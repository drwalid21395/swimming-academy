/** Webhook واتساب (Meta Cloud API): استقبال الرسائل الواردة والرد عليها تلقائياً
 *  بالذكاء الاصطناعي مع بيانات الموقع الحية من قاعدة البيانات. */
const express = require('express');
const router = express.Router();
const { db } = require('../lib/db');
const { settingsMap, aiDraftReply, buildAcademyContext } = require('../lib/ai');
const { sendViaApi, logMessage } = require('../lib/whatsapp');

/* رسالة بديلة لطيفة تُرسل عند تعطل المزوّد أو عدم وجود مفتاح AI */
function fallbackReply(s) {
  const acad = String(s.site_name || 'الأكاديمية').trim();
  const phone = String(s.phone || '').trim();
  const hours = String(s.work_hours || '').trim();
  let t = 'السلام عليكم ورحمة الله وبركاته 🌊\nشكراً لتواصلكم مع ' + (acad || 'الأكاديمية') + '.';
  t += '\nسيتواصل معكم فريق الأكاديمية في أقرب وقت للرد على استفساركم.';
  if (phone) t += '\n\nلاستفسار عاجل اتصلوا على: ' + phone;
  if (hours) t += '\n\nمواعيد العمل: ' + hours;
  return t;
}

/* التحقق من الويب هوك (يُستدعى عند إضافة الرابط في Meta Developers) */
router.get('/', async function (req, res) {
  let s = {};
  try { s = await settingsMap(); } catch (e) { /* تجاهل */ }
  const mode = req.query['hub.mode'];
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === String(s.whatsapp_webhook_token || '')) {
    return res.type('text/plain').send(challenge);
  }
  res.status(403).send('Forbidden');
});

/* استقبال الرسائل الواردة من Meta */
router.post('/', async function (req, res) {
  try {
    const body = req.body || {};
    const entries = Array.isArray(body.entry) ? body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const ch of changes) {
        const v = ch.value || {};
        const msgs = Array.isArray(v.messages) ? v.messages : [];
        for (const msg of msgs) {
          if (!msg || typeof msg !== 'object') continue;
          if (msg.type !== 'text') continue;
          const from = String(msg.from || '');
          const text = String(msg.text && msg.text.body || '').trim();
          const waId = String(msg.id || '');
          if (!from || !text || !waId) continue;
          const name = (Array.isArray(v.contacts) && v.contacts[0]) ? String(v.contacts[0].profile && v.contacts[0].profile.name || '').trim() : '';
          await handleInbound({ waId, from, text, name });
        }
      }
    }
    res.status(200).send('ok');
  } catch (e) {
    console.error('[webhook]', e.message);
    res.status(200).send('ok');
  }
});

async function handleInbound({ waId, from, text, name }) {
  const ins = await db.prepare('INSERT OR IGNORE INTO webhook_log (wa_msg_id, phone, sender_name, message) VALUES (?,?,?,?)');
  const r = await ins.run(waId, from, name, text);
  if (!r.changes) return; /* رسالة مكررة (إعادة إرسال من Meta) — نهملها */
  try {
    const s = await settingsMap();
    const token = (s.whatsapp_api_token || '').trim();
    const phoneId = (s.whatsapp_phone_id || '').trim();
    if (!token || !phoneId) {
      await db.prepare('UPDATE webhook_log SET reply_mode=?, error=? WHERE wa_msg_id=?').run('skip', 'لا يوجد مفتاح واتساب API مفعّل', waId);
      return;
    }
    if (s.wa_auto_reply !== '1') {
      await db.prepare('UPDATE webhook_log SET reply_mode=?, error=? WHERE wa_msg_id=?').run('skip', 'الرد التلقائي غير مفعّل', waId);
      return;
    }
    let reply = null, mode = 'ai', error = '';
    if (s.ai_enabled === '1') {
      const ctx = await buildAcademyContext();
      const ai = await aiDraftReply({
        clientMessage: text,
        guardianName: name || null,
        swimmerName: null,
        contextPrepend: ctx,
        timeoutMs: 9000
      });
      if (ai.ok) reply = ai.text;
      else error = (ai.error || '').slice(0, 200);
    } else {
      error = 'الذكاء الاصطناعي غير مفعّل';
    }
    if (!reply) { mode = 'fallback'; reply = fallbackReply(s); }
    const sent = await sendViaApi({ phone: from, text: reply, token, phoneId });
    await db.prepare('UPDATE webhook_log SET reply=?, reply_mode=?, ok=?, error=? WHERE wa_msg_id=?')
      .run(reply, mode, sent.ok ? 1 : 0, sent.error || error, waId);
    await logMessage({ subscription_id: null, swimmer_id: null, swimmer_name: '',
      guardian_name: name, phone: from, message: reply, mode: 'api',
      status: sent.ok ? 'sent' : 'failed', trigger: 'webhook', error: sent.error || '', created_by: null });
  } catch (e) {
    await db.prepare('UPDATE webhook_log SET reply_mode=?, error=? WHERE wa_msg_id=?').run('error', String(e.message || e).slice(0, 200), waId).catch(() => {});
  }
}

module.exports = router;