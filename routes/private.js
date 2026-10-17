/** التدريب الخاص: مواعيد أسبوعية لكل مدرب + حجز حصص + تسجيل حضور وغياب بالباقة */
const express = require('express');
const { db } = require('../lib/db');
const { audit, money, fmtDate, today, canView, canAdd, canEdit, canDel } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const { activeSport, effectiveSport, sportClause, swimmerSportClause } = require('../lib/sport-context');

const router = express.Router();

const DAY_FULL = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const PRIV_STATUS = {
  scheduled: { label: 'مجدولة', cls: 'badge-primary', icon: 'fa-clock' },
  present: { label: 'حاضر', cls: 'badge-success', icon: 'fa-check' },
  absent: { label: 'غائب', cls: 'badge-danger', icon: 'fa-xmark' },
  excused: { label: 'معتذر', cls: 'badge-info', icon: 'fa-hand' },
  late: { label: 'متأخر', cls: 'badge-warning', icon: 'fa-hourglass-half' },
  cancelled: { label: 'ملغاة', cls: 'badge-gray', icon: 'fa-ban' }
};
const ATTENDED = ['present', 'late'];
function attCounts(st) { return ATTENDED.indexOf(st) >= 0 ? 1 : 0; }

function statusBadge(st) {
  const m = PRIV_STATUS[st] || { label: st, cls: 'badge-gray', icon: 'fa-circle' };
  return `<span class="badge ${m.cls}"><i class="fas ${m.icon}"></i> ${m.label}</span>`;
}

/* إعادة حساب حالة الباقة وفق عدد الحصص المستهلكة (تنتهي باكتمال العدد) */
async function refreshPackage(packageId) {
  if (!packageId) return;
  const p = await db.prepare('SELECT * FROM private_packages WHERE id = ?').get(packageId);
  if (!p) return;
  const total = Number(p.sessions_total || 0);
  const used = Math.min(total, Math.max(0, Number(p.sessions_used || 0)));
  let status = p.status;
  if (status !== 'ملغي') status = (total > 0 && used >= total) ? 'منتهي' : 'نشط';
  await db.prepare('UPDATE private_packages SET sessions_used=?, status=? WHERE id=?').run(used, status, packageId);
}

/* ================================================================
   قائمة المدربين
================================================================ */
router.get('/private-training', async function (req, res) {
  if (!canView(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const sid = activeSport(req);
  const coaches = await db.prepare('SELECT * FROM coaches WHERE deleted_at IS NULL' + sportClause(sid, '') + ' ORDER BY full_name').all();

  const stats = {};
  const put = (id, key, val) => { stats[id] = stats[id] || {}; stats[id][key] = val; };
  (await db.prepare("SELECT coach_id, COUNT(*) AS c FROM private_availability WHERE status='نشط' GROUP BY coach_id").all())
    .forEach(a => { stats[a.coach_id] = Object.assign(stats[a.coach_id] || {}, { slots: a.c }); });
  (await db.prepare("SELECT coach_id, COUNT(*) AS c FROM private_packages WHERE status='نشط' GROUP BY coach_id").all())
    .forEach(a => { stats[a.coach_id] = stats[a.coach_id] || {}; stats[a.coach_id].packages = a.c; });
  const upc = await db.prepare("SELECT coach_id, COUNT(*) AS c FROM private_sessions WHERE status='scheduled' AND date >= ? GROUP BY coach_id").all(today());
  upc.forEach(a => { stats[a.coach_id] = stats[a.coach_id] || {}; stats[a.coach_id].upcoming = a.c; });

  res.render('private/coaches', {
    title: 'التدريب الخاص', active: 'privateTraining',
    coaches, stats, dayFull: DAY_FULL,
    canEdit: canEdit(req.currentUser, 'privateTraining'), money
  });
});

/* ================================================================
   صفحة المدرب: المواعيد + جدول الأسبوع + الباقات + الحصص
================================================================ */
router.get('/private-training/coach/:id', async function (req, res) {
  if (!canView(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coachId = Number(req.params.id);
  const coach = await db.prepare('SELECT * FROM coaches WHERE id = ?').get(coachId);
  if (!coach) { setFlash(res, { type: 'error', message: 'المدرب غير موجود' }); return res.redirect('/private-training'); }

  const weekParam = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.week || '')) ? req.query.week : today();
  const wStart = new Date(weekParam + 'T12:00:00');
  wStart.setDate(wStart.getDate() - wStart.getDay());
  const iso = function (d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), x = String(d.getDate()).padStart(2, '0'); return y + '-' + m + '-' + x; };
  const wEnd = new Date(wStart.getTime()); wEnd.setDate(wEnd.getDate() + 6);
  const weekStartISO = iso(wStart), weekEndISO = iso(wEnd);
  const prevWeek = iso(new Date(wStart.getTime() - 7 * 864e5));
  const nextWeek = iso(new Date(wStart.getTime() + 7 * 864e5));

  const availability = await db.prepare('SELECT * FROM private_availability WHERE coach_id = ? ORDER BY weekday, start_time').all(coachId);
  const sessions = await db.prepare('SELECT ps.*, sw.full_name AS swimmer_name, sw.membership_no FROM private_sessions ps LEFT JOIN swimmers sw ON sw.id = ps.swimmer_id WHERE ps.coach_id = ? AND ps.date BETWEEN ? AND ? ORDER BY ps.date, ps.start_time').all(coachId, weekStartISO, weekEndISO);
  const allSessions = await db.prepare('SELECT ps.*, sw.full_name AS swimmer_name FROM private_sessions ps LEFT JOIN swimmers sw ON sw.id = ps.swimmer_id WHERE ps.coach_id = ? ORDER BY ps.date DESC, ps.start_time DESC LIMIT 200').all(coachId);

  const packages = await db.prepare(`SELECT pp.*, sw.full_name AS swimmer_name,
      MAX(0, pp.sessions_total - pp.sessions_used) AS sessions_left
    FROM private_packages pp LEFT JOIN swimmers sw ON sw.id = pp.swimmer_id
    WHERE pp.coach_id = ?
    ORDER BY CASE pp.status WHEN 'نشط' THEN 0 ELSE 1 END, pp.created_at DESC`).all(coachId);

  const swimmers = await db.prepare('SELECT id, full_name, membership_no FROM swimmers WHERE deleted_at IS NULL' + swimmerSportClause(activeSport(req), '') + " AND status != 'منسحب' ORDER BY full_name").all();

  // شبكة الأسبوع: كل يوم + مواعيده المتاحة + حالة الحجز
  const sessByKey = {};
  sessions.forEach(function (s) { sessByKey[s.date + '|' + (s.start_time || '')] = s; });
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(wStart.getTime()); d.setDate(d.getDate() + i);
    const dateISO = iso(d);
    const wd = d.getDay();
    const entries = [];
    availability.filter(function (a) { return Number(a.weekday) === wd && a.status === 'نشط'; }).forEach(function (a) {
      const key = dateISO + '|' + (a.start_time || '');
      const s = sessByKey[key] || null;
      if (s) delete sessByKey[key];
      entries.push({ start: a.start_time, end: a.end_time, rate: a.rate, availability_id: a.id, session: s });
    });
    sessions.filter(function (s) { return s.date === dateISO; }).forEach(function (s) {
      if (entries.some(function (e) { return e.session && e.session.id === s.id; })) return;
      entries.push({ start: s.start_time, end: s.end_time, rate: s.rate, availability_id: null, session: s });
    });
    entries.sort(function (x, y) { return String(x.start).localeCompare(String(y.start)); });
    days.push({ date: dateISO, weekday: wd, label: DAY_FULL[wd], isToday: dateISO === today(), isPast: dateISO < today(), entries });
  }

  const kpi = {
    slots: availability.filter(function (a) { return a.status === 'نشط'; }).length,
    packages: packages.filter(function (p) { return p.status === 'نشط'; }).length,
    scheduled: allSessions.filter(function (s) { return s.status === 'scheduled'; }).length,
    used: packages.reduce(function (a, p) { return a + Number(p.sessions_used || 0); }, 0)
  };

  res.render('private/coach', {
    title: 'التدريب الخاص — ' + coach.full_name, active: 'privateTraining',
    coach, availability, days, weekStartISO, weekEndISO, prevWeek, nextWeek, packages, swimmers, allSessions, kpi,
    dayFull: DAY_FULL, PRIV_STATUS, ATTENDED,
    canAdd: canAdd(req.currentUser, 'privateTraining'), canEdit: canEdit(req.currentUser, 'privateTraining'), canDel: canDel(req.currentUser, 'privateTraining'),
    money, fmtDate, statusBadge, today: today()
  });
});

/* ================================================================
   المواعيد الأسبوعية
================================================================ */
router.post('/private-training/coach/:id/availability', async function (req, res) {
  if (!canAdd(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coachId = Number(req.params.id);
  const weekday = Number(req.body.weekday);
  const start = String(req.body.start_time || '').trim();
  const end = String(req.body.end_time || '').trim();
  if (!(weekday >= 0 && weekday <= 6) || !start || !end) { setFlash(res, { type: 'error', message: 'بيانات الموعد غير مكتملة' }); return res.redirect('/private-training/coach/' + coachId); }
  const dupe = await db.prepare('SELECT id FROM private_availability WHERE coach_id = ? AND weekday = ? AND start_time = ?').get(coachId, weekday, start);
  if (dupe) { setFlash(res, { type: 'error', message: 'هذا الموعد مضاف مسبقاً' }); return res.redirect('/private-training/coach/' + coachId); }
  await db.prepare('INSERT INTO private_availability (coach_id, weekday, start_time, end_time, rate, status, note, sport_id, academy_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(coachId, weekday, start, end, Number(req.body.rate || 0), 'نشط', String(req.body.note || ''), effectiveSport(req) || null, Number(req.currentUser.academy_id) || 1, req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'privateTraining', coachId, 'إضافة موعد تدريب خاص: ' + DAY_FULL[weekday] + ' ' + start, req);
  setFlash(res, { type: 'success', message: 'تمت إضافة الموعد الأسبوعي' });
  res.redirect('/private-training/coach/' + coachId);
});

router.post('/private-training/availability/:aid/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const aid = Number(req.params.aid);
  const a = await db.prepare('SELECT * FROM private_availability WHERE id = ?').get(aid);
  if (a) await db.prepare('DELETE FROM private_availability WHERE id = ?').run(aid);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'privateTraining', aid, 'حذف موعد تدريب خاص', req);
  setFlash(res, { type: 'success', message: 'تم حذف الموعد' });
  res.redirect('/private-training/coach/' + (a ? a.coach_id : ''));
});

/* ================================================================
   الباقات
================================================================ */
router.post('/private-training/coach/:id/package', async function (req, res) {
  if (!canAdd(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coachId = Number(req.params.id);
  const b = req.body;
  const swimmerId = Number(b.swimmer_id) || 0;
  const total = Math.max(0, Number(b.sessions_total) || 0);
  const perSession = Math.max(0, Number(b.price_per_session) || 0);
  if (!swimmerId || total <= 0) { setFlash(res, { type: 'error', message: 'اختر اللاعب وعدد الحصص' }); return res.redirect('/private-training/coach/' + coachId); }
  const price = Math.round(total * perSession * 100) / 100;
  const paid = Math.max(0, Number(b.paid_amount) || 0);
  const remaining = Math.round((price - paid) * 100) / 100;
  await db.prepare(`INSERT INTO private_packages (academy_id, sport_id, swimmer_id, coach_id, sessions_total, sessions_used, price_per_session, price, paid_amount, remaining, start_date, status, notes, created_by)
    VALUES (?,?,?,?,?,0,?,?,?,?,?,'نشط',?,?)`)
    .run(Number(req.currentUser.academy_id) || 1, effectiveSport(req), swimmerId, coachId, total, perSession, price, paid, remaining, String(b.start_date || today()), String(b.notes || ''), req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'privateTraining', coachId, 'إنشاء باقة تدريب خاص (' + total + ' حصة)', req);
  setFlash(res, { type: 'success', message: 'تم إنشاء الباقة' });
  res.redirect('/private-training/coach/' + coachId);
});

router.post('/private-training/package/:pid/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const pid = Number(req.params.pid);
  const pkg = await db.prepare('SELECT * FROM private_packages WHERE id = ?').get(pid);
  if (!pkg) { setFlash(res, { type: 'error', message: 'الباقة غير موجودة' }); return res.redirect('/private-training'); }
  if (Number(pkg.sessions_used) > 0) { setFlash(res, { type: 'error', message: 'لا يمكن حذف باقة بها حصص مسجلة' }); return res.redirect('/private-training/coach/' + pkg.coach_id); }
  await db.prepare('DELETE FROM private_sessions WHERE package_id = ?').run(pid);
  await db.prepare('DELETE FROM private_packages WHERE id = ?').run(pid);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'privateTraining', pid, 'حذف باقة تدريب خاص', req);
  setFlash(res, { type: 'success', message: 'تم حذف الباقة' });
  res.redirect('/private-training/coach/' + pkg.coach_id);
});

/* ================================================================
   حجز حصة
================================================================ */
router.post('/private-training/coach/:id/book', async function (req, res) {
  if (!canAdd(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coachId = Number(req.params.id);
  const b = req.body;
  const packageId = Number(b.package_id) || 0;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : '';
  const start = String(b.start_time || '');
  const end = String(b.end_time || '');
  if (!packageId || !date || !start) { setFlash(res, { type: 'error', message: 'بيانات الحجز غير مكتملة' }); return res.redirect('/private-training/coach/' + coachId); }
  const pkg = await db.prepare('SELECT * FROM private_packages WHERE id = ?').get(packageId);
  if (!pkg || Number(pkg.coach_id) !== coachId) { setFlash(res, { type: 'error', message: 'الباقة غير صحيحة' }); return res.redirect('/private-training/coach/' + coachId); }
  if (pkg.status !== 'نشط' || Number(pkg.sessions_used) >= Number(pkg.sessions_total)) { setFlash(res, { type: 'error', message: 'الباقة منتهية أو لا توجد حصص متبقية' }); return res.redirect('/private-training/coach/' + coachId); }
  const clash = await db.prepare("SELECT id FROM private_sessions WHERE coach_id=? AND date=? AND start_time=? AND status != 'cancelled'").get(coachId, date, start);
  if (clash) { setFlash(res, { type: 'error', message: 'الموعد محجوز بالفعل' }); return res.redirect('/private-training/coach/' + coachId); }
  let rate = Number(b.rate) || 0;
  if (!rate) {
    const tr = await db.prepare('SELECT private_rate FROM trainer_rates WHERE coach_id = ?').get(coachId);
    rate = Number((tr && tr.private_rate) || 0);
  }
  await db.prepare(`INSERT INTO private_sessions (academy_id, sport_id, package_id, swimmer_id, coach_id, availability_id, date, start_time, end_time, status, rate, note, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,'scheduled',?,?,?)`)
    .run(Number(req.currentUser.academy_id) || 1, effectiveSport(req), packageId, pkg.swimmer_id, coachId,
      (b.availability_id ? Number(b.availability_id) : null), date, start, end, rate, String(b.note || ''), req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'privateTraining', coachId, 'حجز حصة تدريب خاص ' + date + ' ' + start, req);
  setFlash(res, { type: 'success', message: 'تم حجز الحصة' });
  res.redirect('/private-training/coach/' + coachId);
});

/* ================================================================
   تسجيل حضور/غياب الحصة
================================================================ */
router.post('/private-training/session/:sid/attendance', async function (req, res) {
  if (!canEdit(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const sid = Number(req.params.sid);
  const status = String(req.body.status || '');
  const coachRedirect = '/private-training/coach/' + (req.body.coach_id || '');
  if (!PRIV_STATUS[status]) { setFlash(res, { type: 'error', message: 'حالة غير صحيحة' }); return res.redirect(coachRedirect); }
  const before = await db.prepare('SELECT * FROM private_sessions WHERE id = ?').get(sid);
  if (!before) { setFlash(res, { type: 'error', message: 'الحصة غير موجودة' }); return res.redirect(coachRedirect); }
  await db.prepare('UPDATE private_sessions SET status=?, attendance_note=?, updated_at=? WHERE id=?')
    .run(status, String(req.body.attendance_note || ''), new Date().toLocaleString('sv-SE').replace('T', ' '), sid);
  const delta = attCounts(status) - attCounts(before.status);
  if (delta !== 0 && before.package_id) {
    await db.prepare('UPDATE private_packages SET sessions_used = MIN(sessions_total, MAX(0, sessions_used + ?)) WHERE id = ?').run(delta, before.package_id);
    await refreshPackage(before.package_id);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'privateTraining', sid, 'تسجيل حضور حصة تدريب خاص: ' + status, req);
  setFlash(res, { type: 'success', message: 'تم تسجيل الحضور' });
  res.redirect(coachRedirect);
});

router.post('/private-training/session/:sid/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const sid = Number(req.params.sid);
  const s = await db.prepare('SELECT * FROM private_sessions WHERE id = ?').get(sid);
  if (s) {
    await db.prepare('DELETE FROM private_sessions WHERE id = ?').run(sid);
    if (attCounts(s.status) && s.package_id) {
      await db.prepare('UPDATE private_packages SET sessions_used = MIN(sessions_total, MAX(0, sessions_used - 1)) WHERE id = ?').run(s.package_id);
      await refreshPackage(s.package_id);
    }
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'privateTraining', sid, 'حذف حصة تدريب خاص', req);
  setFlash(res, { type: 'success', message: 'تم حذف الحصة' });
  res.redirect('/private-training/coach/' + (s ? s.coach_id : ''));
});

module.exports = router;
