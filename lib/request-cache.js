/**
 * كاش محدود بمدة الطلب الواحد فقط.
 *
 * الغرض: منع تكرار استعلامات القراءة نفسها داخل طبقات الوسائط (middleware)
 * في نفس الطلب، مثل قراءة المستخدم أو الأكاديمية أو صلاحيات الخطة أكثر من مرة.
 *
 * القواعد الحاسمة:
 *  - لا مشاركة بين الطلبات أو بين المستخدمين (AsyncLocalStorage مستقل لكل طلب).
 *  - يُوقف الكاش قبل الدخول إلى المسارات (routes)، فلا يتغير سلوك أي صفحة
 *    ولا تُقرأ قيمة قديمة بعد تعديل داخل الطلب.
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

function withRequestCache(fn) {
  return storage.run({ enabled: true, values: new Map() }, fn);
}

function disableRequestCache() {
  const state = storage.getStore();
  if (state) state.enabled = false;
}

function memoize(key, factory) {
  const state = storage.getStore();
  if (!state || !state.enabled) return factory();
  if (state.values.has(key)) return state.values.get(key);

  let pending;
  try {
    pending = Promise.resolve(factory());
  } catch (err) {
    pending = Promise.reject(err);
  }
  state.values.set(key, pending);
  return pending;
}

module.exports = { withRequestCache, disableRequestCache, memoize };
