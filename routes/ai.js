/** مساعد الردود الذكية: صفحة التحكم في الرد الآلي على العملاء بالذكاء الاصطناعي */
const express = require('express');
const router = express.Router();
const { db } = require('../lib/db');
const { canView, canEdit, audit } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const { aiDraftReply, PROVIDERS, DEFAULT_MODEL, settingsMap } = require('../lib/ai');
const { sendViaApi, logMessage, waLinkFor, normalizePhone } = require('../lib/whatsapp');

const AI_KEYS = ['ai_enabled', 'ai_provider', 'ai_api_key', 'ai_model', 'ai_tone', 'ai_max_length', 'ai_instructions', 'wa_auto_reply', 'whatsapp_webhook_token'];

router.get('/ai-replies', async function (req, res) {
  if (!canView(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const current = {};
  (await db.prepare('SELECT key, value FROM settings').all()).forEach(r => { current[r.key] = r.value; });
  current.ai_enabled = current.ai_enabled || '0';
  current.ai_provider = current.ai_provider || 'gemini';
  current.ai_model = current.ai_model || PROVIDERS[current.ai_provider].defaultModel;
  current.ai_tone = current.ai_tone || 'مهني';
  current.ai_max_length = current.ai_max_length || '300';
  const guardians = await db.prepare('SELECT id, full_name, phone, whatsapp FROM guardians ORDER BY full_name').all();
  const lastMsgs = await db.prepare('SELECT * FROM whatsapp_messages ORDER BY id DESC LIMIT 15').all();
  const webhookUrl = (req.protocol || 'https') + '://' + (req.get('host') || '') + '/webhooks/whatsapp';
  res.render('ai_replies', {
    title: 'الردود الذكية', active: 'ai_replies',
    current, guardians, lastMsgs, providers: PROVIDERS, webhookUrl,
    canEdit: canEdit(req.currentUser, 'settings')
  });
});

router.post('/ai-replies/settings', async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const st = await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)');
  for (const k of AI_KEYS) {
    st.run(k, k === 'ai_enabled' || k === 'wa_auto_reply' ? (req.body[k] ? '1' : '0') : String(req.body[k] || '').trim());
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'settings', 0, 'تحديث إعدادات الردود الذكية', req);
  setFlash(res, { type: 'success', message: 'تم حفظ إعدادات الردود الذكية' });
  res.redirect('/ai-replies');
});

router.post('/ai-replies/draft', async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const message = String(req.body.message || '').trim();
  if (!message) return res.json({ ok: false, error: 'أدخل نص رسالة العميل أولاً' });
  const r = await aiDraftReply({
    clientMessage: message,
    guardianName: String(req.body.guardian_name || '').trim() || null,
    swimmerName: String(req.body.swimmer_name || '').trim() || null
  });
  if (r.ok) {
    audit(req.currentUser.id, req.currentUser.full_name, 'ai', 'ai_replies', null, 'توليد رد ذكي لرسالة عميل', req);
    return res.json({ ok: true, text: r.text });
  }
  return res.json({ ok: false, error: r.error || 'تعذر توليد الرد' });
});

router.post('/ai-replies/send', async function (req, res) {
  if (!canEdit(req.currentUser, 'settings')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const phone = String(req.body.phone || '').trim();
  const text = String(req.body.text || '').trim();
  const guard = String(req.body.guardian_name || '').trim();
  if (!phone) return res.json({ ok: false, error: 'رقم الهاتف مطلوب' });
  if (!text) return res.json({ ok: false, error: 'نص الرد مطلوب' });
  const s = await settingsMap();
  const token = (s.whatsapp_api_token || '').trim();
  const phoneId = (s.whatsapp_phone_id || '').trim();
  let mode = 'link', url = null, apiError = null;
  if (token && phoneId) {
    const r = await sendViaApi({ phone, text, token, phoneId });
    if (r.ok) mode = 'api';
    else { apiError = r.error; url = waLinkFor(phone, text, req.headers['user-agent']); }
  } else {
    url = waLinkFor(phone, text, req.headers['user-agent']);
  }
  await logMessage({
    subscription_id: null, swimmer_id: null, swimmer_name: req.body.swimmer_name || '',
    guardian_name: guard, phone, message: text, mode,
    status: mode === 'api' ? 'sent' : 'link', trigger: 'ai_reply',
    error: apiError || '', created_by: req.currentUser.id
  });
  audit(req.currentUser.id, req.currentUser.full_name, 'send', 'whatsapp', null,
    'رد ذكي للعميل ' + (guard || phone) + (mode === 'api' ? ' (واتساب API)' : ' (رابط)') + (apiError ? ' — ' + apiError : ''), req);
  return res.json({ ok: true, mode, url, error: apiError || null });
});

module.exports = router;