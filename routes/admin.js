/** الإدارة: المستخدمون، الأدوار والصلاحيات، الإعدادات، سجل النشاط */
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { db } = require('../lib/db');
const { audit, money, fmtDate, fmtDateTime, today, canView, canAdd, canEdit, canDel, hashPassword, MODULES } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const { upload, uploadAndStore, removeUploaded } = require('../lib/upload');
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
  auditLog: 'سجل النشاط', site: 'الموقع التعريفي'
};
const MODULE_GROUPS = [
  ['الأعضاء والتسجيل', ['swimmers', 'guardians', 'coaches', 'staff']],
  ['البرامج التدريبية', ['programs', 'levels', 'groups']],
  ['الجداول والحضور', ['sessions', 'attendance']],
  ['الجوانب الفنية', ['assessments', 'tests', 'teams', 'competitions']],
  ['المالية', ['subscriptions', 'payments', 'revenues', 'expenses', 'coachPayments']],
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
    headerActions: [
      { label: 'طلبات كلمة المرور', icon: 'fa-key', href: '/password-requests' }
    ],
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

/* ============ طلبات تغيير كلمة المرور (الإشعار يصل للمدير فقط) ============ */
router.get('/password-requests', async function (req, res) {
  if (!canView(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare('SELECT * FROM password_reset_requests ORDER BY id DESC LIMIT 300').all();
  const page = {
    title: 'طلبات تغيير كلمة المرور', subtitle: 'وصلت عبر «نسيت كلمة المرور» — تغيير كلمة المرور يتم منك أنت فقط', icon: 'fa-key', module: 'users', active: 'users',
    columns: [
      { key: 'username', label: 'اسم المستخدم', html: row => `<b>${row.username || '—'}</b>` },
      { key: 'full_name', label: 'الاسم' },
      { key: 'note', label: 'ملاحظات', html: row => `<span class="text-soft font-11">${row.note || ''}</span>` },
      { key: 'notified_email', label: 'بريد الإشعار', html: row => `<span dir="ltr" class="font-11">${row.notified_email || '—'}</span>` },
      { key: 'email_status', label: 'البريد', html: row => row.email_status === 'sent' ? `<span class="badge badge-success">أُرسل</span>` : row.email_status === 'failed' ? `<span class="badge badge-danger">فشل</span>` : '—' },
      { key: 'wa_status', label: 'واتساب', html: row => row.wa_status === 'api' ? `<span class="badge badge-success">أُرسل</span>` : row.wa_status === 'link' ? `<span class="badge badge-warning">رابط</span>` : row.wa_status === 'none' || row.wa_status === 'failed' ? `<span class="badge badge-danger">فشل</span>` : '—' },
      { key: 'error', label: 'تفاصيل', html: row => `<span class="text-soft font-11">${row.error || ''}</span>` },
      { key: 'ip', label: 'الآيبي', html: row => `<span dir="ltr" class="font-11">${row.ip || '—'}</span>` },
      { key: 'status', label: 'الحالة', html: row => `<span class="badge ${row.status === 'pending' ? 'badge-warning' : row.status === 'rejected' ? 'badge-danger' : 'badge-success'}">${row.status === 'pending' ? 'معلق' : row.status === 'rejected' ? 'مرفوض' : 'تمت المعالجة'}</span>` },
      { key: 'created_at', label: 'التوقيت', html: row => fmtDateTime(row.created_at) }
    ],
    rows,
    filters: [
      { name: 'status', label: 'الحالة', options: [{ value: 'pending', label: 'معلق' }, { value: 'done', label: 'تمت المعالجة' }, { value: 'rejected', label: 'مرفوض' }] }
    ],
    actions: () => row => row.status === 'pending' ? [
      { label: 'تغيير كلمة المرور', icon: 'fa-user-shield', href: '/users' },
      { label: 'تمت المعالجة', icon: 'fa-check', href: '/password-requests/' + row.id + '/done', confirm: 'تحديد هذا الطلب كمُعالَج؟' }
    ] : []
  };
  res.render('list', { page });
});
router.post('/password-requests/:id/done', async function (req, res) {
  if (!canEdit(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  await db.prepare("UPDATE password_reset_requests SET status='done' WHERE id=?").run(Number(req.params.id));
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'password', Number(req.params.id), 'معالجة طلب تغيير كلمة المرور', req);
  setFlash(res, { type: 'success', message: 'تم تحديث حالة الطلب' });
  res.redirect('/password-requests');
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
  await db.prepare('DELETE FROM users WHERE id=?').run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'users', id, 'حذف مستخدم', req);
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
  { key: 'whatsapp_country_code', label: 'مفتاح دولة الواتساب (مثال: 20 لمصر)', type: 'text', section: 'إعدادات الواتساب' },
  { key: 'whatsapp_api_token', label: 'رمز API للواتساب (WhatsApp Cloud API)', type: 'text', section: 'إعدادات الواتساب' },
  { key: 'whatsapp_phone_id', label: 'معرّف رقم الهاتف (Phone Number ID)', type: 'text', section: 'إعدادات الواتساب' },
  { key: 'whatsapp_auto_send', label: 'الإرسال التلقائي عند انتهاء الاشتراك (1 = مفعل / 0 = معطل)', type: 'text', section: 'إعدادات الواتساب' },
  { key: 'notify_email', label: 'بريد إشعارات المدير (طلبات تغيير كلمة المرور)', type: 'email', section: 'إشعارات' },
  { key: 'resend_api_key', label: 'رمز Resend API (لإرسال بريد من Vercel) — من resend.com', type: 'password', section: 'إشعارات' },
  { key: 'resend_from', label: 'عنوان المُرسل Resend (مثال: admin@your-domain.com، ويفضّل تفعيل Domain هناك)', type: 'email', section: 'إشعارات' }
];
router.get('/settings', async function (req, res) {
  if (!canView(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const current = {};
  (await db.prepare('SELECT * FROM settings').all()).forEach(r => { current[r.key] = r.value; });
  res.render('settings', { title: 'إعدادات النظام', active: 'settings', defs: SETTING_DEFS, current,
    canEdit: canEdit(req.currentUser, 'settings') });
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
/*                         سجل النشاط                             */
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
