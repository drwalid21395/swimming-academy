/** حجز إيجار الميه: اشتراك بعدد حصص وسعر وبيانات كابتن، مع حضور وغياب خاص بالاشتراك.
 *  ينتهي الاشتراك تلقائياً عند استهلاك عدد الحصص المسجلة في الحضور/الغياب. */
const express = require('express');
const { db } = require('../lib/db');
const { audit, money, fmtDate, today, canView, canAdd, canEdit, canDel } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const { activeSport, effectiveSport, sportClause } = require('../lib/sport-context');

const router = express.Router();

const ATT_STATUS = {
  present: { label: 'حاضر', cls: 'badge-success', icon: 'fa-check' },
  absent: { label: 'غائب', cls: 'badge-danger', icon: 'fa-xmark' }
};

function statusBadge(st) {
  const map = {
    'نشط': ['badge-success', 'fa-circle-play'],
    'منتهي': ['badge-gray', 'fa-circle-check'],
    'ملغي': ['badge-danger', 'fa-ban']
  };
  const m = map[st] || ['badge-gray', 'fa-circle'];
  return `<span class="badge ${m[0]}"><i class="fas ${m[1]}"></i> ${st}</span>`;
}

function attBadge(st) {
  const m = ATT_STATUS[st] || { label: st, cls: 'badge-gray', icon: 'fa-circle' };
  return `<span class="badge ${m.cls}"><i class="fas ${m.icon}"></i> ${m.label}</span>`;
}

/* إعادة حساب عدد الحصص المستهلكة وحالة الاشتراك بعد أي تغيير في الحضور/الغياب */
async function refreshRental(rentalId) {
  const r = await db.prepare('SELECT * FROM water_rentals WHERE id = ?').get(rentalId);
  if (!r) return null;
  const cnt = await db.prepare('SELECT COUNT(*) AS c FROM water_rental_attendance WHERE rental_id = ?').get(rentalId);
  const total = Math.max(0, Number(r.sessions_total || 0));
  const used = Math.max(0, Number((cnt && cnt.c) || 0));
  let status = r.status;
  if (status !== 'ملغي') status = (total > 0 && used >= total) ? 'منتهي' : 'نشط';
  const remaining = Math.round((Number(r.price || 0) - Number(r.paid_amount || 0)) * 100) / 100;
  await db.prepare('UPDATE water_rentals SET sessions_used=?, status=?, remaining=? WHERE id=?')
    .run(used, status, remaining, rentalId);
  return { rental: r, used, status };
}

async function loadFormOptions(req) {
  const sid = activeSport(req);
  const coaches = await db.prepare('SELECT id, full_name, phone FROM coaches WHERE deleted_at IS NULL' + sportClause(sid, 'coaches') + ' ORDER BY full_name').all();
  const branches = await db.prepare('SELECT id, name FROM branches ORDER BY name').all();
  const pools = await db.prepare('SELECT id, name FROM pools ORDER BY name').all();
  return { coaches, branches, pools };
}

/* ================================================================
   القائمة
=============================================================== */
router.get('/water-rentals', async function (req, res) {
  if (!canView(req.currentUser, 'waterRentals')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const sid = activeSport(req);
  const status = String(req.query.status || '').trim();
  const q = String(req.query.q || '').trim();

  let where = 'WHERE 1=1' + sportClause(sid, 'r');
  const args = [];
  if (status) { where += ' AND r.status = ?'; args.push(status); }
  if (q) {
    where += ' AND (r.customer_name LIKE ? OR r.phone LIKE ? OR r.coach_name LIKE ?)';
    const like = '%' + q + '%';
    args.push(like, like, like);
  }

  const rows = await db.prepare(`SELECT r.*, c.full_name AS coach_full_name,
      b.name AS branch_name, p.name AS pool_name,
      (SELECT COUNT(*) FROM water_rental_attendance a WHERE a.rental_id = r.id) AS att_count
    FROM water_rentals r
    LEFT JOIN coaches c ON c.id = r.coach_id
    LEFT JOIN branches b ON b.id = r.branch_id
    LEFT JOIN pools p ON p.id = r.pool_id
    ${where}
    ORDER BY CASE r.status WHEN 'نشط' THEN 0 WHEN 'منتهي' THEN 1 ELSE 2 END, r.id DESC`).all(...args);

  const all = await db.prepare('SELECT r.* FROM water_rentals r WHERE 1=1' + sportClause(sid, 'r')).all();
  const kpi = {
    total: all.length,
    active: all.filter(function (r) { return r.status === 'نشط'; }).length,
    sessions: all.reduce(function (a, r) { return a + Number(r.sessions_total || 0); }, 0),
    used: all.reduce(function (a, r) { return a + Number(r.sessions_used || 0); }, 0),
    revenue: all.reduce(function (a, r) { return a + Number(r.price || 0); }, 0),
    remaining: all.reduce(function (a, r) { return a + Number(r.remaining || 0); }, 0)
  };

  res.render('water_rentals/index', {
    title: 'حجز إيجار الميه', active: 'waterRentals',
    rows, kpi, status, q,
    canAdd: canAdd(req.currentUser, 'waterRentals'),
    canEdit: canEdit(req.currentUser, 'waterRentals'),
    canDel: canDel(req.currentUser, 'waterRentals'),
    money, fmtDate, statusBadge
  });
});

/* ================================================================
   إنشاء
=============================================================== */
router.get('/water-rentals/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'waterRentals')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const opts = await loadFormOptions(req);
  res.render('water_rentals/form', {
    title: 'حجز إيجار ميه جديد', active: 'waterRentals',
    rental: {}, isEdit: false, action: '/water-rentals',
    coaches: opts.coaches, branches: opts.branches, pools: opts.pools,
    today: today()
  });
});

router.post('/water-rentals', async function (req, res) {
  if (!canAdd(req.currentUser, 'waterRentals')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const name = String(b.customer_name || '').trim();
  const total = Math.max(0, Number(b.sessions_total) || 0);
  if (!name) { setFlash(res, { type: 'error', message: 'اسم العميل مطلوب' }); return res.redirect('/water-rentals/new'); }
  if (total <= 0) { setFlash(res, { type: 'error', message: 'عدد الحصص يجب أن يكون أكبر من صفر' }); return res.redirect('/water-rentals/new'); }

  const coachId = Number(b.coach_id) || null;
  let coachName = String(b.coach_name || '').trim();
  let coachPhone = String(b.coach_phone || '').trim();
  if (coachId && !coachName) {
    const c = await db.prepare('SELECT full_name, phone FROM coaches WHERE id = ?').get(coachId);
    if (c) { coachName = c.full_name || ''; coachPhone = coachPhone || c.phone || ''; }
  }
  const price = Math.max(0, Number(b.price) || 0);
  const paid = Math.max(0, Number(b.paid_amount) || 0);
  const remaining = Math.round((price - paid) * 100) / 100;

  const r = await db.prepare(`INSERT INTO water_rentals
    (academy_id, sport_id, customer_name, phone, branch_id, pool_id, coach_id, coach_name, coach_phone,
     sessions_total, sessions_used, price, paid_amount, remaining, start_date, end_date, start_time, end_time, status, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,'نشط',?,?)`)
    .run(Number(req.currentUser.academy_id) || 1, effectiveSport(req) || null,
      name, String(b.phone || '').trim(), Number(b.branch_id) || null, Number(b.pool_id) || null,
      coachId, coachName, coachPhone, total, price, paid, remaining,
      String(b.start_date || today()), String(b.end_date || ''), String(b.start_time || ''), String(b.end_time || ''),
      String(b.notes || ''), req.currentUser.id);

  const id = r.lastInsertRowid;
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'waterRentals', id, 'إنشاء حجز إيجار ميه (' + total + ' حصة)', req);
  setFlash(res, { type: 'success', message: 'تم إنشاء حجز إيجار الميه' });
  res.redirect('/water-rentals/' + id);
});

/* ================================================================
   التفاصيل + الحضور والغياب
=============================================================== */
router.get('/water-rentals/:id', async function (req, res) {
  if (!canView(req.currentUser, 'waterRentals')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.redirect('/water-rentals');
  const r = await db.prepare(`SELECT r.*, c.full_name AS coach_full_name,
      b.name AS branch_name, p.name AS pool_name
    FROM water_rentals r
    LEFT JOIN coaches c ON c.id = r.coach_id
    LEFT JOIN branches b ON b.id = r.branch_id
    LEFT JOIN pools p ON p.id = r.pool_id
    WHERE r.id = ?`).get(id);
  if (!r) { setFlash(res, { type: 'error', message: 'الحجز غير موجود' }); return res.redirect('/water-rentals'); }

  const attendance = await db.prepare('SELECT * FROM water_rental_attendance WHERE rental_id = ? ORDER BY date DESC, id DESC').all(id);
  const total = Number(r.sessions_total || 0);
  const used = attendance.length;
  const left = Math.max(0, total - used);
  const present = attendance.filter(function (a) { return a.status === 'present'; }).length;
  const absent = attendance.filter(function (a) { return a.status === 'absent'; }).length;

  res.render('water_rentals/detail', {
    title: 'حجز إيجار ميه — ' + r.customer_name, active: 'waterRentals',
    rental: r, attendance, total, used, left, present, absent,
    ATT_STATUS, attBadge, statusBadge,
    canAdd: canAdd(req.currentUser, 'waterRentals'),
    canEdit: canEdit(req.currentUser, 'waterRentals'),
    canDel: canDel(req.currentUser, 'waterRentals'),
    money, fmtDate, today: today()
  });
});

/* ================================================================
   تعديل
=============================================================== */
router.get('/water-rentals/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'waterRentals')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const rental = await db.prepare('SELECT * FROM water_rentals WHERE id = ?').get(id);
  if (!rental) { setFlash(res, { type: 'error', message: 'الحجز غير موجود' }); return res.redirect('/water-rentals'); }
  const opts = await loadFormOptions(req);
  res.render('water_rentals/form', {
    title: 'تعديل حجز إيجار ميه', active: 'waterRentals',
    rental, isEdit: true, action: '/water-rentals/' + id,
    coaches: opts.coaches, branches: opts.branches, pools: opts.pools,
    today: today()
  });
});

router.post('/water-rentals/:id', async function (req, res) {
  if (!canEdit(req.currentUser, 'waterRentals')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const before = await db.prepare('SELECT * FROM water_rentals WHERE id = ?').get(id);
  if (!before) { setFlash(res, { type: 'error', message: 'الحجز غير موجود' }); return res.redirect('/water-rentals'); }
  const b = req.body;
  const name = String(b.customer_name || '').trim();
  const total = Math.max(0, Number(b.sessions_total) || 0);
  if (!name) { setFlash(res, { type: 'error', message: 'اسم العميل مطلوب' }); return res.redirect('/water-rentals/' + id + '/edit'); }
  if (total <= 0) { setFlash(res, { type: 'error', message: 'عدد الحصص يجب أن يكون أكبر من صفر' }); return res.redirect('/water-rentals/' + id + '/edit'); }

  const coachId = Number(b.coach_id) || null;
  let coachName = String(b.coach_name || '').trim();
  let coachPhone = String(b.coach_phone || '').trim();
  if (coachId && !coachName) {
    const c = await db.prepare('SELECT full_name, phone FROM coaches WHERE id = ?').get(coachId);
    if (c) { coachName = c.full_name || ''; coachPhone = coachPhone || c.phone || ''; }
  }
  const price = Math.max(0, Number(b.price) || 0);
  const paid = Math.max(0, Number(b.paid_amount) || 0);
  const remaining = Math.round((price - paid) * 100) / 100;

  await db.prepare(`UPDATE water_rentals SET customer_name=?, phone=?, branch_id=?, pool_id=?, coach_id=?, coach_name=?, coach_phone=?,
      sessions_total=?, price=?, paid_amount=?, remaining=?, start_date=?, end_date=?, start_time=?, end_time=?, notes=? WHERE id=?`)
    .run(name, String(b.phone || '').trim(), Number(b.branch_id) || null, Number(b.pool_id) || null,
      coachId, coachName, coachPhone, total, price, paid, remaining,
      String(b.start_date || ''), String(b.end_date || ''), String(b.start_time || ''), String(b.end_time || ''),
      String(b.notes || ''), id);

  await refreshRental(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'waterRentals', id, 'تعديل حجز إيجار ميه', req);
  setFlash(res, { type: 'success', message: 'تم تحديث الحجز' });
  res.redirect('/water-rentals/' + id);
});

/* ================================================================
   حذف
=============================================================== */
router.post('/water-rentals/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'waterRentals')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const r = await db.prepare('SELECT * FROM water_rentals WHERE id = ?').get(id);
  if (r) {
    await db.prepare('DELETE FROM water_rental_attendance WHERE rental_id = ?').run(id);
    await db.prepare('DELETE FROM water_rentals WHERE id = ?').run(id);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'waterRentals', id, 'حذف حجز إيجار ميه', req);
  setFlash(res, { type: 'success', message: 'تم حذف الحجز وسجل الحضور' });
  res.redirect('/water-rentals');
});

/* ================================================================
   تسجيل الحضور والغياب
=============================================================== */
router.post('/water-rentals/:id/attendance', async function (req, res) {
  if (!canEdit(req.currentUser, 'waterRentals')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const r = await db.prepare('SELECT * FROM water_rentals WHERE id = ?').get(id);
  if (!r) { setFlash(res, { type: 'error', message: 'الحجز غير موجود' }); return res.redirect('/water-rentals'); }
  if (r.status === 'ملغي') { setFlash(res, { type: 'error', message: 'الحجز ملغي، لا يمكن تسجيل حضور' }); return res.redirect('/water-rentals/' + id); }

  const cnt = await db.prepare('SELECT COUNT(*) AS c FROM water_rental_attendance WHERE rental_id = ?').get(id);
  if (Number(cnt.c) >= Number(r.sessions_total || 0)) {
    setFlash(res, { type: 'error', message: 'تم استهلاك كل حصص الاشتراك — أضف حصصاً جديدة للاستمرار' });
    return res.redirect('/water-rentals/' + id);
  }

  const status = String(req.body.status || 'present');
  if (!ATT_STATUS[status]) { setFlash(res, { type: 'error', message: 'حالة غير صحيحة' }); return res.redirect('/water-rentals/' + id); }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.date || '')) ? req.body.date : today();

  await db.prepare('INSERT INTO water_rental_attendance (academy_id, sport_id, rental_id, date, status, note, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(Number(req.currentUser.academy_id) || 1, effectiveSport(req) || null, id, date, status, String(req.body.note || ''), req.currentUser.id);

  const refreshed = await refreshRental(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'waterRentals', id,
    'تسجيل ' + (status === 'present' ? 'حضور' : 'غياب') + ' — ' + date, req);
  setFlash(res, {
    type: 'success',
    message: refreshed && refreshed.status === 'منتهي' ? 'تم تسجيل الحضور — انتهى الاشتراك باكتمال الحصص' : 'تم تسجيل الحضور'
  });
  res.redirect('/water-rentals/' + id);
});

router.post('/water-rentals/:id/attendance/:aid/toggle', async function (req, res) {
  if (!canEdit(req.currentUser, 'waterRentals')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const aid = Number(req.params.aid);
  const a = await db.prepare('SELECT * FROM water_rental_attendance WHERE id = ? AND rental_id = ?').get(aid, id);
  if (!a) { setFlash(res, { type: 'error', message: 'سجل الحضور غير موجود' }); return res.redirect('/water-rentals/' + id); }
  const next = a.status === 'present' ? 'absent' : 'present';
  await db.prepare('UPDATE water_rental_attendance SET status=? WHERE id=?').run(next, aid);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'waterRentals', id,
    'تغيير حالة الحضور إلى ' + (next === 'present' ? 'حاضر' : 'غائب'), req);
  setFlash(res, { type: 'success', message: 'تم تحديث حالة الحضور' });
  res.redirect('/water-rentals/' + id);
});

router.post('/water-rentals/:id/attendance/:aid/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'waterRentals')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const aid = Number(req.params.aid);
  await db.prepare('DELETE FROM water_rental_attendance WHERE id = ? AND rental_id = ?').run(aid, id);
  await refreshRental(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'waterRentals', id, 'حذف سجل حضور/غياب', req);
  setFlash(res, { type: 'success', message: 'تم حذف السجل وإعادة حصة للاشتراك' });
  res.redirect('/water-rentals/' + id);
});

/* ================================================================
   تمديد الحصص / تغيير الحالة
=============================================================== */
router.post('/water-rentals/:id/extend', async function (req, res) {
  if (!canEdit(req.currentUser, 'waterRentals')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const r = await db.prepare('SELECT * FROM water_rentals WHERE id = ?').get(id);
  if (!r) { setFlash(res, { type: 'error', message: 'الحجز غير موجود' }); return res.redirect('/water-rentals'); }
  const extra = Math.max(0, Number(req.body.sessions_extra) || 0);
  if (extra <= 0) { setFlash(res, { type: 'error', message: 'أدخل عدد حصص صحيح للإضافة' }); return res.redirect('/water-rentals/' + id); }
  await db.prepare('UPDATE water_rentals SET sessions_total = sessions_total + ? WHERE id = ?').run(extra, id);
  await refreshRental(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'waterRentals', id, 'إضافة ' + extra + ' حصة للاشتراك', req);
  setFlash(res, { type: 'success', message: 'تمت إضافة الحصص وتفعيل الاشتراك إن كان منتهياً' });
  res.redirect('/water-rentals/' + id);
});

router.post('/water-rentals/:id/status', async function (req, res) {
  if (!canEdit(req.currentUser, 'waterRentals')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const r = await db.prepare('SELECT * FROM water_rentals WHERE id = ?').get(id);
  if (!r) { setFlash(res, { type: 'error', message: 'الحجز غير موجود' }); return res.redirect('/water-rentals'); }
  const action = String(req.body.action || '');
  if (action === 'cancel') {
    await db.prepare("UPDATE water_rentals SET status='ملغي' WHERE id=?").run(id);
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'waterRentals', id, 'إلغاء حجز إيجار ميه', req);
    setFlash(res, { type: 'success', message: 'تم إلغاء الحجز' });
  } else if (action === 'restore') {
    await refreshRental(id);
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'waterRentals', id, 'إعادة تفعيل حجز إيجار ميه', req);
    setFlash(res, { type: 'success', message: 'تمت إعادة تفعيل الحجز' });
  } else {
    setFlash(res, { type: 'error', message: 'إجراء غير صحيح' });
  }
  res.redirect('/water-rentals/' + id);
});

module.exports = router;
