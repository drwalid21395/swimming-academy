/** الإدارة: المستخدمون، الأدوار والصلاحيات، الإعدادات، سجل النشاط */
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { db } = require('../lib/db');
const { audit, money, fmtDate, fmtDateTime, today, canView, canAdd, canEdit, canDel, hashPassword, MODULES } = require('../lib/helpers');
const { upload, removeUploaded } = require('../lib/upload');
const router = express.Router();

function getArr(key, fallback) {
  const v = (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) || {}).value;
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : fallback; } catch (e) { return fallback; }
}
function saveArr(key, arr) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(arr));
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
router.get('/users', function (req, res) {
  if (!canView(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = db.prepare(`SELECT u.*, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id ORDER BY u.id`).all();
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
      { name: 'role_id', label: 'الدور', options: db.prepare('SELECT * FROM roles ORDER BY id').all().map(r => ({ value: r.id, label: r.name })) },
      { name: 'user_type', label: 'النوع', options: [{ value: 'staff', label: 'موظف' }, { value: 'coach', label: 'مدرب' }, { value: 'guardian', label: 'ولي أمر' }, { value: 'swimmer', label: 'سباح' }] }
    ],
    canAdd: canAdd(req.currentUser, 'users'), addUrl: canAdd(req.currentUser, 'users') ? '/users/new' : null, addLabel: 'مستخدم جديد',
    actions: () => row => [
      { label: 'تعديل', icon: 'fa-pen', href: '/users/' + row.id + '/edit' },
      { label: 'إعادة كلمة المرور', icon: 'fa-key', href: '/users/' + row.id + '/reset', confirm: 'إعادة تعيين كلمة مرور هذا المستخدم إلى 123456؟' },
      { label: 'حذف', icon: 'fa-trash', href: '/users/' + row.id + '/delete', confirm: 'حذف المستخدم؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});

const userFields = function (values) {
  const roles = db.prepare('SELECT * FROM roles ORDER BY id').all().map(r => ({ value: r.id, label: r.name }));
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

router.get('/users/new', function (req, res) {
  if (!canAdd(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'مستخدم جديد', subtitle: 'إنشاء حساب في النظام', icon: 'fa-plus', active: 'users', action: '/users/new', fields: userFields({}), values: {}, submitLabel: 'إنشاء المستخدم', cancelUrl: '/users', csrf: '' } });
});
router.post('/users/new', function (req, res) {
  if (!canAdd(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const pass = b.password ? b.password : '123456';
  try {
    const info = db.prepare('INSERT INTO users (username, password_hash, full_name, email, phone, role_id, user_type, linked_id, status) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(b.username.trim(), hashPassword(pass), b.full_name.trim(), b.email || '', b.phone || '', b.role_id, b.user_type || 'staff', b.linked_id || 0, b.status || 'active');
    audit(req.currentUser.id, req.currentUser.full_name, 'add', 'users', info.lastInsertRowid, 'مستخدم جديد: ' + b.username, req);
    req.session.flash = { type: 'success', message: 'تم إنشاء المستخدم' };
    res.redirect('/users');
  } catch (e) {
    req.session.flash = { type: 'error', message: 'اسم المستخدم موجود مسبقاً' };
    res.redirect('/users/new');
  }
});
router.get('/users/:id/edit', function (req, res) {
  if (!canEdit(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/users');
  res.render('form', { form: { title: 'تعديل المستخدم', subtitle: row.full_name, icon: 'fa-pen', active: 'users', action: '/users/' + row.id + '/edit', fields: userFields(row), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/users', csrf: '' } });
});
router.post('/users/:id/edit', function (req, res) {
  if (!canEdit(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  if (b.password) {
    db.prepare('UPDATE users SET username=?, password_hash=?, full_name=?, email=?, phone=?, role_id=?, user_type=?, linked_id=?, status=? WHERE id=?')
      .run(b.username.trim(), hashPassword(b.password), b.full_name.trim(), b.email || '', b.phone || '', b.role_id, b.user_type || 'staff', b.linked_id || 0, b.status || 'active', id);
  } else {
    db.prepare('UPDATE users SET username=?, full_name=?, email=?, phone=?, role_id=?, user_type=?, linked_id=?, status=? WHERE id=?')
      .run(b.username.trim(), b.full_name.trim(), b.email || '', b.phone || '', b.role_id, b.user_type || 'staff', b.linked_id || 0, b.status || 'active', id);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'users', id, 'تعديل مستخدم: ' + b.username, req);
  req.session.flash = { type: 'success', message: 'تم حفظ التعديلات' };
  res.redirect('/users');
});
router.post('/users/:id/reset', function (req, res) {
  if (!canEdit(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword('123456'), Number(req.params.id));
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'users', Number(req.params.id), 'إعادة تعيين كلمة المرور', req);
  req.session.flash = { type: 'success', message: 'تم إعادة تعيين كلمة المرور إلى 123456' };
  res.redirect('/users');
});
router.post('/users/:id/delete', function (req, res) {
  if (!canDel(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  if (id === req.currentUser.id) { req.session.flash = { type: 'error', message: 'لا يمكنك حذف حسابك الحالي' }; return res.redirect('/users'); }
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'users', id, 'حذف مستخدم', req);
  res.redirect('/users');
});

/* ============================================================== */
/*                       الأدوار والصلاحيات                        */
/* ============================================================== */
router.get('/roles', function (req, res) {
  if (!canView(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const roles = db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS users_count FROM roles r ORDER BY r.id`).all();
  res.render('roles', { title: 'الأدوار والصلاحيات', active: 'users', roles, groups: MODULE_GROUPS, labels: MODULE_LABELS,
    canEdit: canEdit(req.currentUser, 'users') });
});
router.post('/roles/:id/permissions', function (req, res) {
  if (!canEdit(req.currentUser, 'users')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const perms = {};
  for (const m of MODULES) {
    perms[m] = {
      view: req.body[m + '_view'] ? 1 : 0,
      add: req.body[m + '_add'] ? 1 : 0,
      edit: req.body[m + '_edit'] ? 1 : 0,
      del: req.body[m + '_del'] ? 1 : 0
    };
  }
  db.prepare('UPDATE roles SET permissions=? WHERE id=?').run(JSON.stringify(perms), id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'roles', id, 'تحديث صلاحيات دور', req);
  req.session.flash = { type: 'success', message: 'تم تحديث صلاحيات الدور' };
  res.redirect('/roles');
});

/* ============================================================== */
/*                       إعدادات النظام                           */
/* ============================================================== */
const SETTING_DEFS = [
  { key: 'site_name', label: 'اسم الأكاديمية', type: 'text' },
  { key: 'site_slogan', label: 'الشعار النصي', type: 'text' },
  { key: 'phone', label: 'هاتف التواصل', type: 'tel' },
  { key: 'whatsapp', label: 'واتساب', type: 'tel' },
  { key: 'email', label: 'البريد الإلكتروني', type: 'email' },
  { key: 'address', label: 'العنوان', type: 'text' },
  { key: 'work_hours', label: 'مواعيد العمل', type: 'text' },
  { key: 'about', label: 'نبذة عن الأكاديمية', type: 'textarea' },
  { key: 'facebook', label: 'فيسبوك', type: 'text' },
  { key: 'instagram', label: 'انستغرام', type: 'text' },
  { key: 'tiktok', label: 'تيك توك', type: 'text' },
  { key: 'map_url', label: 'رابط الخريطة', type: 'text' },
  { key: 'safety_notes', label: 'إرشادات السلامة في الماء', type: 'textarea' }
];
router.get('/settings', function (req, res) {
  if (!canView(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const current = {};
  db.prepare('SELECT * FROM settings').all().forEach(r => { current[r.key] = r.value; });
  res.render('settings', { title: 'إعدادات النظام', active: 'settings', defs: SETTING_DEFS, current,
    canEdit: canEdit(req.currentUser, 'settings') });
});
router.post('/settings', function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const st = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)');
  for (const def of SETTING_DEFS) st.run(def.key, req.body[def.key] || '');
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'settings', 0, 'تحديث إعدادات النظام', req);
  req.session.flash = { type: 'success', message: 'تم حفظ الإعدادات' };
  res.redirect('/settings');
});

/* أنواع البرامج واختبارات التقييم (من الإعدادات) */
const TYPES_DEFS = [
  { key: 'program_types', label: 'أنواع البرامج', icon: 'fa-layer-group', placeholder: 'مثال: تعليمي، متقدم، ترميم، احترافي' },
  { key: 'test_types', label: 'أنواع الاختبارات', icon: 'fa-vial-circle-check', placeholder: 'مثال: مستوى، زمن، بطولة، عام' }
];
router.get('/settings/types', function (req, res) {
  if (!canView(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const types = {};
  for (const d of TYPES_DEFS) types[d.key] = getArr(d.key, []);
  res.render('settings_types', { title: 'أنواع البرامج والاختبارات', active: 'settings', types, defs: TYPES_DEFS, canEdit: canEdit(req.currentUser, 'settings') });
});
router.post('/settings/types/add', function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const key = String(req.body.key || '');
  const val = String(req.body.value || '').trim();
  const def = TYPES_DEFS.find(d => d.key === key);
  if (def && val) {
    const arr = getArr(key, []);
    if (!arr.includes(val)) {
      arr.push(val);
      saveArr(key, arr);
      audit(req.currentUser.id, req.currentUser.full_name, 'add', 'settings', 0, 'إضافة نوع: ' + val + ' (' + def.label + ')', req);
    }
  }
  req.session.flash = { type: 'success', message: 'تمت الإضافة' };
  res.redirect('/settings/types');
});
router.post('/settings/types/remove', function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const key = String(req.body.key || '');
  const val = String(req.body.value || '');
  const def = TYPES_DEFS.find(d => d.key === key);
  if (def && val) {
    const arr = getArr(key, []).filter(v => v !== val);
    saveArr(key, arr);
    audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'settings', 0, 'حذف نوع: ' + val + ' (' + def.label + ')', req);
  }
  req.session.flash = { type: 'success', message: 'تم الحذف' };
  res.redirect('/settings/types');
});

/* صور الواجهة الرئيسية */
router.get('/settings/images', function (req, res) {
  if (!canView(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const images = getArr('home_images', []);
  res.render('settings_images', { title: 'صور الواجهة الرئيسية', active: 'settings', images, canEdit: canEdit(req.currentUser, 'settings') });
});
router.post('/settings/images', function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  upload.single('image')(req, res, function (err) {
    if (err) { req.session.flash = { type: 'danger', message: 'فشل رفع الصورة: ' + err.message }; return res.redirect('/settings/images'); }
    const images = getArr('home_images', []);
    if (req.file) images.push(req.file.filename);
    saveArr('home_images', images);
    audit(req.currentUser.id, req.currentUser.full_name, 'add', 'settings', 0, 'إضافة صورة للواجهة', req);
    req.session.flash = { type: 'success', message: 'تم حفظ الصورة' };
    res.redirect('/settings/images');
  });
});
router.post('/settings/images/:id/delete', function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const idx = Number(req.params.id);
  const images = getArr('home_images', []);
  if (images[idx]) {
    removeUploaded(images[idx]);
    images.splice(idx, 1);
    saveArr('home_images', images);
    audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'settings', 0, 'حذف صورة من الواجهة', req);
  }
  req.session.flash = { type: 'success', message: 'تم حذف الصورة' };
  res.redirect('/settings/images');
});

/* ============================================================== */
/*                         سجل النشاط                             */
/* ============================================================== */
const ACTIONS = [
  { value: 'add', label: 'إضافة' }, { value: 'edit', label: 'تعديل' }, { value: 'delete', label: 'حذف' }, { value: 'login', label: 'دخول' }
];
router.get('/audit-log', function (req, res) {
  if (!canView(req.currentUser, 'auditLog')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300').all();
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
