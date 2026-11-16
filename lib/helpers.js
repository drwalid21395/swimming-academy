/** أدوات مساعدة عامة: التشفير، الصلاحيات، سجل النشاط، التنسيق */
const crypto = require('node:crypto');
const { db } = require('./db');
const { sendPushToUsers } = require('./push');

/* ---------- تشفير كلمات المرور (scrypt) ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

/* ---------- تنسيقات عربية ---------- */
function money(n) {
  if (n === null || n === undefined || isNaN(n)) n = 0;
  return Number(n).toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ج.م';
}
function fmtMoney(n) { return Number(n || 0).toFixed(2); }
function today() { return new Date().toISOString().slice(0, 10); }

function calcAge(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (isNaN(b)) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

function fmtDate(d) {
  if (!d) return '—';
  const date = new Date(String(d));
  if (isNaN(date)) return String(d);
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  const date = new Date(String(d).replace(' ', 'T'));
  if (isNaN(date)) return String(d);
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }) + ' ' + date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

const AR_DAYS = { sunday: 'الأحد', monday: 'الإثنين', tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس', friday: 'الجمعة', saturday: 'السبت' };
function dayAr(day) { return AR_DAYS[day] || day; }

function daysAgo(days) {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function daysAhead(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

/* ---------- سجل النشاط وإشعارات النشاط ---------- */
/* أنشطة تُحوَّل إلى إشعارات صوتية للمستخدمين المصرَّح لهم.
   لا نُنشئ إشعارات للدخول/الخروج ولا للكيانات التي ترسل إشعاراً مباشراً
   بالفعل (الإشعارات، الحجوزات، الشكاوى) ولا لسجل النشاط نفسه. */
const ACTIVITY_ACTIONS = ['add', 'edit', 'delete', 'approve_payment', 'reject_payment', 'renew', 'restore', 'cancel'];
const ACTIVITY_SKIP_ENTITIES = ['auth', 'notifications', 'audit_log', 'auditLog', 'reservations', 'complaints'];
const ACTIVITY_ACTION_AR = {
  add: 'إضافة', edit: 'تعديل', delete: 'حذف', approve_payment: 'اعتماد دفعة',
  reject_payment: 'رفض دفعة', renew: 'تجديد', restore: 'استعادة', cancel: 'إلغاء'
};
const ACTIVITY_ENTITY_AR = {
  swimmers: 'اللاعبين', guardians: 'أولياء الأمور', coaches: 'الكباتن والمدربين', staff: 'الموظفين',
  programs: 'البرامج', levels: 'المستويات', groups: 'المجموعات', sessions: 'الحصص',
  attendance: 'الحضور', assessments: 'التقييمات', tests: 'الاختبارات', teams: 'الفرق',
  competitions: 'البطولات', membershipCards: 'بطاقات العضوية', subscriptions: 'الاشتراكات',
  payments: 'المدفوعات', revenues: 'الإيرادات', expenses: 'المصروفات',
  coachPayments: 'مستحقات المدربين', coach_payments: 'مستحقات المدربين', payroll: 'الرواتب',
  incoming: 'الوارد', outgoing: 'الصادر', documents: 'المستندات', sports: 'الألعاب الرياضية',
  waterRentals: 'إيجار الميه', privateTraining: 'التدريب الخاص', reports: 'التقارير',
  branches: 'الفروع', pools: 'حمامات السباحة', schools: 'المدارس', users: 'المستخدمين',
  settings: 'الإعدادات', site: 'الموقع التعريفي', academy: 'بيانات الأكاديمية', plan: 'الخطط',
  trainerAttendance: 'حضور المدربين', staffAttendance: 'حضور الموظفين', whatsapp: 'واتساب'
};
const ACTIVITY_ENTITY_LINK = {
  swimmers: '/swimmers', guardians: '/guardians', coaches: '/coaches', staff: '/staff',
  programs: '/programs', levels: '/levels', groups: '/groups', sessions: '/sessions',
  attendance: '/sessions', assessments: '/assessments', tests: '/assessments', teams: '/teams',
  competitions: '/competitions', membershipCards: '/membership-cards', subscriptions: '/subscriptions',
  payments: '/payments', revenues: '/revenues', expenses: '/expenses',
  coachPayments: '/coach-payments', coach_payments: '/coach-payments', payroll: '/payroll',
  incoming: '/incoming', outgoing: '/outgoing', documents: '/documents', sports: '/sports',
  waterRentals: '/water-rentals', privateTraining: '/private-training', reports: '/reports',
  branches: '/branches', pools: '/pools', schools: '/schools', users: '/users',
  settings: '/settings', site: '/site', trainerAttendance: '/trainer-attendance',
  staffAttendance: '/staff-attendance'
};

/* دمج صلاحيات الدور مع الصلاحيات الفردية للمستخدم (نفس منطق تسجيل الدخول) */
function mergedPermissions(roleJson, ownJson) {
  let perms = {};
  try { perms = JSON.parse(roleJson || '{}') || {}; } catch (e) { perms = {}; }
  try {
    const own = JSON.parse(ownJson || '{}') || {};
    Object.keys(own).forEach(function (m) {
      const actions = own[m];
      if (!actions || typeof actions !== 'object') return;
      perms[m] = perms[m] || {};
      Object.keys(actions).forEach(function (a) { perms[m][a] = actions[a] ? 1 : 0; });
    });
  } catch (e) { /* تجاهل */ }
  return perms;
}

async function createActivityNotification(userId, userName, action, entity, entityId, details, req) {
  try {
    if (!ACTIVITY_ACTIONS.includes(action)) return;
    if (ACTIVITY_SKIP_ENTITIES.includes(entity)) return;

    let academyId = req && req.currentUser ? (req.currentUser.impersonatingAcademyId || req.currentUser.academy_id) : null;
    if (!academyId && userId) {
      const actor = await db.prepare('SELECT academy_id FROM users WHERE id = ?').get(Number(userId));
      academyId = actor && actor.academy_id;
    }
    academyId = Number(academyId) || 1;

    const entityAr = ACTIVITY_ENTITY_AR[entity] || entity || 'النظام';
    const actionAr = ACTIVITY_ACTION_AR[action] || action;
    const cleanDetails = String(details || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const title = actionAr + ' ' + entityAr + (entityId ? ' #' + entityId : '');
    const message = 'قام ' + (userName || 'مستخدم') + ' بـ' + actionAr +
      (entityId ? ' ' + entityAr + ' رقم ' + entityId : ' ' + entityAr) +
      (cleanDetails ? ': ' + cleanDetails : '');
    let link = ACTIVITY_ENTITY_LINK[entity] || '/notifications';
    if (entityId && link && link !== '/notifications' && link !== '/settings') link = link + '/' + entityId;

    /* منع تكرار الإشعارات لنفس النوع من نفس المستخدم خلال 30 ثانية
       (مثل حفظ حضور مجموعة كاملة الذي يولّد تعديلاً لكل لاعب). */
    const recent = await db.prepare(`SELECT id FROM notifications
      WHERE created_by = ? AND academy_id = ? AND title = ?
        AND created_at >= datetime('now','localtime','-30 seconds')
      ORDER BY id DESC LIMIT 1`).get(Number(userId), academyId, title);
    if (recent) return;

    /* المستخدمون النشطون في نفس الأكاديمية ممن يملكون صلاحية عرض الإشعارات
       وصلاحية استقبال صوت النشاط (النظام = كل الصلاحيات). */
    const candidates = await db.all(`SELECT u.id, u.user_type, u.permissions AS own_permissions,
        r.permissions AS role_permissions
      FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.status = 'active' AND u.id <> ? AND COALESCE(u.academy_id, 1) = ?`, Number(userId) || 0, academyId);
    const recipients = candidates.filter(function (u) {
      if (u.user_type === 'system') return true;
      const p = mergedPermissions(u.role_permissions, u.own_permissions);
      const notif = p.notifications || {};
      const sound = p.notifSound || {};
      return !!(notif.view && sound.view);
    }).map(function (u) { return u.id; });
    if (!recipients.length) return;

    const info = await db.prepare(`INSERT INTO notifications
      (title, message, type, link, is_broadcast, created_by, academy_id)
      VALUES (?,?,?,?,0,?,?)`)
      .run(title, message, 'تنبيه', link, Number(userId) || 0, academyId);

    const st = db.prepare('INSERT INTO notification_recipients (notification_id, user_id, academy_id) VALUES (?,?,?)');
    for (const rid of recipients) {
      try { await st.run(info.lastInsertRowid, rid, academyId); } catch (e) { /* تجاهل مستخدم */ }
    }
    const payload = { title: title, message: message, link: link, id: info.lastInsertRowid, tag: 'sw-activity-' + info.lastInsertRowid };
    sendPushToUsers(recipients, payload).catch(() => {});
  } catch (e) { /* لا نُفشل العملية الأصلية بسبب الإشعار */ }
}

function audit(userId, userName, action, entity, entityId, details, req) {
  db.prepare(`INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, details, ip)
      VALUES (?,?,?,?,?,?,?)`)
    .run(userId, userName, action, entity, entityId, details || '', req && req.ip ? req.ip : '')
    .catch(() => { });
  createActivityNotification(userId, userName, action, entity, entityId, details, req);
}

/* ---------- صلاحيات ---------- */
const MODULES = [
  'dashboard', 'swimmers', 'guardians', 'coaches', 'staff',
  'programs', 'levels', 'groups', 'sessions', 'attendance',
  'assessments', 'tests', 'teams', 'competitions',
  'membershipCards',
  'subscriptions', 'payments', 'revenues', 'expenses', 'coachPayments',
  'incoming', 'outgoing', 'documents', 'notifications', 'complaints',
  'reservations', 'sports', 'privateTraining', 'waterRentals',
  'reports', 'branches', 'pools', 'schools', 'users', 'settings', 'auditLog', 'site',
  'trainerAttendance', 'staffAttendance', 'payroll', 'notifSound'
];

function defaultPermissions(all) {
  const p = {};
  for (const m of MODULES) p[m] = all ? { view: 1, add: 1, edit: 1, del: 1, export: 1 } : { view: 0, add: 0, edit: 0, del: 0, export: 0 };
  return p;
}

function getPermissions(user) {
  if (!user) return {};
  if (user.perms) return user.perms;
  if (user.user_type === 'system') return defaultPermissions(true);
  return {};
}

function can(user, module, action) {
  if (!user) return false;
  if (user.user_type === 'system') return true;
  const perms = getPermissions(user);
  const p = perms[module] || { view: 0, add: 0, edit: 0, del: 0, export: 0 };
  return !!(p && p[action]);
}

function canView(user, module) { return can(user, module, 'view'); }
function canAdd(user, module) { return can(user, module, 'add'); }
function canEdit(user, module) { return can(user, module, 'edit'); }
function canDel(user, module) { return can(user, module, 'del'); }
function canExport(user, module) { return can(user, module, 'export'); }

function requirePerm(module, action) {
  return (req, res, next) => {
    if (req.currentUser && can(req.currentUser, module, action)) return next();
    if (req.currentUser) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
    return res.redirect('/login');
  };
}

/* ---------- أكواد تحويل الرواتب ---------- */
function normalizePhone(phone) { return String(phone || '').replace(/[^\d+]/g, ''); }
function buildTransferCode(tpl, phone, amount) {
  var code = String(tpl || '').trim() || '*9*7*{phone}*{amount}#';
  var amt = Number(amount || 0);
  var amtStr = (Math.round(amt * 100) % 100 === 0) ? String(Math.round(amt)) : amt.toFixed(2);
  code = code.replace(/\{phone\}/g, normalizePhone(phone)).replace(/\{amount\}/g, amtStr);
  return code;
}
function transferTelHref(code) { return 'tel:' + String(code || '').replace(/#/g, '%23'); }

/* ---------- مقارنة القيم لإشعارات التفاصيل ---------- */
function formatDiffValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

/* يبني نصاً يوضح الحقول التي تغيّرت: "الاسم: من أحمد إلى محمد | الهاتف: من — إلى 010" */
function buildDiff(oldObj, newObj, labels) {
  const parts = [];
  const oldObjSafe = oldObj || {};
  for (const key of Object.keys(newObj)) {
    if (key === 'id' || key === 'created_at' || key === 'updated_at' || key === 'deleted_at') continue;
    const oldVal = oldObjSafe[key];
    const newVal = newObj[key];
    if (oldVal === newVal) continue;
    if (oldVal == null && (newVal === '' || newVal === null || newVal === undefined)) continue;
    const label = (labels && labels[key]) || key;
    parts.push(label + ': من ' + formatDiffValue(oldVal) + ' إلى ' + formatDiffValue(newVal));
  }
  return parts.join(' | ').slice(0, 450);
}

/* ملخّص القيم الجديدة للإضافات: "الاسم: محمد | الهاتف: 010" */
function buildSummary(obj, labels) {
  const parts = [];
  for (const key of Object.keys(obj)) {
    if (key === 'id' || key === 'created_at' || key === 'updated_at' || key === 'deleted_at') continue;
    const v = obj[key];
    if (v === null || v === undefined || v === '') continue;
    const label = (labels && labels[key]) || key;
    parts.push(label + ': ' + formatDiffValue(v));
  }
  return parts.join(' | ').slice(0, 450);
}
function parseJSON(str, fallback) {
  if (str === null || str === undefined || str === '') return fallback;
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

module.exports = {
  hashPassword, verifyPassword,
  money, fmtMoney, today, calcAge, fmtDate, fmtDateTime,
  dayAr, daysAgo, daysAhead, pct,
  buildTransferCode, transferTelHref, normalizePhone,
  audit, MODULES, defaultPermissions, getPermissions,
  can, canView, canAdd, canEdit, canDel, canExport, requirePerm,
  buildDiff, buildSummary, formatDiffValue,
  parseJSON
};
