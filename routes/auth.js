/** المصادقة والحساب الشخصي والبحث السريع */
const express = require('express');
const { db } = require('../lib/db');
const { hashPassword, verifyPassword, audit, money, fmtDate, calcAge } = require('../lib/helpers');
const { setAuth, clearAuth, setFlash } = require('../lib/auth-cookie');
const { scopedRateLimit } = require('../lib/security');
const router = express.Router();

/* حدود متدرّجة لمحاولات الدخول (حماية Brute-Force دون إزعاج المستخدم الطبيعي):
   - حدّ عام لكل عنوان IP
   - حدّ أدق لكل IP + اسم مستخدم */
const loginIpLimit = scopedRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 90,
  keyPrefix: 'login-ip',
  keyFn: () => ''
});
const loginUserLimit = scopedRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: 'login-user',
  keyFn: (req) => String((req.body && req.body.username) || '').trim().toLowerCase()
});

/* ---------- تسجيل الدخول ---------- */
/* اللون الرئيسي: لون الأكاديمية الأساسية (primary) ثم لون المنصة */
async function loginPrimaryColor() {
  const s = {};
  try { (await db.prepare('SELECT * FROM settings').all()).forEach(r => { s[r.key] = r.value; }); } catch (e) { }
  let primaryColor = s.platform_primary_color || '';
  try {
    const acad = await db.prepare("SELECT settings FROM academies WHERE code = 'primary' LIMIT 1").get();
    if (acad) { const a = JSON.parse(acad.settings || '{}'); if (a.primary_color) primaryColor = a.primary_color; }
  } catch (e) { }
  return primaryColor;
}
router.get('/login', async function (req, res) {
  if (req.currentUser) return res.redirect('/');
  const primaryColor = await loginPrimaryColor();
  res.render('auth/login', { error: '', layout: false, user: null, siteName: res.locals.siteName, primaryColor });
});
router.post('/login', loginIpLimit, loginUserLimit, async function (req, res) {
  const { username, password } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  const primaryColor = await loginPrimaryColor();
  if (!user || !verifyPassword(password || '', user.password_hash)) {
    return res.render('auth/login', { error: 'اسم المستخدم أو كلمة المرور غير صحيحة', layout: false, user: null, siteName: res.locals.siteName, primaryColor });
  }
  if (user.status === 'disabled') {
    return res.render('auth/login', { error: 'هذا الحساب معطّل، تواصل مع مدير النظام', layout: false, user: null, siteName: res.locals.siteName, primaryColor });
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

/* ---------- نسيان كلمة المرور: يُوجَّه المستخدم لإرسال طلب عبر واتساب (الزر أسفل صفحة الدخول) ---------- */

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
router.post('/profile/password', loginIpLimit, async function (req, res) {
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
      WHERE s.deleted_at IS NULL AND (s.full_name LIKE ? OR s.membership_no LIKE ? OR s.phone LIKE ? OR g.full_name LIKE ?) LIMIT 12`).all(like, like, like, like);
    results.guardians = await db.prepare('SELECT * FROM guardians WHERE deleted_at IS NULL AND (full_name LIKE ? OR phone LIKE ?) LIMIT 8').all(like, like);
    results.coaches = await db.prepare('SELECT * FROM coaches WHERE deleted_at IS NULL AND (full_name LIKE ? OR phone LIKE ?) LIMIT 8').all(like, like);
    results.programs = await db.prepare('SELECT * FROM programs WHERE deleted_at IS NULL AND name LIKE ? LIMIT 8').all(like);
    results.groups = await db.prepare('SELECT * FROM groups WHERE deleted_at IS NULL AND name LIKE ? LIMIT 8').all(like);
  }
  res.render('search', { q, results, title: 'نتائج البحث', active: 'dashboard' });
});

module.exports = router;
