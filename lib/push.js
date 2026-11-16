/* Web Push: إرسال إشعارات النظام للهاتف/سطح المكتب حتى خارج التطبيق */
const webpush = require('web-push');
const { db } = require('./db');

let vapidConfigured = false;

async function getSetting(key) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

async function setSetting(key, value) {
  await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

async function getOrCreateVapidKeys() {
  let publicKey = await getSetting('vapid_public_key');
  let privateKey = await getSetting('vapid_private_key');
  if (!publicKey || !privateKey) {
    try {
      const keys = webpush.generateVAPIDKeys();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
      await setSetting('vapid_public_key', publicKey);
      await setSetting('vapid_private_key', privateKey);
      console.log('Web Push: تم توليد مفاتيح VAPID جديدة.');
    } catch (e) {
      console.error('Web Push: فشل توليد مفاتيح VAPID:', e.message);
      throw e;
    }
  }
  return { publicKey, privateKey };
}

async function ensureVapid() {
  if (vapidConfigured) return;
  const { publicKey, privateKey } = await getOrCreateVapidKeys();
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@swimacademy.eg';
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

function getVapidPublicKey() {
  return getSetting('vapid_public_key');
}

async function saveSubscription(userId, academyId, subscription) {
  if (!subscription || !subscription.endpoint) return false;
  await db.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    academy_id INTEGER DEFAULT 1,
    endpoint TEXT UNIQUE NOT NULL,
    subscription TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`).run();
  await db.prepare(`INSERT OR REPLACE INTO push_subscriptions
    (user_id, academy_id, endpoint, subscription, updated_at)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))`)
    .run(Number(userId), Number(academyId), subscription.endpoint, JSON.stringify(subscription));
  return true;
}

async function removeSubscription(endpoint) {
  await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

async function removeSubscriptionsForUser(userId) {
  await db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(Number(userId));
}

async function sendPushToUsers(userIds, payload) {
  if (!Array.isArray(userIds) || !userIds.length) return;
  await ensureVapid();
  const ids = userIds.map(Number).filter(n => n > 0);
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');
  const rows = await db.all(`SELECT * FROM push_subscriptions WHERE user_id IN (${ph})`, ...ids);
  if (!rows || !rows.length) return;
  const data = JSON.stringify(payload);
  for (const row of rows) {
    try {
      const subscription = JSON.parse(row.subscription);
      await webpush.sendNotification(subscription, data);
    } catch (err) {
      /* إذا انتهت صلاحية الاشتراك نحذفه */
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        try { await removeSubscription(row.endpoint); } catch (e) { /* تجاهل */ }
      }
    }
  }
}

async function sendPushToUser(userId, payload) {
  return sendPushToUsers([userId], payload);
}

module.exports = {
  ensureVapid,
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
  removeSubscriptionsForUser,
  sendPushToUser,
  sendPushToUsers
};
