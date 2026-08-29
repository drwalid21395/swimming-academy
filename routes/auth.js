/** المصادقة والحساب الشخصي والبحث السريع */
const express = require('express');
const { db } = require('../lib/db');
const { hashPassword, verifyPassword, audit, money, fmtDate, calcAge } = require('../lib/helpers');
const { setAuth, clearAuth, setFlash } = require('../lib/auth-cookie');
const router = express.Router();

/* ---------- تسجيل الدخول ---------- */
router.get('/login', function (req, res) {
  if (req.currentUser) return res.redirect('/');
  res.render('auth/login', { error: '', layout: false, user: null, siteName: res.locals.siteName });
});
router.post('/login', async function (req, res) {
  const { username, password } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!user || !verifyPassword(password || '', user.password_hash)) {
    return res.render('auth/login', { error: 'اسم المستخدم أو كلمة المرور غير صحيحة', layout: false, user: null, siteName: res.locals.siteName });
  }
  if (user.status === 'disabled') {
    return res.render('auth/login', { error: 'هذا الحساب معطّل، تواصل مع مدير النظام', layout: false, user: null, siteName: res.locals.siteName });
  }
  setAuth(res, user.id);
  await db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?").run(user.id);
  audit(user.id, user.full_name, 'login', 'auth', user.id, 'تسجيل دخول', req);
  const role = await db.prepare('SELECT * FROM roles WHERE id = ?').get(user.role_id);
  const base = role && (role.name === 'ولي الأمر' || role.name === 'السباح أو اللاعب') ? '/my-portal' : '/';
  res.redirect(base);
});

router.get('/logout', function (req, res) {
  if (req.currentUser) audit(req.currentUser.id, req.currentUser.full_name, 'logout', 'auth', req.currentUser.id, 'تسجيل خروج', req);
  clearAuth(res);
  res.redirect('/login');
});

/* ---------- نسيان كلمة المرور (محاكاة إرسال) ---------- */
router.get('/forgot-password', function (req, res) {
  res.render('auth/forgot', { message: '', layout: false, user: null, siteName: res.locals.siteName });
});
router.post('/forgot-password', function (req, res) {
  const { username } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username || '', username || '');
  res.render('auth/forgot', { message: user ? 'تم إرسال رابط استعادة كلمة المرور إلى حسابك. (في الوضع التجريبي تُعاد التعيين إلى 123456)' : 'لم يتم العثور على حساب بهذه البيانات.', layout: false, user: null, siteName: res.locals.siteName });
});

/* ---------- الحساب الشخصي ---------- */
router.get('/profile', function (req, res) {
  const user = req.currentUser;
  const profile = {
    username: user.username,
    full_name: user.full_name,
    email: user.email,
    phone: user.phone,
    role_name: user.role_name,
    last_login: user.last_login
  };
  const items = [
    ['اسم المستخدم', profile.username], ['الاسم الكامل', profile.full_name],
    ['البريد الإلكتروني', profile.email || '—'], ['رقم الهاتف', profile.phone || '—'],
    ['الدور', profile.role_name], ['آخر دخول', fmtDate(profile.last_login)]
  ];
  res.render('detail', { page: { title: 'حسابي', icon: 'fa-user', active: '', fields: items.map(f => ({ label: f[0], value: f[1] })), backUrl: '/', canEdit: false } });
});
router.post('/profile/password', async function (req, res) {
  const { current, password } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.currentUser.id);
  if (!verifyPassword(current || '', user.password_hash)) {
    setFlash(res, { type: 'error', message: 'كلمة المرور الحالية غير صحيحة' });
  } else {
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
    setFlash(res, { type: 'success', message: 'تم تغيير كلمة المرور بنجاح' });
    audit(user.id, user.full_name, 'edit', 'users', user.id, 'تغيير كلمة المرور', req);
  }
  res.redirect('/profile');
});

/* ---------- البحث السريع ---------- */
router.get('/search', async function (req, res) {
  const q = (req.query.q || '').trim();
  const results = { swimmers: [], guardians: [], coaches: [], programs: [], groups: [] };
  if (q) {
    const like = '%' + q + '%';
    results.swimmers = await db.prepare(`SELECT s.*, g.full_name AS guardian_name, l.name AS level_name FROM swimmers s
      LEFT JOIN guardians g ON g.id = s.guardian_id LEFT JOIN levels l ON l.id = s.level_id
      WHERE s.full_name LIKE ? OR s.membership_no LIKE ? OR s.phone LIKE ? OR g.full_name LIKE ? LIMIT 12`).all(like, like, like, like);
    results.guardians = await db.prepare('SELECT * FROM guardians WHERE full_name LIKE ? OR phone LIKE ? LIMIT 8').all(like, like);
    results.coaches = await db.prepare('SELECT * FROM coaches WHERE full_name LIKE ? OR phone LIKE ? LIMIT 8').all(like, like);
    results.programs = await db.prepare('SELECT * FROM programs WHERE name LIKE ? LIMIT 8').all(like);
    results.groups = await db.prepare('SELECT * FROM groups WHERE name LIKE ? LIMIT 8').all(like);
  }
  res.render('search', { q, results, title: 'نتائج البحث', active: 'dashboard' });
});

module.exports = router;
