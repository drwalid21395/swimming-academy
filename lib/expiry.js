
const { db } = require('./db');
const { today } = require('./helpers');

/* آخر زمن تشغيل (ذاكرة) لمنع تكرار المزامنة مع كل طلب */
let lastRun = 0;
const INTERVAL_MS = 60 * 60 * 1000; /* مرة كل ساعة كحد أقصى */

/**
 * عند انتهاء تاريخ اشتراك اللاعب (لا يملك أي اشتراك سارٍ، وله اشتراك منتهٍ)
 * تتحول حالته تلقائياً إلى «منتهي» في كل مكان. وعند تجديد اشتراك سارٍ
 * تعود حالته «نشط». تُشغَّل بشكل دوري (مخنوقة) وليست مع كل طلب.
 * ملاحظة: لا نغيّر حالة الاشتراك نفسه (تبقى «نشط») حتى لا تتعطل تذكيرات التجديد.
 */
async function syncExpiredSubscriptions(force) {
  const now = Date.now();
  if (!force && now - lastRun < INTERVAL_MS) return { skipped: true };
  const t = today();
  const expired = await db.prepare(
    `UPDATE swimmers SET status = 'منتهي'
      WHERE deleted_at IS NULL
        AND status NOT IN ('منسحب', 'خريج', 'مجمد', 'متوقف مؤقتاً')
        AND EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.swimmer_id = swimmers.id AND sub.end_date IS NOT NULL AND date(sub.end_date) < date(?))
        AND NOT EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.swimmer_id = swimmers.id AND sub.status = 'نشط' AND (sub.end_date IS NULL OR date(sub.end_date) >= date(?)))`
  ).run(t, t);
  const reactivated = await db.prepare(
    `UPDATE swimmers SET status = 'نشط'
      WHERE deleted_at IS NULL AND status = 'منتهي'
        AND EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.swimmer_id = swimmers.id AND sub.status = 'نشط' AND (sub.end_date IS NULL OR date(sub.end_date) >= date(?)))`
  ).run(t);
  lastRun = now;
  return { expired: expired.changes, reactivated: reactivated.changes };
}

module.exports = { syncExpiredSubscriptions };
