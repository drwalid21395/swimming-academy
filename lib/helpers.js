/** أدوات مساعدة عامة: التشفير، الصلاحيات، سجل النشاط، التنسيق */
const crypto = require('node:crypto');
const { db } = require('./db');

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

/* ---------- سجل النشاط ---------- */
function audit(userId, userName, action, entity, entityId, details, req) {
  db.prepare(`INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, details, ip)
      VALUES (?,?,?,?,?,?,?)`)
    .run(userId, userName, action, entity, entityId, details || '', req && req.ip ? req.ip : '')
    .catch(() => { });
}

/* ---------- صلاحيات ---------- */
const MODULES = [
  'dashboard', 'swimmers', 'guardians', 'coaches', 'staff',
  'programs', 'levels', 'groups', 'sessions', 'attendance',
  'assessments', 'tests', 'teams', 'competitions',
  'subscriptions', 'payments', 'revenues', 'expenses', 'coachPayments',
  'incoming', 'outgoing', 'documents', 'notifications', 'complaints',
  'reports', 'branches', 'pools', 'schools', 'users', 'settings', 'auditLog', 'site',
  'trainerAttendance', 'staffAttendance', 'payroll'
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

/* ---------- محولات JSON ---------- */
function parseJSON(str, fallback) {
  if (str === null || str === undefined || str === '') return fallback;
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

module.exports = {
  hashPassword, verifyPassword,
  money, fmtMoney, today, calcAge, fmtDate, fmtDateTime,
  dayAr, daysAgo, daysAhead, pct,
  audit, MODULES, defaultPermissions, getPermissions,
  can, canView, canAdd, canEdit, canDel, canExport, requirePerm,
  parseJSON
};
