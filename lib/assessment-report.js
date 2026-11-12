/* بيانات تقارير التقييم الفني: كل المستويات + النسب + الحضور والغياب */
const { db } = require('./db');

function round(v) { return Math.round(v * 1000) / 1000; }
function avgValue(total, count) { return count ? round(total / count) : 0; }

function parseScores(raw) {
  try {
    const o = JSON.parse(raw || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch (e) { return {}; }
}

async function criteriaIndex() {
  const all = await db.prepare('SELECT * FROM assessment_criteria ORDER BY order_no, id').all();
  const map = {}, general = [], byLevel = {};
  all.forEach(function (c) {
    map[c.id] = c;
    if (c.level_id === null || c.level_id === undefined) general.push(c);
    else {
      const k = String(c.level_id);
      (byLevel[k] = byLevel[k] || []).push(c);
    }
  });
  return { all: all, map: map, general: general, byLevel: byLevel };
}

async function levelsList() {
  return await db.prepare('SELECT * FROM levels ORDER BY order_no, id').all();
}

function recordScores(list, scores) {
  return (list || []).map(function (c) {
    const raw = scores[c.id];
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return { id: c.id, name: c.name, category: c.category, score: Math.min(100, Math.max(0, n)) };
  }).filter(Boolean);
}

function totals(skills) {
  const total = skills.reduce(function (s, k) { return s + k.score; }, 0);
  return { total: total, count: skills.length, avg: avgValue(total, skills.length) };
}

function attendanceSummary(records) {
  const stats = { total: 0, present: 0, absent: 0, excused: 0, late: 0, rate: 0 };
  (records || []).forEach(function (r) {
    stats.total++;
    if (stats[r.status] !== undefined) stats[r.status]++;
  });
  stats.rate = stats.total ? Math.round((stats.present / stats.total) * 100) : 0;
  return stats;
}

function buildSwimmer(swimmer, assessments, attRecords, idx, levels) {
  const latestLevel = {};
  let genRow = null;
  (assessments || []).forEach(function (a) {
    if (a.level_id === null || a.level_id === undefined) {
      if (!genRow) genRow = a;
      return;
    }
    const k = String(a.level_id);
    if (!latestLevel[k]) latestLevel[k] = a;
  });

  const genRaw = genRow ? parseScores(genRow.scores) : {};
  const generalSkills = recordScores(idx.general, genRaw).map(function (s) { s.isGeneral = true; return s; });
  const generalTotals = totals(generalSkills);
  const general = {
    skills: generalSkills, total: generalTotals.total, count: generalTotals.count,
    avg: generalTotals.avg, assessment: genRow || null
  };

  const allLevels = [];
  (levels || []).forEach(function (lvl) {
    const k = String(lvl.id);
    const row = latestLevel[k] || null;
    if (row && !row.level_name) row.level_name = lvl.name;
    const sc = row ? parseScores(row.scores) : {};
    const crit = idx.byLevel[k] || [];
    if (!crit.length && !row) return;
    const own = recordScores(crit, sc).map(function (s) { s.isGeneral = false; return s; });
    const ownTotals = totals(own);
    /* المستوى لا يُعتبر مقيّماً إلا إذا سُجلت مهارة واحدة على الأقل من مهاراته،
       حتى لا تظهر نسبة مبنية على المعايير العامة وحدها لمستوى لم يُقيَّم بعد. */
    const assessed = !!(row && ownTotals.count);
    const skills = assessed ? own.concat(generalSkills) : [];
    const allTotals = totals(skills);
    allLevels.push({
      level: lvl,
      assessment: row,
      ownSkills: own,
      skills: skills,
      ownTotal: ownTotals.total,
      ownCount: ownTotals.count,
      ownPercent: ownTotals.count ? ownTotals.avg : null,
      total: allTotals.total,
      count: allTotals.count,
      percent: assessed && allTotals.count ? allTotals.avg : null,
      avg: assessed ? allTotals.avg : null,
      assessed: assessed
    });
  });

  const assessedLevels = allLevels.filter(function (l) { return l.assessed && l.skills.length; });
  const totalSkills = assessedLevels.reduce(function (n, l) { return n + l.count; }, 0);
  const grandSum = assessedLevels.reduce(function (s, l) { return s + l.total; }, 0);
  const grandAvg = totalSkills ? round(grandSum / totalSkills) : 0;
  const att = attendanceSummary(attRecords);

  return {
    swimmer: swimmer,
    levels: assessedLevels,
    allLevels: allLevels,
    general: general,
    totalLevels: assessedLevels.length,
    allSkills: totalSkills,
    grandSum: grandSum,
    grandAvg: grandAvg,
    attendance: { stats: att, records: attRecords || [] }
  };
}

async function assessmentRows(swimmerIds, opts) {
  if (!swimmerIds.length) return [];
  const ph = swimmerIds.map(function () { return '?'; }).join(',');
  let sql = 'SELECT a.*, c.full_name AS coach_name FROM assessments a LEFT JOIN coaches c ON c.id = a.coach_id WHERE a.swimmer_id IN (' + ph + ')';
  const args = swimmerIds.slice();
  if (opts && opts.from) { sql += ' AND a.date >= ?'; args.push(opts.from); }
  if (opts && opts.to) { sql += ' AND a.date <= ?'; args.push(opts.to); }
  sql += ' ORDER BY a.date DESC, a.id DESC';
  return await db.prepare(sql).all(...args);
}

async function attendanceRows(swimmerIds, opts) {
  if (!swimmerIds.length) return [];
  const ph = swimmerIds.map(function () { return '?'; }).join(',');
  let sql = 'SELECT a.session_id, a.swimmer_id, a.status, a.reason, se.date, se.title, se.start_time'
    + ' FROM attendance a JOIN sessions se ON se.id = a.session_id'
    + ' WHERE se.deleted_at IS NULL AND a.swimmer_id IN (' + ph + ')';
  const args = swimmerIds.slice();
  if (opts && opts.from) { sql += ' AND se.date >= ?'; args.push(opts.from); }
  if (opts && opts.to) { sql += ' AND se.date <= ?'; args.push(opts.to); }
  sql += ' ORDER BY se.date DESC, se.start_time DESC';
  return await db.prepare(sql).all(...args);
}

/* تقرير لاعب واحد: أحدث تقييم لكل مستوى + المعايير العامة + الحضور */
async function swimmerReportData(swimmerId, opts) {
  const swimmer = await db.prepare(`SELECT s.*, l.name AS level_name, gr.name AS group_name, c.full_name AS coach_name, p.name AS program_name FROM swimmers s
    LEFT JOIN levels l ON l.id = s.level_id LEFT JOIN groups gr ON gr.id = s.group_id
    LEFT JOIN coaches c ON c.id = s.coach_id LEFT JOIN programs p ON p.id = s.program_id
    WHERE s.id = ?`).get(swimmerId);
  if (!swimmer) return null;
  const idx = await criteriaIndex();
  const levels = await levelsList();
  const rows = await assessmentRows([swimmerId], opts);
  const att = await attendanceRows([swimmerId], opts);
  return buildSwimmer(swimmer, rows, att, idx, levels);
}

/* تقرير مجموعة كاملة: كل لاعب + كل مستوياته + الحضور، مع إجماليات المجموعة */
async function groupReportData(groupId, opts) {
  const group = await db.prepare(`SELECT g.*, p.name AS program_name, c.full_name AS coach_name FROM groups g
    LEFT JOIN programs p ON p.id = g.program_id LEFT JOIN coaches c ON c.id = g.coach_id
    WHERE g.id = ? AND g.deleted_at IS NULL`).get(groupId);
  if (!group) return null;
  const members = await db.prepare(`SELECT DISTINCT s.*, l.name AS level_name, c.full_name AS coach_name, p.name AS program_name
    FROM swimmers s
    LEFT JOIN levels l ON l.id = s.level_id LEFT JOIN coaches c ON c.id = s.coach_id
    LEFT JOIN programs p ON p.id = s.program_id
    WHERE s.deleted_at IS NULL
      AND (s.group_id = ? OR EXISTS (SELECT 1 FROM swimmer_group sg WHERE sg.swimmer_id = s.id AND sg.group_id = ?))
    ORDER BY s.full_name`).all(groupId, groupId);

  const ids = members.map(function (m) { return m.id; });
  const idx = await criteriaIndex();
  const levels = await levelsList();
  const rows = await assessmentRows(ids, opts);
  const att = await attendanceRows(ids, opts);

  const bySwimmer = {}, attBySwimmer = {};
  rows.forEach(function (r) { (bySwimmer[r.swimmer_id] = bySwimmer[r.swimmer_id] || []).push(r); });
  att.forEach(function (r) { (attBySwimmer[r.swimmer_id] = attBySwimmer[r.swimmer_id] || []).push(r); });

  const swimmers = members.map(function (m) {
    return buildSwimmer(m, bySwimmer[m.id] || [], attBySwimmer[m.id] || [], idx, levels);
  });

  const assessedSwimmers = swimmers.filter(function (s) { return s.allSkills > 0; });
  const totalsObj = {
    members: swimmers.length,
    assessed: assessedSwimmers.length,
    average: assessedSwimmers.length
      ? round(assessedSwimmers.reduce(function (x, s) { return x + s.grandAvg; }, 0) / assessedSwimmers.length)
      : 0,
    attendance: { total: 0, present: 0, absent: 0, excused: 0, late: 0, rate: 0 }
  };
  swimmers.forEach(function (s) {
    const a = s.attendance.stats;
    totalsObj.attendance.total += a.total;
    totalsObj.attendance.present += a.present;
    totalsObj.attendance.absent += a.absent;
    totalsObj.attendance.excused += a.excused;
    totalsObj.attendance.late += a.late;
  });
  totalsObj.attendance.rate = totalsObj.attendance.total
    ? Math.round((totalsObj.attendance.present / totalsObj.attendance.total) * 100)
    : 0;

  return {
    group: group,
    swimmers: swimmers,
    totals: totalsObj,
    from: (opts && opts.from) || null,
    to: (opts && opts.to) || null
  };
}

module.exports = {
  swimmerReportData: swimmerReportData,
  groupReportData: groupReportData,
  attendanceSummary: attendanceSummary,
  attendanceRows: attendanceRows,
  criteriaIndex: criteriaIndex,
  levelsList: levelsList
};
