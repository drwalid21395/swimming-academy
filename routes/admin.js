/** الإدارة: المستخدمون، الأدوار والصلاحيات، الإعدادات، سجل النشاط */
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { db } = require('../lib/db');
const { audit, money, fmtDate, fmtDateTime, today, canView, canAdd, canEdit, canDel, hashPassword, MODULES } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const { upload, uploadAndStore, removeUploaded } = require('../lib/upload');
const { getAcademy, getActiveSubscription, subscriptionStatus, featureEnabled, maybeNotifyAcademySubscription } = require('../lib/tenant');
const router = express.Router();

async function getArr(key, fallback) {
  const v = (await db.prepare('SELECT value FROM settings WHERE key = ?').get(key) || {}).value;
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : fallback; } catch (e) { return fallback; }
}
async function saveArr(key, arr) {
  await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(arr));
}

const MODULE_LABELS = {
  dashboard: 'لوحة التحكم', swimmers: 'السباحون', guardians: 'أولياء الأمور', coaches: 'الكباتن والمدربون', staff: 'الموظفون',
  programs: 'البرامج والدورات', levels: 'المستويات', groups: 'المجموعات', sessions: 'الحصص والجداول', attendance: 'الحضور والغياب',
  assessments: 'التقييمات الفنية', tests: 'الاختبارات', teams: 'فرق السباحة', competitions: 'البطولات',
  subscriptions: 'الاشتراكات', payments: 'المدفوعات', revenues: 'الإيرادات', expenses: 'المصروفات', coachPayments: 'مستحقات المدربين',
  incoming: 'الوارد', outgoing: 'الصادر', documents: 'المستندات', notifications: 'الإشعارات', complaints: 'الشكاوى والطلبات',
  reports: 'التقارير', branches: 'الفروع', pools: 'حمامات السباحة', users: 'المستخدمون والصلاحيات', settings: 'إعدادات النظام',
  auditLog: 'سجل النشاط', site: 'الموقع التعريفي',
  trainerAttendance: 'حضور المدربين', staffAttendance: 'حضور الموظفين', payroll: 'المستحقات والرواتب'
};
const MODULE_GROUPS = [
  ['الأعضاء والتسجيل', ['swimmers', 'guardians', 'coaches', 'staff']],
  ['البرامج التدريبية', ['programs', 'levels', 'groups']],
  ['الجداول والحضور', ['sessions', 'attendance']],
  ['الجوانب الفنية', ['assessments', 'tests', 'teams', 'competitions']],
  ['المالية', ['subscriptions', 'payments', 'revenues', 'expenses', 'coachPayments']],
  ['الحضور والمستحقات', ['trainerAttendance', 'staffAttendance', 'payroll']],
  ['الإدارة والمراسلات', ['incoming', 'outgoing', 'documents', 'notifications', 'complaints']],
  ['النظام', ['reports', 'branches', 'pools', 'users', 'settings', 'auditLog', 'site']]
];

/* ============================================================== */
/*                          المستخدمون                            */
/* ============================================================== */
router.get('/users', async function (req, res) {
  if (!canView(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT u.*, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.id`).all();
  const page = {
    title: 'المستخدمون والصلاحيات', subtitle: 'إدارة حسابات النظام', icon: 'fa-user-shield', module: 'users', active: 'users',
    columns: [
      { key: 'full_name', label: 'المستخدم', html: row => `<div class="avatar-cell"><div class="avatar-sm">${(row.full_name || 'م').trim().charAt(0)}</div><div><div class="cell-title">${row.full_name}</div><div class="cell-sub">@${row.username}</div></div></div>` },
      { key: 'role_name', label: 'الدور', html: row => `<span class="badge badge-primary">${row.role_name || '—'}</span>` },
      { key: 'email', label: 'البريد' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'last_login', label: 'آخر دخول', html: row => row.last_login ? fmtDateTime(row.last_login) : '—' },
      { key: 'status', label: 'الحالة', html: row => `<span class="badge ${row.status === 'active' ? 'badge-success' : 'badge-danger'}">${row.status === 'active' ? 'مفعّل' : 'معطّل'}</span>` }
    ],
    rows,
    filters: [
      { name: 'status', label: 'الحالة', options: [{ value: 'active', label: 'مفعّل' }, { value: 'disabled', label: 'معطّل' }] },
      { name: 'role_id', label: 'الدور', options: (await db.prepare('SELECT * FROM roles ORDER BY id').all()).map(r => ({ value: r.id, label: r.name })) },
      { name: 'user_type', label: 'النوع', options: [{ value: 'staff', label: 'موظف' }, { value: 'coach', label: 'مدرب' }, { value: 'guardian', label: 'ولي أمر' }, { value: 'swimmer', label: 'سباح' }] }
    ],
    canAdd: canAdd(req.currentUser, 'users'), addUrl: canAdd(req.currentUser, 'users') ? '/users/new' : null, addLabel: 'مستخدم جديد',
    actions: () => row => [
      { label: 'تعديل', icon: 'fa-pen', href: '/users/' + row.id + '/edit' },
      { label: 'الصلاحيات', icon: 'fa-user-shield', href: '/users/' + row.id + '/permissions' },
      { label: 'إعادة كلمة المرور', icon: 'fa-key', href: '/users/' + row.id + '/reset', confirm: 'إعادة تعيين كلمة مرور هذا المستخدم إلى 123456؟' },
      { label: 'حذف', icon: 'fa-trash', href: '/users/' + row.id + '/delete', confirm: 'حذف المستخدم؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});

const userFields = async function (values) {
  const roles = (await db.prepare('SELECT * FROM roles ORDER BY id').all()).map(r => ({ value: r.id, label: r.name }));
  return [
    { key: 'username', label: 'اسم المستخدم', type: 'text', required: true, section: 'بيانات الحساب', sectionIcon: 'fa-user-shield' },
    { key: 'full_name', label: 'الاسم الكامل', type: 'text', required: true },
    { key: 'email', label: 'البريد الإلكتروني', type: 'email' },
    { key: 'phone', label: 'الهاتف', type: 'tel' },
    { key: 'role_id', label: 'الدور', type: 'select', options: roles, required: true },
    { key: 'user_type', label: 'نوع الحساب', type: 'select', options: [{ value: 'staff', label: 'موظف' }, { value: 'coach', label: 'مدرب' }, { value: 'guardian', label: 'ولي أمر' }, { value: 'swimmer', label: 'سباح' }, { value: 'system', label: 'مدير النظام' }] },
    { key: 'linked_id', label: 'رقم السجل المرتبط', type: 'number', number: true, hint: 'id في جدول السباحين أو المدربين أو أولياء الأمور' },
    { key: 'status', label: 'الحالة', type: 'select', options: [{ value: 'active', label: 'مفعّل' }, { value: 'disabled', label: 'معطّل' }] },
    { key: 'password', label: 'كلمة المرور', type: 'password', hint: 'اتركها فارغة للاحتفاظ بالكلمة الحالية (الافتراضي 123456)' }
  ];
};

router.get('/users/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'مستخدم جديد', subtitle: 'إنشاء حساب في النظام', icon: 'fa-plus', active: 'users', action: '/users/new', fields: await userFields({}), values: {}, submitLabel: 'إنشاء المستخدم', cancelUrl: '/users', csrf: '' } });
});
router.post('/users/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const pass = b.password ? b.password : '123456';
  try {
    const info = await db.prepare('INSERT INTO users (username, password_hash, full_name, email, phone, role_id, user_type, linked_id, status) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(b.username.trim(), hashPassword(pass), b.full_name.trim(), b.email || '', b.phone || '', b.role_id, b.user_type || 'staff', b.linked_id || 0, b.status || 'active');
    audit(req.currentUser.id, req.currentUser.full_name, 'add', 'users', info.lastInsertRowid, 'مستخدم جديد: ' + b.username, req);
    setFlash(res, { type: 'success', message: 'تم إنشاء المستخدم' });
    res.redirect('/users');
  } catch (e) {
    setFlash(res, { type: 'error', message: 'اسم المستخدم موجود مسبقاً' });
    res.redirect('/users/new');
  }
});
router.get('/users/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/users');
  res.render('form', { form: { title: 'تعديل المستخدم', subtitle: row.full_name, icon: 'fa-pen', active: 'users', action: '/users/' + row.id + '/edit', fields: await userFields(row), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/users', csrf: '' } });
});
router.post('/users/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  if (b.password) {
    await db.prepare('UPDATE users SET username=?, password_hash=?, full_name=?, email=?, phone=?, role_id=?, user_type=?, linked_id=?, status=? WHERE id=?')
      .run(b.username.trim(), hashPassword(b.password), b.full_name.trim(), b.email || '', b.phone || '', b.role_id, b.user_type || 'staff', b.linked_id || 0, b.status || 'active', id);
  } else {
    await db.prepare('UPDATE users SET username=?, full_name=?, email=?, phone=?, role_id=?, user_type=?, linked_id=?, status=? WHERE id=?')
      .run(b.username.trim(), b.full_name.trim(), b.email || '', b.phone || '', b.role_id, b.user_type || 'staff', b.linked_id || 0, b.status || 'active', id);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'users', id, 'تعديل مستخدم: ' + b.username, req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/users');
});
router.post('/users/:id/reset', async function (req, res) {
  if (!canEdit(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword('123456'), Number(req.params.id));
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'users', Number(req.params.id), 'إعادة تعيين كلمة المرور', req);
  setFlash(res, { type: 'success', message: 'تم إعادة تعيين كلمة المرور إلى 123456' });
  res.redirect('/users');
});

/* ============ الصلاحيات الدقيقة لكل مستخدم ============ */
router.get('/users/:id/permissions', async function (req, res) {
  if (!canEdit(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT u.*, r.name AS role_name, r.permissions AS role_permissions FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/users');
  let own = {};
  try { own = JSON.parse(row.permissions || '{}'); } catch (e) { own = {}; }
  res.render('user_permissions', { title: 'صلاحيات ' + row.full_name, active: 'users', target: row, own,
    groups: MODULE_GROUPS, labels: MODULE_LABELS });
});
router.post('/users/:id/permissions', async function (req, res) {
  if (!canEdit(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  const perms = {};
  for (const m of MODULES) {
    perms[m] = {
      view: b[m + '_view'] === 'allow' ? 1 : b[m + '_view'] === 'deny' ? 0 : undefined,
      add: b[m + '_add'] === 'allow' ? 1 : b[m + '_add'] === 'deny' ? 0 : undefined,
      edit: b[m + '_edit'] === 'allow' ? 1 : b[m + '_edit'] === 'deny' ? 0 : undefined,
      del: b[m + '_del'] === 'allow' ? 1 : b[m + '_del'] === 'deny' ? 0 : undefined,
      export: b[m + '_export'] === 'allow' ? 1 : b[m + '_export'] === 'deny' ? 0 : undefined
    };
    Object.keys(perms[m]).forEach(function (k) { if (perms[m][k] === undefined) delete perms[m][k]; });
    if (!Object.keys(perms[m]).length) delete perms[m];
  }
  await db.prepare('UPDATE users SET permissions=? WHERE id=?').run(JSON.stringify(perms), id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'users', id, 'تحديث الصلاحيات الفردية', req);
  setFlash(res, { type: 'success', message: 'تم حفظ الصلاحيات الفردية لهذا المستخدم' });
  res.redirect('/users/' + id + '/permissions');
});
router.post('/users/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  if (id === req.currentUser.id) { setFlash(res, { type: 'error', message: 'لا يمكنك حذف حسابك الحالي' }); return res.redirect('/users'); }
  try {
    /* إزالة/فك الروابط التي تشير لهذا المستخدم حتى لا يفشل الحذف بسبب قيد المفاتيح الأجنبية */
    await db.prepare('UPDATE staff SET user_id = NULL WHERE user_id = ?').run(id);
    await db.prepare('DELETE FROM notification_recipients WHERE user_id = ?').run(id);
    await db.prepare('UPDATE messages SET from_user_id = NULL, to_user_id = NULL WHERE from_user_id = ? OR to_user_id = ?').run(id, id);
    await db.prepare('DELETE FROM users WHERE id=?').run(id);
    audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'users', id, 'حذف مستخدم', req);
    setFlash(res, { type: 'success', message: 'تم حذف المستخدم' });
  } catch (e) {
    console.error('فشل حذف مستخدم ' + id + ':', e.message);
    setFlash(res, { type: 'error', message: 'تعذّر حذف المستخدم بسبب ارتباطه ببيانات أخرى: ' + e.message });
  }
  res.redirect('/users');
});

/* ============================================================== */
/*                       الأدوار والصلاحيات                        */
/* ============================================================== */
router.get('/roles', async function (req, res) {
  if (!canView(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const roles = await db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS users_count FROM roles r ORDER BY r.id`).all();
  res.render('roles', { title: 'الأدوار والصلاحيات', active: 'users', roles, groups: MODULE_GROUPS, labels: MODULE_LABELS,
    canEdit: canEdit(req.currentUser, 'users') });
});
router.post('/roles/:id/permissions', async function (req, res) {
  if (!canEdit(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const perms = {};
  for (const m of MODULES) {
    perms[m] = {
      view: req.body[m + '_view'] ? 1 : 0,
      add: req.body[m + '_add'] ? 1 : 0,
      edit: req.body[m + '_edit'] ? 1 : 0,
      del: req.body[m + '_del'] ? 1 : 0,
      export: req.body[m + '_export'] ? 1 : 0
    };
  }
  await db.prepare('UPDATE roles SET permissions=? WHERE id=?').run(JSON.stringify(perms), id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'roles', id, 'تحديث صلاحيات دور', req);
  setFlash(res, { type: 'success', message: 'تم تحديث صلاحيات الدور' });
  res.redirect('/roles');
});

/* ============================================================== */
/*                       إعدادات النظام                           */
/* ============================================================== */
const SETTING_DEFS = [
  { key: 'site_name', label: 'اسم الأكاديمية', type: 'text', section: 'بيانات الأكاديمية' },
  { key: 'site_slogan', label: 'الشعار النصي', type: 'text', section: 'بيانات الأكاديمية' },
  { key: 'phone', label: 'هاتف التواصل', type: 'tel', section: 'بيانات الأكاديمية' },
  { key: 'whatsapp', label: 'واتساب', type: 'tel', section: 'التواصل' },
  { key: 'email', label: 'البريد الإلكتروني', type: 'email', section: 'التواصل' },
  { key: 'address', label: 'العنوان', type: 'text', section: 'التواصل' },
  { key: 'work_hours', label: 'مواعيد العمل', type: 'text', section: 'التواصل' },
  { key: 'about', label: 'نبذة عن الأكاديمية', type: 'textarea', section: 'عن الأكاديمية' },
  { key: 'facebook', label: 'فيسبوك', type: 'text', section: 'عن الأكاديمية' },
  { key: 'instagram', label: 'انستغرام', type: 'text', section: 'السوشيال ميديا' },
  { key: 'tiktok', label: 'تيك توك', type: 'text', section: 'السوشيال ميديا' },
  { key: 'map_url', label: 'رابط الخريطة', type: 'text', section: 'السوشيال ميديا' },
  { key: 'safety_notes', label: 'إرشادات السلامة في الماء', type: 'textarea', section: 'السلامة' },
  { key: 'whatsapp_country_code', label: 'مفتاح دولة الواتساب (مثال: 20 لمصر)', type: 'text', section: 'إعدادات الواتساب' }
];
router.get('/settings', async function (req, res) {
  if (!canView(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const current = {};
  (await db.prepare('SELECT * FROM settings').all()).forEach(r => { current[r.key] = r.value; });
  /* سياق الأكاديمية الحالية: معلومات الاشتراك + صلاحية رفع الشعار */
  const acadId = req.currentUser.impersonatingAcademyId || req.currentUser.academy_id;
  try { await maybeNotifyAcademySubscription(acadId); } catch (e) { /* تجاهل */ }
  const academy = await getAcademy(acadId);
  let subscription = null, subInfo = null, plan = null, paidAmount = 0, dueAmount = 0;
  if (academy) {
    subscription = await getActiveSubscription(academy.id);
    subInfo = subscriptionStatus(subscription);
    const planId = subscription ? subscription.plan_id : (academy.plan_id || null);
    if (planId) plan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
    const pr = await db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments_history WHERE academy_id = ? AND status='APPROVED'").get(academy.id);
    paidAmount = Number(pr ? pr.s : 0) || 0;
    const periodCost = subscription ? (Number(subscription.price) || 0) : 0;
    dueAmount = periodCost > paidAmount ? (periodCost - paidAmount) : 0;
  }
  res.render('settings', { title: 'إعدادات النظام', active: 'settings', defs: SETTING_DEFS, current,
    canEdit: canEdit(req.currentUser, 'settings'),
    academy, subscription, subInfo, plan, paidAmount, dueAmount,
    canUploadLogo: !!await featureEnabled(acadId, 'academy_logo'),
    canCustomizeBranding: !!await featureEnabled(acadId, 'custom_branding') });
});

/* رفع صورة/شعار الأكاديمية (يتطلب تفعيل ميزة "رفع صورة وشعار الأكاديمية") */
router.post('/settings/logo', uploadAndStore('logo'), async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const acadId = req.currentUser.impersonatingAcademyId || req.currentUser.academy_id;
  if (!req.file) { setFlash(res, { type: 'error', message: 'لم يتم اختيار صورة' }); return res.redirect('/settings'); }
  if (!await featureEnabled(acadId, 'academy_logo')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const publicPath = '/uploads/' + req.file.filename;
  const old = await db.prepare('SELECT logo FROM academies WHERE id = ?').get(acadId);
  if (old && old.logo) removeUploaded(old.logo);
  await db.prepare("UPDATE academies SET logo = ?, updated_at=datetime('now','localtime') WHERE id = ?").run(publicPath, acadId);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'settings', acadId, 'تحديث شعار الأكاديمية', req);
  setFlash(res, { type: 'success', message: 'تم تحديث شعار الأكاديمية' });
  res.redirect('/settings');
});

/* تغيير اللون الرئيسي لهوية الأكاديمية (يتطلب تفعيل ميزة "تخصيص هوية الأكاديمية") */
router.post('/settings/color', async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const acadId = req.currentUser.impersonatingAcademyId || req.currentUser.academy_id;
  if (!acadId) { setFlash(res, { type: 'error', message: 'لا توجد أكاديمية مرتبطة' }); return res.redirect('/settings'); }
  if (!await featureEnabled(acadId, 'custom_branding')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const color = String(req.body.primary_color || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) { setFlash(res, { type: 'error', message: 'اللون غير صالح' }); return res.redirect('/settings'); }
  const a = await getAcademy(acadId);
  let s = {};
  try { s = JSON.parse(a.settings || '{}'); } catch (e) { s = {}; }
  s.primary_color = color;
  await db.prepare("UPDATE academies SET settings = ?, updated_at=datetime('now','localtime') WHERE id = ?").run(JSON.stringify(s), acadId);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'academy', acadId, 'تغيير اللون الرئيسي لهوية الأكاديمية', req);
  setFlash(res, { type: 'success', message: 'تم تحديث اللون الرئيسي للأكاديمية' });
  res.redirect('/settings');
});


/* صورة الأكاديمية (الصورة الشخصية بجانب الاسم) — تُحدَّث وترجع لنفس الصفحة */router.post('/settings/avatar', uploadAndStore('logo'), async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const acadId = req.currentUser.impersonatingAcademyId || req.currentUser.academy_id;
  const back = String(req.body.back || '').replace(/[^\/\w:?=&%.@_-]/g, '').slice(0, 200) || '/';
  if (!req.file) { setFlash(res, { type: 'error', message: 'لم يتم اختيار صورة' }); return res.redirect(back); }
  const publicPath = '/uploads/' + req.file.filename;
  const old = await db.prepare('SELECT logo FROM academies WHERE id = ?').get(acadId);
  if (old && old.logo) removeUploaded(old.logo);
  await db.prepare("UPDATE academies SET logo = ?, updated_at=datetime('now','localtime') WHERE id = ?").run(publicPath, acadId);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'academy', acadId, 'تحديث صورة الأكاديمية', req);
  setFlash(res, { type: 'success', message: 'تم تحديث صورة الأكاديمية' });
  res.redirect(back);
});
router.post('/settings', async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const st = await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)');
  for (const def of SETTING_DEFS) st.run(def.key, req.body[def.key] || '');
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'settings', 0, 'تحديث إعدادات النظام', req);
  setFlash(res, { type: 'success', message: 'تم حفظ الإعدادات' });
  res.redirect('/settings');
});

/* أنواع البرامج واختبارات التقييم (من الإعدادات) */
const TYPES_DEFS = [
  { key: 'program_types', label: 'أنواع البرامج', icon: 'fa-layer-group', placeholder: 'مثال: تعليمي، متقدم، ترميم، احترافي' },
  { key: 'test_types', label: 'أنواع الاختبارات', icon: 'fa-vial-circle-check', placeholder: 'مثال: مستوى، زمن، بطولة، عام' }
];
router.get('/settings/types', async function (req, res) {
  if (!canView(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const types = {};
  for (const d of TYPES_DEFS) types[d.key] = await getArr(d.key, []);
  res.render('settings_types', { title: 'أنواع البرامج والاختبارات', active: 'settings', types, defs: TYPES_DEFS, canEdit: canEdit(req.currentUser, 'settings') });
});
router.post('/settings/types/add', async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const key = String(req.body.key || '');
  const val = String(req.body.value || '').trim();
  const def = TYPES_DEFS.find(d => d.key === key);
  if (def && val) {
    const arr = await getArr(key, []);
    if (!arr.includes(val)) {
      arr.push(val);
      await saveArr(key, arr);
      audit(req.currentUser.id, req.currentUser.full_name, 'add', 'settings', 0, 'إضافة نوع: ' + val + ' (' + def.label + ')', req);
    }
  }
  setFlash(res, { type: 'success', message: 'تمت الإضافة' });
  res.redirect('/settings/types');
});
router.post('/settings/types/remove', async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const key = String(req.body.key || '');
  const val = String(req.body.value || '');
  const def = TYPES_DEFS.find(d => d.key === key);
  if (def && val) {
    const arr = (await getArr(key, [])).filter(v => v !== val);
    await saveArr(key, arr);
    audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'settings', 0, 'حذف نوع: ' + val + ' (' + def.label + ')', req);
  }
  setFlash(res, { type: 'success', message: 'تم الحذف' });
  res.redirect('/settings/types');
});

/* صور الواجهة الرئيسية */
router.get('/settings/images', async function (req, res) {
  if (!canView(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const images = await getArr('home_images', []);
  res.render('settings_images', { title: 'صور الواجهة الرئيسية', active: 'settings', images, canEdit: canEdit(req.currentUser, 'settings') });
});
router.post('/settings/images', uploadAndStore('image'), async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const images = await getArr('home_images', []);
  if (req.file) images.push(req.file.filename);
  await saveArr('home_images', images);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'settings', 0, 'إضافة صورة للواجهة', req);
  setFlash(res, { type: 'success', message: 'تم حفظ الصورة' });
  res.redirect('/settings/images');
});
router.post('/settings/images/:id/delete', async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const idx = Number(req.params.id);
  const images = await getArr('home_images', []);
  if (images[idx]) {
    removeUploaded(images[idx]);
    images.splice(idx, 1);
    await saveArr('home_images', images);
    audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'settings', 0, 'حذف صورة من الواجهة', req);
  }
  setFlash(res, { type: 'success', message: 'تم حذف الصورة' });
  res.redirect('/settings/images');
});

/* ============================================================== */
/*           الأخبار والأحداث (المركز الإعلامي)                    */
/* ============================================================== */
router.get('/settings/news', async function (req, res) {
  if (!canView(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const acadId = req.currentUser.impersonatingAcademyId || req.currentUser.academy_id;
  const news = await db.prepare('SELECT * FROM announcements WHERE academy_id = ? ORDER BY id DESC').all(acadId);
  res.render('settings_news', { title: 'الأخبار والأحداث', active: 'settings', news, canEdit: canEdit(req.currentUser, 'settings'), fmtDate });
});

router.post('/settings/news/add', uploadAndStore('image'), async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const acadId = req.currentUser.impersonatingAcademyId || req.currentUser.academy_id;
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  const isPublic = req.body.is_public ? 1 : 0;
  const image = req.file ? '/uploads/' + req.file.filename : (String(req.body.image || '').trim() || null);
  if (title && body) {
    await db.prepare('INSERT INTO announcements (title, body, image, is_public, created_by, academy_id) VALUES (?,?,?,?,?,?)')
      .run(title, body, image, isPublic, req.currentUser.id, acadId);
    audit(req.currentUser.id, req.currentUser.full_name, 'add', 'announcements', 0, 'إضافة خبر: ' + title, req);
    setFlash(res, { type: 'success', message: 'تم نشر الخبر' });
  } else {
    if (req.file) removeUploaded('/uploads/' + req.file.filename);
    setFlash(res, { type: 'error', message: 'أدخل عنواناً ونصاً للخبر' });
  }
  res.redirect('/settings/news');
});

router.post('/settings/news/:id/edit', uploadAndStore('image'), async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const acadId = req.currentUser.impersonatingAcademyId || req.currentUser.academy_id;
  const old = await db.prepare('SELECT * FROM announcements WHERE id = ? AND academy_id = ?').get(id, acadId);
  if (!old) { setFlash(res, { type: 'error', message: 'الخبر غير موجود' }); return res.redirect('/settings/news'); }
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  let image = old.image;
  if (req.file) {
    if (old.image) removeUploaded(old.image);
    image = '/uploads/' + req.file.filename;
  } else if (req.body.remove_image === '1') {
    if (old.image) removeUploaded(old.image);
    image = null;
  }
  const isPublic = req.body.is_public ? 1 : 0;
  if (title && body) {
    await db.prepare('UPDATE announcements SET title = ?, body = ?, image = ?, is_public = ? WHERE id = ?')
      .run(title, body, image, isPublic, id);
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'announcements', id, 'تعديل خبر: ' + title, req);
    setFlash(res, { type: 'success', message: 'تم تحديث الخبر' });
  } else {
    if (req.file) removeUploaded('/uploads/' + req.file.filename);
    setFlash(res, { type: 'error', message: 'أدخل عنواناً ونصاً للخبر' });
  }
  res.redirect('/settings/news');
});

router.post('/settings/news/:id/delete', async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const acadId = req.currentUser.impersonatingAcademyId || req.currentUser.academy_id;
  const old = await db.prepare('SELECT image FROM announcements WHERE id = ? AND academy_id = ?').get(id, acadId);
  if (old && old.image) removeUploaded(old.image);
  await db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'announcements', id, 'حذف خبر', req);
  setFlash(res, { type: 'success', message: 'تم حذف الخبر' });
  res.redirect('/settings/news');
});

/* ============================================================== */
const ACTIONS = [
  { value: 'add', label: 'إضافة' }, { value: 'edit', label: 'تعديل' }, { value: 'delete', label: 'حذف' }, { value: 'login', label: 'دخول' }
];
router.get('/audit-log', async function (req, res) {
  if (!canView(req.currentUser, 'auditLog')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300').all();
  const page = {
    title: 'سجل النشاط', subtitle: 'آخر عمليات النظام', icon: 'fa-clock-rotate-left', module: 'auditLog', active: 'auditLog',
    columns: [
      { key: 'created_at', label: 'الوقت', html: row => fmtDateTime(row.created_at) },
      { key: 'user_name', label: 'المستخدم' },
      { key: 'action', label: 'العملية', html: row => `<span class="badge ${row.action === 'add' ? 'badge-success' : row.action === 'edit' ? 'badge-warning' : row.action === 'delete' ? 'badge-danger' : 'badge-primary'}">${row.action === 'add' ? 'إضافة' : row.action === 'edit' ? 'تعديل' : row.action === 'delete' ? 'حذف' : 'دخول'}</span>` },
      { key: 'entity', label: 'الوحدة', html: row => `<span class="badge badge-gray">${row.entity}</span>` },
      { key: 'details', label: 'التفاصيل' },
      { key: 'ip', label: 'IP' }
    ],
    rows,
    filters: [{ name: 'action', label: 'العملية', options: ACTIONS }]
  };
  res.render('list', { page });
});

module.exports = router;
