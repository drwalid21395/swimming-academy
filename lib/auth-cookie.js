/** جلسات بكوكيز موقّعة (HMAC) — تعمل على Vercel بدون تخزين خادمي */
const crypto = require('node:crypto');

const SECRET = process.env.SESSION_SECRET || 'swim-academy-secret-key-2026';

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(String(value)).digest('base64url');
}

function verify(signed) {
  if (!signed || !signed.includes('.')) return null;
  const idx = signed.lastIndexOf('.');
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = sign(value);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (e) { return null; }
  return value;
}

/* كوكي تسجيل الدخول: uid.<توقيع> */
function setAuth(res, userId) {
  res.setHeader('Set-Cookie', [
    `swim_uid=${userId}.${sign(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 12}` + (process.env.NODE_ENV === 'production' ? '; Secure' : '')
  ]);
}
function clearAuth(res) {
  res.setHeader('Set-Cookie', `swim_uid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` + (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
}
function getAuth(req) {
  const cookies = parseCookies(req);
  return verify(cookies['swim_uid']);
}

/* كوكي الرسائل المؤقتة (flash): base64(json).<توقيع> */
function setFlash(res, obj) {
  const payload = Buffer.from(JSON.stringify(obj || {}), 'utf8').toString('base64url');
  res.append('Set-Cookie', `swim_flash=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=60` + (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
}
function takeFlash(req, res) {
  const cookies = parseCookies(req);
  const raw = cookies['swim_flash'];
  if (!raw) return undefined;
  res.append('Set-Cookie', 'swim_flash=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  const payload = verify(raw);
  if (!payload) return undefined;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (e) { return undefined; }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

module.exports = { sign, verify, setAuth, clearAuth, getAuth, setFlash, takeFlash };
