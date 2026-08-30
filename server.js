/** نقطة التشغيل الرئيسية لنظام إدارة أكاديمية السباحة */
const path = require('node:path');
const express = require('express');
const { db, client, ready } = require('./lib/db');
const { canView, canAdd, canEdit, canDel, canExport, money, fmtDate, fmtDateTime, dayAr, calcAge, pct, parseJSON } = require('./lib/helpers');
const { getAuth, takeFlash } = require('./lib/auth-cookie');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
if (IS_PROD) app.set('view cache', true);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '12mb' }));

/* الملفات الثابتة + المرفقات المخزنة داخل قاعدة البيانات */
app.use(express.static(path.join(__dirname, 'public')));
app.get('/uploads/:name', async function (req, res) {
  try {
    if (req.query.dl === '1') {
      const u = req.currentUser || await currentUser(req);
      const ok = u && (u.user_type === 'system' || canExport(u, 'documents') || canExport(u, 'incoming') || canExport(u, 'outgoing') || canExport(u, 'coaches') || canExport(u, 'staff'));
      if (!ok) return res.status(403).send('غير مصرح بالتحميل');
    }
    const row = await db.prepare('SELECT mime, data FROM file_blobs WHERE name = ?').get(String(req.params.name));
    if (!row) {
      /* الرجوع للملفات القديمة على القرص */
      const p = path.join(__dirname, 'uploads', path.basename(String(req.params.name)));
      if (require('node:fs').existsSync(p)) return res.sendFile(p);
      return res.status(404).send('الملف غير موجود');
    }
    if (row.mime) res.setHeader('Content-Type', row.mime);
    if (IS_PROD && req.get('Origin')) res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(Buffer.from(row.data));
  } catch (e) { res.status(500).send('خطأ في جلب الملف'); }
});

async function currentUser(req) {
  const uid = getAuth(req);
  if (!uid) return null;
  try {
    const u = await db.prepare('SELECT * FROM users WHERE id = ?').get(Number(uid));
    if (!u || u.status !== 'active') return null;
    const role = await db.prepare('SELECT * FROM roles WHERE id = ?').get(u.role_id);
    u.role_name = role ? role.name : u.user_type;
    let perms = {};
    try { perms = JSON.parse((role && role.permissions) || '{}'); } catch (e) { perms = {}; }
    /* الصلاحيات الفردية للمستخدم تتجاوز صلاحيات دوره (لكل وحدة وإجراء على حدة) */
    try {
      const own = JSON.parse(u.permissions || '{}');
      Object.entries(own).forEach(([m, actions]) => {
        if (!actions || typeof actions !== 'object') return;
        perms[m] = perms[m] || {};
        Object.entries(actions).forEach(([a, v]) => { perms[m][a] = v ? 1 : 0; });
      });
    } catch (e) { /* تجاهل */ }
    if (u.user_type === 'system') {
      perms = {};
      const MODULES = require('./lib/helpers').MODULES;
      MODULES.forEach(m => { perms[m] = { view: 1, add: 1, edit: 1, del: 1, export: 1 }; });
    }
    u.perms = perms;
    return u;
  } catch (e) { return null; }
}

/* توفير المتغيرات العامة لكل الصفحات */
app.use(async function (req, res, next) {
  try {
    await ready();
    res.set('Cache-Control', 'no-store');
    const settingsRows = await db.all('SELECT * FROM settings');
    const settings = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });
    res.locals.siteName = settings.site_name || 'أكاديمية السباحة';
    res.locals.siteLogo = settings.site_logo || '';
    res.locals.settings = settings;
    res.locals.canView = canView;
    res.locals.canAdd = canAdd;
    res.locals.canEdit = canEdit;
    res.locals.canDel = canDel;
    res.locals.canExport = canExport;
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
    res.locals.flash = takeFlash(req, res);
    const user = await currentUser(req);
    res.locals.user = user;
    res.locals.isAuth = !!user;
    if (user) {
      const ur = await db.prepare('SELECT COUNT(*) c FROM notification_recipients r JOIN notifications n ON n.id = r.notification_id WHERE r.user_id = ? AND r.is_read = 0').get(user.id);
      res.locals.unreadCount = ur.c;
    }
    req.currentUser = user;
    next();
  } catch (err) { next(err); }
});

/* منع الوصول للوحة بدون تسجيل دخول */
app.use(function (req, res, next) {
  const publicPaths = ['/login', '/site', '/api/site'];
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

/* التهيئة عند بدء التشغيل المحلي (على Vercel تعمل تلقائياً مع أول طلب) */
ready().then(() => {
  if (!process.env.VERCEL) {
    app.listen(PORT, () => {
      console.log('============================================');
      console.log('  نظام إدارة أكاديمية السباحة يعمل الآن');
      console.log('  الرابط:  http://localhost:' + PORT);
      console.log('  قاعدة البيانات: ' + (process.env.DB_URL || 'محلي (data.db)'));
      console.log('============================================');
    });
  }
}).catch(e => {
  console.error('تعذر تشغيل النظام:', e.message);
  process.exit(1);
});

module.exports = app;
