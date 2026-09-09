/** طبقة مساعدة للألعاب الرياضية — مشتركة بين الموقع والإدارة والمنصة */
const { db } = require('./db');

/* كتالوج الألعاب النشطة (مشترك على مستوى المنصة) */
async function listActiveSports() {
  return db.prepare('SELECT * FROM sports WHERE is_active = 1 ORDER BY sort_order, id').all();
}

/* تفاصيل لعبة من الكتالوج */
async function getSport(sportId) {
  return db.prepare('SELECT * FROM sports WHERE id = ?').get(Number(sportId));
}

/* صف ربط لعبة بأكاديمية معينة (قد يكون غير مفعّل) */
async function academySportRow(academyId, sportId) {
  return db.prepare('SELECT * FROM academy_sports WHERE academy_id = ? AND sport_id = ?').get(Number(academyId), Number(sportId));
}

/* الألعاب المفعلة لأكاديمية معينة مع بيانات موقع كل لعبة (website JSON محللاً) */
async function enabledSportsForAcademy(academyId) {
  const rows = await db.prepare(`
    SELECT as2.id AS link_id, as2.is_enabled, as2.website,
           s.id, s.name, s.icon, s.description, s.sort_order
    FROM academy_sports as2
    JOIN sports s ON s.id = as2.sport_id
    WHERE as2.academy_id = ? AND s.is_active = 1
    ORDER BY s.sort_order, s.name
  `).all(Number(academyId));
  return rows.map(r => {
    let w = {};
    try { w = JSON.parse(r.website || '{}'); } catch (e) { w = {}; }
    return Object.assign({}, r, { website: w });
  });
}

/* لعبة من الكتالوج + حالة تفعيلها في كل الأكاديميات (لشاشة التحكم المركزية) */
async function sportWithAcademies(sportId) {
  const sport = await getSport(sportId);
  if (!sport) return null;
  const academies = await db.all(`
    SELECT a.id, a.name, a.code, a.status, a.premium,
           as2.id AS link_id, as2.is_enabled
    FROM academies a
    LEFT JOIN academy_sports as2 ON as2.academy_id = a.id AND as2.sport_id = ?
    ORDER BY a.id
  `, Number(sportId));
  return { sport, academies };
}

/* تفعيل/تعطيل لعبة لأكاديمية (ينشئ الرابط إن لم يوجد) */
async function setSportEnabled(academyId, sportId, enabled) {
  const ai = Number(academyId), si = Number(sportId);
  const link = await academySportRow(ai, si);
  if (link) {
    await db.prepare('UPDATE academy_sports SET is_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, link.id);
  } else {
    await db.prepare('INSERT INTO academy_sports (academy_id, sport_id, is_enabled) VALUES (?,?,?)').run(ai, si, enabled ? 1 : 0);
  }
  return true;
}

module.exports = { listActiveSports, getSport, academySportRow, enabledSportsForAcademy, sportWithAcademies, setSportEnabled };