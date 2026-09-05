/** نقطة التشغيل الرئيسية لنظام إدارة أكاديمية السباحة */
const path = require('node:path');
const express = require('express');
const { db, client, ready } = require('./lib/db');
const { canView, canAdd, canEdit, canDel, canExport, money, fmtDate, fmtDateTime, dayAr, calcAge, pct, parseJSON, today } = require('./lib/helpers');
const { getAuth, takeFlash, getCookie } = require('./lib/auth-cookie');
const { getAcademy, getActiveSubscription, subscriptionStatus, academyRestricted, academyPlanPerms, ACTIONS } = require('./lib/tenant');
const { withAcademy } = require('./lib/tenant-context');
const { securityHeaders, stripServerHeader, csrfProtect } = require('./lib/security');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

/* حماية من تجمّد النظام كلياً: أي خطأ غير متعامل معاه في requests
   (والذي لا يلتقطه Express 4 من الـ async handlers) كان سيقفل العملية،
   فيُسجَّل ويُستكمل بدلاً من أن يتوقف الموقع كله. */
process.on('unhandledRejection', function (reason) {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', function (err) {
  console.error('[uncaughtException]', err);
});

app.set('trust proxy', 1);
if (IS_PROD) app.set('view cache', true);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '12mb' }));

/* الترويسات الأمنية على كل الردود (بما فيها الملفات الثابتة) */
app.use(stripServerHeader);
app.use(securityHeaders);

/* دفاع إضافي ضد CSRF: طلبات من أصل مختلف تُرفض (لا يؤثر على نفس الأصل) */
app.use(csrfProtect);

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
    u.academy_id = u.academy_id ? Number(u.academy_id) : 1;
    u.is_super = u.user_type === 'system';
    /* فرض صلاحيات خطة الأكاديمية على مستخدمي الأكاديميات (non-system).
       صلاحيات الخطة = تقاطع مع صلاحيات المستخدم/الدور: أي وحدة/إجراء غير مفعّل
       بالخطة يُغلق حتى لو كان مفعلاً للمستخدم. الأكاديمية الأساسية premium
       والدخول بالنيابة (Super Admin) لا يخضعان للقيود. */
    if (!u.is_super) {
      try {
        const planPerms = await academyPlanPerms(u.academy_id);
        if (planPerms) {
          Object.keys(perms).forEach(function (m) {
            const planActions = planPerms[m] || {};
            ACTIONS.forEach(function (a) {
              if (perms[m] && typeof perms[m][a] !== 'undefined') {
                perms[m][a] = (perms[m][a] && planActions[a]) ? 1 : 0;
              }
            });
          });
        }
      } catch (e) { /* تجاهل: لا نقيّد عند خطأ */ }
    }
    /* وضع الدخول بالنيابة (Super Admin فقط): أقصد من أكاديمية محددة للدعم الفني */
    u.impersonatingAcademyId = null;
    u.impersonatingAcademy = null;
    if (u.is_super) {
      const impRaw = getCookie(req, 'swim_imp');
      if (impRaw) {
        const impAcademy = await getAcademy(impRaw);
        if (impAcademy) {
          u.impersonatingAcademyId = impAcademy.id;
          u.impersonatingAcademy = impAcademy;
        }
      }
    }
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
    res.locals._permCanEdit = canEdit;
    res.locals.canDel = canDel;
    res.locals.canExport = canExport;
    res.locals.money = money;
    res.locals.fmtDate = fmtDate;
    res.locals.fmtDateTime = fmtDateTime;
    res.locals.dayAr = dayAr;
    res.locals.calcAge = calcAge;
    res.locals.pct = pct;
    res.locals.today = today;
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
    res.locals.isSuper = !!(user && user.is_super);
    res.locals.currentPath = req.path;
    /* سياق الأكاديمية: الأكاديمية الأساسية، أو المستهدف عند الدخول بالنيابة */
    let academy = null;
    let subInfo = null;
    if (user) {
      const acadId = user.impersonatingAcademyId || user.academy_id;
      academy = await getAcademy(acadId);
      if (academy) {
        const sub = await getActiveSubscription(academy.id);
        subInfo = subscriptionStatus(sub);
      }
    }
    res.locals.academy = academy;
    res.locals.academyId = academy ? academy.id : (user ? user.academy_id : null);
    res.locals.impersonating = user && user.impersonatingAcademy;
    res.locals.subInfo = subInfo;
    res.locals.academyRestricted = academy ? academyRestricted(academy, subInfo) : false;
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

/* عزل متعدد الأكاديميات: يفعّل withAcademy(...) لجميع طلبات الأكاديمية.
   يُستثنى: مسارات المنصة (/platform)، والمسارات العامة، ومستخدمي النظام
   غير الداخلين بالنيابة (يرون كل شيء على مستوى المنصة). */
app.use(function (req, res, next) {
  const u = req.currentUser;
  if (!u) return next();
  if (req.path.startsWith('/platform')) return next();
  if (req.path.startsWith('/site') || req.path.startsWith('/api/site') || req.path === '/login') return next();
  if (u.is_super && !u.impersonatingAcademyId) return next();
  const acadId = u.impersonatingAcademyId || u.academy_id;
  return withAcademy(acadId, next);
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
app.use('/', require('./routes/attendance'));
app.use('/site', require('./routes/site'));
app.use('/', require('./routes/platform'));

app.use(function (req, res) {
  res.status(404).render('errors/404', { layout: false, user: res.locals.user, siteName: res.locals.siteName });
});
app.use(function (err, req, res, next) {
  /* لا نكشف تفاصيل الخطأ للمستخدم (تُسجَّل داخلياً فقط) */
  console.error('[error]', req.method, req.url, err && err.message, err && err.stack);
  res.status(500).send('حدث خطأ داخلي في النظام، يرجى المحاولة لاحقاً.');
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
