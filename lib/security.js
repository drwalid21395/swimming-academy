/**
 * طبقة أمنية إضافية (Additive / Non-Destructive):
 * - Security Headers (CSP متوافق، clickjacking، إلخ)
 * - Rate Limiting بذاكرة داخلية لمحاولات الدخول
 * - فحص CSRF عبر تطابق Origin/Referer مع المضيف
 *
 * كل ذلك لا يغيّر الوظيفة الحالية ولا تجربة المستخدم ولا البيانات.
 */

const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ')
};

/* إزالة ترويسة إفصاح الخادم الافتراضية من Express */
function stripServerHeader(req, res, next) {
  res.removeHeader('X-Powered-By');
  next();
}

function securityHeaders(req, res, next) {
  for (const k in SECURITY_HEADERS) res.setHeader(k, SECURITY_HEADERS[k]);
  next();
}

/* ------------------------------------------------------------------ *
 * Rate Limiting في الذاكرة (best-effort على Vercel لكل مثيل).
 * خفيف ولا يحتاج قاعدة بيانات ولا يقفل المستخدم الطبيعي.
 * ------------------------------------------------------------------ */
function createRateLimiter({ windowMs, max, keyPrefix }) {
  const hits = new Map();
  function bump(key) {
    const now = Date.now();
    const rec = hits.get(key) || { count: 0, resetAt: now + windowMs };
    if (rec.resetAt <= now) { rec.resetAt = now + windowMs; rec.count = 0; }
    rec.count++;
    hits.set(key, rec);
    if (hits.size > 10000) {
      for (const [k, r] of hits) if (r.resetAt <= now) hits.delete(k);
    }
    return rec;
  }
  function apply(req, res, next) {
    const ip = (req.ip || '').replace(/[^\w.:]/g, '') || 'unknown';
    const rec = bump(keyPrefix + ':' + ip);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - rec.count)));
    if (rec.count > max) {
      res.status(429).send('محاولات كثيرة. يرجى المحاولة لاحقاً.');
      return;
    }
    next();
  }
  return { middleware: apply, bump, _hits: hits };
}

/* محدد بمفتاح مركّب (IP + عامل إضافي مثل اسم المستخدم) لفرض الحماية
   دون التأثير على المستخدم الطبيعي */
function scopedRateLimit({ windowMs, max, keyPrefix, keyFn }) {
  const limiter = createRateLimiter({ windowMs, max, keyPrefix });
  return function (req, res, next) {
    const ip = (req.ip || '').replace(/[^\w.:]/g, '') || 'unknown';
    let scope = '';
    try { scope = String(keyFn ? keyFn(req) : ''); } catch (e) { scope = ''; }
    const rec = limiter.bump(keyPrefix + ':' + ip + ':' + scope);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - rec.count)));
    if (rec.count > max) {
      res.status(429).send('محاولات كثيرة. يرجى المحاولة لاحقاً.');
      return;
    }
    next();
  };
}

/* ------------------------------------------------------------------ *
 * CSRF (دفاع إضافي، Additive): رفض الطلبات الواردة من أصل مختلف
 * (cross-origin) للطرق التي تغيّر البيانات، عبر مقارنة Origin/Referer
 * مع المضيف المتوقع. لا يؤثر على الطلبات من نفس الأصل ولا على العملاء
 * غير المتصفحات (لا Origin ولا Referer).
 * ------------------------------------------------------------------ */
function originOfUrl(u) {
  try { return new URL(u).origin; } catch (e) { return null; }
}

function csrfProtect(req, res, next) {
  if (UNSAFE_METHODS.indexOf(req.method) === -1) return next();
  const host = req.headers.host;
  if (!host) return next();
  const proto = req.headers['x-forwarded-proto']
    ? String(req.headers['x-forwarded-proto']).split(',')[0].trim()
    : (req.secure ? 'https' : 'http');
  const expectedOrigin = proto + '://' + String(host).trim();

  const reqOrigin = req.headers.origin ? originOfUrl(String(req.headers.origin)) : null;
  if (reqOrigin) {
    if (reqOrigin !== expectedOrigin) {
      res.status(403).json({ ok: false, error: 'طلب غير مصرح (Cross-Site)' });
      return;
    }
    return next();
  }

  const referer = req.headers.referer ? originOfUrl(String(req.headers.referer)) : null;
  if (referer && referer !== expectedOrigin) {
    res.status(403).json({ ok: false, error: 'طلب غير مصرح (Cross-Site)' });
    return;
  }
  next();
}

module.exports = {
  securityHeaders, stripServerHeader,
  createRateLimiter, scopedRateLimit, csrfProtect
};
