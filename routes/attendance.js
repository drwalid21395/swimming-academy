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

/* ---------- حالات الحضور ---------- */
const TRAINER_STATUS = [
  { value: 'حاضر', label: 'حاضر', icon: 'fa-check', cls: 'badge-success' },
  { value: 'غائب', label: 'غائب', icon: 'fa-xmark', cls: 'badge-danger' },
  { value: 'متأخر', label: 'متأخر', icon: 'fa-clock', cls: 'badge-warning' },
  { value: 'معتذر', label: 'معتذر', icon: 'fa-user-shield', cls: 'badge-info' },
  { value: 'ملغاة', label: 'حصة ملغاة', icon: 'fa-ban', cls: 'badge-gray' },
  { value: 'بديل', label: 'مدرب بديل', icon: 'fa-rotate', cls: 'badge-purple' }
];
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
   الشاشة السريعة: حصص اليوم + تسجيل حضور المدرب بضغطة
================================================================ */
/* أسماء أيام الأسبوع الإنجليزية المقابلة لـ getDay() (0=الأحد ... 6=السبت) */
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function weekdayName(dateStr) { try { const d = new Date(dateStr + 'T12:00:00'); return DAY_NAMES[d.getDay()]; } catch (e) { return null; } }

/* حصص اليوم: الصفوف الفعلية + جلسات المجموعات المتكررة النشطة المتوقعة في ذلك اليوم */
async function sessionsFor(date) {
  const rows = await db.prepare(`SELECT se.id, se.date, se.start_time, se.end_time, se.title, se.status AS ses_status,
      se.group_id, g.name AS group_name, g.branch_id, c.id AS coach_id, c.full_name AS coach_name, p.name AS pool_name
    FROM sessions se
    LEFT JOIN groups g ON g.id = se.group_id
    LEFT JOIN coaches c ON c.id = se.coach_id
    LEFT JOIN pools p ON p.id = se.pool_id
    WHERE se.date = ? AND se.deleted_at IS NULL
    ORDER BY se.start_time`).all(date);

  const wd = weekdayName(date);
  if (wd) {
    const groups = await db.prepare(`SELECT g.id, g.name, g.branch_id, g.coach_id, g.pool_id, g.schedule, c.full_name AS coach_name, p.name AS pool_name
      FROM groups g
      LEFT JOIN coaches c ON c.id = g.coach_id
      LEFT JOIN pools p ON p.id = g.pool_id
WHERE (g.status IS NULL OR g.status = '' OR g.status = 'نشطة') AND g.deleted_at IS NULL`).all();
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

router.get('/staff-hours', async function (req, res) {
  if (!canView(req.currentUser, 'trainerAttendance') && !canView(req.currentUser, 'staffAttendance')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : today();
  const ai = getAcademyId();
  const { pol } = await getPolicy();

  let sessionsToday = await sessionsFor(date);

  const atts = await db.prepare('SELECT * FROM trainer_session_attendance WHERE date = ?').all(date);
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

/* ================================================================
   حضور المدربين (سجل + ترشيح بالشهر)
================================================================ */
router.get('/trainer-attendance', async function (req, res) {
  if (!canView(req.currentUser, 'trainerAttendance')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const month = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : today().slice(0, 7);
  const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : today();
  const rows = await db.prepare(`SELECT a.*, g.name AS group_name, b.name AS branch_name, c.full_name AS coach_name,
      sc.full_name AS substitute_name
    FROM trainer_session_attendance a
    LEFT JOIN groups g ON g.id = a.group_id
    LEFT JOIN branches b ON b.id = a.branch_id
    LEFT JOIN coaches c ON c.id = a.coach_id
    LEFT JOIN coaches sc ON sc.id = a.substitute_coach_id
    WHERE substr(a.date,1,7) = ?
    ORDER BY a.date DESC, a.start_time`).all(month);
  const pol = (await getPolicy()).pol;
  rows.forEach(r => {
    r.amount = amountForAttendance(r, pol);
  });

  const dayAtt = {};
  (await db.prepare('SELECT * FROM trainer_session_attendance WHERE date = ?').all(date)).forEach(a => { if (!dayAtt[a.coach_id]) dayAtt[a.coach_id] = a; });

  const sessionsToday = await db.prepare(`SELECT se.group_id, se.coach_id, se.start_time, g.name AS group_name FROM sessions se LEFT JOIN groups g ON g.id = se.group_id WHERE se.date = ? AND se.deleted_at IS NULL`).all(date);
  const timeMap = {};
  const grpMap = {};
  sessionsToday.forEach(s => { if (s.coach_id) { if (!timeMap[s.coach_id]) timeMap[s.coach_id] = s.start_time; if (!grpMap[s.coach_id]) grpMap[s.coach_id] = s.group_name; } });
  const wd = weekdayName(date);
  if (wd) {
    const groups = await db.prepare(`SELECT g.* FROM groups g WHERE (g.status IS NULL OR g.status = '' OR g.status = 'نشطة') AND g.deleted_at IS NULL`).all();
    groups.forEach(g => {
      const sch = parseJSON(g.schedule, []);
      const slot = (sch || []).find(s => s.day === wd);
      if (slot && g.coach_id && !timeMap[g.coach_id]) { timeMap[g.coach_id] = slot.start || '16:00'; grpMap[g.coach_id] = g.name; }
    });
  }

  const coaches = await db.prepare(`SELECT c.* FROM coaches c WHERE c.deleted_at IS NULL AND (c.status IS NULL OR c.status = '' OR c.status = 'active' OR c.status = 'نشط' OR c.status = 'نشطة') ORDER BY c.full_name`).all();
  const sheet = coaches.map(c => Object.assign({}, c, {
    time: timeMap[c.id] || null,
    group_name: grpMap[c.id] || null,
    att: dayAtt[c.id] || null
  }));

  let present = 0, absent = 0, excused = 0, late = 0;
  Object.keys(dayAtt).forEach(k => { const st = dayAtt[k].status; if (st === 'حاضر') present++; else if (st === 'غائب') absent++; else if (st === 'معتذر') excused++; else if (st === 'متأخر') late++; });
  const yday = (new Date(Date.now() - 86400000)).toISOString().slice(0, 10);
  res.render('attendance_payroll/trainer_attendance', { title: 'حضور المدربين', active: 'trainerAttendance', sheet, rows, month, date, yday, kpi: { present, absent, excused, late }, coaches, STATUS: TRAINER_STATUS, canAdd: canAdd(req.currentUser, 'trainerAttendance') });
});

/* ================================================================
   حضور الموظفين
================================================================ */
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
    let session = await db.prepare(`SELECT * FROM sessions WHERE date = ? AND coach_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1`).get(date, coachId);
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
    const cancel_reason = status === 'ملغاة' ? String(v.cancel_reason || '') : '';
    const payment_policy = status === 'ملغاة' ? String(v.payment_policy || '') : '';
    const existing = await db.prepare('SELECT * FROM trainer_session_attendance WHERE session_id = ? AND coach_id = ?').get(session.id, coachId);
    if (existing) {
      await db.prepare(`UPDATE trainer_session_attendance SET status=?, session_rate=?, late_minutes=?, cancel_reason=?, payment_policy=?, note=?, updated_by=?, updated_at=? WHERE id=?`)
        .run(status, session_rate, late_minutes, cancel_reason, payment_policy, String(v.note || ''), req.currentUser.id, new Date().toLocaleString('sv-SE').replace('T', ' '), existing.id);
    } else {
      await db.prepare(`INSERT INTO trainer_session_attendance (session_id, group_id, branch_id, coach_id, substitute_coach_id, date, start_time, end_time, duration_min, status, session_rate, base_rate, late_minutes, cancel_reason, payment_policy, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(session.id, session.group_id, groupRow ? groupRow.branch_id : null, coachId, substitute_coach_id, date, session.start_time, session.end_time, durationMin, status, session_rate, rate.effective, late_minutes, cancel_reason, payment_policy, String(v.note || ''), req.currentUser.id);
    }
    n++;
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'trainerAttendance', 0, 'حفظ حضور يومي للمدربين (' + n + ') — ' + date, req);
  res.json({ ok: true, count: n });
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
  const dayAtt = {};
  (await db.prepare('SELECT * FROM staff_attendance WHERE date = ?').all(date)).forEach(a => { dayAtt[a.staff_id] = a; });
  const sheet = staff.map(s => Object.assign({}, s, { att: dayAtt[s.id] || null }));
  const staffRates = {};
  (await db.prepare('SELECT * FROM staff_rates').all()).forEach(r => staffRates[r.staff_id] = r);
  let present = 0, absent = 0, excused = 0, late = 0;
  Object.keys(dayAtt).forEach(k => {
    const st = dayAtt[k].status;
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
  const rec = {
    staff_id: staffId, branch_id: b.branch_id || (staffRow && staffRow.branch_id) || null,
    date, check_in: b.check_in || '', check_out: b.check_out || '',
    status: String(b.status || 'حاضر'), shift_count: Number(b.shift_count || 1),
    late_minutes: Number(b.late_minutes || 0), early_leave: Number(b.early_leave || 0),
    overtime_minutes: Number(b.overtime_minutes || 0), note: String(b.note || '')
  };
  if (existing) {
    await db.prepare(`UPDATE staff_attendance SET branch_id=?, check_in=?, check_out=?, status=?, shift_count=?, late_minutes=?, early_leave=?, overtime_minutes=?, note=? WHERE id=?`)
      .run(rec.branch_id, rec.check_in, rec.check_out, rec.status, rec.shift_count, rec.late_minutes, rec.early_leave, rec.overtime_minutes, rec.note, existing.id);
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'staffAttendance', existing.id, 'تعديل حضور: ' + (staffRow ? staffRow.full_name : staffId) + ' — ' + date, req);
  } else {
    const info = await db.prepare(`INSERT INTO staff_attendance (staff_id, branch_id, date, check_in, check_out, status, shift_count, late_minutes, early_leave, overtime_minutes, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(rec.staff_id, rec.branch_id, rec.date, rec.check_in, rec.check_out, rec.status, rec.shift_count, rec.late_minutes, rec.early_leave, rec.overtime_minutes, rec.note, req.currentUser.id);
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
  const stmtU = await db.prepare(`UPDATE staff_attendance SET branch_id=?, check_in=?, check_out=?, status=?, shift_count=?, late_minutes=?, early_leave=?, overtime_minutes=?, note=? WHERE id=?`);
  const stmtI = await db.prepare(`INSERT INTO staff_attendance (staff_id, branch_id, date, check_in, check_out, status, shift_count, late_minutes, early_leave, overtime_minutes, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  for (const sid of Object.keys(statuses || {})) {
    const id = Number(sid);
    if (!id) continue;
    const v = statuses[sid] || {};
    const staffRow = await db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
    const status = String(v.status || 'حاضر');
    const existing = await db.prepare('SELECT * FROM staff_attendance WHERE staff_id = ? AND date = ?').get(id, date);
    if (existing) {
      await stmtU.run(staffRow && staffRow.branch_id || null, v.check_in || '', v.check_out || '', status, Number(v.shift_count || 1), Number(v.late_minutes || 0), Number(v.early_leave || 0), Number(v.overtime_minutes || 0), String(v.note || ''), existing.id);
    } else {
      await stmtI.run(id, staffRow && staffRow.branch_id || null, date, v.check_in || '', v.check_out || '', status, Number(v.shift_count || 1), Number(v.late_minutes || 0), Number(v.early_leave || 0), Number(v.overtime_minutes || 0), String(v.note || ''), req.currentUser.id);
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
    WHERE substr(a.date,1,7) = ?` + (type === 'deduction' ? ' AND a.adj_type=\'deduction\'' : type === 'bonus' ? ' AND a.adj_type=\'bonus\'' : '') + `
    ORDER BY a.date DESC`).all(month);
  const coaches = await db.prepare('SELECT id, full_name FROM coaches WHERE deleted_at IS NULL ORDER BY full_name').all();
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

router.get('/payroll', async function (req, res) {
  if (!canView(req.currentUser, 'payroll')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const month = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : today().slice(0, 7);
  const ptype = req.query.type || 'all';
  const rows = await db.prepare(`SELECT p.*, c.full_name AS coach_name, s.full_name AS staff_name, b.name AS branch_name
    FROM payroll p
    LEFT JOIN coaches c ON c.id = p.coach_id
    LEFT JOIN staff s ON s.id = p.staff_id
    LEFT JOIN branches b ON b.id = p.branch_id
    WHERE p.period = ?` + (ptype === 'trainer' ? ' AND p.person_type=\'trainer\'' : ptype === 'staff' ? ' AND p.person_type=\'staff\'' : '') + `
    ORDER BY p.person_type, c.full_name, s.full_name`).all(month);

  const coaches = await db.prepare('SELECT * FROM coaches WHERE deleted_at IS NULL ORDER BY full_name').all();
  const staff = await db.prepare('SELECT * FROM staff ORDER BY full_name').all();
  res.render('attendance_payroll/payroll_list', { title: 'مستحقات ورواتب', active: 'payroll', rows, month, ptype, coaches, staff, canAdd: canAdd(req.currentUser, 'payroll'), canEdit: canEdit(req.currentUser, 'payroll'), canExport: canExport(req.currentUser, 'payroll') });
});

/* حساب كشف لكل مدرب في الفترة (قبل الحفظ) */
async function computeTrainerPayroll(coachId, month) {
  const t = await db.prepare('SELECT * FROM coaches WHERE id = ?').get(coachId);
  if (!t) return null;
  const atts = await db.prepare('SELECT * FROM trainer_session_attendance WHERE coach_id = ? AND substr(date,1,7) = ?').all(coachId, month);
  const pol = (await getPolicy()).pol;
  let gross = 0, extras = 0, deductions = 0;
  atts.forEach(a => {
    const amt = amountForAttendance(a, pol);
    if (a.status === 'ملغاة' || a.status === 'غائب' || a.status === 'متأخر') {
      const full = Number(a.base_rate || a.session_rate || 0);
      if (a.status === 'غائب') {
        gross += 0;
        if (Number(pol.absence_deduction || 0) > 0) deductions += Number(pol.absence_deduction);
      } else if (a.status === 'متأخر') {
        gross += amt; // النسبة المستحقة بعد الخصم
      } else {
        gross += amt; // الملغاة بنسبة السياسة
      }
    } else {
      gross += amt;
    }
  });
  // حصص بديلة يقوم بها هذا المدرب نيابة عن آخرين
  const subs = await db.prepare('SELECT * FROM trainer_session_attendance WHERE substitute_coach_id = ? AND substr(date,1,7) = ?').all(coachId, month);
  subs.forEach(a => { gross += amountForAttendance(a, pol); });

  const adjustments = await db.prepare(`SELECT * FROM salary_adjustments WHERE coach_id = ? AND period = ?`).all(coachId, month);
  adjustments.forEach(x => { if (x.adj_type === 'bonus') extras += Number(x.amount || 0); else deductions += Number(x.amount || 0); });
  return { coachId, personType: 'trainer', name: t.full_name, atts: atts.length + subs.length, gross, extras, deductions, net: Math.round((gross + extras - deductions) * 100) / 100 };
}

async function computeStaffPayroll(staffId, month) {
  const s = await db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId);
  if (!s) return null;
  const rate = await db.prepare('SELECT * FROM staff_rates WHERE staff_id = ?').get(staffId);
  const attendance = await db.prepare('SELECT * FROM staff_attendance WHERE staff_id = ? AND substr(date,1,7) = ?').all(staffId, month);
  let gross = 0;
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
    // شهري: راتب ثابت (يُحتسب كامل بغض النظر عن أيام الحضور، مع خصم الغياب حسب الأيام)
    gross = Number((rate && rate.monthly_salary) || s.salary || 0);
    const dayValue = Number((rate && rate.day_value) || 0);
    const absDays = attendance.filter(a => a.status === 'غائب').length;
    if (absDays > 0 && dayValue > 0) gross = gross - (absDays * dayValue);
  }
  let extras = 0, deductions = 0;
  const adjustments = await db.prepare(`SELECT * FROM salary_adjustments WHERE staff_id = ? AND period = ?`).all(staffId, month);
  adjustments.forEach(x => { if (x.adj_type === 'bonus') extras += Number(x.amount || 0); else deductions += Number(x.amount || 0); });
  return { staffId, personType: 'staff', name: s.full_name, atts: attendance.length, gross, extras, deductions, net: Math.round((gross + extras - deductions) * 100) / 100 };
}

/* إنشاء/تحديث كشف لفترة لمجموعة أشخاص (مدربين أو موظفين) */
router.post('/payroll/generate', async function (req, res) {
  if (!canAdd(req.currentUser, 'payroll')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const month = String(req.body.month || today().slice(0, 7));
  const ptype = req.body.type === 'staff' ? 'staff' : 'trainer';
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(n => Number.isFinite(n) && n > 0);
  const results = [];
  if (ptype === 'trainer') {
    const list = ids.length ? ids : (await db.prepare('SELECT id FROM coaches WHERE deleted_at IS NULL').all()).map(r => r.id);
    for (const id of list) {
      const p = await computeTrainerPayroll(id, month);
      if (!p) continue;
      await upsertPayroll(p, month, req);
      results.push(p);
    }
  } else {
    const list = ids.length ? ids : (await db.prepare('SELECT id FROM staff').all()).map(r => r.id);
    for (const id of list) {
      const p = await computeStaffPayroll(id, month);
      if (!p) continue;
      await upsertPayroll(p, month, req);
      results.push(p);
    }
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'payroll', 0, 'توليد كشوف مستحقات ' + (ptype === 'trainer' ? 'مدربين' : 'موظفين') + ' لشهر ' + month + ' (' + results.length + ' كشف)', req);
  res.json({ ok: true, count: results.length });
});

async function upsertPayroll(p, month, req) {
  const existing = p.personType === 'trainer'
    ? await db.prepare("SELECT * FROM payroll WHERE person_type='trainer' AND coach_id = ? AND period = ?").get(p.coachId, month)
    : await db.prepare("SELECT * FROM payroll WHERE person_type='staff' AND staff_id = ? AND period = ?").get(p.staffId, month);
  const values = [p.personType, p.coachId || null, p.staffId || null, month, p.gross, p.extras, p.deductions, p.net];
  if (existing) {
    // لا نلمس المدفوع إذا كان قد صُرف بالفعل؛ فقط نحدّث الجانب الاستحقاقي
    const paid = Number(existing.paid_amount || 0);
    const remaining = Math.round((p.net - paid) * 100) / 100;
    await db.prepare(`UPDATE payroll SET gross=?, extras=?, deductions=?, net=?, remaining=?, status=?, updated_at=? WHERE id=?`)
      .run(p.gross, p.extras, p.deductions, p.net, remaining, remaining <= 0 ? 'مسدد' : (paid > 0 ? 'مدفوع جزئياً' : 'مستحق'), new Date().toLocaleString('sv-SE').replace('T', ' '), existing.id);
    return existing.id;
  }
  const info = await db.prepare(`INSERT INTO payroll (person_type, coach_id, staff_id, period, gross, extras, deductions, net, paid_amount, remaining, status, note) VALUES (?,?,?,?,?,?,?,?,0,0,'مستحق','مولّد تلقائياً')`).run(...values);
  return info.lastInsertRowid;
}

router.get('/payroll/:id', async function (req, res) {
  if (!canView(req.currentUser, 'payroll')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
    const row = await db.prepare(`SELECT p.*, c.full_name AS coach_name, c.qualification, s.full_name AS staff_name, s.job_title, b.name AS branch_name
    FROM payroll p
    LEFT JOIN coaches c ON c.id = p.coach_id
    LEFT JOIN staff s ON s.id = p.staff_id
    LEFT JOIN branches b ON b.id = p.branch_id
    WHERE p.id = ?`).get(id);
  if (!row) return res.redirect('/payroll');
  const month = row.period;
  let statementRows = [];
  if (row.person_type === 'trainer' && row.coach_id) {
    statementRows = await db.prepare(`SELECT a.*, g.name AS group_name FROM trainer_session_attendance a LEFT JOIN groups g ON g.id=a.group_id WHERE a.coach_id = ? AND substr(a.date,1,7) = ? ORDER BY a.date`).all(row.coach_id, month);
  } else if (row.person_type === 'staff' && row.staff_id) {
    statementRows = await db.prepare('SELECT * FROM staff_attendance WHERE staff_id = ? AND substr(date,1,7) = ? ORDER BY date').all(row.staff_id, month);
  }
  const adjustments = await db.prepare(`SELECT * FROM salary_adjustments WHERE ` + (row.person_type === 'trainer' ? 'coach_id = ?' : 'staff_id = ?') + ` AND period = ?`).all(row.person_type === 'trainer' ? row.coach_id : row.staff_id, month);
  const pays = await db.prepare(`SELECT pt.*, u.full_name AS payer_name FROM payroll_transactions pt LEFT JOIN users u ON u.id = pt.created_by WHERE pt.payroll_id = ? ORDER BY pt.paid_date`).all(id);
  const pol = (await getPolicy()).pol;
  res.render('attendance_payroll/payroll_detail', {
    title: 'كشف حساب ' + (row.coach_name || row.staff_name || ''), active: 'payroll',
    row, statementRows, adjustments, pays, month, pol,
    canEdit: canEdit(req.currentUser, 'payroll'), canDel: canDel(req.currentUser, 'payroll'),
    canExport: canExport(req.currentUser, 'payroll'), PAY_METHODS, money, fmtDate
  });
});

/* تسجيل دفعة على كشف */
router.post('/payroll/:id/pay', async function (req, res) {
  if (!canEdit(req.currentUser, 'payroll')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const id = Number(req.params.id);
  const b = req.body;
  const row = await db.prepare('SELECT * FROM payroll WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ ok: false });
  const amount = Math.min(Number(b.amount || 0), Number(row.remaining || 0));
  if (amount <= 0) return res.json({ ok: false, error: 'مبلغ غير صالح' });
  const paidDate = String(b.paid_date || today());
  const method = String(b.method || 'نقدي');
  const note = String(b.note || '');
  const info = await db.prepare(`INSERT INTO payroll_transactions (payroll_id, amount, paid_date, method, note, created_by) VALUES (?,?,?,?,?,?)`)
    .run(id, amount, paidDate, method, note, req.currentUser.id);
  // تحديث حالة الكشف
  const paidNow = Math.round((Number(row.paid_amount || 0) + amount) * 100) / 100;
  const remaining = Math.round((Number(row.net || 0) - paidNow) * 100) / 100;
  const status = remaining <= 0 ? 'مسدد' : 'مدفوع جزئياً';
  await db.prepare(`UPDATE payroll SET paid_amount=?, remaining=?, status=? WHERE id=?`).run(paidNow, remaining, status, id);
  // إنشاء مصروف تلقائي بنفس نمط نظام coach_payments الحالي
  const name = row.coach_name || row.staff_name || ('#' + id);
  try {
    await db.prepare(`INSERT INTO expenses (category, date, description, amount, payment_method, beneficiary, status, created_by) VALUES ('رواتب وأجور', ?, ?, ?, ?, ?, 'معتمد', ?)`)
      .run(paidDate, 'صرف مستحقات: ' + name + ' (شهر ' + row.period + ')', amount, method, name, req.currentUser.id);
  } catch (e) { /* لا نكسر العملية */ }
  audit(req.currentUser.id, req.currentUser.fullName || req.currentUser.full_name, 'approve_payment', 'payroll', id, 'صرف مستحقات ' + name + ': ' + money(amount) + ' (' + method + ')', req);
  res.json({ ok: true, paidNow, remaining, status, id: Number(info.lastInsertRowid || 0) });
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
  const coaches = await db.prepare('SELECT * FROM coaches WHERE deleted_at IS NULL ORDER BY full_name').all();
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
  await db.prepare(`INSERT INTO trainer_rates (coach_id, default_rate, hourly_rate, private_rate, group_rate, branch_id, branch_rate, period) VALUES (?,?,?,?,?,?,?,?)`)
    .run(coachId, Number(b.default_rate || 0), Number(b.hourly_rate || 0), Number(b.private_rate || 0), Number(b.group_rate || 0), b.branch_id ? Number(b.branch_id) : null, Number(b.branch_rate || 0), b.period || today().slice(0, 7));
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'payroll', coachId, 'تحديث أسعار المدرب #' + coachId, req);
  res.json({ ok: true });
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
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'payroll', staffId, 'تحديث أجور الموظف #' + staffId, req);
  res.json({ ok: true });
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
async function reportData(month, type, filterCoach) {
  const f = filterCoach ? Number(filterCoach) : 0;
  let coaches;
  if (f) {
    coaches = await db.prepare('SELECT id, full_name FROM coaches WHERE id=?').all(f);
  } else {
    coaches = await db.prepare('SELECT id, full_name FROM coaches WHERE deleted_at IS NULL ORDER BY full_name').all();
  }
  const coachesList = coaches;
  const rows = [];
  const pol = (await getPolicy()).pol;
  for (const c of coachesList) {
    const atts = await db.prepare(`SELECT * FROM trainer_session_attendance WHERE coach_id=? AND substr(date,1,7)=?`).all(c.id, month);
    let present = 0, absent = 0, late = 0, cancelled = 0, substitute = 0, excused = 0, total = 0, cost = 0;
    atts.forEach(a => {
      total++;
      if (a.status === 'حاضر') present++;
      else if (a.status === 'غائب') absent++;
      else if (a.status === 'متأخر') late++;
      else if (a.status === 'ملغاة') cancelled++;
      else if (a.status === 'بديل') substitute++;
      else if (a.status === 'معتذر') excused++;
      cost += amountForAttendance(a, pol);
    });
    rows.push({ id: c.id, coach: c.full_name, total, present, absent, late, cancelled, substitute, excused, cost: Math.round(cost * 100) / 100 });
  }
  let presentTotal = 0, absentTotal = 0, lateTotal = 0, costTotal = 0, totalSessions = 0;
  rows.forEach(r => { presentTotal += r.present; absentTotal += r.absent; lateTotal += r.late; costTotal += r.cost; totalSessions += r.total; });
  return { rows, month, summary: { presentTotal, absentTotal, lateTotal, costTotal, totalSessions } };
}

router.get('/attendance-reports', async function (req, res) {
  if (!canView(req.currentUser, 'reports') && !canView(req.currentUser, 'payroll')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const month = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : today().slice(0, 7);
  const type = String(req.query.type || 'trainers');
  const filterCoach = req.query.coach || 0;
  try {
    const data = await reportData(month, type, filterCoach);
    const coaches = await db.prepare('SELECT id, full_name FROM coaches WHERE deleted_at IS NULL ORDER BY full_name').all();
    res.render('attendance_payroll/reports', { title: 'تقارير الحضور والمستحقات', active: 'reports', ...data, type, coaches, month, filterCoach, canExport: canExport(req.currentUser, 'payroll') || canExport(req.currentUser, 'reports') });
  } catch (e) {
    console.error('attendance-reports error:', e);
    res.status(500).send('حدث خطأ في تقرير الحضور: ' + e.message);
  }
});

router.get('/attendance-reports/export', async function (req, res) {
  if (!canExport(req.currentUser, 'payroll') && !canExport(req.currentUser, 'reports')) return res.status(403).send('غير مصرح');
  const month = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : today().slice(0, 7);
  const type = String(req.query.type || 'trainers');
  const data = await reportData(month, type, 0);
  const head = ['المدرب', 'إجمالي الحصص', 'حاضر', 'غائب', 'متأخر', 'ملغاة', 'بديل', 'معتذر', 'قيمة الحصص'];
  const lines = [head.join(',')];
  data.rows.forEach(r => lines.push([r.coach, r.total, r.present, r.absent, r.late, r.cancelled, r.substitute, r.excused, r.cost.toFixed(2)].join(',')));
  lines.push(['الإجمالي', data.summary.totalSessions, data.summary.presentTotal, data.summary.absentTotal, data.summary.lateTotal, '', '', '', data.summary.costTotal.toFixed(2)].join(','));
  const csv = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance_' + month + '.csv"');
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
  const month = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) ? req.query.month : today().slice(0, 7);
  const atts = await db.prepare(`SELECT a.*, g.name AS group_name, b.name AS branch_name FROM trainer_session_attendance a LEFT JOIN groups g ON g.id=a.group_id LEFT JOIN branches b ON b.id=a.branch_id WHERE a.coach_id=? AND substr(a.date,1,7)=? ORDER BY a.date`).all(train.id, month);
  const rate = await effectiveTrainerRate(train.id);
  const adjustments = await db.prepare('SELECT * FROM salary_adjustments WHERE coach_id=? AND period=? ORDER BY date DESC').all(train.id, month);
  res.render('attendance_payroll/trainer_profile', { title: 'ملف ' + train.full_name, active: 'trainerAttendance', train, atts, rate, adjustments, month, STATUS: TRAINER_STATUS, money, fmtDate });
});

module.exports = router;
