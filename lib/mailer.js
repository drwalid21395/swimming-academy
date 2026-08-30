/** إرسال إشعارات عبر البريد لمدير النظام: Resend (يعمل من Vercel) ثم FormSubmit احتياطياً + سجل محلي */
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./db');

const DEFAULT_TO = 'waa11@fayoum.edu.eg';
const DEFAULT_FROM = 'Admin <onboarding@resend.dev>';

async function notifyEmail() {
  let val = '';
  try {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get('notify_email');
    val = (row && row.value || '').trim();
  } catch (e) { /* تجاهل */ }
  return val || process.env.MAIL_TO || DEFAULT_TO;
}

/* قراءة إعداد من جدول الإعدادات ثم من متغير البيئة */
async function getSettingOrEnv(key, envName) {
  try {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (row && row.value && String(row.value).trim()) return String(row.value).trim();
  } catch (e) { /* تجاهل */ }
  return process.env[envName] || '';
}

/* سجل محلي دائم (على Vercel يستخدم /tmp لأن مساحة المشروع مؤقتة) */
function appendLog(text) {
  try {
    const dir = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..');
    fs.appendFileSync(path.join(dir, 'mail-log.txt'),
      '[' + new Date().toLocaleString('ar-EG') + ']\n' + text + '\n--------------------------------------------------\n', 'utf8');
  } catch (e) { /* تجاهل */ }
}

/* إرسال عبر Resend REST API (يعمل من بيئة Vercel serverless) */
async function sendViaResend(to, subject, text) {
  const apiKey = await getSettingOrEnv('resend_api_key', 'RESEND_API_KEY');
  if (!apiKey) return { ok: false, mode: 'unconfigured', error: 'RESEND_API_KEY غير مضبوط' };
  const from = (await getSettingOrEnv('resend_from', 'RESEND_FROM')) || DEFAULT_FROM;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(15000)
  });
  if (r.ok) return { ok: true, mode: 'email', to, error: '' };
  let detail = 'HTTP ' + r.status;
  try { const j = await r.json(); if (j && j.message) detail += ' — ' + String(j.message); } catch (e) { /* تجاهل */ }
  return { ok: false, mode: 'log', to, error: detail };
}

/* إرسال عبر FormSubmit (احتياطي — محجوب من Vercel لكن يعمل محلياً) */
async function sendViaFormSubmit(to, subject, text) {
  const r = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(to), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ _subject: subject, message: text }),
    signal: AbortSignal.timeout(15000)
  });
  return { ok: r.ok, mode: r.ok ? 'email' : 'log', to, error: r.ok ? '' : 'HTTP ' + r.status };
}

/* إرسال بريد لمدير النظام */
async function sendAdminMail({ subject, text }) {
  const to = await notifyEmail();
  appendLog('إلى: ' + to + '\nالموضوع: ' + subject + '\n' + text);
  try {
    const via = await sendViaResend(to, subject, text);
    if (via.ok || via.mode !== 'unconfigured') return via;
  } catch (e) {
    /* انتقل لـ FormSubmit احتياطياً */
    try {
      const fb = await sendViaFormSubmit(to, subject, text);
      fb.error = 'Resend: ' + (e.message || String(e)) + (fb.error ? ' | ' + fb.error : '');
      return fb;
    } catch (e2) {
      return { ok: false, mode: 'log', to, error: 'Resend: ' + (e.message || String(e)) + ' | FormSubmit: ' + (e2.message || String(e2)) };
    }
  }
  return { ok: false, mode: 'log', to, error: 'لا يوجد مزود بريد مضبوط' };
}

module.exports = { sendAdminMail, notifyEmail, DEFAULT_TO };