/** نقطة التشغيل الرئيسية لنظام إدارة أكاديمية السباحة */
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { db } = require('./lib/db');
const { canView, canAdd, canEdit, canDel, money, fmtDate, fmtDateTime, dayAr, calcAge, pct, parseJSON } = require('./lib/helpers');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
if (IS_PROD) app.set('view cache', true);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'swim-academy-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 12, httpOnly: true, sameSite: 'lax', secure: IS_PROD }
}));

/* تهيئة البيانات التجريبية تلقائياً عند أول تشغيل (قاعدة بيانات فارغة) */
try {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
    console.log('قاعدة بيانات فارغة — جاري تهيئة البيانات التجريبية...');
    require('./db/seed');
  }
} catch (e) { console.error('تعذر فحص/تهيئة قاعدة البيانات:', e.message); }

function loadSettings() {
  const s = {};
  try { db.prepare('SELECT * FROM settings').all().forEach(r => { s[r.key] = r.value; }); } catch (e) { }
  return s;
}

function currentUser(req) {
  if (!req.session.userId) return null;
  try {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!u || u.status !== 'active') return null;
    const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(u.role_id);
    u.role_name = role ? role.name : u.user_type;
    return u;
  } catch (e) { return null; }
}

/* توفير المتغيرات العامة لكل الصفحات */
app.use(function (req, res, next) {
  res.set('Cache-Control', 'no-store');
  const settings = loadSettings();
  res.locals.siteName = settings.site_name || 'أكاديمية السباحة';
  res.locals.siteLogo = settings.site_logo || '';
  res.locals.settings = settings;
  res.locals.canView = canView;
  res.locals.canAdd = canAdd;
  res.locals.canEdit = canEdit;
  res.locals.canDel = canDel;
  res.locals.money = money;
  res.locals.fmtDate = fmtDate;
  res.locals.fmtDateTime = fmtDateTime;
  res.locals.dayAr = dayAr;
  res.locals.calcAge = calcAge;
  res.locals.pct = pct;
  res.locals.parseJSON = parseJSON;
  res.locals.statusBadge = function (st) {
    const map = { 'نشط': ['badge-success', 'fa-user-check'], 'متوقف مؤقتاً': ['badge-warning', 'fa-pause'], 'مجمد': ['badge-info', 'fa-snowflake'], 'منسحب': ['badge-danger', 'fa-user-minus'], 'خريج': ['badge-purple', 'fa-graduation-cap'] };
    const m = map[st] || ['badge-gray', 'fa-circle'];
    return `<span class="badge ${m[0]}"><i class="fas ${m[1]}"></i> ${st}</span>`;
  };
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  const user = currentUser(req);
  res.locals.user = user;
  res.locals.isAuth = !!user;
  if (user) {
    res.locals.unreadCount = db.prepare('SELECT COUNT(*) c FROM notification_recipients r JOIN notifications n ON n.id = r.notification_id WHERE r.user_id = ? AND r.is_read = 0').get(user.id).c;
  }
  req.currentUser = user;
  req.session.user = user;
  next();
});

/* منع الوصول للوحة بدون تسجيل دخول */
app.use(function (req, res, next) {
  const publicPaths = ['/login', '/forgot-password', '/site', '/api/site'];
  if (publicPaths.some(p => req.path.startsWith(p))) return next();
  if (!req.currentUser) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'غير مصرح' });
    return res.redirect('/login');
  }
  next();
});

/* ======================= توجيه الوحدات ======================= */
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/swimmers'));
app.use('/', require('./routes/programs'));
app.use('/', require('./routes/schedule'));
app.use('/', require('./routes/coaching'));
app.use('/', require('./routes/finance'));
app.use('/', require('./routes/correspondence'));
app.use('/', require('./routes/admin'));
app.use('/', require('./routes/schools'));
app.use('/', require('./routes/reports'));
app.use('/site', require('./routes/site'));

app.use(function (req, res) {
  res.status(404).render('errors/404', { layout: false, user: res.locals.user, siteName: res.locals.siteName });
});
app.use(function (err, req, res, next) {
  console.error(err);
  res.status(500).send('حدث خطأ داخلي في النظام: ' + err.message);
});

app.listen(PORT, () => {
  console.log('============================================');
  console.log('  نظام إدارة أكاديمية السباحة يعمل الآن');
  console.log('  الرابط:  http://localhost:' + PORT);
  console.log('  الموقع التعريفي:  /site');
  console.log('============================================');
});
