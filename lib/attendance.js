/** أدوات مشتركة للحضور: مزامنة الأعضاء، إنشاء الحصة تلقائياً، وقائمة اللاعبين */
const { db } = require('./db');
const { parseJSON } = require('./helpers');

/* وقت بدء افتراضي للمجموعة من جدولها */
function groupStartTime(group) {
  if (!group) return '16:00';
  const sch = parseJSON(group.schedule, []);
  if (sch.length && sch[0] && sch[0].start) return sch[0].start;
  return '16:00';
}

/* مزامنة أعضاء المجموعة: من عمود group_id الأساسي + من الاشتراكات النشطة */
async function syncGroupMembers(groupId) {
  if (!groupId) return;
  await db.prepare('INSERT OR IGNORE INTO swimmer_group (swimmer_id, group_id) SELECT id, ? FROM swimmers WHERE group_id = ? AND deleted_at IS NULL').run(groupId, groupId);
  await db.prepare(`INSERT OR IGNORE INTO swimmer_group (swimmer_id, group_id)
    SELECT DISTINCT swimmer_id, ? FROM subscriptions WHERE group_id = ? AND status = 'نشط'`).run(groupId, groupId);
  await db.prepare(`DELETE FROM swimmer_group WHERE group_id = ? AND swimmer_id NOT IN (
    SELECT id FROM swimmers WHERE group_id = ? AND deleted_at IS NULL
    UNION
    SELECT DISTINCT swimmer_id FROM subscriptions WHERE group_id = ? AND status = 'نشط'
  )`).run(groupId, groupId, groupId);
}

async function syncGroups(groupIds) {
  for (const gid of (groupIds || [])) await syncGroupMembers(gid);
}

async function sessionGroupIds(sessionId) {
  const rows = await db.prepare('SELECT group_id FROM session_groups WHERE session_id = ?').all(sessionId);
  if (rows.length) return rows.map(r => r.group_id);
  const s = await db.prepare('SELECT group_id FROM sessions WHERE id = ?').get(sessionId);
  return s && s.group_id ? [s.group_id] : [];
}

/* حصة المجموعة في تاريخ معيّن (مع مراعاة حصص عدة مجموعات) */
async function findGroupSession(groupId, date) {
  if (!groupId || !date) return null;
  return db.prepare(`SELECT * FROM sessions se
    WHERE se.date = ? AND se.deleted_at IS NULL
      AND (se.group_id = ? OR EXISTS (SELECT 1 FROM session_groups sg WHERE sg.session_id = se.id AND sg.group_id = ?))
    ORDER BY se.start_time LIMIT 1`).get(date, groupId, groupId);
}

/* إنشاء حصة المجموعة تلقائياً إن لم توجد */
async function ensureGroupSession(group, date, userId) {
  if (!group || !group.id || !date) return null;
  let session = await findGroupSession(group.id, date);
  if (session) return session;
  const start = groupStartTime(group);
  const info = await db.prepare(`INSERT INTO sessions
    (group_id, title, date, start_time, end_time, coach_id, pool_id, status, is_compensatory, note, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(group.id, group.name + ' - ' + date, date, start, null, group.coach_id || null, group.pool_id || null,
      'scheduled', 0, 'أُنشئت تلقائياً من شاشة الحضور', userId || null);
  const sessionId = Number(info.lastInsertRowid);
  await db.prepare('INSERT OR IGNORE INTO session_groups (session_id, group_id) VALUES (?,?)').run(sessionId, group.id);
  session = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  return session;
}

/* قائمة لاعبي مجموعة مع حالة الاشتراك */
async function groupRoster(groupId, skipSync) {
  if (!skipSync) await syncGroupMembers(groupId);
  return db.prepare(`SELECT s.id, s.full_name, s.membership_no, s.birth_date,
      (SELECT sub.end_date FROM subscriptions sub WHERE sub.swimmer_id = s.id
        ORDER BY (sub.status = 'نشط') DESC, sub.id DESC LIMIT 1) AS sub_end
    FROM swimmer_group sg JOIN swimmers s ON s.id = sg.swimmer_id
    WHERE sg.group_id = ? AND s.deleted_at IS NULL
    ORDER BY s.full_name`).all(groupId);
}

/* قائمة لاعبي حصة (كل المجموعات المرتبطة بها) */
async function sessionRoster(sessionId) {
  const groupIds = await sessionGroupIds(sessionId);
  await syncGroups(groupIds);
  if (!groupIds.length) return [];
  const placeholders = groupIds.map(() => '?').join(',');
  return db.prepare(`SELECT DISTINCT s.id, s.full_name, s.membership_no, s.birth_date, a.status AS att_status,
      a.reason, a.coach_note,
      (SELECT sub.end_date FROM subscriptions sub WHERE sub.swimmer_id = s.id
        ORDER BY (sub.status = 'نشط') DESC, sub.id DESC LIMIT 1) AS sub_end
    FROM swimmer_group sg
    JOIN swimmers s ON s.id = sg.swimmer_id
    LEFT JOIN attendance a ON a.session_id = ? AND a.swimmer_id = s.id
    WHERE sg.group_id IN (${placeholders}) AND s.deleted_at IS NULL
    ORDER BY s.full_name`).all(sessionId, ...groupIds);
}

async function attendanceStatuses(sessionId) {
  const rows = await db.prepare('SELECT swimmer_id, status FROM attendance WHERE session_id = ?').all(sessionId);
  const map = {};
  rows.forEach(r => { map[r.swimmer_id] = r.status; });
  return map;
}

/* عند المسح: تسجيل باقي اللاعبين غياباً تلقائياً في استعلام واحد سريع */
async function seedAbsentForSession(sessionId, exceptSwimmerId) {
  const groupIds = await sessionGroupIds(sessionId);
  if (!groupIds.length) return;
  await syncGroups(groupIds);
  const placeholders = groupIds.map(() => '?').join(',');
  await db.prepare(`INSERT OR IGNORE INTO attendance (session_id, swimmer_id, status)
    SELECT ?, sg.swimmer_id, 'absent' FROM swimmer_group sg
    WHERE sg.group_id IN (${placeholders}) AND sg.swimmer_id <> ?`)
    .run(sessionId, ...groupIds, Number(exceptSwimmerId) || 0);
}

async function attendanceRowCount(sessionId) {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM attendance WHERE session_id = ?').get(sessionId);
  return Number(row && row.c) || 0;
}

module.exports = {
  groupStartTime,
  syncGroupMembers,
  syncGroups,
  sessionGroupIds,
  findGroupSession,
  ensureGroupSession,
  groupRoster,
  sessionRoster,
  attendanceStatuses,
  seedAbsentForSession,
  attendanceRowCount
};
