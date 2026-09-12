/** سياق اللعبة النشطة عبر «التبويب الجانبي» — مشترك بين الموقع العام والإدارة */
const { getCookie } = require('./auth-cookie');

const COOKIE = 'swim_sport';

function cookieOpts(maxAge) {
  return `Path=/; SameSite=Lax; Max-Age=${maxAge}` + (process.env.NODE_ENV === 'production' ? '; Secure' : '');
}

/* قراءة اللعبة النشطة من الكوكي (رقم صحيح؛ 0 إن لم توجد) */
function readSport(req) {
  const raw = parseInt(getCookie(req, COOKIE), 10);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : 0;
}

/* تثبيت اللعبة النشطة (id = 0 لمسح/الرئيسية) */
function setSport(res, sportId) {
  const id = Number(sportId) || 0;
  res.append('Set-Cookie', `${COOKIE}=${id}; ${cookieOpts(30 * 86400)}`);
}

/* اللعبة النشطة للطلب الحالي (0 = الوضع العام) */
function activeSport(req) {
  return (req && req.activeSportId) || 0;
}

/* اللعبة الفعلية عند الإنشاء: التبويب النشط، وإلا لعبة الأكاديمية الوحيدة إن كانت
   وحيدة (حتى لا تُنشأ سجلات بلا رياضة في الأكاديمية أحادية اللعبة). */
function effectiveSport(req) {
  const a = activeSport(req);
  if (a > 0) return a;
  const sp = (req && req.enabledSports) || [];
  return sp.length === 1 ? (Number(sp[0].id) || 0) : 0;
}

/* ---- مقاطع SQL آمنة (الرقم محوَّل دائماً لعدد صحيح) ---- */
function sid(s) {
  const id = Number(s) || 0;
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

/* جداول فيها sport_id مباشرة: coaches, programs, announcements */
function sportClause(s, alias) {
  const id = sid(s);
  if (!id) return '';
  return ` AND ${alias || 't'}.sport_id = ${id}`;
}

/* جداول فيها program_id: swimmers, subscriptions, groups, reservations, assessments */
function progClause(s, alias) {
  const id = sid(s);
  if (!id) return '';
  return ` AND ${alias || 't'}.program_id IN (SELECT id FROM programs WHERE deleted_at IS NULL AND sport_id = ${id})`;
}

/* اللاعبون (عبر برنامجهم) */
function swimmerClause(s) {
  const id = sid(s);
  if (!id) return '';
  return ` AND id IN (SELECT id FROM swimmers WHERE deleted_at IS NULL AND program_id IN (SELECT id FROM programs WHERE deleted_at IS NULL AND sport_id = ${id}))`;
}

/* اللاعبون حسب رياضتهم الفعلية: حقل swimmers.sport_id الذي يُملأ عند التسجيل
   (من البرنامج المختار أو من التبويب النشط) — مع الرجوع إلى رياضة البرنامج
   للاعبين الأقدم، حتى لا "يضيع" لاعب جديد من القائمة الخاصة برياضته. */
function swimmerSportClause(s, alias) {
  const id = sid(s);
  if (!id) return '';
  const a = alias ? alias + '.' : 's.';
  return ` AND (${a}sport_id = ${id} OR (${a}sport_id IS NULL AND ${a}program_id IN (SELECT id FROM programs WHERE deleted_at IS NULL AND sport_id = ${id})))`;
}

/* المجموعات (عبر برنامجها) */
function groupClause(s) {
  const id = sid(s);
  if (!id) return '';
  return ` AND id IN (SELECT id FROM groups WHERE deleted_at IS NULL AND program_id IN (SELECT id FROM programs WHERE deleted_at IS NULL AND sport_id = ${id}))`;
}

/* الحصص (عبر مجموعتها ← برنامجها) — alias = اسم جدول sessions في الاستعلام أو '' */
function sessionClause(s, alias) {
  const id = sid(s);
  if (!id) return '';
  const a = alias ? alias + '.' : '';
  return ` AND ${a}id IN (SELECT s2.id FROM sessions s2 JOIN groups g ON g.id = s2.group_id WHERE g.program_id IN (SELECT id FROM programs WHERE deleted_at IS NULL AND sport_id = ${id}))`;
}

/* جداول فيها swimmer_id (tests، team_members، ...) — نطاق عبر برنامج اللاعب */
function swimmerOfClause(s, alias) {
  const id = sid(s);
  if (!id) return '';
  const a = alias ? alias + '.' : '';
  return ` AND ${a}swimmer_id IN (SELECT id FROM swimmers WHERE deleted_at IS NULL AND program_id IN (SELECT id FROM programs WHERE deleted_at IS NULL AND sport_id = ${id}))`;
}

module.exports = { readSport, setSport, activeSport, effectiveSport, sportClause, progClause, swimmerClause, swimmerSportClause, groupClause, sessionClause, swimmerOfClause };