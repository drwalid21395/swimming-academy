/** تذكير تجديد الاشتراك عبر واتساب: إرسال تلقائي (Cloud API) + رابط wa.me احتياطي */
const { db } = require('./db');
const { fmtDate, today } = require('./helpers');

async function settingsMap() {
  const rows = await db.all('SELECT key, value FROM settings');
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return s;
}

/* تحويل الرقم لصيغة دولية بالشكل 2010xxxxxxxx */
function normalizePhone(raw, cc) {
  const code = (cc || '20').replace(/\D+/g, '');
  let d = String(raw || '').replace(/\D+/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length <= 11) return code + d;
  return d;
}

function waLink(phone, text) {
  return 'https://wa.me/' + normalizePhone(phone) + '?text=' + encodeURIComponent(text);
}

/* نص رسالة تذكير التجديد: اسم السباح + تاريخ انتهاء الاشتراك + طلب التجديد */
function buildRenewalMessage(opts) {
  const name = (opts.swimmerName || '').trim();
  const end = opts.endDate ? fmtDate(opts.endDate) : '';
  const acad = (opts.academyName || '').trim();
  const lines = [];
  lines.push('السلام عليكم ورحمة الله وبركاته');
  if (opts.guardianName) lines.push('عزيزي/عزيزتي ' + opts.guardianName + '، ولي أمر السباح/ة ' + name);
  else lines.push('عزيزي ولي أمر السباح/ة ' + name);
  lines.push('نود إعلامكم أن اشتراك السباح ' + name + ' انتهى بتاريخ ' + end + '.');
  lines.push('يرجى التوجه للأكاديمية لتجديد الاشتراك في أقرب وقت لضمان استمرار التدريب على أكمل وجه.');
  if (acad) lines.push('مع خالص الشكر والاحترام — ' + acad);
  return lines.join('\n');
}

/* إرسال عبر WhatsApp Cloud API (Meta) */
async function sendViaApi({ phone, text, token, phoneId }) {
  const url = 'https://graph.facebook.com/v21.0/' + phoneId + '/messages';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizePhone(phone),
        type: 'text',
        text: { body: text }
      }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { ok: false, error: 'HTTP ' + r.status + ' ' + txt.slice(0, 200) };
    }
    return { ok: true };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: e.message };
  }
}

/* إرسال تذكير: Cloud API إذا كان مفعلاً وإلا/فشل → رابط wa.me */
async function sendReminder({ phone, text }) {
  const s = await settingsMap();
  const token = (s.whatsapp_api_token || '').trim();
  const phoneId = (s.whatsapp_phone_id || '').trim();
  if (token && phoneId) {
    const r = await sendViaApi({ phone, text, token, phoneId });
    if (r.ok) return { ok: true, mode: 'api' };
    return { ok: true, mode: 'link', url: waLink(phone, text), apiError: r.error };
  }
  return { ok: true, mode: 'link', url: waLink(phone, text) };
}

/* تسجيل الرسالة في سجل الإرسال */
async function logMessage(o) {
  try {
    await db.prepare(`INSERT INTO whatsapp_messages (subscription_id, swimmer_id, swimmer_name, guardian_name, phone, message, mode, status, trigger, error, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(o.subscription_id || null, o.swimmer_id || null, o.swimmer_name || '', o.guardian_name || '', o.phone || '', o.message || '',
        o.mode || 'link', o.status || 'sent', o.trigger || 'manual', o.error || '', o.created_by || null);
  } catch (e) { /* تجاهل أخطاء التسجيل */ }
}

/* إرسال تلقائي (مرة واحدة لكل اشتراك انتهى ولم يُجدد) - يُستدعى عند فتح لوحة التحكم */
async function maybeSendExpiryReminders(user) {
  const s = await settingsMap();
  const token = (s.whatsapp_api_token || '').trim();
  const phoneId = (s.whatsapp_phone_id || '').trim();
  if (!token || !phoneId || s.whatsapp_auto_send !== '1') return 0;
  const rows = await db.prepare(`SELECT sub.id AS subscription_id, sub.swimmer_id, sub.end_date,
      sw.full_name AS swimmer_name, g.full_name AS guardian_name, COALESCE(g.whatsapp, g.phone) AS phone
    FROM subscriptions sub
    JOIN swimmers sw ON sw.id = sub.swimmer_id
    LEFT JOIN guardians g ON g.id = sw.guardian_id
    WHERE sub.status = 'نشط' AND sub.end_date IS NOT NULL AND date(sub.end_date) < date(?)
      AND COALESCE(g.whatsapp, g.phone) IS NOT NULL AND COALESCE(g.whatsapp, g.phone) != ''
      AND NOT EXISTS (SELECT 1 FROM whatsapp_messages wm WHERE wm.subscription_id = sub.id AND wm.trigger = 'auto' AND wm.status = 'sent')
    LIMIT 50`).all(today());
  let sent = 0;
  for (const row of rows) {
    const text = buildRenewalMessage({
      swimmerName: row.swimmer_name, guardianName: row.guardian_name,
      endDate: row.end_date, academyName: s.site_name
    });
    const r = await sendViaApi({ phone: row.phone, text, token, phoneId });
    await logMessage({
      subscription_id: row.subscription_id, swimmer_id: row.swimmer_id,
      swimmer_name: row.swimmer_name, guardian_name: row.guardian_name,
      phone: row.phone, message: text, mode: 'api', status: r.ok ? 'sent' : 'failed',
      trigger: 'auto', error: r.error || '', created_by: user && user.id
    });
    if (r.ok) sent++;
  }
  return sent;
}

module.exports = { normalizePhone, waLink, buildRenewalMessage, sendViaApi, sendReminder, logMessage, maybeSendExpiryReminders };