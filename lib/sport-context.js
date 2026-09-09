/** سياق اللعبة النشطة عبر «التبويب الجانبي» — مشترك بين الموقع العام والإدارة */
const { getCookie } = require('./auth-cookie');

const COOKIE = 'swim_sport';

function cookieOpts(maxAge) {
  return `Path=/; SameSite=Lax; Max-Age=${maxAge}` + (process.env.NODE_ENV === 'production' ? '; Secure' : '');
}

/* قراءة اللعبة النشطة من الكوكي (رقم صحيح؛ 0 إن لم توجد) */
function readSport(req) {
  const raw = parseInt(getCookie(req, COOKIE), 10);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : 0;
}

/* تثبيت اللعبة النشطة (id = 0 لمسح/الرئيسية) */
function setSport(res, sportId) {
  const id = Number(sportId) || 0;
  res.append('Set-Cookie', `${COOKIE}=${id}; ${cookieOpts(30 * 86400)}`);
}

module.exports = { readSport, setSport };