/** التدريب الخاص: مواعيد أسبوعية ثابتة لكل مدرب (باسم اللاعب وتقييمه)
    + حجز الحصص + تسجيل الحضور + فترات عدم توفر لا يمكن تسكينها */
const express = require('express');
const { db } = require('../lib/db');
const { audit, money, fmtDate, today, canView, canAdd, canEdit, canDel } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const { activeSport, effectiveSport, sportClause, swimmerSportClause } = require('../lib/sport-context');
const { normalizeTime, toMinutes, overlaps, validateRange } = require('../lib/attendance-time');

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
function ratingValue(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n))) : 0;
}
function ratingStars(r) {
  const n = ratingValue(r);
  let stars = '';
  for (let i = 1; i <= 5; i++) stars += '<i class="fas fa-star' + (i <= n ? '' : '-regular') + '"></i>';
  return '<span class="pt-stars" title="' + n + ' من 5">' + stars + '</span>';
}
function weekdayOf(dateISO) { return new Date(dateISO + 'T12:00:00').getDay(); }

async function unavailableFor(coachId) {
  return db.prepare('SELECT * FROM private_unavailable WHERE coach_id = ? ORDER BY weekday, start_time').all(coachId);
}
function blockingWindow(blocks, weekday, start, end) {
  if (!start) return null;
  return blocks.find(function (b) {
    return Number(b.weekday) === Number(weekday) && overlaps(start, end, b.start_time, b.end_time);
  }) || null;
}
async function findActivePackage(swimmerId, coachId, preferredId) {
  if (preferredId) {
    const p = await db.prepare('SELECT * FROM private_packages WHERE id = ? AND swimmer_id = ? AND coach_id = ?').get(preferredId, swimmerId, coachId);
    if (p && p.status === 'نشط' && Number(p.sessions_used) < Number(p.sessions_total)) return p;
  }
  return db.prepare("SELECT * FROM private_packages WHERE swimmer_id = ? AND coach_id = ? AND status = 'نشط' AND sessions_used < sessions_total ORDER BY id LIMIT 1")
    .get(swimmerId, coachId);
}
/* منع التسكين نهائياً داخل فترات عدم التوفر أو في حصة متداخلة */
async function bookingIssue(coachId, date, start, end, ignoreSessionId) {
  const windows = await unavailableFor(coachId);
  const blocked = blockingWindow(windows, weekdayOf(date), start, end);
  if (blocked) {
    return 'هذا الوقت ضمن فترة عدم التوفر للمدرب (' + DAY_FULL[Number(blocked.weekday)] + ' ' +
      blocked.start_time + ' - ' + blocked.end_time + ') ولا يمكن تسكينه';
  }
  const rows = await db.prepare("SELECT id, start_time, end_time FROM private_sessions WHERE coach_id = ? AND date = ? AND status != 'cancelled' AND id <> ?")
    .all(coachId, date, ignoreSessionId || 0);
  const clash = rows.find(function (r) { return overlaps(start, end, r.start_time, r.end_time); });
  if (clash) return 'يوجد حجز آخر متداخل في هذا الموعد';
  return null;
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

function flashBack(res, type, message, coachId) {
  setFlash(res, { type: type, message: message });
  res.redirect('/private-training/coach/' + coachId);
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
    .forEach(a => { put(a.coach_id, 'slots', a.c); });
  (await db.prepare("SELECT coach_id, COUNT(*) AS c FROM private_availability WHERE status='نشط' AND swimmer_id IS NOT NULL GROUP BY coach_id").all())
    .forEach(a => { put(a.coach_id, 'booked', a.c); });
  (await db.prepare("SELECT coach_id, COUNT(*) AS c FROM private_availability WHERE status='نشط' AND swimmer_id IS NULL GROUP BY coach_id").all())
    .forEach(a => { put(a.coach_id, 'free', a.c); });
  (await db.prepare('SELECT coach_id, COUNT(*) AS c FROM private_unavailable GROUP BY coach_id').all())
    .forEach(a => { put(a.coach_id, 'blocked', a.c); });
  (await db.prepare("SELECT coach_id, COUNT(*) AS c FROM private_packages WHERE status='نشط' GROUP BY coach_id").all())
    .forEach(a => { put(a.coach_id, 'packages', a.c); });
  const upc = await db.prepare("SELECT coach_id, COUNT(*) AS c FROM private_sessions WHERE status='scheduled' AND date >= ? GROUP BY coach_id").all(today());
  upc.forEach(a => { put(a.coach_id, 'upcoming', a.c); });

  res.render('private/coaches', {
    title: 'التدريب الخاص', active: 'privateTraining',
    coaches, stats, dayFull: DAY_FULL,
    canEdit: canEdit(req.currentUser, 'privateTraining'), money
  });
});

/* ================================================================
   تقييم التدريب الخاص — يظهر كفئة داخل التقييمات (الجوانب الفنية)
================================================================ */
router.get('/private-training/ratings', async function (req, res) {
  const canSee = canView(req.currentUser, 'assessments') || canView(req.currentUser, 'privateTraining');
  if (!canSee) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const fixed = await db.prepare(`SELECT pa.*, c.full_name AS coach_name, sw.full_name AS swimmer_name, sw.membership_no
    FROM private_availability pa
    JOIN swimmers sw ON sw.id = pa.swimmer_id
    LEFT JOIN coaches c ON c.id = pa.coach_id
    WHERE pa.swimmer_id IS NOT NULL
    ORDER BY pa.weekday, pa.start_time`).all();
  const sessions = await db.prepare(`SELECT ps.*, c.full_name AS coach_name, sw.full_name AS swimmer_name, sw.membership_no
    FROM private_sessions ps
    JOIN swimmers sw ON sw.id = ps.swimmer_id
    LEFT JOIN coaches c ON c.id = ps.coach_id
    WHERE ps.swimmer_id IS NOT NULL
    ORDER BY ps.date DESC, ps.start_time DESC LIMIT 200`).all();
  const rated = fixed.filter(function (a) { return Number(a.rating) > 0; });
  const avg = rated.length ? Math.round(rated.reduce(function (a, x) { return a + Number(x.rating); }, 0) / rated.length * 10) / 10 : 0;
  res.render('private/ratings', {
    title: 'تقييم التدريب الخاص', active: 'assessments',
    fixed, sessions, dayFull: DAY_FULL,
    kpi: { fixed: fixed.length, rated: rated.length, avg: avg, sessions: sessions.length },
    canRate: canEdit(req.currentUser, 'assessments') || canEdit(req.currentUser, 'privateTraining'),
    ratingStars: ratingStars, ratingValue: ratingValue,
    backUrl: '/assessments'
  });
});

router.post('/private-training/rating', async function (req, res) {
  if (!canEdit(req.currentUser, 'assessments') && !canEdit(req.currentUser, 'privateTraining')) {
    return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  }
  const kind = String(req.body.kind || '') === 'session' ? 'session' : 'availability';
  const id = Number(req.body.id) || 0;
  const rating = ratingValue(req.body.rating);
  if (!id) { setFlash(res, { type: 'error', message: 'التقييم غير صالح' }); return res.redirect('/private-training/ratings'); }
  const table = kind === 'session' ? 'private_sessions' : 'private_availability';
  await db.prepare('UPDATE ' + table + ' SET rating = ? WHERE id = ?').run(rating, id);
  if (kind === 'availability') await db.prepare('UPDATE private_sessions SET rating = ? WHERE availability_id = ?').run(rating, id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', kind === 'session' ? 'privateTraining' : 'assessments', id,
    'تقييم التدريب الخاص: ' + rating + '/5', req);
  setFlash(res, { type: 'success', message: 'تم حفظ التقييم' });
  const back = String(req.body.back || '/private-training/ratings');
  res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/private-training/ratings');
});

/* ================================================================
   صفحة المدرب: لوحة البيانات + المواعيد الثابتة + شبكة الأسبوع
================================================================ */
router.get('/private-training/coach/:id', async function (req, res) {
  if (!canView(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coachId = Number(req.params.id);
  const coach = await db.prepare('SELECT * FROM coaches WHERE id = ?').get(coachId);
  if (!coach) { setFlash(res, { type: 'error', message: 'المدرب غير موجود' }); return res.redirect('/private-training'); }

  const weekParam = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.week || '')) ? String(req.query.week) : today();
  const wStart = new Date(weekParam + 'T12:00:00');
  wStart.setDate(wStart.getDate() - wStart.getDay());
  const iso = function (d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), x = String(d.getDate()).padStart(2, '0'); return y + '-' + m + '-' + x; };
  const wEnd = new Date(wStart.getTime()); wEnd.setDate(wEnd.getDate() + 6);
  const weekStartISO = iso(wStart), weekEndISO = iso(wEnd);
  const prevWeek = iso(new Date(wStart.getTime() - 7 * 864e5));
  const nextWeek = iso(new Date(wStart.getTime() + 7 * 864e5));

  const availability = await db.prepare(`SELECT pa.*, sw.full_name AS swimmer_name FROM private_availability pa
    LEFT JOIN swimmers sw ON sw.id = pa.swimmer_id
    WHERE pa.coach_id = ? ORDER BY pa.weekday, pa.start_time`).all(coachId);
  const unavailable = await unavailableFor(coachId);
  const sessions = await db.prepare(`SELECT ps.*, sw.full_name AS swimmer_name, sw.membership_no FROM private_sessions ps
    LEFT JOIN swimmers sw ON sw.id = ps.swimmer_id
    WHERE ps.coach_id = ? AND ps.date BETWEEN ? AND ? ORDER BY ps.date, ps.start_time`).all(coachId, weekStartISO, weekEndISO);
  const allSessions = await db.prepare(`SELECT ps.*, sw.full_name AS swimmer_name FROM private_sessions ps
    LEFT JOIN swimmers sw ON sw.id = ps.swimmer_id
    WHERE ps.coach_id = ? ORDER BY ps.date DESC, ps.start_time DESC LIMIT 200`).all(coachId);

  const packages = await db.prepare(`SELECT pp.*, sw.full_name AS swimmer_name,
      MAX(0, pp.sessions_total - pp.sessions_used) AS sessions_left
    FROM private_packages pp LEFT JOIN swimmers sw ON sw.id = pp.swimmer_id
    WHERE pp.coach_id = ?
    ORDER BY CASE pp.status WHEN 'نشط' THEN 0 ELSE 1 END, pp.created_at DESC`).all(coachId);
  const swimmers = await db.prepare('SELECT id, full_name, membership_no FROM swimmers WHERE deleted_at IS NULL' + swimmerSportClause(activeSport(req), '') + " AND status != 'منسحب' ORDER BY full_name").all();

  // شبكة الأسبوع: فترات عدم التوفر + المواعيد الثابتة + حالة الحجز
  const sessByKey = {};
  sessions.forEach(function (s) { sessByKey[s.date + '|' + (s.start_time || '')] = s; });
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(wStart.getTime()); d.setDate(d.getDate() + i);
    const dateISO = iso(d);
    const wd = d.getDay();
    const entries = [];
    unavailable.filter(function (b) { return Number(b.weekday) === wd; }).forEach(function (b) {
      entries.push({ blocked: true, block: b, start: b.start_time, end: b.end_time, note: b.note });
    });
    availability.filter(function (a) { return Number(a.weekday) === wd && a.status === 'نشط'; }).forEach(function (a) {
      const key = dateISO + '|' + (a.start_time || '');
      const s = sessByKey[key] || null;
      if (s) delete sessByKey[key];
      const block = blockingWindow(unavailable, wd, a.start_time, a.end_time);
      entries.push({
        start: a.start_time, end: a.end_time, rate: a.rate,
        availability_id: a.id, availability: a, session: s,
        swimmer_id: a.swimmer_id, swimmer_name: a.swimmer_name, rating: a.rating,
        blocked: !!block, block: block
      });
    });
    sessions.filter(function (s) { return s.date === dateISO; }).forEach(function (s) {
      if (entries.some(function (e) { return e.session && e.session.id === s.id; })) return;
      entries.push({ start: s.start_time, end: s.end_time, rate: s.rate, availability_id: null, session: s, blocked: false });
    });
    entries.sort(function (x, y) { return String(x.start).localeCompare(String(y.start)); });
    days.push({ date: dateISO, weekday: wd, label: DAY_FULL[wd], isToday: dateISO === today(), isPast: dateISO < today(), entries: entries });
  }

  const activeSlots = availability.filter(function (a) { return a.status === 'نشط'; });
  const slotBlocked = function (a) { return !!blockingWindow(unavailable, a.weekday, a.start_time, a.end_time); };
  const blockedSlotIds = activeSlots.filter(slotBlocked).map(function (a) { return a.id; });
  const kpi = {
    slots: activeSlots.length,
    booked: activeSlots.filter(function (a) { return a.swimmer_id; }).length,
    free: activeSlots.filter(function (a) { return !a.swimmer_id && !slotBlocked(a); }).length,
    blocked: unavailable.length,
    packages: packages.filter(function (p) { return p.status === 'نشط'; }).length,
    scheduled: allSessions.filter(function (s) { return s.status === 'scheduled'; }).length,
    used: packages.reduce(function (a, p) { return a + Number(p.sessions_used || 0); }, 0)
  };

  res.render('private/coach', {
    title: 'التدريب الخاص — ' + coach.full_name, active: 'privateTraining',
    coach, availability, unavailable, blockedSlotIds, days, weekStartISO, weekEndISO, prevWeek, nextWeek, packages, swimmers, allSessions, kpi,
    dayFull: DAY_FULL, PRIV_STATUS, ATTENDED,
    canAdd: canAdd(req.currentUser, 'privateTraining'), canEdit: canEdit(req.currentUser, 'privateTraining'), canDel: canDel(req.currentUser, 'privateTraining'),
    money, fmtDate, statusBadge, ratingStars, ratingValue, today: today()
  });
});

/* ================================================================
   المواعيد الثابتة الأسبوعية (اسم اللاعب + التقييم اختياريان)
================================================================ */
router.post('/private-training/coach/:id/availability', async function (req, res) {
  if (!canAdd(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coachId = Number(req.params.id);
  const weekday = Number(req.body.weekday);
  const vr = validateRange(req.body.start_time, req.body.end_time);
  if (!(weekday >= 0 && weekday <= 6) || vr.error) return flashBack(res, 'error', 'حدد اليوم ووقت البداية ووقت النهاية بشكل صحيح', coachId);
  const windows = await unavailableFor(coachId);
  if (blockingWindow(windows, weekday, vr.from, vr.to)) return flashBack(res, 'error', 'هذا الوقت ضمن فترة عدم التوفر للمدرب', coachId);
  const dupe = await db.prepare('SELECT id FROM private_availability WHERE coach_id = ? AND weekday = ? AND start_time = ?').get(coachId, weekday, vr.from);
  if (dupe) return flashBack(res, 'error', 'هذا الموعد مضاف مسبقاً', coachId);
  const swimmerId = Number(req.body.swimmer_id) || null;
  if (swimmerId) {
    const sw = await db.prepare('SELECT id FROM swimmers WHERE id = ? AND deleted_at IS NULL').get(swimmerId);
    if (!sw) return flashBack(res, 'error', 'اللاعب المختار غير موجود', coachId);
  }
  await db.prepare(`INSERT INTO private_availability
    (coach_id, weekday, start_time, end_time, rate, status, note, swimmer_id, rating, sport_id, academy_id, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(coachId, weekday, vr.from, vr.to, Number(req.body.rate || 0), 'نشط', String(req.body.note || ''),
      swimmerId, ratingValue(req.body.rating), effectiveSport(req) || null, Number(req.currentUser.academy_id) || 1, req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'privateTraining', coachId,
    'إضافة موعد تدريب خاص: ' + DAY_FULL[weekday] + ' ' + vr.from + (swimmerId ? ' — لاعب مُسكَّن' : ''), req);
  setFlash(res, { type: 'success', message: swimmerId ? 'تمت إضافة الموعد وتسكين اللاعب' : 'تمت إضافة الموعد الأسبوعي' });
  res.redirect('/private-training/coach/' + coachId);
});

/* تسكين/إزالة اللاعب على موعد ثابت + تعديل التقييم */
router.post('/private-training/availability/:aid/assign', async function (req, res) {
  if (!canAdd(req.currentUser, 'privateTraining') && !canEdit(req.currentUser, 'privateTraining')) {
    return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  }
  const aid = Number(req.params.aid);
  const a = await db.prepare('SELECT * FROM private_availability WHERE id = ?').get(aid);
  if (!a) { setFlash(res, { type: 'error', message: 'الموعد غير موجود' }); return res.redirect('/private-training'); }
  const swimmerId = Number(req.body.swimmer_id) || 0;
  const rating = ratingValue(req.body.rating);
  if (swimmerId) {
    const sw = await db.prepare('SELECT id FROM swimmers WHERE id = ? AND deleted_at IS NULL').get(swimmerId);
    if (!sw) return flashBack(res, 'error', 'اللاعب المختار غير موجود', a.coach_id);
    const windows = await unavailableFor(a.coach_id);
    if (blockingWindow(windows, a.weekday, a.start_time, a.end_time)) {
      return flashBack(res, 'error', 'لا يمكن التسكين في فترة عدم التوفر', a.coach_id);
    }
  }
  await db.prepare('UPDATE private_availability SET swimmer_id = ?, rating = ? WHERE id = ?').run(swimmerId || null, rating, aid);
  await db.prepare('UPDATE private_sessions SET rating = ? WHERE availability_id = ?').run(rating, aid);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'privateTraining', aid,
    swimmerId ? 'تسكين لاعب في موعد تدريب خاص' : 'إزالة تسكين من موعد تدريب خاص', req);
  setFlash(res, { type: 'success', message: swimmerId ? 'تم تسكين اللاعب وحفظ التقييم' : 'تم إزالة التسكين' });
  res.redirect('/private-training/coach/' + a.coach_id);
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
   فترات عدم التوفر — ممنوع التسكين داخلها نهائياً
================================================================ */
router.post('/private-training/coach/:id/unavailable', async function (req, res) {
  if (!canAdd(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coachId = Number(req.params.id);
  const weekday = Number(req.body.weekday);
  const vr = validateRange(req.body.start_time, req.body.end_time);
  if (!(weekday >= 0 && weekday <= 6) || vr.error) return flashBack(res, 'error', 'حدد اليوم ووقت البداية ووقت النهاية بشكل صحيح', coachId);
  const windows = await unavailableFor(coachId);
  const dupe = windows.find(function (b) { return Number(b.weekday) === weekday && overlaps(vr.from, vr.to, b.start_time, b.end_time); });
  if (dupe) return flashBack(res, 'error', 'هذه الفترة مضافة مسبقاً', coachId);
  await db.prepare(`INSERT INTO private_unavailable
    (coach_id, weekday, start_time, end_time, note, sport_id, academy_id, created_by)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(coachId, weekday, vr.from, vr.to, String(req.body.note || ''), effectiveSport(req) || null,
      Number(req.currentUser.academy_id) || 1, req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'privateTraining', coachId,
    'فترة عدم توفر: ' + DAY_FULL[weekday] + ' ' + vr.from + ' - ' + vr.to, req);
  setFlash(res, { type: 'success', message: 'تمت إضافة فترة عدم التوفر — لا يمكن تسكين أي حصة داخلها' });
  res.redirect('/private-training/coach/' + coachId);
});

router.post('/private-training/unavailable/:uid/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const uid = Number(req.params.uid);
  const row = await db.prepare('SELECT * FROM private_unavailable WHERE id = ?').get(uid);
  if (row) await db.prepare('DELETE FROM private_unavailable WHERE id = ?').run(uid);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'privateTraining', uid, 'حذف فترة عدم توفر', req);
  setFlash(res, { type: 'success', message: 'تمت إزالة فترة عدم التوفر' });
  res.redirect('/private-training/coach/' + (row ? row.coach_id : ''));
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
  if (!swimmerId || total <= 0) return flashBack(res, 'error', 'اختر اللاعب وعدد الحصص', coachId);
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
  if (Number(pkg.sessions_used) > 0) return flashBack(res, 'error', 'لا يمكن حذف باقة بها حصص مسجلة', pkg.coach_id);
  await db.prepare('DELETE FROM private_sessions WHERE package_id = ?').run(pid);
  await db.prepare('DELETE FROM private_packages WHERE id = ?').run(pid);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'privateTraining', pid, 'حذف باقة تدريب خاص', req);
  setFlash(res, { type: 'success', message: 'تم حذف الباقة' });
  res.redirect('/private-training/coach/' + pkg.coach_id);
});

/* ================================================================
   حجز حصة داخل موعد ثابت (باسم اللاعب + التقييم)
================================================================ */
router.post('/private-training/coach/:id/book', async function (req, res) {
  if (!canAdd(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coachId = Number(req.params.id);
  const b = req.body;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : '';
  const swimmerId = Number(b.swimmer_id) || 0;
  const availabilityId = Number(b.availability_id) || 0;
  let availability = null;
  if (availabilityId) {
    availability = await db.prepare('SELECT * FROM private_availability WHERE id = ? AND coach_id = ?').get(availabilityId, coachId);
    if (!availability) return flashBack(res, 'error', 'الموعد الثابت غير صحيح', coachId);
  }
  let start = normalizeTime(b.start_time);
  let end = normalizeTime(b.end_time);
  if (availability) {
    if (!start) start = normalizeTime(availability.start_time);
    if (!end) end = normalizeTime(availability.end_time);
  }
  const vr = validateRange(start, end);
  if (!date || !swimmerId || vr.error) return flashBack(res, 'error', 'اختر اللاعب والتاريخ ووقت الموعد بشكل صحيح', coachId);
  if (availability && Number(availability.weekday) !== weekdayOf(date)) {
    return flashBack(res, 'error', 'يوم التاريخ المختار لا يطابق يوم الموعد الثابت', coachId);
  }
  const sw = await db.prepare('SELECT id FROM swimmers WHERE id = ? AND deleted_at IS NULL').get(swimmerId);
  if (!sw) return flashBack(res, 'error', 'اللاعب المختار غير موجود', coachId);
  const issue = await bookingIssue(coachId, date, vr.from, vr.to);
  if (issue) return flashBack(res, 'error', issue, coachId);

  const pkg = await findActivePackage(swimmerId, coachId, Number(b.package_id) || 0);
  let rate = Number(b.rate) || 0;
  if (!rate && availability) rate = Number(availability.rate) || 0;
  if (!rate) {
    const tr = await db.prepare('SELECT private_rate FROM trainer_rates WHERE coach_id = ?').get(coachId);
    rate = Number((tr && tr.private_rate) || 0);
  }
  const rating = ratingValue(b.rating != null && b.rating !== '' ? b.rating : (availability && availability.rating));
  await db.prepare(`INSERT INTO private_sessions
    (academy_id, sport_id, package_id, swimmer_id, coach_id, availability_id, date, start_time, end_time, status, rate, rating, note, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,'scheduled',?,?,?,?)`)
    .run(Number(req.currentUser.academy_id) || 1, effectiveSport(req), pkg ? pkg.id : null, swimmerId, coachId,
      availabilityId || null, date, vr.from, vr.to, rate, rating, String(b.note || ''), req.currentUser.id);
  if (availability) {
    await db.prepare('UPDATE private_availability SET swimmer_id = ?, rating = ? WHERE id = ?').run(swimmerId, rating, availabilityId);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'privateTraining', coachId, 'حجز حصة تدريب خاص ' + date + ' ' + vr.from, req);
  setFlash(res, { type: 'success', message: 'تم حجز الحصة وتسكين اللاعب في الموعد' });
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
