/* Cache صغير داخل العملية للبيانات قليلة التغيير. يمنع تكرار نفس الاستعلام
   أثناء الطلبات المتزامنة، مع مدة قصيرة حتى لا تصبح البيانات قديمة. */
const entries = new Map();

async function cached(key, loader, ttlMs) {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.promise) return hit.promise;
  if (hit && hit.expiresAt > now) return hit.value;
  const promise = Promise.resolve().then(loader).then(value => {
    entries.set(key, { value, expiresAt: Date.now() + (ttlMs || 30000) });
    return value;
  }).catch(error => {
    entries.delete(key);
    throw error;
  });
  entries.set(key, { promise, expiresAt: now + (ttlMs || 30000) });
  return promise;
}

function invalidate(prefix) {
  for (const key of entries.keys()) if (!prefix || key === prefix || key.startsWith(prefix + ':')) entries.delete(key);
}

module.exports = { cached, invalidate };
