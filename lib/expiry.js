
const { db } = require('./db');
const { today } = require('./helpers');

/* آخر زمن تشغيل (ذاكرة) لمنع تكرار المزامنة مع كل طلب */
let lastRun = 0;
const INTERVAL_MS = 60 * 60 * 1000; /* مرة كل ساعة كحد أقصى */

/* اشتراك سارٍ: حالته «نشط» ولم ينتهِ تاريخه ولم تُستهلك كل حصصه */
const VALID_SUB = "sub.status = 'نشط' AND (sub.end_date IS NULL OR date(sub.end_date) >= date(?)) AND (sub.sessions_total IS NULL OR sub.sessions_total = 0 OR sub.sessions_used < sub.sessions_total)";

/**
 * مزامنة انتهاء الاشتراكات:
 *  - أي اشتراك «نشط» انتهى تاريخه (تاريخ قبل اليوم) أو استُهلك عدد حصصه يتحول إلى «منتهي».
 *  - أي لاعب لا يملك اشتراكاً سارياً وله اشتراك منتهٍ/مكتمل تتحول حالته إلى «منتهي».
 *  - عند التجديد (اشتراك سارٍ) تعود حالة اللاعب «نشط».
 * تُشغَّل بشكل دوري (مخنوقة) وليست مع كل طلب.
 */
async function syncExpiredSubscriptions(force) {
  const now = Date.now();
  if (!force && now - lastRun < INTERVAL_MS) return { skipped: true };
  const t = today();

  /* 1) تحويل الاشتراكات المنتهية (تاريخاً أو حصصاً) إلى «منتهي» */
  const subs = await db.prepare(
    `UPDATE subscriptions SET status = 'منتهي'
      WHERE status = 'نشط'
        AND ((end_date IS NOT NULL AND date(end_date) < date(?))
             OR (sessions_total IS NOT NULL AND sessions_total > 0 AND sessions_used >= sessions_total))`
  ).run(t);

  /* 2) اللاعبون بلا اشتراك سارٍ ولديهم اشتراك منتهٍ/مكتمل → «منتهي» */
  const expired = await db.prepare(
    `UPDATE swimmers SET status = 'منتهي'
      WHERE deleted_at IS NULL
        AND status NOT IN ('منسحب', 'خريج', 'مجمد', 'متوقف مؤقتاً')
        AND NOT EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.swimmer_id = swimmers.id AND ${VALID_SUB})
        AND EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.swimmer_id = swimmers.id AND sub.status IN ('منتهي', 'مكتمل'))`
  ).run(t);

  /* 3) إعادة النشاط عند وجود اشتراك سارٍ */
  const reactivated = await db.prepare(
    `UPDATE swimmers SET status = 'نشط'
      WHERE deleted_at IS NULL AND status = 'منتهي'
        AND EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.swimmer_id = swimmers.id AND ${VALID_SUB})`
  ).run(t);

  lastRun = now;
  return { subscriptions: subs.changes, expired: expired.changes, reactivated: reactivated.changes };
}

module.exports = { syncExpiredSubscriptions };
