/* مهام مجدولة منفصلة عن طلبات المستخدم حتى لا تؤخر فتح الصفحات. */
const express = require('express');
const { maybeSendExpiryReminders } = require('../lib/whatsapp');

const router = express.Router();

router.get('/expiry-reminders', async function (req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get('authorization') !== 'Bearer ' + secret) return res.status(401).json({ ok: false });

  try {
    const sent = await maybeSendExpiryReminders(null);
    return res.json({ ok: true, sent });
  } catch (err) {
    console.error('خطأ في مهمة تذكيرات واتساب:', err.message);
    return res.status(500).json({ ok: false });
  }
});

module.exports = router;
