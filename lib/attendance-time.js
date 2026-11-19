/** أدوات الوقت لحصص الحضور: تحقّق، مقارنة مدى زمني، ومنع التداخل.
    كل الأوقات بصيغة HH:MM (24 ساعة). */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function normalizeTime(v) {
  const s = String(v == null ? '' : v).trim();
  return TIME_RE.test(s) ? s : null;
}

function toMinutes(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(t || ''));
  return m ? (Number(m[1]) * 60 + Number(m[2])) : 0;
}

function minutesToTime(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/** نهاية المدي: إن غابت تُعتبر بداية + ساعة، وإن كانت قبل البداية فهي بعد منتصف الليل. */
function rangeEnd(start, end) {
  const s = toMinutes(start);
  let e = end ? toMinutes(end) : s + 60;
  if (e < s) e += 1440;
  return e;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !bStart) return false;
  const as = toMinutes(aStart), ae = rangeEnd(aStart, aEnd);
  const bs = toMinutes(bStart), be = rangeEnd(bStart, bEnd);
  return as < be && bs < ae;
}

/** يتحقق من صحة «من / إلى» ويعيد { from, to } أو { error }. */
function validateRange(from, to) {
  const f = normalizeTime(from), t = normalizeTime(to);
  if (!f || !t) return { error: 'حدد وقت البداية ووقت النهاية بصيغة صحيحة (مثال: 16:00)' };
  if (toMinutes(t) <= toMinutes(f)) return { error: 'وقت النهاية يجب أن يكون بعد وقت البداية' };
  return { from: f, to: t };
}

module.exports = { normalizeTime, toMinutes, minutesToTime, rangeEnd, overlaps, validateRange };
