/**
 * سياق المستأجر (Tenant Context) عبر AsyncLocalStorage
 * يحدّد معرف الأكاديمية النشط أثناء معالجة الطلب حتى تتمكن طبقة
 * قاعدة البيانات الموسّعة من حقن شرط academy_id تلقائياً.
 *
 * ملاحظة: لا يُؤثّر هذا على مسارات لوحة التحكم الخارقة (platform)
 * والتي تُدار بشكل مستقل في routes/platform.js.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

/* ALS يخزّن الحالة لكل طلب بشكل معزول عن باقي الطلبات */
const storage = new AsyncLocalStorage();

/**
 * يشغّل fn داخل سياق الأكاديمية المحددة.
 * returns: ما تعيده الدالة fn
 */
function withAcademy(academyId, fn) {
  const cleaned = academyId == null || Number(academyId) <= 0 ? 1 : Number(academyId);
  return storage.run({ academyId: cleaned }, fn);
}

/** يعيد { academyId } الحالي أو null إذا لم يكن هناك سياق. */
function getTenant() {
  return storage.getStore() || null;
}

/** يعيد معرّف الأكاديمية الحالي (افتراضياً 1 عند عدم وجود سياق). */
function getAcademyId() {
  const t = getTenant();
  return t && t.academyId ? t.academyId : 1;
}

module.exports = { withAcademy, getTenant, getAcademyId };
