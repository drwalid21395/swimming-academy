/** وحدة النظام الأساسي (Super Admin): الأكاديميات، الخطط، الاشتراكات، المدفوعات، الإعدادات */
const express = require('express');
const { db, seedAcademyBaseline } = require('../lib/db');
const { audit, fmtDate, fmtDateTime, canView } = require('../lib/helpers');
const { setFlash, getCookie } = require('../lib/auth-cookie');
const { hashPassword, verifyPassword } = require('../lib/helpers');
const { uploadAndStore, removeUploaded } = require('../lib/upload');
  const { getAcademy, getActiveSubscription, subscriptionStatus, featureEnabled, planLimits, atPlanLimit, FEATURES, FEATURE_GROUPS, ACTIONS, ACTION_LABELS, EXTRA_FEATURES } =
require('../lib/tenant');
const router = express.Router();

/* لا يصل لهذه الوحدة إلا Super Admin (حساب النظام) */
function requireSuper(req, res) {
  if (!req.currentUser || !req.currentUser.is_super) {
    res.status(403).render('errors/403', { layout: false, user: req.currentUser });
    return true;
  }
  return false;
}

function today() { return new Date().toISOString().slice(0, 10); }
function addDays(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); }

/* ================================================================ */
/*  لوحة تحكم Super Admin                                           */
/* ================================================================ */
router.get('/platform', async function (req, res) {
  if (requireSuper(req, res)) return;
  const academies = await db.all('SELECT * FROM academies ORDER BY id');
  const plans = await db.all('SELECT * FROM plans ORDER BY id');
  const now = today();

  let activeCount = 0, suspendedCount = 0, expiringSoonCount = 0, expiredCount = 0;
  for (const a of academies) {
    const sub = await getActiveSubscription(a.id);
    const st = subscriptionStatus(sub);
    if (+a.premium === 1) { activeCount++; continue; }
    if (a.status !== 'active') suspendedCount++;
    else if (st.status === 'EXPIRED') expiredCount++;
    else if (st.status === 'EXPIRING_SOON') expiringSoonCount++;
    else if (st.status === 'ACTIVE') activeCount++;
    else expiredCount++;
  }
  const totalUsers = (await db.prepare('SELECT COUNT(*) c FROM users').get()).c;
  const totalStudents = (await db.prepare('SELECT COUNT(*) c FROM swimmers WHERE deleted_at IS NULL').get()).c;
  const pendingPayments = (await db.prepare("SELECT COUNT(*) c FROM payment_requests WHERE status='PENDING'").get()).c;
  const monthlyRevenue = (await db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments_history WHERE strftime('%Y-%m', approved_at) = strftime('%Y-%m', 'now')").get()).s;

  const rows = [];
  for (const a of academies) {
    const sub = await getActiveSubscription(a.id);
    const st = subscriptionStatus(sub);
    const studentCount = (await db.prepare('SELECT COUNT(*) c FROM swimmers WHERE academy_id = ? AND deleted_at IS NULL').get(a.id)).c;
    const userCount = (await db.prepare('SELECT COUNT(*) c FROM users WHERE academy_id = ?').get(a.id)).c;
    const planRow = a.plan_id ? await db.prepare('SELECT name FROM plans WHERE id = ?').get(a.plan_id) : null;
    rows.push({
      a, plan: planRow, sub, st,
      studentCount, userCount,
      badge: +a.premium === 1 ? 'success' : a.status !== 'active' ? 'danger' : st.status === 'EXPIRED' ? 'danger' : st.status === 'EXPIRING_SOON' ? 'warning' : 'success',
      statusLabel: +a.premium === 1 ? 'الأساسية (بدون قيود)' : a.status !== 'active' ? 'موقوف' : st.label
    });
  }

  res.render('platform/dashboard', {
    title: 'لوحة تحكم النظام الأساسي', active: 'platform',
    stats: { academies: academies.length, activeCount, suspendedCount, expiredCount, expiringSoonCount, pendingPayments, monthlyRevenue, totalUsers, totalStudents, now },
    rows, FEATURES
  });
});

/* ================================================================ */
/*  الأكاديميات: قائمة + إنشاء + تعديل + تفعيل/إيقاف                */
/* ================================================================ */
router.get('/platform/academies', async function (req, res) {
  if (requireSuper(req, res)) return;
  const academies = await db.all('SELECT a.*, p.name AS plan_name FROM academies a LEFT JOIN plans p ON p.id = a.plan_id ORDER BY a.id');
  for (const a of academies) {
    const sub = await getActiveSubscription(a.id);
    a.subInfo = subscriptionStatus(sub);
    a.studentCount = (await db.prepare('SELECT COUNT(*) c FROM swimmers WHERE academy_id = ? AND deleted_at IS NULL').get(a.id)).c;
    a.userCount = (await db.prepare('SELECT COUNT(*) c FROM users WHERE academy_id = ?').get(a.id)).c;
  }
  const plans = await db.all('SELECT * FROM plans ORDER BY id');
  res.render('platform/academies', { title: 'الأكاديميات', active: 'platform', academies, plans });
});

router.get('/platform/academies/new', async function (req, res) {
  if (requireSuper(req, res)) return;
  const plans = await db.all('SELECT * FROM plans ORDER BY id');
  res.render('platform/academy_form', { title: 'إضافة أكاديمية جديدة', active: 'platform', plans, values: {}, action: '/platform/academies/new', today: today(), sett: {} });
});

router.post('/platform/academies/new', uploadAndStore('logo'), async function (req, res) {
  if (requireSuper(req, res)) return;
  const b = req.body;
  const planId = Number(b.plan_id) || null;
  const start = b.start_date || today();
  const months = Math.max(1, Number(b.duration_months) || 1);
  const end = new Date(new Date(start + 'T00:00:00').getTime() + months * 30 * 86400000).toISOString().slice(0, 10);
  const status = b.status === 'suspended' ? 'suspended' : 'active';
  const username = (b.username || '').trim();
  const tempPass = b.temp_password || '123456';

  /* فحص تكرار اسم المستخدم */
  const dup = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (dup || !username) {
    setFlash(res, { type: 'error', message: 'اسم المستخدم لمدير الأكاديمية موجود أو غير صالح' });
    return res.redirect('/platform/academies/new');
  }

  const logo = req.file ? '/uploads/' + req.file.filename : (b.logo || '').trim();
  const settingsJson = JSON.stringify({
    vodafone_cash: b.vodafone_cash || '',
    payment_instructions: b.payment_instructions || ''
  });

  const info = await db.prepare(
    `INSERT INTO academies (code, name, owner_name, phone, whatsapp, email, address, logo, username, plan_id, status, settings, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(genCode(b.name), b.name.trim(), b.owner_name || '', b.phone || '', b.whatsapp || '', b.email || '', b.address || '', logo, username, planId, status, settingsJson, b.notes || '');

  const academyId = info.lastInsertRowid;
  if (!academyId) { setFlash(res, { type: 'error', message: 'فشل إنشاء الأكاديمية' }); return res.redirect('/platform/academies'); }

  /* بذر البيانات الأساسية لهذه الأكاديمية فقط (مستويات المنهج + معاييرها) */
  await seedAcademyBaseline(academyId);

  /* اشتراك أولي */
  let planPrice = 0;
  if (planId) { const p = await db.prepare('SELECT monthly_price FROM plans WHERE id = ?').get(planId); planPrice = p ? p.monthly_price : 0; }
  const subInfo = await db.prepare(
    `INSERT INTO academy_subscriptions (academy_id, plan_id, price, start_date, expiry_date, status, grace_period_end)
     VALUES (?,?,?,?,?,?,?)`
  ).run(academyId, planId, b.monthly_price != null ? Number(b.monthly_price) || planPrice : planPrice, start, end, status === 'active' ? 'ACTIVE' : 'SUSPENDED', addDays(Number(b.grace_days) || 7));

  /* إنشاء حساب ACADEMY_ADMIN مرتبط بهذه الأكاديمية فقط */
  const adminRole = (await db.prepare("SELECT id FROM roles WHERE name = 'مدير الأكاديمية' LIMIT 1").get() || {}).id;
  const adminUserId = (await db.prepare(
    `INSERT INTO users (username, password_hash, full_name, email, phone, role_id, user_type, academy_id, status)
     VALUES (?,?,?,?,?,?,?,?, 'active')`
  ).run(username, hashPassword(tempPass), b.owner_name || b.name.trim(), b.email || '', b.phone || '', adminRole || null, 'academy_admin', academyId)).lastInsertRowid;

  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'academy', academyId, 'إنشاء أكاديمية: ' + b.name + ' (مدير: ' + username + ')', req);
  setFlash(res, { type: 'success', message: 'تم إنشاء الأكاديمية وحساب مديرها (' + username + ')' });
  res.redirect('/platform/academies');
});

function genCode(name) {
  const base = (name || 'academy').replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '').slice(0, 8).toLowerCase();
  return (base || 'academy') + '_' + Math.random().toString(36).slice(2, 6);
}

router.get('/platform/academies/:id/edit', async function (req, res) {
  if (requireSuper(req, res)) return;
  const a = await db.prepare('SELECT * FROM academies WHERE id = ?').get(Number(req.params.id));
  if (!a) return res.redirect('/platform/academies');
  const plans = await db.all('SELECT * FROM plans ORDER BY id');
  let s = {}; try { s = JSON.parse(a.settings || '{}'); } catch (e) { s = {}; }
  a.settingsJson = s;
  res.render('platform/academy_form', { title: 'تعديل أكاديمية', active: 'platform', plans, values: a, action: '/platform/academies/' + a.id + '/edit', today: today(), sett: s });
});

router.post('/platform/academies/:id/edit', uploadAndStore('logo'), async function (req, res) {
  if (requireSuper(req, res)) return;
  const id = Number(req.params.id);
  const b = req.body;
  const planId = Number(b.plan_id) || null;
  const status = b.status === 'suspended' ? 'suspended' : (b.status === 'expired' ? 'expired' : 'active');
  const s = JSON.stringify({ vodafone_cash: b.vodafone_cash || '', payment_instructions: b.payment_instructions || '' });
  const a = await db.prepare('SELECT username, logo FROM academies WHERE id = ?').get(id);
  let logo = (b.logo || '').trim();
  if (req.file) {
    if (a && a.logo) removeUploaded(a.logo);
    logo = '/uploads/' + req.file.filename;
  }
  await db.prepare(
    `UPDATE academies SET name=?, owner_name=?, phone=?, whatsapp=?, email=?, address=?, plan_id=?, status=?, settings=?, logo=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?`
  ).run(b.name.trim(), b.owner_name || '', b.phone || '', b.whatsapp || '', b.email || '', b.address || '', planId, status, s, logo, b.notes || '', id);

  /* تحديد كلمة مرور جديدة لمدير الأكاديمية (اتركها فارغة للاحتفاظ بالحالية) */
  const newPass = (b.admin_password || '').trim();
  if (newPass) {
    const uname = (a && a.username) || (b.username || '').trim();
    const upd = uname
      ? await db.prepare("UPDATE users SET password_hash = ? WHERE username = ? AND academy_id = ?")
          .run(hashPassword(newPass), uname, id)
      : { changes: 0 };
    const msg = upd.changes > 0 ? '، وتم تغيير كلمة مرور المدير' : '، (لم يتم تغيير كلمة مرور المدير: لا يوجد حساب مطابق)';
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'users', id, 'تغيير كلمة مرور مدير الأكاديمية: ' + b.name, req);
    setFlash(res, { type: 'success', message: 'تم تحديث الأكاديمية' + msg });
  } else {
    setFlash(res, { type: 'success', message: 'تم تحديث الأكاديمية' });
  }

  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'academy', id, 'تعديل أكاديمية: ' + b.name, req);
  res.redirect('/platform/academies');
});

/* رفع/استبدال الصورة التعريفية للأكاديمية من قائمة الأكاديميات (بالضغط على الصورة) */
router.post('/platform/academies/:id/logo', uploadAndStore('logo'), async function (req, res) {
  if (requireSuper(req, res)) return;
  const id = Number(req.params.id);
  if (!req.file) { setFlash(res, { type: 'error', message: 'لم يتم اختيار صورة' }); return res.redirect('/platform/academies'); }
  const publicPath = '/uploads/' + req.file.filename;
  const old = await db.prepare('SELECT logo FROM academies WHERE id = ?').get(id);
  if (old && old.logo) removeUploaded(old.logo);
  await db.prepare("UPDATE academies SET logo = ?, updated_at=datetime('now','localtime') WHERE id = ?").run(publicPath, id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'academy', id, 'تغيير الصورة التعريفية للأكاديمية', req);
  setFlash(res, { type: 'success', message: 'تم تحديث الصورة التعريفية للأكاديمية' });
  res.redirect('/platform/academies');
});

router.post('/platform/academies/:id/status', async function (req, res) {
  if (requireSuper(req, res)) return;
  const id = Number(req.params.id);
  const status = req.body.status === 'active' ? 'active' : 'suspended';
  await db.prepare('UPDATE academies SET status=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(status, id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'academy', id, status === 'active' ? 'تفعيل أكاديمية' : 'إيقاف أكاديمية', req);
  setFlash(res, { type: 'success', message: status === 'active' ? 'تم تفعيل الأكاديمية' : 'تم إيقاف الأكاديمية' });
  res.redirect('/platform/academies');
});

/* تفاصيل أكاديمية: إحصاءات + مستخدمون + اشتراك + مدفوعات */
router.get('/platform/academies/:id', async function (req, res) {
  if (requireSuper(req, res)) return;
  const id = Number(req.params.id);
  const a = await db.prepare('SELECT a.*, p.name AS plan_name FROM academies a LEFT JOIN plans p ON p.id = a.plan_id WHERE a.id = ?').get(id);
  if (!a) return res.redirect('/platform/academies');
  const sub = await getActiveSubscription(id);
  a.subInfo = subscriptionStatus(sub);
  a.sub = sub;
  a.studentCount = (await db.prepare('SELECT COUNT(*) c FROM swimmers WHERE academy_id = ? AND deleted_at IS NULL').get(id)).c;
  a.userCount = (await db.prepare('SELECT COUNT(*) c FROM users WHERE academy_id = ?').get(id)).c;
  a.guardianCount = (await db.prepare('SELECT COUNT(*) c FROM guardians WHERE academy_id = ? AND deleted_at IS NULL').get(id)).c;
  a.subsCount = (await db.prepare('SELECT COUNT(*) c FROM academy_subscriptions WHERE academy_id = ?').get(id)).c;
  const users = await db.prepare('SELECT id, username, full_name, user_type, role_id, status FROM users WHERE academy_id = ? ORDER BY id').all(id);
  const subsHistory = await db.prepare('SELECT * FROM academy_subscriptions WHERE academy_id = ? ORDER BY id DESC LIMIT 20').all(id);
  const payments = await db.prepare('SELECT * FROM payments_history WHERE academy_id = ? ORDER BY id DESC LIMIT 50').all(id);
  const plans = await db.all('SELECT * FROM plans ORDER BY id');
  res.render('platform/academy_detail', { title: a.name, active: 'platform', a, users, subsHistory, payments, plans });
});

/* تجديد الاشتراك يدوياً من Super Admin */
router.post('/platform/academies/:id/renew', async function (req, res) {
  if (requireSuper(req, res)) return;
  const id = Number(req.params.id);
  const b = req.body;
  const planId = Number(b.plan_id) || null;
  const months = Math.max(1, Number(b.duration_months) || 1);
  const cur = await getActiveSubscription(id);
  const nowMs = Date.now();
  const reference = cur && cur.expiry_date && new Date(cur.expiry_date + 'T00:00:00').getTime() > nowMs
    ? new Date(cur.expiry_date + 'T00:00:00') : new Date(nowMs);
  const newStart = reference.toISOString().slice(0, 10);
  const newEnd = new Date(reference.getTime() + months * 30 * 86400000).toISOString().slice(0, 10);
  const price = Number(b.price) || 0;
  const planName = planId ? (await db.prepare('SELECT name FROM plans WHERE id = ?').get(planId) || {}).name : null;
  const academyName = (await db.prepare('SELECT name FROM academies WHERE id = ?').get(id) || {}).name;

  await db.prepare(
    `INSERT INTO academy_subscriptions (academy_id, plan_id, price, start_date, expiry_date, status, grace_period_end)
     VALUES (?,?,?,?,?, 'ACTIVE', ?)`
  ).run(id, planId, price, newStart, newEnd, addDays(Number(b.grace_days) || 7));
  await db.prepare(`INSERT INTO payments_history (academy_id, academy_name, plan_id, plan_name, amount, payment_method, approved_by, approved_by_name, approved_at, subscription_period, status)
     VALUES (?,?,?,?,?, 'MANUAL_RENEWAL', ?, ?, datetime('now','localtime'), ?, 'APPROVED')`)
    .run(id, academyName, planId, planName, price, req.currentUser.id, req.currentUser.full_name, newStart + ' إلى ' + newEnd, req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'renew', 'academy', id, 'تجديد اشتراك أكاديمية: ' + academyName + ' لمدة ' + months + ' شهر', req);
  setFlash(res, { type: 'success', message: 'تم تجديد الاشتراك' });
  res.redirect('/platform/academies/' + id);
});

/* ================================================================ */
/*  الدخول بالنيابة (Support Access)                               */
/* ================================================================ */
router.post('/platform/academies/:id/impersonate', async function (req, res) {
  if (requireSuper(req, res)) return;
  const id = Number(req.params.id);
  const a = await getAcademy(id);
  if (!a) return res.redirect('/platform/academies');
  req.res.setHeader('Set-Cookie', 'swim_imp=' + id + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600' + (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
  audit(req.currentUser.id, req.currentUser.full_name, 'impersonate', 'academy', id, 'دخول بالنيابة إلى أكاديمية: ' + a.name, req);
  setFlash(res, { type: 'info', message: 'أنت الآن داخل أكاديمية ' + a.name + ' (وضع الدعم). اخرج بالزر في الشريط العلوي.' });
  res.redirect('/');
});
router.post('/platform/impersonate/exit', async function (req, res) {
  if (requireSuper(req, res)) return;
  audit(req.currentUser.id, req.currentUser.full_name, 'impersonate', 'academy', 0, 'الخروج من وضع الدخول بالنيابة', req);
  req.res.setHeader('Set-Cookie', 'swim_imp=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
  setFlash(res, { type: 'success', message: 'تم الخروج من وضع الدخول بالنيابة' });
  res.redirect('/platform');
});

/* ================================================================ */
/*  مراجعة طلبات الدفع (Vodafone Cash)                             */
/* ================================================================ */
router.get('/platform/payments', async function (req, res) {
  if (requireSuper(req, res)) return;
  const filter = req.query.status || 'PENDING';
  const rows = await db.prepare(`SELECT pr.*, a.name AS academy_name, a.phone AS academy_phone FROM payment_requests pr LEFT JOIN academies a ON a.id = pr.academy_id
    WHERE (? = 'ALL' OR pr.status = ?) ORDER BY pr.created_at DESC LIMIT 200`).all(filter, filter, filter);
  for (const r of rows) {
    const plan = r.plan_id ? await db.prepare('SELECT name FROM plans WHERE id = ?').get(r.plan_id) : null;
    r.plan_name = plan ? plan.name : '—';
    const reviewer = r.reviewed_by ? await db.prepare('SELECT full_name FROM users WHERE id = ?').get(r.reviewed_by) : null;
    r.reviewer_name = reviewer ? reviewer.full_name : '—';
  }
  res.render('platform/payments', { title: 'مراجعة طلبات الدفع', active: 'platform', rows, filter });
});

/* موافقة/رفض طلب دفع — Idempotent وبلا خسارة الأيام المتبقية */
router.post('/platform/payments/:id/review', async function (req, res) {
  if (requireSuper(req, res)) return;
  const id = Number(req.params.id);
  const action = req.body.action === 'approve' ? 'APPROVED' : 'REJECTED';
  const reason = (req.body.reason || '').trim();

  await db.batch([
    { sql: "UPDATE payment_requests SET status='APPROVED', reviewed_by=?, reviewed_at=datetime('now','localtime'), rejection_reason='' WHERE id=? AND status='PENDING'", args: [req.currentUser.id, id] }
  ]);

  const pr = await db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(id);
  if (!pr) return res.redirect('/platform/payments');
  /* منع الموافقة المزدوجة */
  if (pr.status !== 'PENDING') {
    setFlash(res, { type: 'error', message: 'تمت معالجة هذا الطلب مسبقاً (الحالة: ' + pr.status + ')' });
    return res.redirect('/platform/payments');
  }

  if (action === 'REJECTED') {
    await db.prepare("UPDATE payment_requests SET status='REJECTED', reviewed_by=?, reviewed_at=datetime('now','localtime'), rejection_reason=? WHERE id=?").run(req.currentUser.id, reason || 'غير مذكور', id);
    audit(req.currentUser.id, req.currentUser.full_name, 'reject_payment', 'payment', id, 'رفض طلب دفع لكيان: ' + (pr.academy_id), req);
    setFlash(res, { type: 'warning', message: 'تم رفض طلب الدفع' });
    return res.redirect('/platform/payments');
  }

  /* APPROVED: معاملة آمنة */
  const academy = await getAcademy(pr.academy_id);
  const planId = pr.plan_id;
  const plan = planId ? await db.prepare('SELECT * FROM plans WHERE id = ?').get(planId) : null;
  const months = Math.max(1, Number(req.body.duration_months) || 1);
  const cur = await getActiveSubscription(pr.academy_id);
  const nowMs = Date.now();
  const reference = cur && cur.expiry_date && new Date(cur.expiry_date + 'T00:00:00').getTime() > nowMs
    ? new Date(cur.expiry_date + 'T00:00:00') : new Date(nowMs);
  const newStart = reference.toISOString().slice(0, 10);
  const newEnd = new Date(reference.getTime() + months * 30 * 86400000).toISOString().slice(0, 10);
  const planName = plan ? plan.name : '—';

  await db.prepare(
    `INSERT INTO academy_subscriptions (academy_id, plan_id, price, start_date, expiry_date, status, grace_period_end)
     VALUES (?,?,?,?,?, 'ACTIVE', ?)`
  ).run(pr.academy_id, planId, pr.amount, newStart, newEnd, addDays(7));

  await db.prepare(
    `INSERT INTO payments_history (academy_id, academy_name, plan_id, plan_name, amount, payment_method, sender_phone, transaction_reference, payment_date, approved_by, approved_by_name, approved_at, subscription_period, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'),?, 'APPROVED')`
  ).run(pr.academy_id, academy ? academy.name : '', planId, planName, pr.amount, pr.payment_method || 'VODAFONE_CASH', pr.sender_phone, pr.transaction_reference, pr.transfer_date, req.currentUser.id, req.currentUser.full_name, newStart + ' إلى ' + newEnd);

  if (academy) {
    await db.prepare("UPDATE academies SET status='active', updated_at=datetime('now','localtime') WHERE id=?").run(academy.id);
  }
  await db.prepare("UPDATE payment_requests SET status='APPROVED', reviewed_by=?, reviewed_at=datetime('now','localtime') WHERE id=?").run(req.currentUser.id, id);
  audit(req.currentUser.id, req.currentUser.full_name, 'approve_payment', 'payment', id, 'الموافقة على طلب دفع وتجديد اشتراك أكاديمية: ' + (academy ? academy.name : pr.academy_id ), req);
  setFlash(res, { type: 'success', message: 'تمت الموافقة على الدفع وتجديد الاشتراك' });
  res.redirect('/platform/payments');
});

/* ================================================================ */
/*  الخطط                                                          */
/* ================================================================ */
router.get('/platform/plans', async function (req, res) {
  if (requireSuper(req, res)) return;
  const plans = await db.all('SELECT * FROM plans ORDER BY id');
  res.render('platform/plans', { title: 'خطط الاشتراك', active: 'platform', plans, FEATURES });
});
router.get('/platform/plans/new', async function (req, res) {
  if (requireSuper(req, res)) return;
  res.render('platform/plan_form', { title: 'خطة جديدة', active: 'platform', p: null, features: [], FEATURES, FEATURE_GROUPS, ACTIONS, ACTION_LABELS, EXTRA_FEATURES });
});
router.get('/platform/plans/:id/edit', async function (req, res) {
  if (requireSuper(req, res)) return;
  const p = await db.prepare('SELECT * FROM plans WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.redirect('/platform/plans');
  let features = []; try { features = JSON.parse(p.features || '[]'); } catch (e) { features = []; }
  res.render('platform/plan_form', { title: 'تعديل خطة', active: 'platform', p, features, FEATURES, FEATURE_GROUPS, ACTIONS, ACTION_LABELS, EXTRA_FEATURES });
});
router.post('/platform/plans', async function (req, res) {
  if (requireSuper(req, res)) return;
  const b = req.body;
  const features = Array.isArray(b.features) ? b.features : [];
  if (b.plan_id) {
    await db.prepare(`UPDATE plans SET name=?, code=?, monthly_price=?, max_students=?, max_teachers=?, max_employees=?, max_users=?, max_branches=?, storage_limit=?, features=?, status=?, notes=? WHERE id=?`)
      .run(b.name, b.code, Number(b.monthly_price)||0, Number(b.max_students)||-1, Number(b.max_teachers)||-1, Number(b.max_employees)||-1, Number(b.max_users)||-1, Number(b.max_branches)||-1, Number(b.storage_limit)||0, JSON.stringify(features), b.status, b.notes, Number(b.plan_id));
  } else {
    await db.prepare(`INSERT INTO plans (name, code, monthly_price, max_students, max_teachers, max_employees, max_users, max_branches, storage_limit, features, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(b.name, b.code || genCode(b.name), Number(b.monthly_price)||0, Number(b.max_students)||-1, Number(b.max_teachers)||-1, Number(b.max_employees)||-1, Number(b.max_users)||-1, Number(b.max_branches)||-1, Number(b.storage_limit)||0, JSON.stringify(features), b.status || 'active', b.notes);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'plan', Number(b.plan_id)||0, 'تحديث خطة: ' + b.name, req);
  setFlash(res, { type: 'success', message: 'تم حفظ الخطة' });
  res.redirect('/platform/plans');
});

/* ================================================================ */
/*  إعدادات المنصة                                                   */
/* ================================================================ */
router.get('/platform/settings', async function (req, res) {
  if (requireSuper(req, res)) return;
  const current = {};
  (await db.prepare('SELECT * FROM settings').all()).forEach(r => { current[r.key] = r.value; });
  res.render('platform/settings', { title: 'إعدادات المنصة', active: 'platform', sett: current });
});
router.post('/platform/settings', async function (req, res) {
  if (requireSuper(req, res)) return;
  const b = req.body;
  const map = {
    'platform_name': b.platform_name || '',
    'platform_grace_days': b.grace_days || '',
    'platform_auto_renew_months': b.auto_renew_months || '',
    'platform_vodafone_cash': b.vodafone_cash || '',
    'platform_payment_instructions': b.payment_instructions || '',
    'platform_powered_by': b.powered_by || '',
    'whatsapp_api_token': b.whatsapp_api_token || '',
    'whatsapp_phone_id': b.whatsapp_phone_id || '',
    'whatsapp_auto_send': b.whatsapp_auto_send || '0'
  };
  for (const [k, v] of Object.entries(map)) {
    await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run(k, v);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'settings', 0, 'تحديث إعدادات المنصة', req);
  setFlash(res, { type: 'success', message: 'تم حفظ إعدادات المنصة' });
  res.redirect('/platform/settings');
});

/* سجل النشاط */
router.get('/platform/audit-logs', async function (req, res) {
  if (requireSuper(req, res)) return;
  const rows = await db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300');
  res.render('platform/audit_logs', { title: 'سجل النشاط', active: 'platform', rows });
});

module.exports = router;
