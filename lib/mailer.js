/** إرسال إشعارات عبر البريد لمدير النظام (بدون حساب SMTP): FormSubmit + سجل محلي احتياطي */
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./db');

const DEFAULT_TO = 'waa11@fayoum.edu.eg';

async function notifyEmail() {
  let val = '';
  try {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get('notify_email');
    val = (row && row.value || '').trim();
  } catch (e) { /* تجاهل */ }
  return val || process.env.MAIL_TO || DEFAULT_TO;
}

/* سجل محلي دائم (على Vercel يستخدم /tmp لأن مساحة المشروع مؤقتة) */
function appendLog(text) {
  try {
    const dir = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..');
    fs.appendFileSync(path.join(dir, 'mail-log.txt'),
      '[' + new Date().toLocaleString('ar-EG') + ']\n' + text + '\n--------------------------------------------------\n', 'utf8');
  } catch (e) { /* تجاهل */ }
}

/* إرسال بريد لمدير النظام عبر FormSubmit (يتفعّل تلقائياً بعد تأكيد الاستلام لأول مرة) */
async function sendAdminMail({ subject, text }) {
  const to = await notifyEmail();
  appendLog('إلى: ' + to + '\nالموضوع: ' + subject + '\n' + text);
  let out = { ok: false, mode: 'log', to, error: '' };
  try {
    const r = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(to), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ _subject: subject, message: text }),
      signal: AbortSignal.timeout(15000)
    });
    out = { ok: r.ok, mode: r.ok ? 'email' : 'log', to, error: r.ok ? '' : 'HTTP ' + r.status };
  } catch (e) {
    out.error = e.message || String(e);
  }
  return out;
}

module.exports = { sendAdminMail, notifyEmail, DEFAULT_TO };