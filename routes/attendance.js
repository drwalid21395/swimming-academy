/**
 * نظام الحضور والغياب ومستحقات المدربين والموظفين
 * - حضور المدربين حسب الحصة (مربوط بجدول الحصص الحالي)
 * - حضور الموظفين
 * - الخصومات والإضافات
 * - كشوف المستحقات (payroll) ومعاملات الدفع
 * - سياسات الغياب/التأخير القابلة للتعديل
 * - تقارير وتصدير
 * معزول تلقائياً بين الأكاديميات عبر طبقة withAcademy + scoped-db
 */
const express = require('express');
const router = express.Router();
const { db } = require('../lib/db');
const { getAcademyId } = require('../lib/tenant-context');
const { canView, canAdd, canEdit, canDel, canExport, money, fmtMoney, today, fmtDate, fmtDateTime, audit, parseJSON } = require('../lib/helpers');
const { activeSport, sportClause, groupClause, sessionClause } = require('../lib/sport-context');
const { overlaps, validateRange, normalizeTime, toMinutes } = require('../lib/attendance-time');

/* ---------- حالات الحضور ---------- */
const TRAINER_STATUS = [
  { value: 'حاضر', label: 'حاضر', icon: 'fa-check', cls: 'badge-success' },
  { value: 'غائب', label: 'غائب', icon: 'fa-xmark', cls: 'badge-danger' },
  { value: 'متأخر', label: 'متأخر', icon: 'fa-clock', cls: 'badge-warning' },
  { value: 'معتذر', label: 'معتذر', icon: 'fa-user-shield', cls: 'badge-info' },
  { value: 'ملغاة', label: 'حصة ملغاة', icon: 'fa-ban', cls: 'badge-gray' },
  { value: 'بديل', label: 'مدرب بديل', icon: 'fa-rotate', cls: 'badge-purple' }
];
/* حالات حصص التدريب الخاص (إنجليزي ← عربي لعرضها في كشف المستحقات) */
const PRIVATE_STATUS_AR = { present: 'حاضر', late: 'متأخر', absent: 'غائب', excused: 'معتذر', cancelled: 'ملغاة', scheduled: 'مجدولة' };

const STAFF_STATUS = [
  { value: 'حاضر', label: 'حاضر', cls: 'badge-success' },
  { value: 'غائب', label: 'غائب', cls: 'badge-danger' },
  { value: 'متأخر', label: 'متأخر', cls: 'badge-warning' },
  { value: 'معتذر', label: 'معتذر', cls: 'badge-info' },
  { value: 'إجازة', label: 'إجازة', cls: 'badge-gray' },
  { value: 'منصرف مبكراً', label: 'منصرف مبكراً', cls: 'badge-purple' }
];
const CANCEL_REASONS = ['بواسطة الإدارة', 'بواسطة المدرب', 'بسبب المكان', 'بسبب الطقس', 'سبب آخر'];
const ADJ_CATEGORIES_D = ['غياب', 'تأخير', 'انصراف مبكر', 'خصم إداري', 'سلفة', 'جزاء', 'خصم يدوي', 'خصم آخر'];
const ADJ_CATEGORIES_B = ['Bonus', 'حافز', 'بدل', 'عمل إضافي', 'مكافأة', 'زيادة استثنائية'];
const PAY_METHODS = ['نقدي', 'Vodafone Cash', 'InstaPay', 'تحويل بنكي', 'أخرى'];

function periodOf(dateStr) { return String(dateStr || today()).slice(0, 7); } // YYYY-MM

/* عزل سجلات حضور المدربين باللعبة (عبر مجموعة → برنامج → لعبة) */
function tacScope(sid) {
  const id = Number(sid) || 0;
  if (!id) return '';
  return ` AND group_id IN (SELECT id FROM groups WHERE deleted_at IS NULL AND program_id IN (SELECT id FROM programs WHERE deleted_at IS NULL AND sport_id = ${id}))`;
}

/* عزل صفوف الكشوف/الخصومات ذات الصلة بالمدربين (الموظفون عامون للأكاديمية) */
function tpersonScope(sid, alias) {
  const id = Number(sid) || 0;
  if (!id) return '';
  const a = alias ? alias + '.' : '';
  return ` AND (${a}person_type = 'staff' OR ${a}coach_id IN (SELECT id FROM coaches WHERE deleted_at IS NULL AND sport_id = ${id}))`;
}

/* ---------- سياسة المنظومة (بيانات JSON لكل أكاديمية) ---------- */
const DEFAULT_POLICY = {
  absence_rate: 0,              // 0 = لا تُحتسب، نسبة تحدّد نسبة الحصة المستحقة عند الغياب إن وُجد
  absence_deduction: 0,         // خصم إضافي ثابت عند الغياب
  late_tiers: [                 // تأخير: [issue دقائق، خصم نسبة]
    { min: 0, max: 10, deduct: 0 },
    { min: 10, max: 20, deduct: 25 },
    { min: 20, max: 30, deduct: 50 },
    { min: 30, max: 999999, deduct: 100 }   // أكثر من 30 = غائب
  ],
  cancel_paid: 'نسبة',           // كامل | نسبة | غير مستحقة
  cancel_percent: 50
};

async function getPolicy() {
  const ai = getAcademyId();
  const rows = await db.prepare('SELECT pkey, pvalue FROM attendance_policy').all();
  const map = {};
  rows.forEach(r => { map[r.pkey] = r.pvalue; });
  const pol = Object.assign({}, DEFAULT_POLICY);
  if (map.policy) { try { Object.assign(pol, JSON.parse(map.policy)); } catch (e) {} }
  return { ai, map, pol };
}
async function savePolicy(pol) {
  const ai = getAcademyId();
  const vals = { policy: JSON.stringify(pol) };
  for (const k of Object.keys(vals)) {
    await db.prepare('INSERT OR REPLACE INTO attendance_policy (academy_id, pkey, pvalue) VALUES (?,?,?)').run(ai, k, vals[k]);
  }
}

/* ---------- الأسعار المطبّقة للمدرب (افتراضي + مخصص بفرع/نوع) ---------- */
async function effectiveTrainerRate(coachId, branchId) {
  let r = { default_rate: 0, hourly_rate: 0, private_rate: 0, group_rate: 0 };
  const tr = await db.prepare('SELECT * FROM trainer_rates WHERE coach_id = ? ORDER BY id DESC LIMIT 1').get(coachId);
  if (tr) {
    r = { default_rate: Number(tr.default_rate || 0), hourly_rate: Number(tr.hourly_rate || 0), private_rate: Number(tr.private_rate || 0), group_rate: Number(tr.group_rate || 0) };
  }
  let base = r.default_rate;
  if (branchId) {
    const br = await db.prepare('SELECT * FROM trainer_rates WHERE coach_id = ? AND branch_id = ? ORDER BY id DESC LIMIT 1').get(coachId, Number(branchId));
    if (br && Number(br.branch_rate || 0) > 0) { r = Object.assign(r, { default_rate: Number(br.branch_rate) }); base = Number(br.branch_rate); }
  }
  if (!base) {
    const c = await db.prepare('SELECT salary_amount FROM coaches WHERE id = ?').get(coachId);
    if (c) base = Number(c.salary_amount || 0);
  }
  r.effective = base;
  return r;
}

/* ---------- حساب قيمة حصة وفق السياسة ---------- */
function amountForAttendance(row, pol) {
  const status = row.status;
  const base = Number(row.session_rate || row.base_rate || 0);
  if (status === 'غائب') {
    const ratio = Number(pol.absence_rate || 0) / 100;
    const amt = base * ratio;
    return Math.round((amt - Number(pol.absence_deduction || 0)) * 100) / 100;
  }
  if (status === 'متأخر') {
    const lm = Number(row.late_minutes || 0);
    let pct = 0;
    for (const t of pol.late_tiers || []) {
      if (lm >= Number(t.min) && lm < Number(t.max)) { pct = Number(t.deduct || 0); break; }
    }
    if (pct >= 100) return 0; // اعتُبر غائباً
    return Math.round(base * (100 - pct) / 100 * 100) / 100;
  }
  if (status === 'ملغاة') {
    const rule = row.payment_policy || pol.cancel_paid || 'نسبة';
    if (rule === 'كامل') return base;
    if (rule === 'غير مستحقة') return 0;
    return Math.round(base * (Number(row.cancel_percent || pol.cancel_percent || 0)) / 100 * 100) / 100;
  }
  if (status === 'معتذر') return base; // معتذر بدون حجز (قابل للتعديل حسب السياسة)
  if (status === 'بديل') return base;   // تُحتسب للبديل
  return base; // حاضر
}

function deductForLate(tier) { return tier.deduct; }

/* ================================================================
   دعم التعاقد بالحصة للمدربين والموظفين
   ================================================================ */
function isPerSessionCoach(c) {
  return !!c && (c.salary_type === 'per_session' || c.contract_type === 'بالحصة');
}
function isPerSessionStaff(s) {
  return !!s && (s.salary_type === 'per_session' || s.contract_type === 'بالحصة');
}
async function perSessionRateForStaff(staffId) {
  const s = await db.prepare('SELECT salary FROM staff WHERE id = ?').get(staffId);
  return Number((s && s.salary) || 0);
}

/* الحصص المستحقة للمدرب: حاضر/متأخر/معتذر/بديل (الملغاة حسب السياسة) */
function coachPayableStatuses() { return ['حاضر', 'متأخر', 'معتذر', 'بديل']; }
function staffPayableStatuses() { return ['حاضر', 'متأخر']; }

function rangeWhere(range) {
  if (!range || !range.from || !range.to) return { sql: '', args: [] };
  return { sql: ' AND a.date >= ? AND a.date <= ?', args: [range.from, range.to] };
}

function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

/* إجمالي قيمة الحصص التي تم قبضها (المثبتة في بنود الكشوف) لكل الفترات */
async function claimedSessionAmount(personType, personId) {
  const id = Number(personId) || 0;
  if (!id) return 0;
  let row;
  if (personType === 'trainer') {
    row = await db.prepare(`SELECT COALESCE(SUM(pi.amount),0) AS s
      FROM payroll_items pi
      JOIN trainer_session_attendance a ON a.id = pi.source_id
      WHERE ((pi.source_type = 'trainer' AND a.coach_id = ?) OR (pi.source_type = 'substitute' AND a.substitute_coach_id = ?))`).get(id, id);
  } else {
    row = await db.prepare(`SELECT COALESCE(SUM(pi.amount),0) AS s
      FROM payroll_items pi
      JOIN staff_attendance a ON a.id = pi.source_id
      WHERE pi.source_type = 'staff' AND a.staff_id = ?`).get(id);
  }
  return round2(row && row.s);
}

/* قيم عرض كشف التعاقد بالحصة: الصافي = قيمة الحصص التي لم يتم قبضها (المبلغ المطلوب دفعه) */
function applyPerSessionDisplay(row, balance, unclaimedAmount) {
  const unclaimed = round2(unclaimedAmount);
  const claimedAmount = round2(balance && balance.claimedAmount);
  const extras = round2(row.extras);
  const deductions = round2(row.deductions);
  let net = unclaimed > 0 ? round2(unclaimed + extras - deductions) : 0;
  if (net < 0) net = 0;
  row.displayGross = round2(claimedAmount + unclaimed);
  row.displayExtras = extras;
  row.displayDeductions = deductions;
  row.displayPaid = claimedAmount;
  row.displayNet = net;
  row.displayRemaining = net;
  row.displayStatus = Number(balance && balance.unclaimed) > 0 ? 'لم يتم القبض' : 'تم القبض';
  row.displayUnclaimedAmount = unclaimed;
}

/* مزامنة إجماليات كشف التعاقد بالحصة مع بنوده الفعلية (إصلاح الكشوف التي بقيت بقيمة صفر) */
async function syncPerSessionTotals(row, ctx) {
  if (!row || !row.id || row.settled_at) return row;
  let sum;
  if (ctx && ctx.payrollSums && ctx.payrollSums.has(row.id)) sum = { s: ctx.payrollSums.get(row.id) };
  else sum = await db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payroll_items WHERE payroll_id = ?').get(row.id);
  const gross = round2(sum && sum.s);
  const extras = round2(row.extras);
  const deductions = round2(row.deductions);
  const net = round2(gross + extras - deductions);
  const paid = round2(row.paid_amount);
  const remaining = round2(net - paid);
  let status;
  if (net <= 0 && paid <= 0) status = row.status || 'مستحق';
  else if (remaining <= 0) status = 'مسدد';
  else if (paid > 0) status = 'مدفوع جزئياً';
  else status = 'مستحق';
  const changed = round2(row.gross) !== gross || round2(row.net) !== net || round2(row.remaining) !== remaining || row.status !== status;
  row.gross = gross; row.net = net; row.paid_amount = paid; row.remaining = remaining; row.status = status;
  if (changed) {
    await db.prepare('UPDATE payroll SET gross=?, net=?, remaining=?, status=?, updated_at=? WHERE id=?')
      .run(gross, net, remaining, status, new Date().toLocaleString('sv-SE').replace('T', ' '), row.id);
  }
  return row;
}

async function countSessionBalance(personType, personId, range, ctx) {
  const id = Number(personId) || 0;
  if (!id) return { attended: 0, claimed: 0, unclaimed: 0, rate: 0, amountDue: 0 };
  const rw = rangeWhere(range);
  let rate = 0;
  if (personType === 'trainer') {
    if (ctx && ctx.trainerEffectiveRates && ctx.trainerEffectiveRates.has(id)) rate = Number(ctx.trainerEffectiveRates.get(id) || 0);
    else {
      const r = await effectiveTrainerRate(id, null);
      rate = Number(r.effective || 0);
    }
    const attendedRow = await db.prepare(`SELECT COUNT(*) AS c FROM trainer_session_attendance a
      WHERE a.coach_id = ? AND a.status IN (${coachPayableStatuses().map(() => '?').join(',')})` + rw.sql).get(id, ...coachPayableStatuses(), ...rw.args);
    const claimedRow = await db.prepare(`SELECT COUNT(*) AS c FROM trainer_session_attendance a
      JOIN payroll_items pi ON pi.source_type = 'trainer' AND pi.source_id = a.id
      WHERE a.coach_id = ? AND a.status IN (${coachPayableStatuses().map(() => '?').join(',')})` + rw.sql).get(id, ...coachPayableStatuses(), ...rw.args);
    const subAttended = await db.prepare(`SELECT COUNT(*) AS c FROM trainer_session_attendance a
      WHERE a.substitute_coach_id = ? AND a.status IN (${coachPayableStatuses().map(() => '?').join(',')})` + rw.sql).get(id, ...coachPayableStatuses(), ...rw.args);
    const subClaimed = await db.prepare(`SELECT COUNT(*) AS c FROM trainer_session_attendance a
      JOIN payroll_items pi ON pi.source_type = 'substitute' AND pi.source_id = a.id
      WHERE a.substitute_coach_id = ? AND a.status IN (${coachPayableStatuses().map(() => '?').join(',')})` + rw.sql).get(id, ...coachPayableStatuses(), ...rw.args);
    const attended = Number(attendedRow && attendedRow.c || 0) + Number(subAttended && subAttended.c || 0);
    const claimed = Number(claimedRow && claimedRow.c || 0) + Number(subClaimed && subClaimed.c || 0);
    const claimedAmount = await claimedSessionAmount('trainer', id);
    return { attended, claimed, unclaimed: Math.max(0, attended - claimed), rate, claimedAmount, amountDue: Math.max(0, attended - claimed) * rate };
  }
  // staff
  rate = (ctx && ctx.staffRates && ctx.staffRates.has(id)) ? Number(ctx.staffRates.get(id) || 0) : await perSessionRateForStaff(id);
  const attendedRow = await db.prepare(`SELECT COUNT(*) AS c FROM staff_attendance a
    WHERE a.staff_id = ? AND a.status IN (${staffPayableStatuses().map(() => '?').join(',')})` + rw.sql).get(id, ...staffPayableStatuses(), ...rw.args);
  const claimedRow = await db.prepare(`SELECT COUNT(*) AS c FROM staff_attendance a
    JOIN payroll_items pi ON pi.source_type = 'staff' AND pi.source_id = a.id
    WHERE a.staff_id = ? AND a.status IN (${staffPayableStatuses().map(() => '?').join(',')})` + rw.sql).get(id, ...staffPayableStatuses(), ...rw.args);
  const attended = Number(attendedRow && attendedRow.c || 0);
  const claimed = Number(claimedRow && claimedRow.c || 0);
  const claimedAmount = await claimedSessionAmount('staff', id);
  return { attended, claimed, unclaimed: Math.max(0, attended - claimed), rate, claimedAmount, amountDue: Math.max(0, attended - claimed) * rate };
}

async function listUnclaimedSessions(personType, personId, limit, range, ctx, prefetched) {
  const id = Number(personId) || 0;
  if (!id) return [];
  limit = Math.max(1, Math.min(500, Number(limit) || 100));
  const rw = rangeWhere(range);
  if (personType === 'trainer') {
    const pol = (ctx && ctx.policy) ? ctx.policy : (await getPolicy()).pol;
    const statuses = coachPayableStatuses();
    const ph = statuses.map(() => '?').join(',');
    const rows = prefetched ? prefetched.main : await db.prepare(`SELECT a.*, g.name AS group_name,
      CASE WHEN pi.id IS NULL THEN 0 ELSE 1 END AS claimed
      FROM trainer_session_attendance a
      LEFT JOIN groups g ON g.id = a.group_id
      LEFT JOIN payroll_items pi ON pi.source_type = 'trainer' AND pi.source_id = a.id
      WHERE a.coach_id = ? AND a.status IN (${ph}) AND pi.id IS NULL` + rw.sql + `
      ORDER BY a.date ASC, a.start_time ASC LIMIT ?`).all(id, ...statuses, ...rw.args, limit);
    const subRows = prefetched ? prefetched.sub : await db.prepare(`SELECT a.*, g.name AS group_name,
      CASE WHEN pi.id IS NULL THEN 0 ELSE 1 END AS claimed
      FROM trainer_session_attendance a
      LEFT JOIN groups g ON g.id = a.group_id
      LEFT JOIN payroll_items pi ON pi.source_type = 'substitute' AND pi.source_id = a.id
      WHERE a.substitute_coach_id = ? AND a.status IN (${ph}) AND pi.id IS NULL` + rw.sql + `
      ORDER BY a.date ASC, a.start_time ASC LIMIT ?`).all(id, ...statuses, ...rw.args, limit);
    const map = {};
    const out = [];
    function add(r, isSub) {
      const amt = amountForAttendance(r, pol);
      out.push({
        id: r.id, date: r.date, start_time: r.start_time, status: r.status,
        title: (isSub ? 'بديل: ' : '') + (r.group_name || ('حصة #' + r.session_id)) + (r.start_time ? ' — ' + r.start_time : ''),
        amount: Math.round(Number(amt || 0) * 100) / 100, source_type: isSub ? 'substitute' : 'trainer'
      });
    }
    rows.forEach(r => add(r, false));
    subRows.forEach(r => { if (!map[r.id]) { map[r.id] = 1; add(r, true); } });
    out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return out.slice(0, limit);
  }
  // staff
  const rate = (ctx && ctx.staffRates && ctx.staffRates.has(id)) ? Number(ctx.staffRates.get(id) || 0) : await perSessionRateForStaff(id);
  const statuses = staffPayableStatuses();
  const ph = statuses.map(() => '?').join(',');
  if (prefetched) return prefetched;
  return await db.prepare(`SELECT a.id, a.date, a.status, a.session_rate,
    CASE WHEN pi.id IS NULL THEN 0 ELSE 1 END AS claimed,
    ('يوم عمل — ' || a.date) AS title,
    COALESCE(a.session_rate, ?) AS amount
    FROM staff_attendance a
    LEFT JOIN payroll_items pi ON pi.source_type = 'staff' AND pi.source_id = a.id
    WHERE a.staff_id = ? AND a.status IN (${ph}) AND pi.id IS NULL` + rw.sql + `
    ORDER BY a.date ASC LIMIT ?`).all(rate, id, ...statuses, ...rw.args, limit);
}

/* ================================================================
   الشاشة السريعة: حصص اليوم + تسجيل حضور المدرب بضغطة
================================================================ */
/* أسماء أيام الأسبوع الإنجليزية المقابلة لـ getDay() (0=الأحد ... 6=السبت) */
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function weekdayName(dateStr) { try { const d = new Date(dateStr + 'T12:00:00'); return DAY_NAMES[d.getDay()]; } catch (e) { return null; } }

/* حصص اليوم: الصفوف الفعلية + جلسات المجموعات المتكررة النشطة المتوقعة في ذلك اليوم */
async function sessionsFor(date, sid) {
  const rows = await db.prepare(`SELECT se.id, se.date, se.start_time, se.end_time, se.title, se.status AS ses_status,
      se.group_id, g.name AS group_name, g.branch_id, c.id AS coach_id, c.full_name AS coach_name, p.name AS pool_name
    FROM sessions se
    LEFT JOIN groups g ON g.id = se.group_id
    LEFT JOIN coaches c ON c.id = se.coach_id
    LEFT JOIN pools p ON p.id = se.pool_id
    WHERE se.date = ? AND se.deleted_at IS NULL` + sessionClause(sid, 'se') + `
    ORDER BY se.start_time`).all(date);

  const wd = weekdayName(date);
  if (wd) {
    const groups = await db.prepare(`SELECT g.id, g.name, g.branch_id, g.coach_id, g.pool_id, g.schedule, c.full_name AS coach_name, p.name AS pool_name
      FROM groups g
      LEFT JOIN coaches c ON c.id = g.coach_id
      LEFT JOIN pools p ON p.id = g.pool_id
      WHERE (g.status IS NULL OR g.status = '' OR g.status = 'نشطة') AND g.deleted_at IS NULL` + groupClause(sid) + ``).all();
    for (const g of groups) {
      const hasRealSession = rows.some(r => r.group_id === g.id);
      if (hasRealSession) continue;
      const sch = parseJSON(g.schedule, []);
      const slot = (sch || []).find(s => s.day === wd);
      if (!slot || !g.coach_id) continue;
      rows.push({
        id: null, is_virtual: true, date, start_time: slot.start || '16:00', end_time: slot.end || null,
        title: g.name, ses_status: 'scheduled', group_id: g.id, group_name: g.name, branch_id: g.branch_id,
        coach_id: g.coach_id, coach_name: g.coach_name || '', pool_name: g.pool_name || ''
      });
    }
    rows.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  }
  return rows;
}

/* ===============================================================
   حضور الموظفين
================================================================ */
router.get('/staff-hours', async function (req, res) {
  if (!canView(req.currentUser, 'trainerAttendance') && !canView(req.currentUser, 'staffAttendance')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : today();
  const ai = getAcademyId();
  const { pol } = await getPolicy();

  let sessionsToday = await sessionsFor(date, activeSport(req));

  const atts = await db.prepare('SELECT * FROM trainer_session_attendance WHERE 1=1' + tacScope(activeSport(req)) + ' AND date = ?').all(date);
  const attMap = {};
  atts.forEach(a => { attMap[a.session_id + ':' + a.coach_id] = a; });

  const days = [];
  for (let i = 2; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)); }
  days.push(date);
  days.push('');
  const prevDates = [-1, -2].map(x => { const d = new Date(date); d.setDate(d.getDate() + x); return d.toISOString().slice(0, 10); });

  const yday = (new Date(Date.now() - 86400000)).toISOString().slice(0, 10);
  const tmr = (new Date(Date.now() + 86400000)).toISOString().slice(0, 10);

  // إحصائيات اليوم
  let total = sessionsToday.length, marked = 0, present = 0, absent = 0, late = 0, cancelled = 0;
  sessionsToday.forEach(s => {
    const a = s.coach_id ? attMap[s.id + ':' + s.coach_id] : null;
    if (a) { marked++; if (a.status === 'حاضر') present++; else if (a.status === 'غائب') absent++; else if (a.status === 'متأخر') late++; else if (a.status === 'ملغاة') cancelled++; }
  });

  res.render('attendance_payroll/trainer_home', {
    title: 'صفحة الحضور السريع', active: 'trainerAttendance',
    sessions: sessionsToday, attMap, date, yday, tmr, days, prevDates,
    stats: { total, marked, present, absent, late, cancelled },
    STATUS: TRAINER_STATUS, CANCEL_REASONS, ai, pol
  });
});

/* واجهة بسيطة لتسجيل حضور الحصة */
router.post('/staff-hours/save/:sessionId', async function (req, res) {
  if (!canAdd(req.currentUser, 'trainerAttendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const sessionId = Number(req.params.sessionId);
  const b = req.body;
  const session = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ ok: false, error: 'الحصة غير موجودة' });
  const group = session.group_id ? await db.prepare('SELECT * FROM groups WHERE id = ?').get(session.group_id) : null;
  const branchId = group ? group.branch_id : null;
  const coachId = Number(b.coach_id || session.coach_id || (group && group.coach_id) || 0);
  if (!coachId) return res.status(400).json({ ok: false, error: 'لا يوجد مدرب مرتبط بالحصة' });

  const status = String(b.status || 'حاضر');
  const rate = await effectiveTrainerRate(coachId, branchId);
  const session_rate = b.session_rate !== '' && b.session_rate != null ? Number(b.session_rate) : rate.effective;
  const durationMin = durationMinutes(session.start_time, session.end_time);
  const late_minutes = Number(b.late_minutes || 0);
  const substitute_coach_id = status === 'بديل' ? (Number(b.substitute_coach_id) || null) : null;
  const cancel_reason = status === 'ملغاة' ? String(b.cancel_reason || '') : '';
  const payment_policy = status === 'ملغاة' ? String(b.payment_policy || '') : '';

  const existing = await db.prepare('SELECT * FROM trainer_session_attendance WHERE session_id = ? AND coach_id = ?').get(sessionId, coachId);
  const rec = { session_id: sessionId, group_id: session.group_id, branch_id: branchId, coach_id: coachId, substitute_coach_id, date: session.date, start_time: session.start_time, end_time: session.end_time, duration_min: durationMin, status, session_rate, base_rate: rate.effective, late_minutes, cancel_reason, payment_policy, note: String(b.note || ''), created_by: req.currentUser.id };

  if (existing) {
    rec.updated_by = req.currentUser.id; rec.updated_at = new Date().toLocaleString('sv-SE').replace('T', ' ');
    await db.prepare(`UPDATE trainer_session_attendance SET substitute_coach_id=?, status=?, session_rate=?, late_minutes=?, cancel_reason=?, payment_policy=?, note=?, updated_by=?, updated_at=? WHERE id=?`)
      .run(rec.substitute_coach_id, rec.status, rec.session_rate, rec.late_minutes, rec.cancel_reason, rec.payment_policy, rec.note, rec.updated_by, rec.updated_at, existing.id);
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'trainerAttendance', existing.id, 'تعديل حضور حصة: ' + (group ? group.name : ('#' + sessionId)) + ' — ' + dateLabel(session.date), req);
  } else {
    const info = await db.prepare(`INSERT INTO trainer_session_attendance (session_id, group_id, branch_id, coach_id, substitute_coach_id, date, start_time, end_time, duration_min, status, session_rate, base_rate, late_minutes, cancel_reason, payment_policy, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(rec.session_id, rec.group_id, rec.branch_id, rec.coach_id, rec.substitute_coach_id, rec.date, rec.start_time, rec.end_time, rec.duration_min, rec.status, rec.session_rate, rec.base_rate, rec.late_minutes, rec.cancel_reason, rec.payment_policy, rec.note, rec.created_by);
    audit(req.currentUser.id, req.currentUser.full_name, 'add', 'trainerAttendance', Number(info.lastInsertRowid || 0), 'تسجيل حضور حصة: ' + (group ? group.name : ('#' + sessionId)) + ' — ' + dateLabel(session.date) + ' (' + status + ')', req);
  }
  res.json({ ok: true });
});

/* تسجيل حضور حصة مجموعة متكررة غير مادية (تُنشئ الحصة تلقائياً) */
router.post('/staff-hours/save-group', async function (req, res) {
  if (!canAdd(req.currentUser, 'trainerAttendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const b = req.body;
  const gid = Number(b.group_id || 0);
  const date = String(b.date || today());
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  if (!group) return res.status(404).json({ ok: false, error: 'المجموعة غير موجودة' });
  let session = await db.prepare('SELECT * FROM sessions WHERE group_id = ? AND date = ? AND deleted_at IS NULL ORDER BY start_time LIMIT 1').get(gid, date);
  if (!session) {
    const wd = weekdayName(date);
    const sch = parseJSON(group.schedule, []);
    const slot = (sch || []).find(s => s.day === wd);
    const info = await db.prepare(`INSERT INTO sessions (group_id, title, date, start_time, end_time, coach_id, pool_id, status, is_compensatory, note) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(gid, group.name + ' - ' + date, date, (slot && slot.start) || '16:00', (slot && slot.end) || null, group.coach_id, group.pool_id, 'scheduled', 0, 'أُنشئت تلقائياً من صفحة الحضور السريع');
    session = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(info.lastInsertRowid || 0));
  }
  if (!session) return res.status(500).json({ ok: false, error: 'تعذر إنشاء الحصة' });
  const branchId = group.branch_id || null;
  const coachId = Number(b.coach_id || session.coach_id || group.coach_id || 0);
  if (!coachId) return res.status(400).json({ ok: false, error: 'لا يوجد مدرب مرتبط بالمجموعة' });

  const status = String(b.status || 'حاضر');
  const rate = await effectiveTrainerRate(coachId, branchId);
  const session_rate = b.session_rate !== '' && b.session_rate != null ? Number(b.session_rate) : rate.effective;
  const durationMin = durationMinutes(session.start_time, session.end_time);
  const late_minutes = Number(b.late_minutes || 0);
  const substitute_coach_id = status === 'بديل' ? (Number(b.substitute_coach_id) || null) : null;
  const cancel_reason = status === 'ملغاة' ? String(b.cancel_reason || '') : '';
  const payment_policy = status === 'ملغاة' ? String(b.payment_policy || '') : '';

  const existing = await db.prepare('SELECT * FROM trainer_session_attendance WHERE session_id = ? AND coach_id = ?').get(session.id, coachId);
  const rec = { session_id: session.id, group_id: group.id, branch_id: branchId, coach_id: coachId, substitute_coach_id, date, start_time: session.start_time, end_time: session.end_time, duration_min: durationMin, status, session_rate, base_rate: rate.effective, late_minutes, cancel_reason, payment_policy, note: String(b.note || ''), created_by: req.currentUser.id };

  if (existing) {
    rec.updated_by = req.currentUser.id; rec.updated_at = new Date().toLocaleString('sv-SE').replace('T', ' ');
    await db.prepare(`UPDATE trainer_session_attendance SET substitute_coach_id=?, status=?, session_rate=?, late_minutes=?, cancel_reason=?, payment_policy=?, note=?, updated_by=?, updated_at=? WHERE id=?`)
      .run(rec.substitute_coach_id, rec.status, rec.session_rate, rec.late_minutes, rec.cancel_reason, rec.payment_policy, rec.note, rec.updated_by, rec.updated_at, existing.id);
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'trainerAttendance', existing.id, 'تعديل حضور حصة: ' + group.name + ' — ' + date + ' (' + status + ')', req);
  } else {
    const info = await db.prepare(`INSERT INTO trainer_session_attendance (session_id, group_id, branch_id, coach_id, substitute_coach_id, date, start_time, end_time, duration_min, status, session_rate, base_rate, late_minutes, cancel_reason, payment_policy, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(rec.session_id, rec.group_id, rec.branch_id, rec.coach_id, rec.substitute_coach_id, rec.date, rec.start_time, rec.end_time, rec.duration_min, rec.status, rec.session_rate, rec.base_rate, rec.late_minutes, rec.cancel_reason, rec.payment_policy, rec.note, rec.created_by);
    audit(req.currentUser.id, req.currentUser.full_name, 'add', 'trainerAttendance', Number(info.lastInsertRowid || 0), 'تسجيل حضور حصة: ' + group.name + ' — ' + date + ' (' + status + ')', req);
  }
  res.json({ ok: true, session_id: session.id });
});

/* ---------- كشوف الملف: المدربون والموظفون + 500 API ---------- */
router.get('/api/trainer-rates/:coachId', async function (req, res) {
  if (!canView(req.currentUser, 'trainerAttendance')) return res.status(403).json({ ok: false });
  const r = await effectiveTrainerRate(Number(req.params.coachId));
  res.json({ ok: true, rate: r });
});

/* حصة جديدة للمدرب بوقت محدد — مع منع تكرار نفس المدرب في وقت متداخل */
router.post('/trainer-attendance/quick-session', async function (req, res) {
  if (!canAdd(req.currentUser, 'trainerAttendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const date = String(req.body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'تاريخ غير صحيح' });
  const range = validateRange(req.body.time_from, req.body.time_to);
  if (range.error) return res.status(400).json({ ok: false, error: range.error });
  const coachId = Number(req.body.coach_id || 0);
  const coach = await db.prepare('SELECT * FROM coaches WHERE id = ?').get(coachId);
  if (!coach) return res.status(400).json({ ok: false, error: 'اختر المدرب أولاً' });
  const existing = await db.prepare("SELECT start_time, end_time FROM trainer_session_attendance WHERE coach_id = ? AND date = ? AND status IN ('حاضر','متأخر','بديل')").all(coachId, date);
  for (const a of existing) {
    if (overlaps(range.from, range.to, a.start_time, a.end_time)) return res.json({ ok: false, error: 'المدرب مسجّل بالفعل في حصة متداخلة في هذا التوقيت' });
  }
  const rate = await effectiveTrainerRate(coachId, coach.branch_id || null);
  const durationMin = toMinutes(range.to) - toMinutes(range.from);
  const info = await db.prepare(`INSERT INTO sessions (group_id, title, date, start_time, end_time, coach_id, status, note, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(null, (coach.full_name || ('مدرب #' + coachId)) + ' - ' + date + ' (' + range.from + ')',
      date, range.from, range.to, coachId, 'scheduled', 'أُنشئت من شاشة حضور المدربين', req.currentUser.id);
  const sessionId = Number(info.lastInsertRowid || 0);
  const rec = await db.prepare(`INSERT INTO trainer_session_attendance
    (session_id, coach_id, date, start_time, end_time, duration_min, status, session_rate, base_rate, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(sessionId, coachId, date, range.from, range.to, durationMin, String(req.body.status || 'حاضر'), rate.effective, rate.effective, req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'trainerAttendance', Number(rec.lastInsertRowid || 0),
    'حصة جديدة بالوقت: ' + (coach.full_name || coachId) + ' — ' + date + ' (' + range.from + ' - ' + range.to + ')', req);
  res.json({ ok: true, id: Number(rec.lastInsertRowid || 0) });
});

/* إيجاد حصة المدرب في الموعد المحدد، أو إنشاؤها عند عدم وجودها */
async function findOrCreateTrainerSlot(req, coach, date, from, to) {
  const dayAtts = await db.prepare(`SELECT a.* FROM trainer_session_attendance a
    WHERE a.coach_id = ? AND a.date = ? ORDER BY a.id`).all(coach.id, date);
  let att = dayAtts.find(function (a) { return overlaps(from, to, a.start_time, a.end_time); }) || null;
  let createdNow = false;
  if (!att && canAdd(req.currentUser, 'trainerAttendance')) {
    const info = await db.prepare(`INSERT INTO sessions (group_id, title, date, start_time, end_time, coach_id, status, note, created_by)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(null, (coach.full_name || ('مدرب #' + coach.id)) + ' - ' + date + ' (' + from + ')', date, from, to, coach.id,
        'scheduled', 'أُنشئت من شاشة حضور المدربين', req.currentUser.id);
    const sid = Number(info.lastInsertRowid || 0);
    const rate = await effectiveTrainerRate(coach.id, coach.branch_id || null);
    const rec = await db.prepare(`INSERT INTO trainer_session_attendance
      (session_id, coach_id, branch_id, date, start_time, end_time, duration_min, status, session_rate, base_rate, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(sid, coach.id, coach.branch_id || null, date, from, to, toMinutes(to) - toMinutes(from), '', rate.effective, rate.effective, req.currentUser.id);
    att = await db.prepare('SELECT * FROM trainer_session_attendance WHERE id = ?').get(Number(rec.lastInsertRowid || 0));
    createdNow = true;
    audit(req.currentUser.id, req.currentUser.full_name, 'add', 'trainerAttendance', att && att.id,
      'حصة جديدة بالوقت: ' + (coach.full_name || coach.id) + ' — ' + date + ' (' + from + ' - ' + to + ')', req);
  }
  return att ? { att: att, createdNow: createdNow } : null;
}

/* ================================================================
   حضور المدربين (سجل + ترشيح بالشهر)
================================================================ */
router.get('/trainer-attendance', async function (req, res) {
  if (!canView(req.currentUser, 'trainerAttendance')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const month = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : today().slice(0, 7);
  const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : today();
  const from = normalizeTime(req.query.from), to = normalizeTime(req.query.to);
  /* لا تظهر قائمة المدربين إلا بعد تحديد التاريخ والوقت صراحةً */
  const slotMode = !!(from && to && toMinutes(to) > toMinutes(from));
  const coachFilter = Number(req.query.coach) || 0;
  const canAddAtt = canAdd(req.currentUser, 'trainerAttendance');
  const fBranch = (req.query.branch && /^\d+$/.test(req.query.branch)) ? Number(req.query.branch) : null;
  const fPool = (req.query.pool && /^\d+$/.test(req.query.pool)) ? Number(req.query.pool) : null;
  const placeFilter = fPool ? ' AND a.pool_id = ' + fPool : (fBranch ? ' AND a.branch_id = ' + fBranch : '');
  const rows = await db.prepare(`SELECT a.*, g.name AS group_name, b.name AS branch_name, c.full_name AS coach_name,
      COALESCE(sc.full_name, a.substitute_name) AS substitute_name, p.name AS pool_name
    FROM trainer_session_attendance a
    LEFT JOIN groups g ON g.id = a.group_id
    LEFT JOIN branches b ON b.id = a.branch_id
    LEFT JOIN pools p ON p.id = a.pool_id
    LEFT JOIN coaches c ON c.id = a.coach_id
    LEFT JOIN coaches sc ON sc.id = a.substitute_coach_id
    WHERE substr(a.date,1,7) = ?` + tacScope(activeSport(req)) + placeFilter + `
    ORDER BY a.date DESC, a.start_time`).all(month);
  const pol = (await getPolicy()).pol;
  rows.forEach(r => { r.amount = amountForAttendance(r, pol); });

  const coaches = await db.prepare(`SELECT c.* FROM coaches c WHERE c.deleted_at IS NULL AND (c.status IS NULL OR c.status = '' OR c.status = 'active' OR c.status = 'نشط' OR c.status = 'نشطة')` + sportClause(activeSport(req), 'c') + ` ORDER BY c.full_name`).all();
  const targetCoaches = slotMode
    ? coaches.filter(c => (!coachFilter || c.id === coachFilter) && (!fBranch || c.branch_id === fBranch))
    : [];
  const sheet = [];
  if (slotMode) {
    for (const c of targetCoaches) {
      /* حصة مسجّلة بالفعل في هذا المدى؟ تُعرض حالتها المحفوظة كما هي */
      const slot = await findOrCreateTrainerSlot(req, c, date, from, to);
      if (!slot) continue;
      const att = slot.att;
      const createdNow = slot.createdNow;
      const grp = att.group_id ? await db.prepare('SELECT name FROM groups WHERE id = ?').get(att.group_id) : null;
      sheet.push(Object.assign({}, c, {
        time: att.start_time, group_name: grp ? grp.name : null,
        att, atts: [att], att_id: att.id, createdNow
      }));
    }
  }

  let present = 0, absent = 0, excused = 0, late = 0;
  sheet.forEach(s => {
    const st = s.att && s.att.status;
    if (st === 'حاضر') present++; else if (st === 'غائب') absent++; else if (st === 'معتذر') excused++; else if (st === 'متأخر') late++;
  });
  const yday = (new Date(Date.now() - 86400000)).toISOString().slice(0, 10);
  const branches = await db.prepare(`SELECT id, name FROM branches ORDER BY name`).all();
  const pools = await db.prepare(`SELECT p.id, p.name, p.branch_id FROM pools p ORDER BY p.name`).all();
  res.render('attendance_payroll/trainer_attendance', { title: 'حضور المدربين', active: 'trainerAttendance', sheet, rows, month, date, from, to, slotMode, coachFilter, yday, kpi: { present, absent, excused, late }, coaches, STATUS: TRAINER_STATUS, canAdd: canAddAtt, branches, pools, fBranch, fPool });
});

/* شاشة مسح باركود المدربين داخل الموعد المحدد */
router.get('/trainer-attendance/scan', async function (req, res) {
  if (!canView(req.currentUser, 'trainerAttendance')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : today();
  const from = normalizeTime(req.query.from), to = normalizeTime(req.query.to);
  if (!(from && to && toMinutes(to) > toMinutes(from))) return res.redirect('/trainer-attendance?date=' + date);
  const coachFilter = Number(req.query.coach) || 0;
  const coaches = await db.prepare(`SELECT c.* FROM coaches c WHERE c.deleted_at IS NULL AND (c.status IS NULL OR c.status = '' OR c.status = 'active' OR c.status = 'نشط' OR c.status = 'نشطة')` + sportClause(activeSport(req), 'c') + ` ORDER BY c.full_name`).all();
  const targets = coaches.filter(c => !coachFilter || c.id === coachFilter);
  const groups = [];
  let present = 0, absent = 0;
  for (const c of targets) {
    const slot = await findOrCreateTrainerSlot(req, c, date, from, to);
    if (!slot) continue;
    const att = slot.att;
    const status = att.status || '';
    if (status === 'حاضر' || status === 'متأخر') present++;
    else if (status === 'غائب') absent++;
    groups.push({
      id: c.id,
      name: c.full_name,
      coach_name: '',
      pool_name: '',
      session: { id: att.session_id, start_time: att.start_time, end_time: att.end_time },
      session_id: att.session_id,
      members: [{ id: c.id, full_name: c.full_name, membership_no: 'TR-' + c.id, barcode: 'TR-' + c.id, att_status: status }],
      attMap: { [c.id]: status }
    });
  }
  const back = '/trainer-attendance?date=' + date + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + '&coach=' + coachFilter;
  res.render('membership_card_scan', {
    title: 'مسح باركود المدربين', active: 'trainerAttendance',
    canScan: canAdd(req.currentUser, 'trainerAttendance') || canEdit(req.currentUser, 'trainerAttendance'),
    groups: groups, sessionId: 0, sessionTitle: '',
    scanScope: 'trainer', scanEndpoint: '/trainer-attendance/scan-mark', backUrl: back,
    slot: { date: date, from: from, to: to, filter: coachFilter, label: coachFilter ? ((coaches.find(c => c.id === coachFilter) || {}).full_name || 'مدرب محدد') : 'جميع المدربين' },
    attDate: date, stats: { present: present, absent: absent }, recent: [], todayDate: date,
    pageScripts: ['/vendor/zxing.min.js']
  });
});

/* تسجيل حضور مدرب بمسح الباركود داخل الموعد المحدد */
router.post('/trainer-attendance/scan-mark', async function (req, res) {
  if (!canAdd(req.currentUser, 'trainerAttendance') && !canEdit(req.currentUser, 'trainerAttendance')) {
    return res.status(403).json({ ok: false, status: 'forbidden', message: 'غير مصرح بتسجيل حضور المدربين' });
  }
  const date = String(req.body && req.body.date || '');
  const from = normalizeTime(req.body && req.body.from), to = normalizeTime(req.body && req.body.to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !from || !to || toMinutes(to) <= toMinutes(from)) {
    return res.status(400).json({ ok: false, status: 'invalid', message: 'الموعد المحدد غير صالح' });
  }
  const raw = String(req.body && req.body.code || '').trim().toUpperCase();
  const m = raw.match(/^\*?TR-?0*(\d+)\*?$/) || (/^\d+$/.test(raw) ? raw.match(/^0*(\d+)$/) : null);
  const coachId = m ? Number(m[1]) : 0;
  if (!coachId) return res.json({ ok: false, status: 'not_found', message: 'باركود مدرب غير صالح — الصيغة المتوقعة TR-رقم المدرب', code: raw });
  const coach = await db.prepare('SELECT * FROM coaches WHERE id = ? AND deleted_at IS NULL').get(coachId);
  if (!coach) return res.json({ ok: false, status: 'not_found', message: 'مدرب غير معروف — تأكد من الباركود', code: raw });
  const coachFilter = Number(req.body && req.body.coach) || 0;
  if (coachFilter && coachFilter !== coachId) {
    return res.json({ ok: false, status: 'not_found', message: 'هذا الباركود ليس للمدرب المحدد في هذا الموعد', code: raw });
  }
  try {
    const slot = await findOrCreateTrainerSlot(req, coach, date, from, to);
    if (!slot) return res.json({ ok: false, status: 'error', message: 'لا توجد حصة في هذا الموعد وليست لديك صلاحية إنشائها' });
    const att = slot.att;
    const mode = req.body.mode === 'absent' ? 'absent' : 'present';
    const next = mode === 'absent' ? 'غائب' : 'حاضر';
    const current = att.status || '';
    const time = new Date().toLocaleString('sv-SE').slice(11, 16);
    const person = { id: coach.id, name: coach.full_name, membership_no: 'TR-' + coach.id, program_name: 'مدرب' };
    if (current === next || (mode === 'present' && (current === 'متأخر' || current === 'بديل'))) {
      return res.json({ ok: false, status: 'duplicate', message: 'المدرب مسجّل بالفعل في هذه الحصة', swimmer: person, time: time, session_id: att.session_id });
    }
    if (mode === 'present') {
      const others = await db.prepare(`SELECT id, status, start_time, end_time FROM trainer_session_attendance
        WHERE coach_id = ? AND date = ? AND id <> ?`).all(coachId, date, att.id);
      const clash = others.find(a => overlaps(from, to, a.start_time, a.end_time) && ['حاضر', 'متأخر', 'بديل'].indexOf(a.status) > -1);
      if (clash) return res.json({ ok: false, status: 'time_clash', message: 'المدرب مسجّل حاضراً بالفعل في حصة متداخلة في هذا التوقيت', swimmer: person, time: time, session_id: att.session_id });
    }
    await db.prepare('UPDATE trainer_session_attendance SET status=?, updated_by=?, updated_at=? WHERE id=?')
      .run(next, req.currentUser.id, new Date().toLocaleString('sv-SE').replace('T', ' '), att.id);
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'trainerAttendance', att.id,
      (mode === 'absent' ? 'تسجيل غياب' : 'تسجيل حضور') + ' بمسح الباركود: ' + coach.full_name, req);

    const dayRows = await db.prepare('SELECT * FROM trainer_session_attendance WHERE date = ?').all(date);
    const statuses = {};
    let present = 0, absent = 0;
    for (const row of dayRows) {
      if (!overlaps(from, to, row.start_time, row.end_time)) continue;
      statuses[row.coach_id] = row.status;
      if (row.status === 'حاضر' || row.status === 'متأخر' || row.status === 'بديل') present++;
      else if (row.status === 'غائب') absent++;
    }
    res.json({
      ok: true, status: next, message: mode === 'absent' ? 'تم تسجيل غياب المدرب' : 'تم تسجيل حضور المدرب',
      swimmer: person, person: person, time: time, session_id: att.session_id,
      statuses: statuses, stats: { present: present, absent: absent }
    });
  } catch (e) {
    console.error('خطأ في مسح باركود المدربين:', e.message);
    res.status(500).json({ ok: false, status: 'error', message: 'تعذر تسجيل العملية، حاول مرة أخرى' });
  }
});

router.post('/trainer-attendance/bulk-delete', async function (req, res) {
  if (!canDel(req.currentUser, 'trainerAttendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(n => Number.isFinite(n));
  if (!ids.length) return res.json({ ok: false, error: 'لا توجد سجلات' });
  try {
    await db.prepare('DELETE FROM trainer_session_attendance WHERE id IN (' + ids.map(() => '?').join(',') + ')').run(...ids);
    res.json({ ok: true, count: ids.length });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/trainer-attendance/bulk-clear', async function (req, res) {
  if (!canEdit(req.currentUser, 'trainerAttendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(n => Number.isFinite(n));
  if (!ids.length) return res.json({ ok: false, error: 'لا توجد سجلات' });
  try {
    await db.prepare('UPDATE trainer_session_attendance SET status = ? WHERE id IN (' + ids.map(() => '?').join(',') + ')').run('', ...ids);
    res.json({ ok: true, count: ids.length });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/trainer-attendance/clear-range', async function (req, res) {
  if (!canDel(req.currentUser, 'trainerAttendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const from = String(req.body.from || '');
  const to = String(req.body.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.json({ ok: false, error: 'تاريخ غير صحيح' });
  try {
    await db.prepare('DELETE FROM trainer_session_attendance WHERE date >= ? AND date <= ?').run(from, to);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

/* حفظ حضور يومي جماعي لجميع المدربين (ينشئ الحصص تلقائياً حسب الجدول اليوم) */
router.post('/trainer-attendance/save-day', async function (req, res) {
  if (!canAdd(req.currentUser, 'trainerAttendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const b = req.body;
  const date = String(b.date || today());
  const wd = weekdayName(date);
  const statuses = b.statuses || {};
  let n = 0;
  for (const cid of Object.keys(statuses || {})) {
    const coachId = Number(cid);
    if (!coachId) continue;
    const v = statuses[cid] || {};
    const status = String(v.status || 'حاضر');
    const coach = await db.prepare('SELECT * FROM coaches WHERE id = ?').get(coachId);
    if (!coach) continue;
    /* عند الحفظ من شاشة الموعد المحدد نستخدم الحصة المرتبطة بالسجل نفسه */
    const attById = v.att_id
      ? await db.prepare('SELECT * FROM trainer_session_attendance WHERE id = ?').get(Number(v.att_id))
      : null;
    let session = attById && attById.session_id
      ? await db.prepare('SELECT * FROM sessions WHERE id = ?').get(attById.session_id)
      : null;
    if (!session) session = await db.prepare(`SELECT * FROM sessions WHERE date = ? AND coach_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1`).get(date, coachId);
    if (!session) {
      let group = null;
      const groups = await db.prepare(`SELECT * FROM groups WHERE coach_id = ? AND (status IS NULL OR status = '' OR status = 'نشطة') AND deleted_at IS NULL`).all(coachId);
      for (const g of groups) {
        const sch = parseJSON(g.schedule, []);
        const slot = (sch || []).find(s => s.day === wd);
        if (slot) { group = g; break; }
      }
      const startT = group ? (() => { const sch = parseJSON(group.schedule, []); const slot = sch.find(s => s.day === wd); return (slot && slot.start) || '16:00'; })() : (v.time || '16:00');
      const info = await db.prepare(`INSERT INTO sessions (group_id, title, date, start_time, end_time, coach_id, pool_id, status, is_compensatory, note) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(group ? group.id : null, (group ? group.name : (coach.full_name || ('مدرب #' + coachId))) + ' - ' + date, date, startT, null, coachId, group ? group.pool_id : null, 'scheduled', 0, 'أُنشئت تلقائياً من شاشة حضور المدربين');
      session = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(info.lastInsertRowid || 0));
    }
    if (!session) continue;
    const groupRow = session.group_id ? await db.prepare('SELECT * FROM groups WHERE id = ?').get(session.group_id) : null;
    const rate = await effectiveTrainerRate(coachId, groupRow ? groupRow.branch_id : null);
    const session_rate = v.session_rate !== '' && v.session_rate != null ? Number(v.session_rate) : rate.effective;
    const durationMin = durationMinutes(session.start_time, session.end_time);
    const late_minutes = Number(v.late_minutes || 0);
    const substitute_coach_id = status === 'بديل' ? (Number(v.substitute_coach_id) || null) : null;
    const substitute_name = status === 'بديل' && !substitute_coach_id ? String(v.substitute_name || '').trim().slice(0, 120) : null;
    const cancel_reason = status === 'ملغاة' ? String(v.cancel_reason || '') : '';
    const payment_policy = status === 'ملغاة' ? String(v.payment_policy || '') : '';
    const existing = attById || await db.prepare('SELECT * FROM trainer_session_attendance WHERE session_id = ? AND coach_id = ?').get(session.id, coachId);
    let pool_id = Number(v.pool_id) || (existing && existing.pool_id) || session.pool_id || (groupRow ? groupRow.pool_id : null) || null;
    let branch_id = (existing && existing.branch_id) || (groupRow ? groupRow.branch_id : null);
    if (pool_id) {
      const poolRow = await db.prepare('SELECT * FROM pools WHERE id = ?').get(pool_id);
      if (poolRow) { branch_id = poolRow.branch_id || branch_id; } else { pool_id = null; }
    }
    if (existing) {
      await db.prepare(`UPDATE trainer_session_attendance SET status=?, session_rate=?, late_minutes=?, cancel_reason=?, payment_policy=?, note=?, pool_id=?, branch_id=?, substitute_coach_id=?, substitute_name=?, updated_by=?, updated_at=? WHERE id=?`)
        .run(status, session_rate, late_minutes, cancel_reason, payment_policy, String(v.note || ''), pool_id, branch_id, substitute_coach_id, substitute_name, req.currentUser.id, new Date().toLocaleString('sv-SE').replace('T', ' '), existing.id);
    } else {
      await db.prepare(`INSERT INTO trainer_session_attendance (session_id, group_id, branch_id, pool_id, coach_id, substitute_coach_id, substitute_name, date, start_time, end_time, duration_min, status, session_rate, base_rate, late_minutes, cancel_reason, payment_policy, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(session.id, session.group_id, branch_id, pool_id, coachId, substitute_coach_id, substitute_name, date, session.start_time, session.end_time, durationMin, status, session_rate, rate.effective, late_minutes, cancel_reason, payment_policy, String(v.note || ''), req.currentUser.id);
    }
    n++;
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'trainerAttendance', 0, 'حفظ حضور يومي للمدربين (' + n + ') — ' + date, req);
  res.json({ ok: true, count: n });
});

/* حصة/فترة جديدة للموظف بوقت محدد — مع منع تكرار نفس الموظف في وقت متداخل */
router.post('/staff-attendance/quick-session', async function (req, res) {
  if (!canAdd(req.currentUser, 'staffAttendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const date = String(req.body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'تاريخ غير صحيح' });
  const range = validateRange(req.body.time_from, req.body.time_to);
  if (range.error) return res.status(400).json({ ok: false, error: range.error });
  const staffId = Number(req.body.staff_id || 0);
  const staffRow = await db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId);
  if (!staffRow) return res.status(400).json({ ok: false, error: 'اختر الموظف أولاً' });
  const existing = await db.prepare("SELECT check_in, check_out FROM staff_attendance WHERE staff_id = ? AND date = ? AND status IN ('حاضر','متأخر')").all(staffId, date);
  for (const a of existing) {
    if (overlaps(range.from, range.to, a.check_in, a.check_out)) return res.json({ ok: false, error: 'الموظف مسجّل بالفعل في فترة متداخلة في هذا التوقيت' });
  }
  const rate = isPerSessionStaff(staffRow) ? Number(staffRow.salary || 0) : 0;
  const rec = await db.prepare(`INSERT INTO staff_attendance
    (staff_id, branch_id, date, check_in, check_out, status, shift_count, session_rate, base_rate, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(staffId, staffRow.branch_id || null, date, range.from, range.to, String(req.body.status || 'حاضر'), 1, rate, rate, req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'staffAttendance', Number(rec.lastInsertRowid || 0),
    'فترة جديدة بالوقت: ' + (staffRow.full_name || staffId) + ' — ' + date + ' (' + range.from + ' - ' + range.to + ')', req);
  res.json({ ok: true, id: Number(rec.lastInsertRowid || 0) });
});

router.get('/staff-attendance', async function (req, res) {
  if (!canView(req.currentUser, 'staffAttendance')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const month = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : today().slice(0, 7);
  const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : today();
  const rows = await db.prepare(`SELECT s.*, b.name AS branch_name, st.full_name AS staff_name
    FROM staff_attendance s
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN staff st ON st.id = s.staff_id
    WHERE substr(s.date,1,7) = ?
    ORDER BY s.date DESC`).all(month);
  const staff = await db.prepare(`SELECT st.*, b.name AS branch_name FROM staff st
    LEFT JOIN branches b ON b.id = st.branch_id
    WHERE (st.status IS NULL OR st.status = '' OR st.status = 'active' OR st.status = 'نشط' OR st.status = 'نشطة')
    ORDER BY st.full_name`).all();
  const dayAtt = {}, dayAtts = {};
  const dayRows = await db.prepare('SELECT * FROM staff_attendance WHERE date = ? ORDER BY check_in, id').all(date);
  dayRows.forEach(a => { if (!dayAtt[a.staff_id]) dayAtt[a.staff_id] = a; if (!dayAtts[a.staff_id]) dayAtts[a.staff_id] = []; dayAtts[a.staff_id].push(a); });
  const sheet = staff.map(s => Object.assign({}, s, { att: dayAtt[s.id] || null, atts: dayAtts[s.id] || [] }));
  const staffRates = {};
  (await db.prepare('SELECT * FROM staff_rates').all()).forEach(r => staffRates[r.staff_id] = r);
  let present = 0, absent = 0, excused = 0, late = 0;
  dayRows.forEach(a => {
    const st = a.status;
    if (st === 'حاضر') present++; else if (st === 'غائب') absent++; else if (st === 'معتذر') excused++; else if (st === 'متأخر') late++;
  });
  const yday = (new Date(Date.now() - 86400000)).toISOString().slice(0, 10);
  res.render('attendance_payroll/staff_attendance', { title: 'حضور الموظفين', active: 'staffAttendance', sheet, rows, staff, staffRates, month, date, yday, kpi: { present, absent, excused, late }, STATUS: STAFF_STATUS, canAdd: canAdd(req.currentUser, 'staffAttendance') });
});

router.post('/staff-attendance/save', async function (req, res) {
  if (!canAdd(req.currentUser, 'staffAttendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const b = req.body;
  const staffId = Number(b.staff_id || 0);
  const date = String(b.date || today());
  if (!staffId) return res.json({ ok: false, error: 'اختر الموظف' });
  const staffRow = await db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId);
  const existing = await db.prepare('SELECT * FROM staff_attendance WHERE staff_id = ? AND date = ?').get(staffId, date);
  const rate = isPerSessionStaff(staffRow) ? Number(staffRow.salary || 0) : 0;
  const rec = {
    staff_id: staffId, branch_id: b.branch_id || (staffRow && staffRow.branch_id) || null,
    date, check_in: b.check_in || '', check_out: b.check_out || '',
    status: String(b.status || 'حاضر'), shift_count: Number(b.shift_count || 1),
    session_rate: rate, base_rate: rate,
    late_minutes: Number(b.late_minutes || 0), early_leave: Number(b.early_leave || 0),
    overtime_minutes: Number(b.overtime_minutes || 0), note: String(b.note || '')
  };
  if (existing) {
    await db.prepare(`UPDATE staff_attendance SET branch_id=?, check_in=?, check_out=?, status=?, shift_count=?, session_rate=?, base_rate=?, late_minutes=?, early_leave=?, overtime_minutes=?, note=? WHERE id=?`)
      .run(rec.branch_id, rec.check_in, rec.check_out, rec.status, rec.shift_count, rec.session_rate, rec.base_rate, rec.late_minutes, rec.early_leave, rec.overtime_minutes, rec.note, existing.id);
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'staffAttendance', existing.id, 'تعديل حضور: ' + (staffRow ? staffRow.full_name : staffId) + ' — ' + date, req);
  } else {
    const info = await db.prepare(`INSERT INTO staff_attendance (staff_id, branch_id, date, check_in, check_out, status, shift_count, session_rate, base_rate, late_minutes, early_leave, overtime_minutes, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(rec.staff_id, rec.branch_id, rec.date, rec.check_in, rec.check_out, rec.status, rec.shift_count, rec.session_rate, rec.base_rate, rec.late_minutes, rec.early_leave, rec.overtime_minutes, rec.note, req.currentUser.id);
    audit(req.currentUser.id, req.currentUser.full_name, 'add', 'staffAttendance', Number(info.lastInsertRowid || 0), 'تسجيل حضور: ' + (staffRow ? staffRow.full_name : staffId) + ' — ' + date + ' (' + rec.status + ')', req);
  }
  res.json({ ok: true });
});

/* ================================================================
   الخصومات والإضافات
================================================================ */
/* حفظ حضور يومي جماعي لجميع الموظفين */
router.post('/staff-attendance/save-day', async function (req, res) {
  if (!canAdd(req.currentUser, 'staffAttendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const b = req.body;
  const date = String(b.date || today());
  const statuses = b.statuses || {};
  const stmtU = await db.prepare(`UPDATE staff_attendance SET branch_id=?, check_in=?, check_out=?, status=?, shift_count=?, session_rate=?, base_rate=?, late_minutes=?, early_leave=?, overtime_minutes=?, note=? WHERE id=?`);
  const stmtI = await db.prepare(`INSERT INTO staff_attendance (staff_id, branch_id, date, check_in, check_out, status, shift_count, session_rate, base_rate, late_minutes, early_leave, overtime_minutes, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  for (const sid of Object.keys(statuses || {})) {
    const id = Number(sid);
    if (!id) continue;
    const v = statuses[sid] || {};
    const staffRow = await db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
    const status = String(v.status || 'حاضر');
    const rate = isPerSessionStaff(staffRow) ? Number(staffRow.salary || 0) : 0;
    const existing = await db.prepare('SELECT * FROM staff_attendance WHERE staff_id = ? AND date = ?').get(id, date);
    if (existing) {
      await stmtU.run(staffRow && staffRow.branch_id || null, v.check_in || '', v.check_out || '', status, Number(v.shift_count || 1), rate, rate, Number(v.late_minutes || 0), Number(v.early_leave || 0), Number(v.overtime_minutes || 0), String(v.note || ''), existing.id);
    } else {
      await stmtI.run(id, staffRow && staffRow.branch_id || null, date, v.check_in || '', v.check_out || '', status, Number(v.shift_count || 1), rate, rate, Number(v.late_minutes || 0), Number(v.early_leave || 0), Number(v.overtime_minutes || 0), String(v.note || ''), req.currentUser.id);
    }
    n++;
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'staffAttendance', 0, 'حفظ حضور يومي للموظفين (' + n + ') — ' + date, req);
  res.json({ ok: true, count: n });
});

router.get('/deductions', async function (req, res) {
  if (!canView(req.currentUser, 'payroll')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const month = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : today().slice(0, 7);
  const type = req.query.type || 'all';
  const rows = await db.prepare(`SELECT a.*, c.full_name AS coach_name, s.full_name AS staff_name
    FROM salary_adjustments a
    LEFT JOIN coaches c ON c.id = a.coach_id
    LEFT JOIN staff s ON s.id = a.staff_id
    WHERE substr(a.date,1,7) = ?` + (type === 'deduction' ? ' AND a.adj_type=\'deduction\'' : type === 'bonus' ? ' AND a.adj_type=\'bonus\'' : '') + tpersonScope(activeSport(req), 'a') + `
    ORDER BY a.date DESC`).all(month);
  const coaches = await db.prepare('SELECT id, full_name FROM coaches WHERE deleted_at IS NULL' + sportClause(activeSport(req), '') + ' ORDER BY full_name').all();
  const staff = await db.prepare('SELECT id, full_name FROM staff ORDER BY full_name').all();
  res.render('attendance_payroll/deductions', { title: 'الخصومات والإضافات', active: 'payroll', rows, month, type, coaches, staff, D: ADJ_CATEGORIES_D, B: ADJ_CATEGORIES_B, canAdd: canAdd(req.currentUser, 'payroll') });
});

router.post('/deductions/save', async function (req, res) {
  if (!canAdd(req.currentUser, 'payroll')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const b = req.body;
  const personType = String(b.person_type || 'trainer');
  const coachId = personType === 'trainer' ? (Number(b.coach_id) || null) : null;
  const staffId = personType === 'staff' ? (Number(b.staff_id) || null) : null;
  if (!coachId && !staffId) return res.json({ ok: false, error: 'اختر الشخص' });
  const kind = b.kind === 'bonus' ? 'bonus' : 'deduction';
  const cat = String(b.cat || (kind === 'bonus' ? 'Bonus' : 'خصم يدوي'));
  const date = String(b.date || today());
  const id = Number(b.id || 0);
  const values = [personType, coachId, staffId, kind, cat, date, Number(b.amount || 0), String(b.reason || ''), String(b.notes || ''), req.currentUser.id, date.slice(0, 7)];
  if (id) {
    await db.prepare(`UPDATE salary_adjustments SET person_type=?, coach_id=?, staff_id=?, adj_type=?, adj_category=?, date=?, amount=?, reason=?, notes=?, period=? WHERE id=?`).run(...values, id);
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'payroll', id, 'تعديل ' + (kind === 'bonus' ? 'إضافة' : 'خصم') + ' (' + cat + ') ' + money(values[6]), req);
  } else {
    const info = await db.prepare(`INSERT INTO salary_adjustments (person_type, coach_id, staff_id, adj_type, adj_category, date, amount, reason, notes, added_by, period) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(...values);
    audit(req.currentUser.id, req.currentUser.full_name, 'add', 'payroll', Number(info.lastInsertRowid || 0), 'إضافة ' + (kind === 'bonus' ? 'إضافة/حافز' : 'خصم') + ' (' + cat + ') ' + money(values[6]) + ' لشخص #' + (coachId || staffId), req);
  }
  res.json({ ok: true });
});
router.post('/deductions/delete/:id', async function (req, res) {
  if (!canDel(req.currentUser, 'payroll')) return res.status(403).json({ ok: false });
  const id = Number(req.params.id);
  await db.prepare('DELETE FROM salary_adjustments WHERE id = ?').run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'payroll', id, 'حذف خصم/إضافة', req);
  res.json({ ok: true });
});

/* ================================================================
   كشوف المستحقات (payroll)
================================================================ */
function cs(gross, extras, deductions) {
  const net = Math.round((Number(gross || 0) + Number(extras || 0) - Number(deductions || 0)) * 100) / 100;
  return { gross: Math.round(gross * 100) / 100, extras: Math.round(extras * 100) / 100, deductions: Math.round(deductions * 100) / 100, net };
}

/* ---------- فترات الاستحقاق (من تاريخ إلى تاريخ) ---------- */
function normYmd(v) {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function lastDayOfMonth(month) {
  const p = String(month || '').split('-');
  const y = Number(p[0]), m = Number(p[1]);
  if (!y || !m) return '';
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function rangeFromQuery(q) {
  q = q || {};
  let from = normYmd(q.from);
  let to = normYmd(q.to);
  const month = (q.month && /^\d{4}-\d{2}$/.test(String(q.month))) ? String(q.month) : '';
  if (!from && month) from = month + '-01';
  if (!to && month) to = lastDayOfMonth(month);
  if (!from) from = today().slice(0, 7) + '-01';
  if (!to) to = lastDayOfMonth(from.slice(0, 7)) || from;
  if (from > to) { const x = from; from = to; to = x; }
  return { from, to };
}
function periodKey(from, to) { return from + '_' + to; }
function parsePeriod(period, fromDate, toDate) {
  let from = normYmd(fromDate);
  let to = normYmd(toDate);
  if (!from || !to) {
    const p = String(period || '').trim();
    if (/^\d{4}-\d{2}$/.test(p)) { from = p + '-01'; to = lastDayOfMonth(p); }
    else if (/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(p)) { const parts = p.split('_'); from = parts[0]; to = parts[1]; }
    else if (/^\d{4}-\d{2}-\d{2}$/.test(p)) { from = p; to = p; }
  }
  if (!from) from = today();
  if (!to) to = from;
  if (from > to) { const x = from; from = to; to = x; }
  return { from, to };
}
function periodLabel(row) {
  if (row && /^\d{4}-\d{2}$/.test(String(row.period || '')) && !normYmd(row.from_date)) return String(row.period);
  const r = parsePeriod(row && row.period, row && row.from_date, row && row.to_date);
  return fmtDate(r.from) + ' ← ' + fmtDate(r.to);
}
/* مساعدات قراءة آمنة لتجميع الاستعلامات المتكررة في نفس الطلب.
   التقسيم إلى دفعات يحفظنا من تجاوز حد متغيرات SQLite عند كثرة الكشوف. */
function chunkIds(ids, size) {
  const out = [];
  const clean = Array.from(new Set((ids || []).map(Number).filter(n => Number.isFinite(n) && n > 0)));
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size));
  return out;
}
async function mapByIds(baseSql, ids, keyFn, valueFn, suffixSql) {
  const map = new Map();
  for (const chunk of chunkIds(ids, 500)) {
    const sql = baseSql + ` IN (${chunk.map(() => '?').join(',')})` + (suffixSql || '');
    const rows = await db.prepare(sql).all(...chunk);
    rows.forEach(r => map.set(keyFn(r), valueFn ? valueFn(r) : r));
  }
  return map;
}
async function queryChunks(baseSql, ids, extraArgs, suffixSql) {
  const rows = [];
  for (const chunk of chunkIds(ids, 300)) {
    const sql = baseSql + ` IN (${chunk.map(() => '?').join(',')})` + (suffixSql || '');
    rows.push(...await db.prepare(sql).all(...chunk, ...(extraArgs || [])));
  }
  return rows;
}
function countByPerson(rows) { return new Map(rows.map(r => [r.person_id, Number(r.c || 0)])); }
function sumByPerson(rows) { return new Map(rows.map(r => [r.person_id, Number(r.s || 0)])); }

/* تجميع قراءات رصيد الحصص للكشوف الظاهرة في نفس الطلب.
   نفس شروط الحالة ومنطق القبض بالظبط؛ بنجمّع فقط استعلامات العدّ/المجاميع،
   أما استعلامات الحصص غير المقبوضة فتظل كما هي (مع حد الـ 500 لكل شخص)
   لضمان تطابق النتائج المعروضة تماماً. */
async function preloadPayrollSessionData(rows, ctx) {
  const trainerIds = rows.filter(r => r.person_type === 'trainer' && r.coach_id).map(r => r.coach_id);
  const staffIds = rows.filter(r => r.person_type === 'staff' && r.staff_id).map(r => r.staff_id);
  ctx.sessionBalances = new Map();

  const coachStatuses = coachPayableStatuses();
  const staffStatuses = staffPayableStatuses();
  const cph = coachStatuses.map(() => '?').join(',');
  const sph = staffStatuses.map(() => '?').join(',');

  if (trainerIds.length) {
    const [attended, claimed, subAttended, subClaimed, amountTrainer, amountSub] = await Promise.all([
      queryChunks('SELECT a.coach_id person_id, COUNT(*) c FROM trainer_session_attendance a WHERE a.coach_id', trainerIds, coachStatuses, ` AND a.status IN (${cph}) GROUP BY a.coach_id`),
      queryChunks(`SELECT a.coach_id person_id, COUNT(*) c FROM trainer_session_attendance a JOIN payroll_items pi ON pi.source_type = 'trainer' AND pi.source_id = a.id WHERE a.coach_id`, trainerIds, coachStatuses, ` AND a.status IN (${cph}) GROUP BY a.coach_id`),
      queryChunks('SELECT a.substitute_coach_id person_id, COUNT(*) c FROM trainer_session_attendance a WHERE a.substitute_coach_id', trainerIds, coachStatuses, ` AND a.status IN (${cph}) GROUP BY a.substitute_coach_id`),
      queryChunks(`SELECT a.substitute_coach_id person_id, COUNT(*) c FROM trainer_session_attendance a JOIN payroll_items pi ON pi.source_type = 'substitute' AND pi.source_id = a.id WHERE a.substitute_coach_id`, trainerIds, coachStatuses, ` AND a.status IN (${cph}) GROUP BY a.substitute_coach_id`),
      queryChunks(`SELECT a.coach_id person_id, COALESCE(SUM(pi.amount),0) s FROM payroll_items pi JOIN trainer_session_attendance a ON a.id = pi.source_id WHERE pi.source_type = 'trainer' AND a.coach_id`, trainerIds, [], ' GROUP BY a.coach_id'),
      queryChunks(`SELECT a.substitute_coach_id person_id, COALESCE(SUM(pi.amount),0) s FROM payroll_items pi JOIN trainer_session_attendance a ON a.id = pi.source_id WHERE pi.source_type = 'substitute' AND a.substitute_coach_id`, trainerIds, [], ' GROUP BY a.substitute_coach_id'),
    ]);
    const aMap = countByPerson(attended), cMap = countByPerson(claimed), saMap = countByPerson(subAttended), scMap = countByPerson(subClaimed);
    const amtMap = sumByPerson(amountTrainer), samtMap = sumByPerson(amountSub);

    trainerIds.forEach(function (id) {
      const attendedN = Number(aMap.get(id) || 0) + Number(saMap.get(id) || 0);
      const claimedN = Number(cMap.get(id) || 0) + Number(scMap.get(id) || 0);
      const unclaimedN = Math.max(0, attendedN - claimedN);
      const rate = Number((ctx.trainerEffectiveRates && ctx.trainerEffectiveRates.get(id)) || 0);
      const claimedAmount = round2(Number(amtMap.get(id) || 0) + Number(samtMap.get(id) || 0));
      ctx.sessionBalances.set('trainer:' + id, {
        attended: attendedN,
        claimed: claimedN,
        unclaimed: unclaimedN,
        rate,
        claimedAmount,
        amountDue: unclaimedN * rate,
      });
    });
  }

  if (staffIds.length) {
    const [attended, claimed, amountRows] = await Promise.all([
      queryChunks('SELECT a.staff_id person_id, COUNT(*) c FROM staff_attendance a WHERE a.staff_id', staffIds, staffStatuses, ` AND a.status IN (${sph}) GROUP BY a.staff_id`),
      queryChunks(`SELECT a.staff_id person_id, COUNT(*) c FROM staff_attendance a JOIN payroll_items pi ON pi.source_type = 'staff' AND pi.source_id = a.id WHERE a.staff_id`, staffIds, staffStatuses, ` AND a.status IN (${sph}) GROUP BY a.staff_id`),
      queryChunks(`SELECT a.staff_id person_id, COALESCE(SUM(pi.amount),0) s FROM payroll_items pi JOIN staff_attendance a ON a.id = pi.source_id WHERE pi.source_type = 'staff' AND a.staff_id`, staffIds, [], ' GROUP BY a.staff_id'),
    ]);
    const aMap = countByPerson(attended), cMap = countByPerson(claimed), amtMap = sumByPerson(amountRows);

    staffIds.forEach(function (id) {
      const attendedN = Number(aMap.get(id) || 0);
      const claimedN = Number(cMap.get(id) || 0);
      const unclaimedN = Math.max(0, attendedN - claimedN);
      const rate = Number((ctx.staffRates && ctx.staffRates.get(id)) || 0);
      ctx.sessionBalances.set('staff:' + id, {
        attended: attendedN,
        claimed: claimedN,
        unclaimed: unclaimedN,
        rate,
        claimedAmount: round2(amtMap.get(id) || 0),
        amountDue: unclaimedN * rate,
      });
    });
  }
}
/* PROTOTYPE: each branch below is the ORIGINAL per-person SQL, wrapped so
   LIMIT 500 / ordering / dedup stay byte-exact. Branches are combined into
   one round trip per chunk. */
function unclaimedBranch(personType, isSub, id, statuses, ph, rate) {
  if (personType === 'trainer') {
    const joinType = isSub ? 'substitute' : 'trainer';
    const idCol = isSub ? 'a.substitute_coach_id' : 'a.coach_id';
    return {
      sql: `SELECT ${Number(id)} AS person_id, ${isSub ? 1 : 0} AS is_sub, t.* FROM (
        SELECT a.*, g.name AS group_name,
          CASE WHEN pi.id IS NULL THEN 0 ELSE 1 END AS claimed
        FROM trainer_session_attendance a
        LEFT JOIN groups g ON g.id = a.group_id
        LEFT JOIN payroll_items pi ON pi.source_type = '${joinType}' AND pi.source_id = a.id
        WHERE ${idCol} = ? AND a.status IN (${ph}) AND pi.id IS NULL
        ORDER BY a.date ASC, a.start_time ASC LIMIT 500
      ) t`,
      args: [Number(id), ...statuses]
    };
  }
  const TITLE = '\u064A\u0648\u0645 \u0639\u0645\u0644 \u2014 ';
  return {
    sql: `SELECT ${Number(id)} AS person_id, 0 AS is_sub, t.* FROM (
      SELECT a.id, a.date, a.status, a.session_rate,
        CASE WHEN pi.id IS NULL THEN 0 ELSE 1 END AS claimed,
        ('${TITLE}' || a.date) AS title,
        COALESCE(a.session_rate, ?) AS amount
      FROM staff_attendance a
      LEFT JOIN payroll_items pi ON pi.source_type = 'staff' AND pi.source_id = a.id
      WHERE a.staff_id = ? AND a.status IN (${ph}) AND pi.id IS NULL
      ORDER BY a.date ASC LIMIT 500
    ) t`,
    args: [Number(rate), Number(id), ...statuses]
  };
}

async function preloadUnclaimedSessions(perSessionRows, ctx) {
  ctx.unclaimedPrefetched = new Map();
  const trainerIds = Array.from(new Set(perSessionRows.filter(r => r.person_type === 'trainer' && r.coach_id).map(r => r.coach_id)));
  const staffIds = Array.from(new Set(perSessionRows.filter(r => r.person_type === 'staff' && r.staff_id).map(r => r.staff_id)));
  trainerIds.forEach(id => ctx.unclaimedPrefetched.set('trainer:' + id, { main: [], sub: [] }));
  staffIds.forEach(id => ctx.unclaimedPrefetched.set('staff:' + id, []));
  const cStatuses = coachPayableStatuses(), cph = cStatuses.map(() => '?').join(',');
  const sStatuses = staffPayableStatuses(), sph = sStatuses.map(() => '?').join(',');

  for (const kind of ['trainer-main', 'trainer-sub', 'staff']) {
    const ids = kind === 'staff' ? staffIds : trainerIds;
    if (!ids.length) continue;
    for (let i = 0; i < ids.length; i += 80) {
      const part = ids.slice(i, i + 80);
      const branches = part.map(id => kind === 'staff'
        ? unclaimedBranch('staff', false, id, sStatuses, sph, Number((ctx.staffRates && ctx.staffRates.get(id)) || 0))
        : unclaimedBranch('trainer', kind === 'trainer-sub', id, cStatuses, cph));
      const sql = branches.map(b => b.sql).join(' UNION ALL ');
      const args = branches.reduce((acc, b) => acc.concat(b.args), []);
      const rows = await db.prepare(sql).all(...args);
      rows.sort((a, b) => (Number(a.person_id) - Number(b.person_id)) || (Number(a.is_sub) - Number(b.is_sub)));
      const grouped = new Map();
      rows.forEach(function (r) {
        const key = (kind === 'staff' ? 'staff:' : 'trainer:') + r.person_id;
        if (!grouped.has(key)) grouped.set(key, kind === 'staff' ? [] : { main: [], sub: [] });
        if (kind === 'staff') grouped.get(key).push(r);
        else grouped.get(key)[r.is_sub ? 'sub' : 'main'].push(r);
      });
      grouped.forEach((v, key) => {
        const prev = ctx.unclaimedPrefetched.get(key);
        if (!prev) { ctx.unclaimedPrefetched.set(key, v); return; }
        if (Array.isArray(v)) v.forEach(x => prev.push(x));
        else { v.main.forEach(x => prev.main.push(x)); v.sub.forEach(x => prev.sub.push(x)); }
      });
    }
  }
}

function overlapsRange(row, range) {
  const r = parsePeriod(row.period, row.from_date, row.to_date);
  return r.to >= range.from && r.from <= range.to;
}
async function payrollAdjustments(personType, personId, range) {
  const col = personType === 'trainer' ? 'coach_id' : 'staff_id';
  return await db.prepare(`SELECT * FROM salary_adjustments WHERE ${col} = ? AND date >= ? AND date <= ? ORDER BY date`).all(personId, range.from, range.to);
}
async function findPayroll(personType, personId, range) {
  const key = periodKey(range.from, range.to);
  return personType === 'trainer'
    ? await db.prepare("SELECT * FROM payroll WHERE person_type='trainer' AND coach_id=? AND period=?").get(personId, key)
    : await db.prepare("SELECT * FROM payroll WHERE person_type='staff' AND staff_id=? AND period=?").get(personId, key);
}

router.get('/payroll', async function (req, res) {
  if (!canView(req.currentUser, 'payroll')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const range = rangeFromQuery(req.query);
  const ptype = req.query.type || 'all';
  const allRows = await db.prepare(`SELECT p.*, c.full_name AS coach_name, c.phone AS coach_phone, s.full_name AS staff_name, s.phone AS staff_phone, b.name AS branch_name
    FROM payroll p
    LEFT JOIN coaches c ON c.id = p.coach_id
    LEFT JOIN staff s ON s.id = p.staff_id
    LEFT JOIN branches b ON b.id = p.branch_id
    WHERE 1=1` + (ptype === 'trainer' ? ' AND p.person_type=\'trainer\'' : ptype === 'staff' ? ' AND p.person_type=\'staff\'' : '') + tpersonScope(activeSport(req), 'p') + `
    ORDER BY p.person_type, c.full_name, s.full_name`).all();
  const rows = allRows.filter(function (r) { return overlapsRange(r, range); });
  function personIdOf(r) {
    if (r.person_type === 'trainer') return r.coach_id;
    if (r.person_type === 'staff') return r.staff_id;
    return 0;
  }

  /* هذه القراءات كانت تتكرر لكل كشف؛ نجمعها مرة واحدة لنفس الطلب.
     الحسابات والتحديثات كما هي، تغيّر فقط عدد رحلات قاعدة البيانات. */
  const coachIds = rows.filter(r => r.person_type === 'trainer' && r.coach_id).map(r => r.coach_id);
  const staffIds = rows.filter(r => r.person_type === 'staff' && r.staff_id).map(r => r.staff_id);
  const [coachTypes, staffTypes] = await Promise.all([
    mapByIds('SELECT id, salary_type, contract_type FROM coaches WHERE id', coachIds, r => r.id),
    mapByIds('SELECT id, salary_type, contract_type FROM staff WHERE id', staffIds, r => r.id)
  ]);

  const perSessionRows = rows.filter(function (r) {
    const id = personIdOf(r);
    if (!id) return false;
    return r.person_type === 'trainer' ? isPerSessionCoach(coachTypes.get(id)) : isPerSessionStaff(staffTypes.get(id));
  });

  const ctx = {};
  if (perSessionRows.length) {
    const psTrainerIds = perSessionRows.filter(r => r.person_type === 'trainer' && r.coach_id).map(r => r.coach_id);
    const psStaffIds = perSessionRows.filter(r => r.person_type === 'staff' && r.staff_id).map(r => r.staff_id);

    /* كل قراءة مستقلة؛ إرسالها معاً يوفّر رحلات قاعدة البيانات بنفس النتيجة. */
    const [payrollSums, policy, staffRates, rateRows, coachSalaries] = await Promise.all([
      mapByIds(
        'SELECT payroll_id, COALESCE(SUM(amount),0) s FROM payroll_items WHERE payroll_id',
        perSessionRows.filter(r => r.id && !r.settled_at).map(r => r.id),
        r => r.payroll_id,
        r => r.s,
        ' GROUP BY payroll_id'
      ),
      getPolicy(),
      psStaffIds.length ? mapByIds('SELECT id, salary FROM staff WHERE id', psStaffIds, r => r.id, r => Number(r.salary || 0)) : Promise.resolve(null),
      psTrainerIds.length ? mapByIds('SELECT id, coach_id, default_rate FROM trainer_rates WHERE coach_id', psTrainerIds, r => r.id) : Promise.resolve(null),
      psTrainerIds.length ? mapByIds('SELECT id, salary_amount FROM coaches WHERE id', psTrainerIds, r => r.id) : Promise.resolve(null)
    ]);
    ctx.payrollSums = payrollSums;
    ctx.policy = policy.pol;
    if (staffRates) ctx.staffRates = staffRates;

    if (rateRows && coachSalaries) {
      const latestRate = new Map();
      rateRows.forEach(function (tr) {
        const cur = latestRate.get(tr.coach_id);
        if (!cur || Number(tr.id) > Number(cur.id)) latestRate.set(tr.coach_id, tr);
      });
      ctx.trainerEffectiveRates = new Map(psTrainerIds.map(function (id) {
        const tr = latestRate.get(id);
        const base = tr ? Number(tr.default_rate || 0) : 0;
        const effective = base || Number((coachSalaries.get(id) || {}).salary_amount || 0);
        return [id, effective];
      }));
    }
  }

  /* نجمّع عدّات الحصص لكل الأشخاص في طلب واحد بدل استعلام لكل كشف. */
  if (perSessionRows.length) {
    await Promise.all([
      preloadPayrollSessionData(perSessionRows, ctx),
      preloadUnclaimedSessions(perSessionRows, ctx)
    ]);
  }

  // حساب رصيد الحصص للتعاقدات بالحصة
  for (const r of rows) {
    const personId = personIdOf(r);
    const ps = !!personId && (r.person_type === 'trainer' ? isPerSessionCoach(coachTypes.get(personId)) : isPerSessionStaff(staffTypes.get(personId)));
    r.is_per_session = ps;
    if (ps) await syncPerSessionTotals(r, ctx);
    const balanceKey = r.person_type + ':' + personId;
    const cachedBalance = ps && ctx.sessionBalances && ctx.sessionBalances.has(balanceKey) ? ctx.sessionBalances.get(balanceKey) : null;
    /* نسخة مستقلة لكل كشف حتى لا تؤدي الإضافات أدناه إلى تعديل كشف آخر */
    const balance = cachedBalance ? Object.assign({}, cachedBalance) : (ps ? await countSessionBalance(r.person_type, personId, undefined, ctx) : null);
    r.session_balance = balance;
    /* قيمة الحصص غير المقبوضة (تظهر في البطاقة الخارجية حتى لو كان الكشف صفراً) */
    if (r.session_balance) {
      const prefetchedUnclaimed = ctx.unclaimedPrefetched && ctx.unclaimedPrefetched.get(balanceKey);
      const pending = await listUnclaimedSessions(r.person_type, personId, 500, undefined, ctx, prefetchedUnclaimed);
      const unclaimedAmount = round2(pending.reduce(function (s, it) { return s + Number(it.amount || 0); }, 0));
      r.session_balance.unclaimedAmount = unclaimedAmount;
      r.session_balance.unclaimedAmounts = pending.map(function (it) { return round2(it.amount); });
      applyPerSessionDisplay(r, r.session_balance, unclaimedAmount);
    }
  }

  const coaches = await db.prepare('SELECT * FROM coaches WHERE deleted_at IS NULL' + sportClause(activeSport(req), '') + ' ORDER BY full_name').all();
  const staff = await db.prepare('SELECT * FROM staff ORDER BY full_name').all();
  res.render('attendance_payroll/payroll_list', {
    title: 'مستحقات ورواتب', active: 'payroll', rows, range, from: range.from, to: range.to,
    periodLabel: periodLabel, ptype, coaches, staff, PAY_METHODS,
    canAdd: canAdd(req.currentUser, 'payroll'), canEdit: canEdit(req.currentUser, 'payroll'), canExport: canExport(req.currentUser, 'payroll')
  });
});

/* حساب كشف لكل مدرب في الفترة (قبل الحفظ) */
async function accruedKeysForRange(range) {
  const rows = await db.prepare('SELECT source_type, source_id FROM payroll_items WHERE work_date >= ? AND work_date <= ?').all(range.from, range.to);
  const set = new Set();
  rows.forEach(function (r) { set.add(r.source_type + ':' + r.source_id); });
  return set;
}
function keyOf(type, id) { return type + ':' + id; }
function parseKey(k) {
  const p = String(k || '').split(':');
  return { type: p[0], id: Number(p[1]) || 0 };
}

async function computeTrainerPayroll(coachId, range, opts) {
  opts = opts || {};
  const t = await db.prepare('SELECT * FROM coaches WHERE id = ?').get(coachId);
  if (!t) return null;
  const perSession = isPerSessionCoach(t);
  const pol = (await getPolicy()).pol;
  const linked = opts.payrollId ? await db.prepare('SELECT * FROM payroll_items WHERE payroll_id = ?').all(opts.payrollId) : [];
  const linkedSet = new Set(linked.map(function (it) { return it.source_type + ':' + it.source_id; }));
  const linkedMode = linked.length > 0;
  const wanted = new Set((opts.keys || []).map(String));
  const acc = await accruedKeysForRange(range);

  let gross = 0, extras = 0, deductions = 0;
  let items = [];

  if (!perSession) {
    const atts = await db.prepare(`SELECT a.*, g.name AS group_name FROM trainer_session_attendance a
      LEFT JOIN groups g ON g.id = a.group_id
      WHERE a.coach_id = ? AND a.date >= ? AND a.date <= ? ORDER BY a.date`).all(coachId, range.from, range.to);
    const subs = await db.prepare(`SELECT a.*, g.name AS group_name FROM trainer_session_attendance a
      LEFT JOIN groups g ON g.id = a.group_id
      WHERE a.substitute_coach_id = ? AND a.date >= ? AND a.date <= ? ORDER BY a.date`).all(coachId, range.from, range.to);
    const priv = await db.prepare(`SELECT ps.*, sw.full_name AS swimmer_name FROM private_sessions ps
      LEFT JOIN swimmers sw ON sw.id = ps.swimmer_id
      WHERE ps.coach_id = ? AND ps.date >= ? AND ps.date <= ? AND ps.status IN ('present','late') ORDER BY ps.date`)
      .all(coachId, range.from, range.to);

    function include(key, amount, sourceType, sourceId, workDate, title) {
      if (linkedMode) {
        const allowed = linkedSet.has(key) || (wanted.size ? wanted.has(key) : (opts.includeNew === true && !acc.has(key)));
        if (!allowed) return false;
      } else if (wanted.size) {
        if (!wanted.has(key)) return false;
      } else if (opts.includeNew === false) {
        return false;
      } else if (acc.has(key)) {
        return false;
      }
      gross += Number(amount || 0);
      items.push({
        source_type: sourceType, source_id: sourceId, work_date: workDate,
        title: title || '', amount: Math.round(Number(amount || 0) * 100) / 100
      });
      return true;
    }

    atts.forEach(function (a) {
      const amt = a.status === 'غائب' ? 0 : amountForAttendance(a, pol);
      const inc = include(keyOf('trainer', a.id), amt, 'trainer', a.id, a.date,
        (a.group_name || ('حصة #' + a.session_id)) + (a.start_time ? ' — ' + a.start_time : ''));
      if (inc && a.status === 'غائب' && Number(pol.absence_deduction || 0) > 0) deductions += Number(pol.absence_deduction);
    });
    subs.forEach(function (a) {
      include(keyOf('substitute', a.id), amountForAttendance(a, pol), 'substitute', a.id, a.date,
        'بديل: ' + (a.group_name || ('حصة #' + a.session_id)));
    });
    priv.forEach(function (s) {
      include(keyOf('private', s.id), Number(s.rate || 0), 'private', s.id, s.date,
        'تدريب خاص — ' + (s.swimmer_name || ''));
    });
  } else {
    // للتعاقد بالحصة: لا نُدخل الحصص تلقائياً هنا؛ تُستحق عبر صرف/استحقاق يدوي
    // نحتفظ بالبنود المستحقة سابقاً إن وُجدت
    if (opts.payrollId) {
      const sum = await db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payroll_items WHERE payroll_id = ?').get(opts.payrollId);
      gross = Number(sum && sum.s || 0);
    }
    items = undefined;
  }

  const adjustments = await payrollAdjustments('trainer', coachId, range);
  adjustments.forEach(function (x) { if (x.adj_type === 'bonus') extras += Number(x.amount || 0); else deductions += Number(x.amount || 0); });

  gross = Math.round(gross * 100) / 100;
  extras = Math.round(extras * 100) / 100;
  deductions = Math.round(deductions * 100) / 100;
  return { coachId, personType: 'trainer', name: t.full_name, atts: items && items.length || 0, items, gross, extras, deductions, net: Math.round((gross + extras - deductions) * 100) / 100 };
}

async function computeStaffPayroll(staffId, range, opts) {
  opts = opts || {};
  const s = await db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId);
  if (!s) return null;
  const rate = await db.prepare('SELECT * FROM staff_rates WHERE staff_id = ?').get(staffId);
  const perSession = isPerSessionStaff(s);
  let gross = 0;
  let items = [];
  if (!perSession) {
    const attendance = await db.prepare('SELECT * FROM staff_attendance WHERE staff_id = ? AND date >= ? AND date <= ?').all(staffId, range.from, range.to);
    if (rate && rate.pay_system === 'shift') {
      const shiftVal = Number(rate.shift_value || 0);
      const hourVal = Number(rate.hourly_value || 0);
      attendance.forEach(a => {
        let v = shiftVal * Number(a.shift_count || 1);
        const ot = Number(a.overtime_minutes || 0);
        if (ot > 0 && hourVal > 0) v += (ot / 60) * hourVal;
        if (a.status !== 'حاضر' && a.status !== 'متأخر') v = 0;
        gross += v;
      });
    } else {
      // شهري: راتب ثابت للفترة (يُحتسب كامل بغض النظر عن أيام الحضور، مع خصم الغياب حسب الأيام)
      gross = Number((rate && rate.monthly_salary) || s.salary || 0);
      const dayValue = Number((rate && rate.day_value) || 0);
      const absDays = attendance.filter(a => a.status === 'غائب').length;
      if (absDays > 0 && dayValue > 0) gross = gross - (absDays * dayValue);
    }
  } else {
    // للتعاقد بالحصة: لا نُحتسب الحصص تلقائياً
    if (opts && opts.payrollId) {
      const sum = await db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payroll_items WHERE payroll_id = ?').get(opts.payrollId);
      gross = Number(sum && sum.s || 0);
    }
    items = undefined;
  }
  let extras = 0, deductions = 0;
  const adjustments = await payrollAdjustments('staff', staffId, range);
  adjustments.forEach(x => { if (x.adj_type === 'bonus') extras += Number(x.amount || 0); else deductions += Number(x.amount || 0); });
  gross = Math.round(gross * 100) / 100;
  extras = Math.round(extras * 100) / 100;
  deductions = Math.round(deductions * 100) / 100;
  return { staffId, personType: 'staff', name: s.full_name, atts: (items && items.length) || 0, items, gross, extras, deductions, net: Math.round((gross + extras - deductions) * 100) / 100 };
}

/* ترحيل كسول: الكشوف الشهرية القديمة (YYYY-MM) ليس لها بنود مرتبطة.
   نربط حصصها مرة واحدة حتى لا تظهر كحصص غير مستحقة مرة أخرى. */
async function backfillLegacyPayrollItems(range, personId) {
  const legacy = await db.prepare(`SELECT p.* FROM payroll p
    WHERE p.person_type='trainer' AND p.coach_id IS NOT NULL
      AND p.period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
      AND NOT EXISTS (SELECT 1 FROM payroll_items i WHERE i.payroll_id = p.id)`
    + (personId ? ' AND p.coach_id = ?' : '')).all(...(personId ? [personId] : []));
  if (!legacy.length) return;
  const pol = (await getPolicy()).pol;
  for (const p of legacy) {
    const pr = parsePeriod(p.period, p.from_date, p.to_date);
    if (pr.to < range.from || pr.from > range.to) continue;
    const atts = await db.prepare(`SELECT a.*, g.name AS group_name FROM trainer_session_attendance a
      LEFT JOIN groups g ON g.id = a.group_id
      WHERE a.date >= ? AND a.date <= ? AND (a.coach_id = ? OR a.substitute_coach_id = ?)`).all(pr.from, pr.to, p.coach_id, p.coach_id);
    for (const a of atts) {
      const isSub = Number(a.substitute_coach_id || 0) === Number(p.coach_id);
      const type = isSub ? 'substitute' : 'trainer';
      const amount = a.status === 'غائب' ? 0 : amountForAttendance(a, pol);
      const title = (isSub ? 'بديل: ' : '') + (a.group_name || ('حصة #' + a.session_id)) + (a.start_time ? ' — ' + a.start_time : '');
      await db.prepare('INSERT OR IGNORE INTO payroll_items (payroll_id, source_type, source_id, work_date, title, amount) VALUES (?,?,?,?,?,?)')
        .run(p.id, type, a.id, a.date, title, Math.round(Number(amount || 0) * 100) / 100);
    }
    const priv = await db.prepare(`SELECT ps.*, sw.full_name AS swimmer_name FROM private_sessions ps
      LEFT JOIN swimmers sw ON sw.id = ps.swimmer_id
      WHERE ps.coach_id = ? AND ps.date >= ? AND ps.date <= ? AND ps.status IN ('present','late')`).all(p.coach_id, pr.from, pr.to);
    for (const s of priv) {
      await db.prepare('INSERT OR IGNORE INTO payroll_items (payroll_id, source_type, source_id, work_date, title, amount) VALUES (?,?,?,?,?,?)')
        .run(p.id, 'private', s.id, s.date, 'تدريب خاص — ' + (s.swimmer_name || ''), Math.round(Number(s.rate || 0) * 100) / 100);
    }
  }
}

/* قائمة الحصص غير المستحقة (لعرضها للمستخدم قبل الاستحقاق) */
async function listPendingTrainerItems(range, personId) {
  const pol = (await getPolicy()).pol;
  await backfillLegacyPayrollItems(range, personId);
  const acc = await accruedKeysForRange(range);
  const items = [];
  const coachWhere = personId ? ' AND a.coach_id = ?' : '';
  const subWhere = personId ? ' AND a.substitute_coach_id = ?' : ' AND a.substitute_coach_id IS NOT NULL';
  const privWhere = personId ? ' AND ps.coach_id = ?' : '';
  const aArgs = personId ? [range.from, range.to, personId] : [range.from, range.to];
  const pArgs = personId ? [range.from, range.to, personId] : [range.from, range.to];

  const atts = await db.prepare(`SELECT a.*, g.name AS group_name, c.full_name AS coach_name FROM trainer_session_attendance a
    LEFT JOIN groups g ON g.id = a.group_id LEFT JOIN coaches c ON c.id = a.coach_id
    WHERE a.date >= ? AND a.date <= ?` + coachWhere + ` ORDER BY a.date, a.start_time`).all(...aArgs);
  atts.forEach(function (a) {
    const key = keyOf('trainer', a.id);
    if (acc.has(key)) return;
    const amount = a.status === 'غائب' ? 0 : amountForAttendance(a, pol);
    items.push({
      key, source_type: 'trainer', source_id: a.id, person_id: a.coach_id, person_name: a.coach_name || '',
      date: a.date, title: (a.group_name || ('حصة #' + a.session_id)) + (a.start_time ? ' — ' + a.start_time : ''),
      status: a.status, amount: Math.round(Number(amount || 0) * 100) / 100
    });
  });

  const subs = await db.prepare(`SELECT a.*, g.name AS group_name, c.full_name AS coach_name FROM trainer_session_attendance a
    LEFT JOIN groups g ON g.id = a.group_id LEFT JOIN coaches c ON c.id = a.substitute_coach_id
    WHERE a.date >= ? AND a.date <= ?` + subWhere + ` ORDER BY a.date, a.start_time`).all(...aArgs);
  subs.forEach(function (a) {
    const key = keyOf('substitute', a.id);
    if (acc.has(key)) return;
    items.push({
      key, source_type: 'substitute', source_id: a.id, person_id: a.substitute_coach_id, person_name: a.coach_name || '',
      date: a.date, title: 'بديل: ' + (a.group_name || ('حصة #' + a.session_id)),
      status: a.status, amount: Math.round(Number(amountForAttendance(a, pol) || 0) * 100) / 100
    });
  });

  const priv = await db.prepare(`SELECT ps.*, sw.full_name AS swimmer_name, c.full_name AS coach_name FROM private_sessions ps
    LEFT JOIN swimmers sw ON sw.id = ps.swimmer_id LEFT JOIN coaches c ON c.id = ps.coach_id
    WHERE ps.date >= ? AND ps.date <= ? AND ps.status IN ('present','late')` + privWhere + ` ORDER BY ps.date, ps.start_time`).all(...pArgs);
  priv.forEach(function (s) {
    const key = keyOf('private', s.id);
    if (acc.has(key)) return;
    items.push({
      key, source_type: 'private', source_id: s.id, person_id: s.coach_id, person_name: s.coach_name || '',
      date: s.date, title: 'تدريب خاص — ' + (s.swimmer_name || ''),
      status: PRIVATE_STATUS_AR[s.status] || s.status, amount: Math.round(Number(s.rate || 0) * 100) / 100
    });
  });

  items.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  return items;
}

router.get('/payroll/pending', async function (req, res) {
  if (!canView(req.currentUser, 'payroll')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const range = rangeFromQuery(req.query);
  const personId = Number(req.query.person_id) || 0;
  const items = await listPendingTrainerItems(range, personId);
  const total = items.reduce(function (s, it) { return s + Number(it.amount || 0); }, 0);
  res.json({ ok: true, items, count: items.length, total: Math.round(total * 100) / 100, range });
});

/* إنشاء/تحديث كشف لفترة لمجموعة أشخاص (مدربين و/أو اداريين) */
router.post('/payroll/generate', async function (req, res) {
  if (!canAdd(req.currentUser, 'payroll')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  try {
    const range = rangeFromQuery(req.body);
    let ptype = req.body.type === 'staff' ? 'staff' : req.body.type === 'all' ? 'all' : 'trainer';
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(n => Number.isFinite(n) && n > 0);
    /* عند اختيار شخص بعينه نعرف فئته من القائمة حتى لا يتعارض رقم مدرب مع رقم اداري */
    const personType = req.body.person_type;
    if (ids.length && (personType === 'trainer' || personType === 'staff')) ptype = personType;
    const results = [];
    const idsFor = async function (table, fallbackSql) {
      if (ids.length) return (await db.prepare(`SELECT id FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)).map(r => r.id);
      return (await db.prepare(fallbackSql).all()).map(r => r.id);
    };
    if (ptype === 'trainer' || ptype === 'all') {
      const list = await idsFor('coaches', 'SELECT id FROM coaches WHERE deleted_at IS NULL' + sportClause(activeSport(req), ''));
      for (const id of list) {
        const existing = await findPayroll('trainer', id, range);
        const p = await computeTrainerPayroll(id, range, { payrollId: existing && existing.id, includeNew: true });
        if (!p) continue;
        if (!(p.items && p.items.length) && !existing && !p.extras && !p.deductions) continue;
        await upsertPayroll(p, range, req, { payrollId: existing && existing.id });
        results.push(p);
      }
    }
    if (ptype === 'staff' || ptype === 'all') {
      const list = await idsFor('staff', 'SELECT id FROM staff');
      for (const id of list) {
        const existing = await findPayroll('staff', id, range);
        const p = await computeStaffPayroll(id, range, { payrollId: existing && existing.id });
        if (!p) continue;
        await upsertPayroll(p, range, req, { payrollId: existing && existing.id });
        results.push(p);
      }
    }
    const label = ptype === 'trainer' ? 'المدربين' : ptype === 'staff' ? 'الاداريين' : 'المدربين والاداريين';
    audit(req.currentUser.id, req.currentUser.full_name, 'add', 'payroll', 0, 'توليد كشوف مستحقات ' + label + ' للفترة ' + range.from + ' ← ' + range.to + ' (' + results.length + ' كشف)', req);
    res.json({ ok: true, count: results.length });
  } catch (err) {
    console.error('payroll/generate:', err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'تعذر توليد الكشوف: ' + (err && err.message ? err.message : 'خطأ غير متوقع') });
  }
});

/* استحقاق حصص محددة (جزء أو كل الحصص) — تظهر مرة واحدة فقط حتى تُسجَّل حصص جديدة */
router.post('/payroll/accrue', async function (req, res) {
  if (!canAdd(req.currentUser, 'payroll')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const range = rangeFromQuery(req.body);
  const keys = (Array.isArray(req.body.keys) ? req.body.keys : []).map(String).filter(Boolean);
  if (!keys.length) return res.json({ ok: false, error: 'اختر حصة واحدة على الأقل' });
  const groups = {};
  for (const k of keys) {
    const parsed = parseKey(k);
    if (!parsed.id || ['trainer', 'substitute', 'private'].indexOf(parsed.type) < 0) continue;
    let owner = 0;
    if (parsed.type === 'private') {
      const s = await db.prepare('SELECT coach_id FROM private_sessions WHERE id = ?').get(parsed.id);
      owner = s ? Number(s.coach_id || 0) : 0;
    } else {
      const a = await db.prepare('SELECT coach_id, substitute_coach_id FROM trainer_session_attendance WHERE id = ?').get(parsed.id);
      if (a) owner = Number(parsed.type === 'substitute' ? (a.substitute_coach_id || 0) : (a.coach_id || 0));
    }
    if (!owner) continue;
    if (!groups[owner]) groups[owner] = [];
    groups[owner].push(keyOf(parsed.type, parsed.id));
  }
  let count = 0;
  for (const coachId of Object.keys(groups)) {
    const id = Number(coachId);
    const existing = await findPayroll('trainer', id, range);
    const p = await computeTrainerPayroll(id, range, { payrollId: existing && existing.id, includeNew: true, keys: groups[coachId] });
    if (!p || (!p.items.length && !existing)) continue;
    await upsertPayroll(p, range, req, { payrollId: existing && existing.id });
    count++;
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'payroll', 0, 'استحقاق ' + keys.length + ' حصة للفترة ' + range.from + ' ← ' + range.to + ' (' + count + ' كشف)', req);
  res.json({ ok: true, count, selected: keys.length });
});

async function upsertPayroll(p, range, req, opts) {
  opts = opts || {};
  const existing = opts.payrollId
    ? await db.prepare('SELECT * FROM payroll WHERE id = ?').get(opts.payrollId)
    : await findPayroll(p.personType, p.coachId || p.staffId, range);
  const key = periodKey(range.from, range.to);
  // إذا تم تسوية الفترة (تم الاستحقاق) لا نعيد حسابها أو نُظهرها مجدداً
  if (existing && existing.settled_at) return existing.id;
  const paid = existing ? Number(existing.paid_amount || 0) : 0;
  const remaining = Math.round((Number(p.net || 0) - paid) * 100) / 100;
  const status = remaining <= 0 ? 'مسدد' : (paid > 0 ? 'مدفوع جزئياً' : 'مستحق');
  let payrollId = existing ? existing.id : 0;
  if (existing) {
    // لا نلمس المدفوع إذا كان قد صُرف بالفعل؛ فقط نحدّث الجانب الاستحقاقي
    await db.prepare(`UPDATE payroll SET period=?, from_date=?, to_date=?, gross=?, extras=?, deductions=?, net=?, remaining=?, status=?, updated_at=? WHERE id=?`)
      .run(key, range.from, range.to, p.gross, p.extras, p.deductions, p.net, remaining, status, new Date().toLocaleString('sv-SE').replace('T', ' '), existing.id);
  } else {
    const info = await db.prepare(`INSERT INTO payroll (person_type, coach_id, staff_id, period, from_date, to_date, gross, extras, deductions, net, paid_amount, remaining, status, note) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,'مستحق','مولّد تلقائياً')`)
      .run(p.personType, p.coachId || null, p.staffId || null, key, range.from, range.to, p.gross, p.extras, p.deductions, p.net, p.net);
    payrollId = Number(info.lastInsertRowid || 0);
  }
  /* مزامنة بنود الكشف حتى لا تُحتسب الحصة مرتين */
  if (payrollId && Array.isArray(p.items)) {
    await db.prepare('DELETE FROM payroll_items WHERE payroll_id = ?').run(payrollId);
    for (const it of p.items) {
      await db.prepare('INSERT OR IGNORE INTO payroll_items (payroll_id, source_type, source_id, work_date, title, amount) VALUES (?,?,?,?,?,?)')
        .run(payrollId, it.source_type, it.source_id, it.work_date, it.title || '', it.amount || 0);
    }
  }
  // للتعاقد بالحصة: نحتفظ بالبنود المستحقة سابقاً دون مسح
  return payrollId;
}

/* حفظ قالب الكود الجاهز للتحويل (يُستخدم لكل الكباتن — قابل للتعديل في أي وقت) */
router.post('/payroll/transfer-tpl', async function (req, res) {
  if (!canEdit(req.currentUser, 'payroll')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const tpl = String((req.body && req.body.tpl) || '').trim().slice(0, 120);
  await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run('pay_ussd_tpl', tpl);
  audit(req.currentUser.id, req.currentUser.fullName || req.currentUser.full_name, 'edit', 'settings', 0, 'تعديل قالب كود التحويل: ' + tpl, req);
  res.json({ ok: true, tpl });
});

router.get('/payroll/:id', async function (req, res) {
  if (!canView(req.currentUser, 'payroll')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
    const row = await db.prepare(`SELECT p.*, c.full_name AS coach_name, c.qualification, c.phone AS coach_phone, s.full_name AS staff_name, s.job_title, s.phone AS staff_phone, b.name AS branch_name
    FROM payroll p
    LEFT JOIN coaches c ON c.id = p.coach_id
    LEFT JOIN staff s ON s.id = p.staff_id
    LEFT JOIN branches b ON b.id = p.branch_id
    WHERE p.id = ?`).get(id);
  if (!row) return res.redirect('/payroll');
  const range = parsePeriod(row.period, row.from_date, row.to_date);
  const label = periodLabel(row);

  /* بيانات التعاقد بالحصة */
  let perSession = false, sessionBalance = null, unclaimedSessions = [];
  if (row.person_type === 'trainer' && row.coach_id) {
    const coach = await db.prepare('SELECT salary_type, contract_type, salary_amount FROM coaches WHERE id = ?').get(row.coach_id);
    if (isPerSessionCoach(coach)) {
      perSession = true;
      /* العداد يشمل كل حضور المدرب (كل الفترات) — والحصص غير المقبوضة تتراكم حتى يتم قبضها */
      sessionBalance = await countSessionBalance('trainer', row.coach_id);
      unclaimedSessions = await listUnclaimedSessions('trainer', row.coach_id, 500);
    }
  } else if (row.person_type === 'staff' && row.staff_id) {
    const staff = await db.prepare('SELECT salary_type, contract_type, salary FROM staff WHERE id = ?').get(row.staff_id);
    if (isPerSessionStaff(staff)) {
      perSession = true;
      sessionBalance = await countSessionBalance('staff', row.staff_id);
      unclaimedSessions = await listUnclaimedSessions('staff', row.staff_id, 500);
    }
  }
  /* إصلاح إجماليات الكشف للتعاقد بالحصة لتطابق بنود الحصص المسجلة */
  if (perSession) {
    await syncPerSessionTotals(row);
    const unclaimedAmount = round2(unclaimedSessions.reduce(function (s, it) { return s + Number(it.amount || 0); }, 0));
    sessionBalance.unclaimedAmount = unclaimedAmount;
    applyPerSessionDisplay(row, sessionBalance, unclaimedAmount);
  }

  let statementRows = [];
  if (row.person_type === 'trainer' && row.coach_id) {
    const items = await db.prepare('SELECT * FROM payroll_items WHERE payroll_id = ? ORDER BY work_date, id').all(id);
    if (items.length) {
      const attIds = items.filter(function (it) { return it.source_type === 'trainer' || it.source_type === 'substitute'; }).map(function (it) { return it.source_id; });
      const privIds = items.filter(function (it) { return it.source_type === 'private'; }).map(function (it) { return it.source_id; });
      const attMap = {};
      if (attIds.length) {
        const ph = attIds.map(function () { return '?'; }).join(',');
        const atts = await db.prepare(`SELECT a.*, g.name AS group_name, COALESCE(sc.full_name, a.substitute_name) AS substitute_name
          FROM trainer_session_attendance a LEFT JOIN groups g ON g.id=a.group_id LEFT JOIN coaches sc ON sc.id=a.substitute_coach_id
          WHERE a.id IN (` + ph + `)`).all(...attIds);
        atts.forEach(function (a) { attMap[a.id] = a; });
      }
      const privMap = {};
      if (privIds.length) {
        const ph = privIds.map(function () { return '?'; }).join(',');
        const privs = await db.prepare(`SELECT ps.*, sw.full_name AS swimmer_name FROM private_sessions ps
          LEFT JOIN swimmers sw ON sw.id = ps.swimmer_id WHERE ps.id IN (` + ph + `)`).all(...privIds);
        privs.forEach(function (p) { privMap[p.id] = p; });
      }
      items.forEach(function (it) {
        if (it.source_type === 'private') {
          const p = privMap[it.source_id];
          if (!p) return;
          statementRows.push({
            date: p.date, start_time: p.start_time, session_id: null,
            group_name: 'تدريب خاص — ' + (p.swimmer_name || ''),
            status: PRIVATE_STATUS_AR[p.status] || p.status,
            session_rate: Number(it.amount || p.rate || 0), _private: true
          });
        } else {
          const a = attMap[it.source_id];
          if (!a) return;
          statementRows.push(Object.assign({}, a, {
            session_rate: Number(it.amount || 0),
            _substitute: it.source_type === 'substitute'
          }));
        }
      });
      statementRows.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    } else {
      /* كشوف قديمة بدون بنود مرتبطة: نعرض كل حضور الفترة */
      statementRows = await db.prepare(`SELECT a.*, g.name AS group_name, COALESCE(sc.full_name, a.substitute_name) AS substitute_name FROM trainer_session_attendance a LEFT JOIN groups g ON g.id=a.group_id LEFT JOIN coaches sc ON sc.id=a.substitute_coach_id WHERE a.coach_id = ? AND a.date >= ? AND a.date <= ? ORDER BY a.date`).all(row.coach_id, range.from, range.to);
      const priv = await db.prepare(`SELECT ps.*, sw.full_name AS swimmer_name FROM private_sessions ps LEFT JOIN swimmers sw ON sw.id = ps.swimmer_id WHERE ps.coach_id = ? AND ps.date >= ? AND ps.date <= ? ORDER BY ps.date`).all(row.coach_id, range.from, range.to);
      priv.forEach(p => {
        statementRows.push({
          date: p.date, start_time: p.start_time, session_id: null,
          group_name: 'تدريب خاص — ' + (p.swimmer_name || ''),
          status: PRIVATE_STATUS_AR[p.status] || p.status,
          session_rate: Number(p.rate || 0), _private: true
        });
      });
      statementRows.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    }
  } else if (row.person_type === 'staff' && row.staff_id) {
    statementRows = await db.prepare('SELECT * FROM staff_attendance WHERE staff_id = ? AND date >= ? AND date <= ? ORDER BY date').all(row.staff_id, range.from, range.to);
  }
  const adjustments = await payrollAdjustments(row.person_type, row.person_type === 'trainer' ? row.coach_id : row.staff_id, range);
  const pays = await db.prepare(`SELECT pt.*, u.full_name AS payer_name FROM payroll_transactions pt LEFT JOIN users u ON u.id = pt.created_by WHERE pt.payroll_id = ? ORDER BY pt.paid_date`).all(id);
  const pol = (await getPolicy()).pol;
  res.render('attendance_payroll/payroll_detail', {
    title: 'كشف حساب ' + (row.coach_name || row.staff_name || ''), active: 'payroll',
    row, statementRows, adjustments, pays, month: label, periodLabel: label, range, pol,
    perSession, sessionBalance, unclaimedSessions,
    STATUS: row.person_type === 'trainer' ? TRAINER_STATUS : STAFF_STATUS,
    canEdit: canEdit(req.currentUser, 'payroll'), canDel: canDel(req.currentUser, 'payroll'),
    canExport: canExport(req.currentUser, 'payroll'), PAY_METHODS, money, fmtMoney, fmtDate
  });
});

/* تسجيل دفعة على كشف */
router.post('/payroll/:id/pay', async function (req, res) {
  if (!canEdit(req.currentUser, 'payroll')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const id = Number(req.params.id);
  const b = req.body;
  const row = await db.prepare('SELECT * FROM payroll WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ ok: false });
  const fullScope = String(b.pay_scope || '') === 'full' || String(b.full || '') === '1';
  const rowRemaining = Number(row.remaining || 0);
  const amount = fullScope ? rowRemaining : Math.min(Number(b.amount || 0), rowRemaining);
  if (amount <= 0) return res.json({ ok: false, error: 'مبلغ غير صالح' });
  const paidDate = String(b.paid_date || today());
  const method = String(b.method || 'نقدي');
  const note = String(b.note || '');
  const transferCode = String(b.transfer_code || '').trim().slice(0, 60);
  const info = await db.prepare(`INSERT INTO payroll_transactions (payroll_id, amount, paid_date, method, note, transfer_code, created_by) VALUES (?,?,?,?,?,?,?)`)
    .run(id, amount, paidDate, method, note, transferCode, req.currentUser.id);
  // تحديث حالة الكشف
  const paidNow = Math.round((Number(row.paid_amount || 0) + amount) * 100) / 100;
  const remaining = Math.round((Number(row.net || 0) - paidNow) * 100) / 100;
  const status = remaining <= 0 ? 'مسدد' : 'مدفوع جزئياً';
  await db.prepare(`UPDATE payroll SET paid_amount=?, remaining=?, status=? WHERE id=?`).run(paidNow, remaining, status, id);
  // إنشاء مصروف تلقائي بنفس نمط نظام coach_payments الحالي
  const meta = await db.prepare(`SELECT COALESCE(c.full_name, s.full_name) AS pname FROM payroll p LEFT JOIN coaches c ON c.id=p.coach_id LEFT JOIN staff s ON s.id=p.staff_id WHERE p.id=?`).get(id);
  const name = (meta && meta.pname) || ('#' + id);
  try {
    const expInfo = await db.prepare(`INSERT INTO expenses (category, date, description, amount, payment_method, beneficiary, status, created_by) VALUES ('رواتب وأجور', ?, ?, ?, ?, ?, 'معتمد', ?)`)
      .run(paidDate, 'صرف مستحقات: ' + name + ' (فترة ' + periodLabel(row) + ')' + (transferCode ? ' — كود: ' + transferCode : ''), amount, method, name, req.currentUser.id);
    const expId = Number(expInfo.lastInsertRowid || 0) || 0;
    if (expId) await db.prepare('UPDATE payroll_transactions SET expense_id = ? WHERE id = ?').run(expId, Number(info.lastInsertRowid || 0));
  } catch (e) { /* لا نكسر العملية */ }
  audit(req.currentUser.id, req.currentUser.fullName || req.currentUser.full_name, 'approve_payment', 'payroll', id, 'صرف مستحقات ' + name + ': ' + money(amount) + ' (' + method + ')' + (transferCode ? ' — كود: ' + transferCode : ''), req);
  res.json({ ok: true, paidNow, remaining, status, id: Number(info.lastInsertRowid || 0) });
});

/* تسوية الفترة: «تم الاستحقاق» — تسجيل باقي المبلغ دفعة واحدة وإغلاق الكشف */
router.post('/payroll/:id/settle', async function (req, res) {
  if (!canEdit(req.currentUser, 'payroll')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM payroll WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ ok: false, error: 'الكشف غير موجود' });
  const remaining = Number(row.remaining || 0);
  if (remaining <= 0) return res.json({ ok: false, error: 'الكشف مسدد بالفعل' });
  const now = new Date().toLocaleString('sv-SE').replace('T', ' ');
  const method = String(req.body.method || 'تسوية').trim() || 'تسوية';
  const note = String(req.body.note || 'تم الاستحقاق').trim() || 'تم الاستحقاق';
  const info = await db.prepare(`INSERT INTO payroll_transactions (payroll_id, amount, paid_date, method, note, transfer_code, created_by) VALUES (?,?,?,?,?,?,?)`)
    .run(id, remaining, today(), method, note, '', req.currentUser.id);
  await db.prepare(`UPDATE payroll SET paid_amount=?, remaining=?, status='مسدد', settled_at=?, settled_by=? WHERE id=?`)
    .run(Number(row.net || 0), 0, now, req.currentUser.id, id);
  // مصروف مرتبط
  const meta = await db.prepare(`SELECT COALESCE(c.full_name, s.full_name) AS pname FROM payroll p LEFT JOIN coaches c ON c.id=p.coach_id LEFT JOIN staff s ON s.id=p.staff_id WHERE p.id=?`).get(id);
  const name = (meta && meta.pname) || ('#' + id);
  try {
    const expInfo = await db.prepare(`INSERT INTO expenses (category, date, description, amount, payment_method, beneficiary, status, created_by) VALUES ('رواتب وأجور', ?, ?, ?, ?, ?, 'معتمد', ?)`)
      .run(today(), 'تسوية مستحقات: ' + name + ' (فترة ' + periodLabel(row) + ')', remaining, method, name, req.currentUser.id);
    const expId = Number(expInfo.lastInsertRowid || 0) || 0;
    if (expId) await db.prepare('UPDATE payroll_transactions SET expense_id = ? WHERE id = ?').run(expId, Number(info.lastInsertRowid || 0));
  } catch (e) { /* لا نكسر العملية */ }
  audit(req.currentUser.id, req.currentUser.fullName || req.currentUser.full_name, 'settle', 'payroll', id, 'تسوية مستحقات ' + name + ': ' + money(remaining), req);
  res.json({ ok: true, remaining: 0, status: 'مسدد', settled_at: now });
});

/* صرف أو استحقاق عدد محدد من الحصص (للتعاقد بالحصة) */
router.post('/payroll/:id/sessions-pay', async function (req, res) {
  if (!canEdit(req.currentUser, 'payroll')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM payroll WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ ok: false, error: 'الكشف غير موجود' });
  if (row.settled_at) return res.json({ ok: false, error: 'الكشف مُسوَّى ولا يمكن تعديله' });

  const b = req.body;
  const action = String(b.action || 'pay'); // 'pay' => تحويل + استحقاق, 'claim' => استحقاق فقط
  const sessionsCount = Math.max(0, Math.round(Number(b.sessions_count) || 0));
  if (!sessionsCount) return res.json({ ok: false, error: 'أدخل عدد الحصص' });

  const personType = row.person_type;
  const personId = personType === 'trainer' ? row.coach_id : row.staff_id;
  if (!personId) return res.json({ ok: false, error: 'لا يوجد شخص مرتبط بالكشف' });

  /* كل الحصص غير المقبوضة (كل الفترات) — أي حصة جديدة تُضاف تلقائياً حتى يتم قبضها */
  const unclaimed = await listUnclaimedSessions(personType, personId, 1000);
  if (sessionsCount > unclaimed.length) return res.json({ ok: false, error: 'الحصص المطلوبة (' + sessionsCount + ') أكبر من غير المقبوضة (' + unclaimed.length + ')' });

  const selected = unclaimed.slice(0, sessionsCount);
  const totalAmount = Math.round(selected.reduce((s, it) => s + Number(it.amount || 0), 0) * 100) / 100;
  if (totalAmount <= 0) return res.json({ ok: false, error: 'لا توجد قيمة مستحقة للحصص المختارة' });

  const paidDate = String(b.paid_date || today());
  const method = String(b.method || 'نقدي');
  const transferCode = String(b.transfer_code || '').trim().slice(0, 60);
  const note = String(b.note || '');

  // إضافة البنود للكشف
  for (const it of selected) {
    await db.prepare(`INSERT OR IGNORE INTO payroll_items (payroll_id, source_type, source_id, work_date, title, amount) VALUES (?,?,?,?,?,?)`)
      .run(id, it.source_type || (personType === 'trainer' ? 'trainer' : 'staff'), it.id, it.date, it.title || '', it.amount || 0);
  }

  // تحديث إجماليات الكشف من مجموع بنوده الفعلية (يمنع بقاء القيمة صفراً إذا كانت هناك بنود سابقة)
  const sum = await db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payroll_items WHERE payroll_id = ?').get(id);
  const newGross = round2(sum && sum.s);
  const newNet = round2(newGross + Number(row.extras || 0) - Number(row.deductions || 0));
  let paidNow = round2(row.paid_amount);
  if (action === 'pay') paidNow = round2(paidNow + totalAmount);
  const remaining = round2(newNet - paidNow);
  const status = remaining <= 0 ? 'مسدد' : (paidNow > 0 ? 'مدفوع جزئياً' : 'مستحق');
  await db.prepare(`UPDATE payroll SET gross=?, net=?, paid_amount=?, remaining=?, status=?, updated_at=? WHERE id=?`)
    .run(newGross, newNet, paidNow, remaining, status, new Date().toLocaleString('sv-SE').replace('T', ' '), id);

  let txnId = 0;
  if (action === 'pay') {
    const info = await db.prepare(`INSERT INTO payroll_transactions (payroll_id, amount, paid_date, method, note, transfer_code, created_by) VALUES (?,?,?,?,?,?,?)`)
      .run(id, totalAmount, paidDate, method, note, transferCode, req.currentUser.id);
    txnId = Number(info.lastInsertRowid || 0);
    // مصروف تلقائي
    const meta = await db.prepare(`SELECT COALESCE(c.full_name, s.full_name) AS pname FROM payroll p LEFT JOIN coaches c ON c.id=p.coach_id LEFT JOIN staff s ON s.id=p.staff_id WHERE p.id=?`).get(id);
    const name = (meta && meta.pname) || ('#' + id);
    try {
      const expInfo = await db.prepare(`INSERT INTO expenses (category, date, description, amount, payment_method, beneficiary, status, created_by) VALUES ('رواتب وأجور', ?, ?, ?, ?, ?, 'معتمد', ?)`)
        .run(paidDate, 'صرف مستحقات: ' + name + ' — ' + sessionsCount + ' حصة (فترة ' + periodLabel(row) + ')' + (transferCode ? ' — كود: ' + transferCode : ''), totalAmount, method, name, req.currentUser.id);
      const expId = Number(expInfo.lastInsertRowid || 0) || 0;
      if (expId && txnId) await db.prepare('UPDATE payroll_transactions SET expense_id = ? WHERE id = ?').run(expId, txnId);
    } catch (e) { /* لا نكسر العملية */ }
  }

  const meta = await db.prepare(`SELECT COALESCE(c.full_name, s.full_name) AS pname FROM payroll p LEFT JOIN coaches c ON c.id=p.coach_id LEFT JOIN staff s ON s.id=p.staff_id WHERE p.id=?`).get(id);
  const name = (meta && meta.pname) || ('#' + id);
  audit(req.currentUser.id, req.currentUser.fullName || req.currentUser.full_name, action === 'pay' ? 'approve_payment' : 'add', 'payroll', id,
    (action === 'pay' ? 'صرف ' : 'استحقاق ') + sessionsCount + ' حصة لـ ' + name + ': ' + money(totalAmount), req);
  res.json({ ok: true, sessionsCount, totalAmount, remaining, status, txnId });
});

/* إعادة احتساب إجماليات الكشف من الدفعات (تُستدعى بعد تعديل/حذف دفعة) */
async function recomputePayrollTotals(payrollId) {
  const p = await db.prepare('SELECT net FROM payroll WHERE id = ?').get(payrollId);
  if (!p) return null;
  const s = await db.prepare('SELECT COALESCE(SUM(amount), 0) AS paid FROM payroll_transactions WHERE payroll_id = ?').get(payrollId);
  const paid = Math.round(Number(s.paid || 0) * 100) / 100;
  const remaining = Math.round((Number(p.net || 0) - paid) * 100) / 100;
  const status = remaining <= 0 ? 'مسدد' : 'مدفوع جزئياً';
  await db.prepare('UPDATE payroll SET paid_amount=?, remaining=?, status=? WHERE id=?').run(paid, remaining, status, payrollId);
  return { paid: paid, remaining: remaining, status: status };
}

/* تعديل دفعة (قبل أو بعد التحويل) — يحدّث المدفوع والمتبقي والمصروف المرتبط */
router.post('/payroll/txn/:txnId/update', async function (req, res) {
  if (!canEdit(req.currentUser, 'payroll')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const txnId = Number(req.params.txnId);
  const txn = await db.prepare('SELECT * FROM payroll_transactions WHERE id = ?').get(txnId);
  if (!txn) return res.status(404).json({ ok: false, error: 'الدفعة غير موجودة' });
  const b = req.body;
  const amount = Math.round(Number(b.amount || 0) * 100) / 100;
  if (!(amount > 0)) return res.json({ ok: false, error: 'مبلغ غير صالح' });
  const p = await db.prepare('SELECT * FROM payroll WHERE id = ?').get(txn.payroll_id);
  if (!p) return res.status(404).json({ ok: false, error: 'الكشف غير موجود' });
  const otherSum = await db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM payroll_transactions WHERE payroll_id = ? AND id != ?').get(txn.payroll_id, txnId);
  const sumAfter = Math.round((Number(otherSum.s || 0) + amount) * 100) / 100;
  if (sumAfter > Number(p.net || 0) + 0.001) return res.json({ ok: false, error: 'مجموع الدفعات يتجاوز صافي الكشف (' + money(p.net) + ')' });
  const paidDate = String(b.paid_date || txn.paid_date || today());
  const method = String(b.method || txn.method || 'نقدي');
  const note = String(b.note || '');
  const transferCode = String(b.transfer_code || '').trim().slice(0, 60);
  await db.prepare('UPDATE payroll_transactions SET amount=?, paid_date=?, method=?, note=?, transfer_code=? WHERE id=?')
    .run(amount, paidDate, method, note, transferCode, txnId);
  const meta = await db.prepare(`SELECT COALESCE(c.full_name, s.full_name) AS pname FROM payroll p LEFT JOIN coaches c ON c.id=p.coach_id LEFT JOIN staff s ON s.id=p.staff_id WHERE p.id=?`).get(txn.payroll_id);
  const pname = (meta && meta.pname) || ('#' + txn.payroll_id);
  if (txn.expense_id) {
    try {
      await db.prepare('UPDATE expenses SET date=?, description=?, amount=?, payment_method=?, beneficiary=? WHERE id=?')
        .run(paidDate, 'صرف مستحقات: ' + pname + ' (فترة ' + periodLabel(p) + ')' + (transferCode ? ' — كود: ' + transferCode : ''), amount, method, pname, txn.expense_id);
    } catch (e) { /* لا نكسر العملية */ }
  }
  const totals = await recomputePayrollTotals(txn.payroll_id);
  audit(req.currentUser.id, req.currentUser.fullName || req.currentUser.full_name, 'edit', 'payroll', txnId, 'تعديل دفعة مستحقات ' + pname + ': ' + money(txn.amount) + ' → ' + money(amount) + ' (' + method + ')' + (transferCode ? ' — كود: ' + transferCode : ''), req);
  res.json(Object.assign({ ok: true, payroll_id: txn.payroll_id }, totals || {}));
});

/* حذف دفعة (قبل أو بعد التحويل) — يعيد احتساب الإجماليات ويحذف المصروف المرتبط */
router.post('/payroll/txn/:txnId/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'payroll')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const txnId = Number(req.params.txnId);
  const txn = await db.prepare('SELECT * FROM payroll_transactions WHERE id = ?').get(txnId);
  if (!txn) return res.status(404).json({ ok: false, error: 'الدفعة غير موجودة' });
  if (txn.expense_id) {
    try { await db.prepare('DELETE FROM expenses WHERE id = ?').run(txn.expense_id); } catch (e) { /* لا نكسر العملية */ }
  }
  await db.prepare('DELETE FROM payroll_transactions WHERE id = ?').run(txnId);
  const meta = await db.prepare(`SELECT COALESCE(c.full_name, s.full_name) AS pname FROM payroll p LEFT JOIN coaches c ON c.id=p.coach_id LEFT JOIN staff s ON s.id=p.staff_id WHERE p.id=?`).get(txn.payroll_id);
  const pname = (meta && meta.pname) || ('#' + txn.payroll_id);
  const totals = await recomputePayrollTotals(txn.payroll_id);
  audit(req.currentUser.id, req.currentUser.fullName || req.currentUser.full_name, 'delete', 'payroll', txnId, 'حذف دفعة مستحقات ' + pname + ': ' + money(txn.amount) + ' (' + txn.method + ')' + (txn.transfer_code ? ' — كود: ' + txn.transfer_code : ''), req);
  res.json(Object.assign({ ok: true, payroll_id: txn.payroll_id }, totals || {}));
});

/* اعتماد الكشف */
router.post('/payroll/:id/approve', async function (req, res) {
  if (!canEdit(req.currentUser, 'payroll')) return res.status(403).json({ ok: false });
  const id = Number(req.params.id);
  await db.prepare('UPDATE payroll SET approved=1, approved_by=?, approved_at=? WHERE id=?').run(req.currentUser.id, new Date().toLocaleString('sv-SE').replace('T', ' '), id);
  audit(req.currentUser.id, req.currentUser.full_name, 'approve_payment', 'payroll', id, 'اعتماد كشف مستحقات', req);
  res.json({ ok: true });
});

router.post('/payroll/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'payroll')) return res.status(403).json({ ok: false });
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM payroll WHERE id = ?').get(id);
  if (row && (Number(row.paid_amount) > 0 || Number(row.approved) === 1)) {
    return res.status(403).json({ ok: false, error: 'لا يمكن حذف كشف معتمد أو تم صرفه' });
  }
  await db.prepare('DELETE FROM payroll_items WHERE payroll_id = ?').run(id);
  await db.prepare('DELETE FROM payroll_transactions WHERE payroll_id = ?').run(id);
  await db.prepare('DELETE FROM payroll WHERE id = ?').run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'payroll', id, 'حذف كشف مستحقات', req);
  res.json({ ok: true });
});

/* ================================================================
   الأسعار (مدرب / موظف)
================================================================ */
router.get('/rates', async function (req, res) {
  if (!canView(req.currentUser, 'payroll') && !canView(req.currentUser, 'trainerAttendance') && !canView(req.currentUser, 'staffAttendance')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coaches = await db.prepare('SELECT * FROM coaches WHERE deleted_at IS NULL' + sportClause(activeSport(req), '') + ' ORDER BY full_name').all();
  const staff = await db.prepare('SELECT * FROM staff ORDER BY full_name').all();
  const tRates = {}; (await db.prepare('SELECT * FROM trainer_rates').all()).forEach(r => { tRates[r.coach_id] = r; });
  const sRates = {}; (await db.prepare('SELECT * FROM staff_rates').all()).forEach(r => { sRates[r.staff_id] = r; });
  const branches = await db.prepare('SELECT * FROM branches ORDER BY name').all();
  res.render('attendance_payroll/rates', { title: 'أسعار الحصص والأجور', active: 'payroll', coaches, staff, tRates, sRates, branches, canEdit: canEdit(req.currentUser, 'payroll') });
});

router.post('/rates/trainer', async function (req, res) {
  if (!canEdit(req.currentUser, 'payroll')) return res.status(403).json({ ok: false });
  const b = req.body;
  const coachId = Number(b.coach_id || 0);
  if (!coachId) return res.json({ ok: false, error: 'اختر المدرب' });
  const defaultRate = Number(b.default_rate || 0);
  const branchId = b.branch_id ? Number(b.branch_id) : null;
  const branchRate = Number(b.branch_rate || 0);
  await db.prepare(`INSERT INTO trainer_rates (coach_id, default_rate, hourly_rate, private_rate, group_rate, branch_id, branch_rate, period) VALUES (?,?,?,?,?,?,?,?)`)
    .run(coachId, defaultRate, Number(b.hourly_rate || 0), Number(b.private_rate || 0), Number(b.group_rate || 0), branchId, branchRate, b.period || today().slice(0, 7));
  /* تحديث الحضور المسجّل مسبقاً (التسعير التلقائي فقط — لا نلمس الحصص يدوية السعر) */
  let updAtt = 0;
  if (branchId && branchRate > 0) {
    const r1 = await db.prepare(`UPDATE trainer_session_attendance SET base_rate=?, session_rate=?
      WHERE coach_id=? AND branch_id=? AND (session_rate IS NULL OR session_rate=0 OR session_rate=base_rate)`)
      .run(branchRate, branchRate, coachId, branchId);
    const r2 = await db.prepare(`UPDATE trainer_session_attendance SET base_rate=?, session_rate=?
      WHERE coach_id=? AND (branch_id IS NULL OR branch_id!=?) AND (session_rate IS NULL OR session_rate=0 OR session_rate=base_rate)`)
      .run(defaultRate, defaultRate, coachId, branchId);
    updAtt = Number(r1.changes || 0) + Number(r2.changes || 0);
  } else {
    const r = await db.prepare(`UPDATE trainer_session_attendance SET base_rate=?, session_rate=?
      WHERE coach_id=? AND (session_rate IS NULL OR session_rate=0 OR session_rate=base_rate)`)
      .run(defaultRate, defaultRate, coachId);
    updAtt = Number(r.changes || 0);
  }
  /* إعادة احتساب كشوف المستحقات القائمة لهذا المدرب (تحفظ المدفوع وتعدّل المتبقي والحالة) */
  let recomputed = 0;
  const periods = await db.prepare("SELECT id, period, from_date, to_date FROM payroll WHERE person_type='trainer' AND coach_id=?").all(coachId);
  for (const p of periods) {
    const range = parsePeriod(p.period, p.from_date, p.to_date);
    const itemCount = await db.prepare('SELECT COUNT(*) AS c FROM payroll_items WHERE payroll_id = ?').get(p.id);
    const legacy = !Number(itemCount && itemCount.c);
    const cp = await computeTrainerPayroll(coachId, range, { payrollId: p.id, includeNew: legacy });
    if (cp) { await upsertPayroll(cp, range, req, { payrollId: p.id }); recomputed++; }
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'payroll', coachId, 'تحديث أسعار المدرب #' + coachId + (updAtt ? ' — تحديث ' + updAtt + ' سجل حضور' : '') + (recomputed ? ' وإعادة احتساب ' + recomputed + ' كشف مستحقات' : ''), req);
  res.json({ ok: true, updated_attendance: updAtt, recomputed: recomputed });
});

router.post('/rates/staff', async function (req, res) {
  if (!canEdit(req.currentUser, 'payroll')) return res.status(403).json({ ok: false });
  const b = req.body;
  const staffId = Number(b.staff_id || 0);
  if (!staffId) return res.json({ ok: false, error: 'اختر الموظف' });
  const prev = await db.prepare('SELECT * FROM staff_rates WHERE staff_id = ?').get(staffId);
  const vals = [staffId, b.pay_system === 'shift' ? 'shift' : 'monthly', Number(b.monthly_salary || 0), Number(b.work_days_count || 0), Number(b.work_hours || 0), Number(b.day_value || 0), Number(b.hourly_value || 0), Number(b.overtime_hour_value || 0), Number(b.shift_value || 0)];
  if (prev) {
    await db.prepare(`UPDATE staff_rates SET pay_system=?, monthly_salary=?, work_days_count=?, work_hours=?, day_value=?, hourly_value=?, overtime_hour_value=?, shift_value=? WHERE staff_id=?`).run(...vals.slice(1), staffId);
  } else {
    await db.prepare(`INSERT INTO staff_rates (staff_id, pay_system, monthly_salary, work_days_count, work_hours, day_value, hourly_value, overtime_hour_value, shift_value) VALUES (?,?,?,?,?,?,?,?,?)`).run(...vals);
  }
  /* إعادة احتساب كشوف المستحقات القائمة لهذا الموظف (تحفظ المدفوع وتعدّل المتبقي والحالة) */
  let recomputed = 0;
  const periods = await db.prepare("SELECT id, period, from_date, to_date FROM payroll WHERE person_type='staff' AND staff_id=?").all(staffId);
  for (const p of periods) {
    const range = parsePeriod(p.period, p.from_date, p.to_date);
    const cp = await computeStaffPayroll(staffId, range);
    if (cp) { await upsertPayroll(cp, range, req, { payrollId: p.id }); recomputed++; }
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'payroll', staffId, 'تحديث أجور الموظف #' + staffId + (recomputed ? ' وإعادة احتساب ' + recomputed + ' كشف مستحقات' : ''), req);
  res.json({ ok: true, recomputed: recomputed });
});

/* ================================================================
   سياسة الغياب والتأخير القابلة للتعديل
================================================================ */
router.get('/attendance-policy', async function (req, res) {
  if (!canEdit(req.currentUser, 'settings') && !canEdit(req.currentUser, 'payroll')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const { pol } = await getPolicy();
  res.render('attendance_payroll/policy', { title: 'سياسة الغياب والتأخير', active: 'settings', pol, canSave: canEdit(req.currentUser, 'settings') || canEdit(req.currentUser, 'payroll') });
});
router.post('/attendance-policy', async function (req, res) {
  if (!canEdit(req.currentUser, 'settings') && !canEdit(req.currentUser, 'payroll')) return res.status(403).json({ ok: false });
  const b = req.body;
  const late_tiers = [];
  const mins = Array.isArray(b.lt_min) ? b.lt_min : [];
  (Array.isArray(b.lt_max) ? b.lt_max : []).forEach((mx, i) => {
    late_tiers.push({ min: Number(b.lt_min[i] || 0), max: Number(mx), deduct: Number((Array.isArray(b.lt_ded) ? b.lt_ded[i] : 0) || 0) });
  });
  const pol = {
    absence_rate: Math.max(0, Math.min(100, Number(b.absence_rate || 0))),
    absence_deduction: Number(b.absence_deduction || 0),
    late_tiers: late_tiers.length ? late_tiers : DEFAULT_POLICY.late_tiers,
    cancel_paid: String(b.cancel_paid || 'نسبة'),
    cancel_percent: Number(b.cancel_percent || 0)
  };
  await savePolicy(pol);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'settings', 0, 'تعديل سياسة الغياب والتأخير', req);
  res.redirect('/attendance-policy');
});

/* ================================================================
   التقارير (عرض + تصدير CSV)
================================================================ */
async function reportData(range, type, filterCoach, sid) {
  const f = filterCoach ? Number(filterCoach) : 0;
  let coaches;
  if (f) {
    coaches = await db.prepare('SELECT id, full_name FROM coaches WHERE id=?').all(f);
  } else {
    coaches = await db.prepare('SELECT id, full_name FROM coaches WHERE deleted_at IS NULL' + sportClause(sid, '') + ' ORDER BY full_name').all();
  }
  const coachesList = coaches;
  const rows = [];
  const pol = (await getPolicy()).pol;
  const payable = coachPayableStatuses();
  for (const c of coachesList) {
    const atts = await db.prepare(`SELECT * FROM trainer_session_attendance WHERE coach_id=? AND date >= ? AND date <= ?`).all(c.id, range.from, range.to);
    /* الحصص التي تم قبضها/استحقاقها لهذا المدرب (مرتبطة ببنود الكشوف) */
    const claimedRows = await db.prepare(`SELECT pi.source_id AS id, pi.amount AS amount
      FROM payroll_items pi
      JOIN trainer_session_attendance a ON a.id = pi.source_id
      WHERE pi.source_type = 'trainer' AND a.coach_id = ? AND a.date >= ? AND a.date <= ?`).all(c.id, range.from, range.to);
    const claimedMap = {};
    let claimedAmount = 0;
    claimedRows.forEach(function (x) { claimedMap[x.id] = 1; claimedAmount += Number(x.amount || 0); });
    let present = 0, absent = 0, late = 0, cancelled = 0, substitute = 0, excused = 0, total = 0, cost = 0, payableCount = 0, claimed = 0;
    atts.forEach(a => {
      total++;
      if (a.status === 'حاضر') present++;
      else if (a.status === 'غائب') absent++;
      else if (a.status === 'متأخر') late++;
      else if (a.status === 'ملغاة') cancelled++;
      else if (a.status === 'بديل') substitute++;
      else if (a.status === 'معتذر') excused++;
      if (payable.indexOf(a.status) >= 0) {
        payableCount++;
        if (claimedMap[a.id]) claimed++;
      }
      cost += amountForAttendance(a, pol);
    });
    rows.push({
      id: c.id, coach: c.full_name, total, payable: payableCount,
      claimed: claimed, unclaimed: Math.max(0, payableCount - claimed),
      claimedAmount: Math.round(claimedAmount * 100) / 100,
      present, absent, late, cancelled, substitute, excused, cost: Math.round(cost * 100) / 100
    });
  }
  let presentTotal = 0, absentTotal = 0, lateTotal = 0, costTotal = 0, totalSessions = 0, claimedTotal = 0, unclaimedTotal = 0, claimedAmountTotal = 0;
  rows.forEach(r => {
    presentTotal += r.present; absentTotal += r.absent; lateTotal += r.late; costTotal += r.cost; totalSessions += r.total;
    claimedTotal += r.claimed; unclaimedTotal += r.unclaimed; claimedAmountTotal += r.claimedAmount;
  });
  return { rows, range, summary: { presentTotal, absentTotal, lateTotal, costTotal, totalSessions, claimedTotal, unclaimedTotal, claimedAmountTotal: Math.round(claimedAmountTotal * 100) / 100 } };
}

router.get('/attendance-reports', async function (req, res) {
  if (!canView(req.currentUser, 'reports') && !canView(req.currentUser, 'payroll')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const range = rangeFromQuery(req.query);
  const type = String(req.query.type || 'trainers');
  const filterCoach = req.query.coach || 0;
  try {
    const data = await reportData(range, type, filterCoach, activeSport(req));
    const coaches = await db.prepare('SELECT id, full_name FROM coaches WHERE deleted_at IS NULL' + sportClause(activeSport(req), '') + ' ORDER BY full_name').all();
    res.render('attendance_payroll/reports', { title: 'تقارير الحضور والمستحقات', active: 'reports', ...data, type, coaches, from: range.from, to: range.to, filterCoach, canExport: canExport(req.currentUser, 'payroll') || canExport(req.currentUser, 'reports') });
  } catch (e) {
    console.error('attendance-reports error:', e);
    res.status(500).send('حدث خطأ في تقرير الحضور: ' + e.message);
  }
});

router.get('/attendance-reports/export', async function (req, res) {
  if (!canExport(req.currentUser, 'payroll') && !canExport(req.currentUser, 'reports')) return res.status(403).send('غير مصرح');
  const range = rangeFromQuery(req.query);
  const type = String(req.query.type || 'trainers');
  const data = await reportData(range, type, 0, activeSport(req));
  const head = ['المدرب', 'إجمالي الحصص', 'تم قبضها', 'لم تُقبض', 'حاضر', 'غائب', 'متأخر', 'ملغاة', 'بديل', 'معتذر', 'قيمة الحصص', 'قيمة تم قبضها'];
  const lines = [head.join(',')];
  data.rows.forEach(r => lines.push([r.coach, r.total, r.claimed, r.unclaimed, r.present, r.absent, r.late, r.cancelled, r.substitute, r.excused, r.cost.toFixed(2), r.claimedAmount.toFixed(2)].join(',')));
  lines.push(['الإجمالي', data.summary.totalSessions, data.summary.claimedTotal, data.summary.unclaimedTotal, data.summary.presentTotal, data.summary.absentTotal, data.summary.lateTotal, '', '', '', data.summary.costTotal.toFixed(2), data.summary.claimedAmountTotal.toFixed(2)].join(','));
  const csv = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance_' + range.from + '_' + range.to + '.csv"');
  res.send(csv);
});

/* ---------- أدوات صغيرة ---------- */
function durationMinutes(start, end) {
  if (!start || !end) return 0;
  const [h1, m1] = String(start).split(':').map(Number);
  const [h2, m2] = String(end).split(':').map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  return mins;
}
function dateLabel(d) { return String(d || '').slice(0, 10); }

/* إعادة توجيه: ملف المدرب من بطاقة الحضور */
router.get('/trainer-profile/:id', async function (req, res) {
  if (!canView(req.currentUser, 'trainerAttendance')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const train = await db.prepare('SELECT * FROM coaches WHERE id=?').get(Number(req.params.id));
  if (!train) return res.redirect('/trainer-attendance');
  const range = rangeFromQuery(req.query);
  const atts = await db.prepare(`SELECT a.*, g.name AS group_name, b.name AS branch_name FROM trainer_session_attendance a LEFT JOIN groups g ON g.id=a.group_id LEFT JOIN branches b ON b.id=a.branch_id WHERE a.coach_id=? AND a.date >= ? AND a.date <= ? ORDER BY a.date`).all(train.id, range.from, range.to);
  const rate = await effectiveTrainerRate(train.id);
  const adjustments = await db.prepare('SELECT * FROM salary_adjustments WHERE coach_id=? AND date >= ? AND date <= ? ORDER BY date DESC').all(train.id, range.from, range.to);
  res.render('attendance_payroll/trainer_profile', { title: 'ملف ' + train.full_name, active: 'trainerAttendance', train, atts, rate, adjustments, from: range.from, to: range.to, STATUS: TRAINER_STATUS, money, fmtDate });
});

module.exports = router;
