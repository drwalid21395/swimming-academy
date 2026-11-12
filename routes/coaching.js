/** الجوانب الفنية: التقييمات، الاختبارات، الفرق، البطولات، الأزمنة الشخصية */
const express = require('express');
const { db } = require('../lib/db');
const { audit, money, fmtDate, canView, canAdd, canEdit, canDel, canExport } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const { activeSport, sportClause, progClause, groupClause, swimmerOfClause } = require('../lib/sport-context');
const pdfmake = require('../lib/pdf');
const assessmentReports = require('../lib/assessment-report');
const router = express.Router();

async function swimmerOptions(sid) {
  return (await db.prepare('SELECT id, full_name, membership_no, level_id FROM swimmers WHERE deleted_at IS NULL' + progClause(sid, 'swimmers') + ' ORDER BY full_name').all())
    .map(s => ({ value: s.id, label: s.full_name + ' (' + s.membership_no + ')', level: s.level_id || '' }));
}
async function coachOptions(sid) {
  return (await db.prepare('SELECT id, full_name FROM coaches WHERE deleted_at IS NULL' + sportClause(sid, 'coaches') + ' ORDER BY full_name').all()).map(c => ({ value: c.id, label: c.full_name }));
}
async function programOptions(sid) {
  return (await db.prepare('SELECT * FROM programs WHERE deleted_at IS NULL' + sportClause(sid, 'programs') + ' ORDER BY name').all()).map(p => ({ value: p.id, label: p.name }));
}
async function levelOptions(sid) {
  return (await db.prepare('SELECT * FROM levels WHERE 1=1' + sportClause(sid, 'levels') + ' ORDER BY order_no').all()).map(l => ({ value: l.id, label: l.name }));
}

async function criteriaFor(levelId) {
  return levelId
    ? await db.prepare('SELECT * FROM assessment_criteria WHERE level_id = ? ORDER BY order_no').all(levelId)
    : await db.prepare('SELECT * FROM assessment_criteria WHERE level_id IS NULL ORDER BY order_no').all();
}

/* المعايير العامة (مشتركة): تظهر مرة واحدة في قسم مستقل وتُضمّن في كل المستويات */
async function generalCriteria() {
  return await db.prepare('SELECT * FROM assessment_criteria WHERE level_id IS NULL ORDER BY order_no, id').all();
}

/* كل المستويات مع مهاراتها (لنموذج التقييم الشامل) */
async function levelGroups(sid, currentLevelId) {
  const levels = await levelOptions(sid);
  const groups = [];
  for (const l of levels) {
    groups.push({
      level: { ...l, current: currentLevelId !== null && currentLevelId !== undefined && String(l.value) === String(currentLevelId) },
      criteria: await criteriaFor(l.value)
    });
  }
  return groups;
}

/* قراءة تقييم (scores) من req.body مقسّمة إلى: مستوى محدد + معايير عامة */
async function parseScores(b) {
  const critLevel = {};
  (await db.prepare('SELECT id, level_id FROM assessment_criteria').all()).forEach(c => { critLevel[c.id] = c.level_id == null ? null : String(c.level_id); });
  const perLevel = {};
  const sharedScores = {};
  Object.keys(b).forEach(k => {
    const m = /^score_(\d+)$/.exec(k);
    if (m && b[k] !== undefined && b[k] !== '') {
      const cid = Number(m[1]);
      const v = Math.min(100, Math.max(0, Number(b[k])));
      const lid = critLevel[cid];
      if (lid === null || lid === undefined) {
        sharedScores[cid] = v;
      } else {
        const g = (perLevel[lid] = perLevel[lid] || { scores: {}, n: 0, sum: 0 });
        g.scores[cid] = v; g.n++; g.sum += v;
      }
    }
  });
  const shared = { scores: sharedScores, n: Object.keys(sharedScores).length, sum: Object.keys(sharedScores).reduce((s, k) => s + sharedScores[k], 0) };
  return { perLevel, shared };
}

/* قراءة scores من صف واحد في نموذج اختبار المجموعة */
async function parseRowScores(row) {
  const critLevel = {};
  (await db.prepare('SELECT id, level_id FROM assessment_criteria').all()).forEach(c => { critLevel[c.id] = c.level_id == null ? null : String(c.level_id); });
  const perLevel = {};
  Object.keys(row || {}).forEach(k => {
    const m = /^score_(\d+)$/.exec(k);
    if (m && row[k] !== undefined && row[k] !== '') {
      const cid = Number(m[1]);
      const v = Math.min(100, Math.max(0, Number(row[k])));
      const lid = critLevel[cid];
      if (lid != null) {
        const g = (perLevel[lid] = perLevel[lid] || { scores: {}, n: 0, sum: 0 });
        g.scores[cid] = v; g.n++; g.sum += v;
      }
    }
  });
  return perLevel;
}

/* ============================================================== */
/*                          التقييمات الفنية                       */
/* ============================================================== */
function todayISO() { return new Date().toISOString().slice(0, 10); }

/* كل المجموعات مع عدد اللاعبين وعدد من تم تقييمهم اليوم */
async function assessmentGroupsOverview(sid) {
  const groups = await db.prepare(`SELECT g.id, g.name, g.capacity, g.program_id, g.coach_id,
      p.name AS program_name, c.full_name AS coach_name,
      (SELECT COUNT(*) FROM swimmers s
        WHERE s.deleted_at IS NULL
          AND (s.group_id = g.id OR EXISTS (SELECT 1 FROM swimmer_group sg WHERE sg.swimmer_id = s.id AND sg.group_id = g.id))) AS members
    FROM groups g
    LEFT JOIN programs p ON p.id = g.program_id
    LEFT JOIN coaches c ON c.id = g.coach_id
    WHERE g.deleted_at IS NULL` + groupClause(sid, 'g') + `
    ORDER BY g.name`).all();
  const assessed = {};
  (await db.prepare(`SELECT g.id AS group_id, COUNT(DISTINCT a.swimmer_id) AS c
      FROM groups g
      JOIN swimmers s ON s.deleted_at IS NULL
        AND (s.group_id = g.id OR EXISTS (SELECT 1 FROM swimmer_group sg WHERE sg.swimmer_id = s.id AND sg.group_id = g.id))
      JOIN assessments a ON a.swimmer_id = s.id AND a.date = ?
      WHERE g.deleted_at IS NULL
      GROUP BY g.id`).all(todayISO())).forEach(r => { assessed[r.group_id] = r.c; });
  groups.forEach(g => { g.assessed_today = assessed[g.id] || 0; });
  return groups;
}

/* شجرة معايير التقييم: العامة + معايير كل مستوى */
async function criteriaTree() {
  const all = await db.prepare('SELECT * FROM assessment_criteria ORDER BY order_no, id').all();
  const general = [];
  const byLevel = {};
  all.forEach(c => {
    if (c.level_id == null) general.push(c);
    else {
      const k = String(c.level_id);
      (byLevel[k] = byLevel[k] || []).push(c);
    }
  });
  return { general, byLevel };
}

/* يوجد تقييم محفوظ لنفس اللاعب/المستوى/التاريخ؟ (لمنع إنشاء سجل صفري جديد وهمي) */
async function assessmentExistsForDate(swimmerId, levelId, date) {
  const row = levelId == null
    ? await db.prepare('SELECT 1 FROM assessments WHERE swimmer_id = ? AND level_id IS NULL AND date = ? LIMIT 1').get(swimmerId, date)
    : await db.prepare('SELECT 1 FROM assessments WHERE swimmer_id = ? AND level_id = ? AND date = ? LIMIT 1').get(swimmerId, levelId, date);
  return !!row;
}
function hasNonZeroScore(g) {
  return !!(g && g.scores && Object.keys(g.scores).some(k => Number(g.scores[k]) > 0));
}

/* أحدث نسبة مسجلة لكل مهارة لكل مستوى + المعايير العامة (لتعبئة النموذج الكامل من نفس بيانات الكارت السريع) */
async function latestScoresFor(swimmerId) {
  const rows = await db.prepare(`SELECT * FROM assessments WHERE swimmer_id = ? ORDER BY date DESC, id DESC`).all(swimmerId);
  const seen = {};
  const values = {};
  rows.forEach(function (a) {
    const key = a.level_id == null ? 'g' : String(a.level_id);
    if (seen[key]) return;
    seen[key] = true;
    let sc = {};
    try { sc = JSON.parse(a.scores || '{}'); } catch (e) { sc = {}; }
    Object.keys(sc).forEach(function (cid) { values['score_' + cid] = sc[cid]; });
  });
  return values;
}

/* حفظ حقول التحليل والملاحظات على سجل التقييم */
async function saveAssessmentMeta(id, b) {
  if (!id || !b) return;
  await db.prepare(`UPDATE assessments SET strengths = ?, weaknesses = ?, recommendations = ?, ready_to_advance = ?, next_assessment_date = ?, notes = ? WHERE id = ?`)
    .run(b.strengths || '', b.weaknesses || '', b.recommendations || '', b.ready_to_advance === '1' ? 1 : 0, b.next_assessment_date || null, b.notes || '', id);
}

/* تعيين مستوى اللاعب إذا كان بلا مستوى: المختار صراحةً أو الأول حسب ترتيب المستويات */
async function assignFirstLevel(swimmerId, preferLevelId, savedLevelIds) {
  const sw = await db.prepare('SELECT id, level_id FROM swimmers WHERE id = ?').get(swimmerId);
  if (!sw || sw.level_id != null) return sw ? Number(sw.level_id) : null;
  let prefer = preferLevelId ? Number(preferLevelId) : null;
  if (prefer) {
    const lvl = await db.prepare('SELECT id FROM levels WHERE id = ?').get(prefer);
    if (!lvl) prefer = null;
  }
  const ids = (savedLevelIds || []).filter(function (n) { return Number.isFinite(Number(n)); }).map(Number);
  if (!prefer && ids.length) {
    const ph = ids.map(function () { return '?'; }).join(',');
    const ordered = await db.prepare('SELECT id FROM levels WHERE id IN (' + ph + ') ORDER BY order_no, id').all(...ids);
    if (ordered.length) prefer = Number(ordered[0].id);
  }
  if (!prefer) return null;
  await db.prepare('UPDATE swimmers SET level_id = ? WHERE id = ? AND level_id IS NULL').run(prefer, swimmerId);
  return prefer;
}

/* حفظ/تحديث تقييم نفس اليوم (بدل إنشاء نسخة جديدة في كل مرة) */
async function upsertAssessmentForDate(swimmerId, levelId, date, g, b, userId, group) {
  if (!g || !g.n) return null;
  const row = levelId == null
    ? await db.prepare('SELECT id FROM assessments WHERE swimmer_id = ? AND level_id IS NULL AND date = ? ORDER BY id DESC LIMIT 1').get(swimmerId, date)
    : await db.prepare('SELECT id FROM assessments WHERE swimmer_id = ? AND level_id = ? AND date = ? ORDER BY id DESC LIMIT 1').get(swimmerId, levelId, date);
  const overall = Math.round((g.sum / g.n) * 1000) / 1000;
  const coachId = (b && b.coach_id) || (group && group.coach_id) || null;
  const programId = (b && b.program_id) || (group && group.program_id) || null;
  if (row) {
    await db.prepare(`UPDATE assessments SET scores = ?, overall_percent = ?, coach_id = COALESCE(?, coach_id), program_id = COALESCE(?, program_id) WHERE id = ?`)
      .run(JSON.stringify(g.scores), overall, coachId, programId, row.id);
    return row.id;
  }
  const info = await db.prepare(`INSERT INTO assessments (swimmer_id, coach_id, program_id, level_id, date, scores, overall_percent, created_by)
      VALUES (?,?,?,?,?,?,?,?)`)
    .run(swimmerId, coachId, programId, levelId, date, JSON.stringify(g.scores), overall, userId);
  return info.lastInsertRowid;
}

/* صفحة التقييمات: كل المجموعات في مكان واحد */
router.get('/assessments', async function (req, res) {
  if (!canView(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const sid = activeSport(req);
  const groups = await assessmentGroupsOverview(sid);
  const totalRes = await db.prepare(`SELECT COUNT(DISTINCT s.id) AS c FROM swimmers s
      WHERE s.deleted_at IS NULL
        AND (s.group_id IS NOT NULL OR EXISTS (SELECT 1 FROM swimmer_group sg WHERE sg.swimmer_id = s.id))` + progClause(sid, 's')).get();
  const totalMembers = Number((totalRes && totalRes.c) || 0);
  const assessedRes = await db.prepare(`SELECT COUNT(DISTINCT a.swimmer_id) AS c
      FROM assessments a JOIN swimmers s ON s.id = a.swimmer_id AND s.deleted_at IS NULL
      WHERE a.date = ?
        AND (s.group_id IS NOT NULL OR EXISTS (SELECT 1 FROM swimmer_group sg WHERE sg.swimmer_id = s.id))` + progClause(sid, 's')).get(todayISO());
  const assessedToday = Number((assessedRes && assessedRes.c) || 0);
  const ungrouped = await db.prepare(`SELECT COUNT(*) AS c FROM swimmers s
      WHERE s.deleted_at IS NULL AND s.group_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM swimmer_group sg WHERE sg.swimmer_id = s.id)` + progClause(sid, 's')).get();
  const ungroupedSwimmers = await db.prepare(`SELECT s.id, s.full_name, s.membership_no, l.name AS level_name
      FROM swimmers s
      LEFT JOIN levels l ON l.id = s.level_id
      WHERE s.deleted_at IS NULL AND s.group_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM swimmer_group sg WHERE sg.swimmer_id = s.id)` + progClause(sid, 's') + `
      ORDER BY s.full_name`).all();
  const availableGroups = await db.prepare(`SELECT g.id, g.name, g.capacity,
      (SELECT COUNT(*) FROM swimmer_group sg WHERE sg.group_id = g.id) AS members
      FROM groups g WHERE g.deleted_at IS NULL` + groupClause(sid, 'g') + ` ORDER BY g.name`).all();
  const teams = await db.prepare(`SELECT t.*, c.full_name AS coach_name,
      (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS members
      FROM teams t LEFT JOIN coaches c ON c.id = t.coach_id
      WHERE 1=1` + sportClause(sid, 't') + `
      ORDER BY t.name`).all();
  const teamAssessed = {};
  (await db.prepare(`SELECT tm.team_id AS id, COUNT(DISTINCT a.swimmer_id) AS c
      FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      JOIN swimmers s ON s.id = tm.swimmer_id AND s.deleted_at IS NULL
      JOIN assessments a ON a.swimmer_id = s.id AND a.date = ?
      WHERE 1=1` + sportClause(sid, 't') + `
      GROUP BY tm.team_id`).all(todayISO())).forEach(function (r) { teamAssessed[r.id] = r.c; });
  teams.forEach(function (t) { t.assessed_today = teamAssessed[t.id] || 0; });
  res.render('assessments_home', {
    title: 'التقييمات الفنية', active: 'assessments',
    groups, totalMembers, assessedToday, ungroupedCount: Number((ungrouped && ungrouped.c) || 0),
    ungroupedSwimmers, availableGroups, teams, userCanExport: canExport(req.currentUser, 'assessments')
  });
});

/* تسكين لاعبين غير مضافين في مجموعة من صفحة التقييمات */
router.post('/assessments/assign-ungrouped', async function (req, res) {
  if (!canAdd(req.currentUser, 'assessments') && !canEdit(req.currentUser, 'assessments')) {
    return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  }
  const b = req.body;
  const groupId = Number(b.group_id || 0);
  const group = groupId ? await db.prepare('SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL').get(groupId) : null;
  if (!group) {
    setFlash(res, { type: 'error', message: 'اختر مجموعة صحيحة' });
    return res.redirect('/assessments');
  }
  const ids = Array.isArray(b.swimmer_ids) ? b.swimmer_ids.map(Number).filter(Boolean) : (b.swimmer_ids ? [Number(b.swimmer_ids)].filter(Boolean) : []);
  if (!ids.length) {
    setFlash(res, { type: 'error', message: 'اختر لاعباً واحداً على الأقل' });
    return res.redirect('/assessments');
  }
  const cap = Number(group.capacity) || 12;
  let assigned = 0, skipped = 0;
  for (const swimmerId of ids) {
    try {
      const sw = await db.prepare('SELECT id, full_name, group_id FROM swimmers WHERE id = ? AND deleted_at IS NULL').get(swimmerId);
      if (!sw || sw.group_id != null || await db.prepare('SELECT 1 FROM swimmer_group WHERE swimmer_id = ? LIMIT 1').get(swimmerId)) { skipped++; continue; }
      const count = Number((await db.prepare('SELECT COUNT(*) AS c FROM swimmer_group WHERE group_id = ?').get(groupId)).c || 0);
      if (count >= cap) { skipped++; continue; }
      await db.prepare('UPDATE swimmers SET group_id = ?, coach_id = ? WHERE id = ?')
        .run(groupId, group.coach_id || null, swimmerId);
      await db.prepare('INSERT OR IGNORE INTO swimmer_group (swimmer_id, group_id) VALUES (?, ?)').run(swimmerId, groupId);
      audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'swimmers', swimmerId, 'تسكين اللاعب ' + sw.full_name + ' في مجموعة ' + group.name, req);
      assigned++;
    } catch (e) {
      console.error('خطأ في تسكين اللاعب', swimmerId, e.message);
      skipped++;
    }
  }
  if (assigned) {
    setFlash(res, { type: 'success', message: 'تم تسكين ' + assigned + ' لاعب في مجموعة ' + group.name + (skipped ? ' وتجاوز ' + skipped + ' لاعب (مضاف مسبقاً أو المجموعة ممتلئة)' : '') });
  } else {
    setFlash(res, { type: 'error', message: 'لم يتم تسكين أي لاعب — قد تكون المجموعة ممتلئة أو اللاعبون مضافون بالفعل' });
  }
  res.redirect('/assessments');
});

/* صفحة تقييم مجموعة: تظهر كل لاعبيها وتُحفظ النسب تلقائياً */
router.get('/assessments/groups/:id', async function (req, res) {
  if (!canView(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const sid = activeSport(req);
  const group = await db.prepare(`SELECT g.*, p.name AS program_name, c.full_name AS coach_name
      FROM groups g LEFT JOIN programs p ON p.id = g.program_id LEFT JOIN coaches c ON c.id = g.coach_id
      WHERE g.id = ? AND g.deleted_at IS NULL` + groupClause(sid, 'g')).get(id);
  if (!group) return res.redirect('/assessments');

  const members = await db.prepare(`SELECT DISTINCT s.id, s.full_name, s.membership_no, s.level_id, s.program_id,
        l.name AS level_name,
        (SELECT a.date FROM assessments a
          WHERE a.swimmer_id = s.id AND (a.level_id = s.level_id OR a.level_id IS NULL OR s.level_id IS NULL)
          ORDER BY (a.level_id IS NULL), a.date DESC, a.id DESC LIMIT 1) AS last_date,
        (SELECT a.overall_percent FROM assessments a
          WHERE a.swimmer_id = s.id AND (a.level_id = s.level_id OR a.level_id IS NULL OR s.level_id IS NULL)
          ORDER BY (a.level_id IS NULL), a.date DESC, a.id DESC LIMIT 1) AS last_percent,
        (SELECT COUNT(*) FROM assessments a WHERE a.swimmer_id = s.id AND a.date = ?) AS assessed_today
      FROM swimmers s
      LEFT JOIN levels l ON l.id = s.level_id
      WHERE s.deleted_at IS NULL
        AND (s.group_id = ? OR EXISTS (SELECT 1 FROM swimmer_group sg WHERE sg.swimmer_id = s.id AND sg.group_id = ?))
      ORDER BY s.full_name`).all(todayISO(), id, id);

  const { general, byLevel } = await criteriaTree();
  const today = todayISO();
  const savedScores = {};
  const levelPercents = {};
  if (members.length) {
    const ids = members.map(m => m.id);
    const ph = ids.map(() => '?').join(',');
    const rows = await db.prepare(`SELECT * FROM assessments WHERE swimmer_id IN (${ph}) ORDER BY date DESC, id DESC`).all(...ids);
    /* أحدث تقييم لكل مستوى + أحدث تقييم للمعايير العامة لكل لاعب */
    const latestBySwimmer = {};
    rows.forEach(a => {
      const key = a.level_id == null ? 'g' : String(a.level_id);
      const box = (latestBySwimmer[a.swimmer_id] = latestBySwimmer[a.swimmer_id] || {});
      if (!box[key]) box[key] = a;
    });
    Object.keys(latestBySwimmer).forEach(sid => {
      savedScores[sid] = {};
      levelPercents[sid] = {};
      const box = latestBySwimmer[sid];
      Object.keys(box).forEach(key => {
        const a = box[key];
        let scores = {};
        try { scores = JSON.parse(a.scores || '{}'); } catch (e) { scores = {}; }
        Object.keys(scores).forEach(cid => { savedScores[sid][cid] = scores[cid]; });
        if (a.overall_percent !== null && a.overall_percent !== undefined) {
          levelPercents[sid][key] = { percent: a.overall_percent, date: a.date };
        }
      });
    });
  }

  /* خيارات الإضافة: فقط اللاعبون غير المضافين لأي مجموعة */
  const ungrouped = await db.prepare(`SELECT s.id, s.full_name, s.membership_no
      FROM swimmers s
      WHERE s.deleted_at IS NULL AND s.group_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM swimmer_group sg WHERE sg.swimmer_id = s.id)` + progClause(sid, 's') + `
      ORDER BY s.full_name`).all();

  res.render('assessment_group', {
    title: 'تقييم مجموعة ' + group.name, active: 'assessments',
    group, members, generalCriteria: general, criteriaByLevel: byLevel,
    savedScores, levelPercents, ungrouped, today,
    levels: (await levelOptions(sid)).filter(function (l) { return byLevel[String(l.value)] && byLevel[String(l.value)].length; }),
    criteriaJson: JSON.stringify(byLevel).replace(/</g, '\\u003c')
  });
});

/* إضافة لاعب غير مضاف لأي مجموعة إلى هذه المجموعة (ثم يظهر للتقييم فوراً) */
router.post('/assessments/groups/:id/add-swimmer', async function (req, res) {
  if (!canAdd(req.currentUser, 'assessments') && !canEdit(req.currentUser, 'assessments')) {
    return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  }
  const gid = Number(req.params.id);
  const sid = activeSport(req);
  const group = await db.prepare('SELECT * FROM groups g WHERE g.id = ? AND g.deleted_at IS NULL' + groupClause(sid, 'g')).get(gid);
  if (!group) {
    setFlash(res, { type: 'error', message: 'المجموعة غير موجودة' });
    return res.redirect('/assessments');
  }
  const swimmerId = Number(req.body.swimmer_id || 0);
  const sw = swimmerId ? await db.prepare('SELECT id, full_name, group_id FROM swimmers WHERE id = ? AND deleted_at IS NULL').get(swimmerId) : null;
  if (!sw) {
    setFlash(res, { type: 'error', message: 'اختر لاعباً صحيحاً' });
    return res.redirect('/assessments/groups/' + gid);
  }
  const already = sw.group_id != null || await db.prepare('SELECT 1 FROM swimmer_group WHERE swimmer_id = ? LIMIT 1').get(swimmerId);
  if (already) {
    setFlash(res, { type: 'error', message: 'هذا اللاعب مضاف بالفعل إلى مجموعة — يقتصر خيار الإضافة على اللاعبين غير المضافين لأي مجموعة' });
    return res.redirect('/assessments/groups/' + gid);
  }
  const cap = Number(group.capacity) || 12;
  const count = Number((await db.prepare('SELECT COUNT(*) AS c FROM swimmer_group WHERE group_id = ?').get(gid)).c || 0);
  if (count >= cap) {
    setFlash(res, { type: 'error', message: 'المجموعة ممتلئة — العدد الأقصى ' + cap + ' عضو' });
    return res.redirect('/assessments/groups/' + gid);
  }
  await db.prepare('UPDATE swimmers SET group_id = ? WHERE id = ?').run(gid, swimmerId);
  await db.prepare('INSERT OR IGNORE INTO swimmer_group (swimmer_id, group_id) VALUES (?,?)').run(swimmerId, gid);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'groups', gid, 'إضافة لاعب #' + swimmerId + ' إلى المجموعة من صفحة التقييم', req);
  setFlash(res, { type: 'success', message: 'تمت إضافة ' + sw.full_name + ' إلى المجموعة — أصبح جاهزاً للتقييم' });
  res.redirect('/assessments/groups/' + gid);
});

/* حفظ تلقائي لتقييم لاعب واحد من صفحة المجموعة */
router.post('/assessments/groups/:gid/swimmer/:sid/quick', async function (req, res) {
  if (!canAdd(req.currentUser, 'assessments') && !canEdit(req.currentUser, 'assessments')) {
    return res.status(403).json({ ok: false, error: 'لا تملك صلاحية التقييم' });
  }
  const gid = Number(req.params.gid), swimmerId = Number(req.params.sid);
  const isAjax = String(req.get('X-Requested-With') || '').toLowerCase() === 'xmlhttprequest' || (req.get('Accept') || '').includes('application/json');
  const group = await db.prepare('SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL').get(gid);
  if (!group) return res.status(404).json({ ok: false, error: 'المجموعة غير موجودة' });
  const member = await db.prepare(`SELECT s.id, s.level_id FROM swimmers s
      WHERE s.id = ? AND s.deleted_at IS NULL
        AND (s.group_id = ? OR EXISTS (SELECT 1 FROM swimmer_group sg WHERE sg.swimmer_id = s.id AND sg.group_id = ?))`).get(swimmerId, gid, gid);
  if (!member) return res.status(404).json({ ok: false, error: 'اللاعب غير موجود في هذه المجموعة' });

  const b = req.body || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : todayISO();
  const { perLevel, shared } = await parseScores(b);
  const levelResults = {};
  for (const lid of Object.keys(perLevel)) {
    const g = perLevel[lid];
    if (!g || !g.n) continue;
    if (!hasNonZeroScore(g) && !(await assessmentExistsForDate(swimmerId, Number(lid), date))) continue;
    await upsertAssessmentForDate(swimmerId, Number(lid), date, g, b, req.currentUser.id, group);
    levelResults[lid] = Math.round((g.sum / g.n) * 1000) / 1000;
  }
  let generalPercent = null;
  if (shared && shared.n && (hasNonZeroScore(shared) || await assessmentExistsForDate(swimmerId, null, date))) {
    await upsertAssessmentForDate(swimmerId, null, date, shared, b, req.currentUser.id, group);
    generalPercent = Math.round((shared.sum / shared.n) * 1000) / 1000;
  }

  /* تعيين المستوى الأول للاعب الذي لم يكن له مستوى (لا يغيّر مستوى لاعب موجود) */
  let assignedLevelId = member.level_id != null ? Number(member.level_id) : null;
  if (assignedLevelId == null) {
    let prefer = b.level_id ? Number(b.level_id) : null;
    if (prefer) {
      const lvl = await db.prepare('SELECT id FROM levels WHERE id = ?').get(prefer);
      if (!lvl) prefer = null;
    }
    const scoredIds = Object.keys(levelResults).map(Number);
    if (!prefer && scoredIds.length) {
      const ph = scoredIds.map(function () { return '?'; }).join(',');
      const ordered = await db.prepare('SELECT id FROM levels WHERE id IN (' + ph + ') ORDER BY order_no, id').all(...scoredIds);
      if (ordered.length) prefer = Number(ordered[0].id);
    }
    if (prefer && (scoredIds.length || generalPercent !== null)) {
      await db.prepare('UPDATE swimmers SET level_id = ? WHERE id = ? AND level_id IS NULL').run(prefer, swimmerId);
      assignedLevelId = prefer;
    }
  }

  const levelIds = Object.keys(levelResults);
  const overall = levelIds.length
    ? Math.round((levelIds.reduce(function (s, k) { return s + levelResults[k]; }, 0) / levelIds.length) * 1000) / 1000
    : generalPercent;
  if (levelPercentEmpty(levelResults) && generalPercent === null) {
    if (!isAjax) {
      setFlash(res, { type: 'error', message: 'لم تُسجل أي نسب — غيّر نسبة مهارة واحدة على الأقل' });
      return res.redirect('/assessments/groups/' + gid);
    }
    return res.status(400).json({ ok: false, error: 'لم تُسجل أي نسب' });
  }
  if (!isAjax) {
    setFlash(res, { type: 'success', message: 'تم حفظ تقييم اللاعب' });
    return res.redirect('/assessments/groups/' + gid);
  }
  const currentKey = assignedLevelId != null ? String(assignedLevelId) : null;
  res.json({
    ok: true,
    percent: overall,
    level_percent: currentKey && levelResults[currentKey] !== undefined ? levelResults[currentKey] : null,
    general_percent: generalPercent,
    level_id: assignedLevelId,
    levels: levelResults,
    date,
    date_label: fmtDate(date),
    time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
  });
});

function levelPercentEmpty(obj) { return !obj || !Object.keys(obj).length; }

/* ============================================================== */
/*              تقارير التقييم الفني: PDF و Excel                  */
/* ============================================================== */
function xEsc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function xCell(v, cls) {
  return '<td' + (cls ? ' style="' + cls + '"' : '') + '>' + (v === null || v === undefined || v === '' ? '—' : xEsc(v)) + '</td>';
}
function xCellAttrs(v, attrs) {
  attrs = attrs || {};
  let s = '';
  if (attrs.rowspan) s += ' rowspan="' + attrs.rowspan + '"';
  if (attrs.colspan) s += ' colspan="' + attrs.colspan + '"';
  if (attrs.cls) s += ' style="' + attrs.cls + '"';
  return '<td' + s + '>' + (v === null || v === undefined || v === '' ? '—' : xEsc(v)) + '</td>';
}
function latestAssessmentDate(d) {
  let last = null;
  (d.levels || []).forEach(function (l) {
    if (l.assessment && l.assessment.date && (!last || String(l.assessment.date) > String(last))) last = l.assessment.date;
  });
  return last;
}

function buildGroupReportContent(data, todayStr, title) {
  const g = data.group;
  const t = data.totals;
  return [
    { text: 'الأكاديمية', style: 'academyTitle' },
    { text: title || 'التقرير الفني الشامل للمجموعة', style: 'reportTitle' },
    { text: 'تاريخ الإصدار: ' + todayStr, style: 'meta' },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 760, y2: 0, lineWidth: 1.6, lineColor: '#0284c7' }], margin: [0, 6, 0, 0] },
    { table: { headerRows: 0, widths: ['14%', '36%', '14%', '36%'], body: [
      [{ text: 'المجموعة', style: 'lbl' }, { text: g.name, style: 'val' }, { text: 'البرنامج', style: 'lbl' }, { text: g.program_name || '—', style: 'val' }],
      [{ text: 'الكابتن', style: 'lbl' }, { text: g.coach_name || '—', style: 'val' }, { text: 'عدد اللاعبين', style: 'lbl' }, { text: String(t.members), style: 'val' }]
    ] }, layout: 'noBorders', margin: [0, 10, 0, 4] },
    { table: { widths: ['20%', '20%', '20%', '20%', '20%'], body: [[
      { text: [String(t.members), { text: '\nلاعب', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#0284c7' },
      { text: [String(t.assessed), { text: '\nلاعب مقيَّم', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#0284c7' },
      { text: [t.average + '%', { text: '\nمتوسط التقييم', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#16a34a' },
      { text: [t.attendance.present + '/' + t.attendance.total, { text: '\nحضور', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#0284c7' },
      { text: [t.attendance.rate + '%', { text: '\nنسبة الحضور', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#ca8a04' }
    ]] }, layout: { defaultBorder: true, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 6, paddingBottom: () => 6 }, margin: [0, 2, 0, 0] },
    { text: 'ملخص اللاعبين', style: 'sectionTitle', margin: [0, 14, 0, 4] }
  ].concat(buildGroupSummaryTable(data)).concat([
    { text: 'تفصيل كل لاعب على كل المستويات', style: 'sectionTitle', margin: [0, 16, 0, 4] }
  ]).concat(buildGroupDetailBlocks(data)).concat([
    { table: { widths: ['33.3%', '33.3%', '33.3%'], body: [[
      { text: 'مدير الأكاديمية', style: 'sign' },
      { text: 'المدرب المسؤول', style: 'sign' },
      { text: 'التاريخ', style: 'sign' }
    ]] }, layout: 'noBorders', margin: [0, 22, 0, 0] }
  ]);
}

function buildGroupSummaryTable(data) {
  const rows = data.swimmers.map(function (d, i) {
    const s = d.swimmer, att = d.attendance.stats;
    return [
      { text: String(i + 1), style: 'td' },
      { text: s.full_name, style: 'td', alignment: 'right' },
      { text: s.membership_no || '—', style: 'td' },
      { text: s.level_name || '—', style: 'td' },
      { text: String(d.totalLevels), style: 'td' },
      { text: d.allSkills ? d.grandAvg + '%' : '—', style: 'td', bold: true, color: d.allSkills ? gradeColor(d.grandAvg) : '#9ca3af' },
      { text: att.present + '/' + att.total, style: 'td' },
      { text: att.rate + '%', style: 'td', bold: true },
      { text: latestAssessmentDate(d) ? fmtDate(latestAssessmentDate(d)) : '—', style: 'td' }
    ];
  });
  return [{ table: { headerRows: 1, widths: [22, '*', 60, 80, 45, 50, 50, 45, 80], body: [
    [{ text: '#', style: 'th' }, { text: 'اللاعب', style: 'th' }, { text: 'العضوية', style: 'th' }, { text: 'المستوى الحالي', style: 'th' }, { text: 'مستويات مقيّمة', style: 'th' }, { text: 'المتوسط', style: 'th' }, { text: 'حضور', style: 'th' }, { text: 'النسبة', style: 'th' }, { text: 'آخر تقييم', style: 'th' }]
  ].concat(rows.length ? rows : [[{ text: 'لا يوجد لاعبون', style: 'td', colSpan: 9, alignment: 'center' }, {}, {}, {}, {}, {}, {}, {}, {}]]) }, layout: 'lightHorizontalLines' }];
}

function buildGroupDetailBlocks(data) {
  const blocks = [];
  data.swimmers.forEach(function (d, i) {
    const att = d.attendance.stats;
    blocks.push({ columns: [
      { text: (i + 1) + '. ' + d.swimmer.full_name, style: 'subTitle' },
      { text: 'المتوسط العام: ' + (d.allSkills ? d.grandAvg + '%' : '—'), alignment: 'left', bold: true, fontSize: 10, color: d.allSkills ? gradeColor(d.grandAvg) : '#9ca3af' }
    ], margin: [0, 8, 0, 3] });
    const lvlRows = d.allLevels.map(function (lvl) {
      return [
        { text: lvl.level.name, style: 'td', alignment: 'right' },
        { text: lvl.assessed ? String(lvl.count) : '—', style: 'td' },
        { text: lvl.ownPercent !== null ? lvl.ownPercent + '%' : '—', style: 'td' },
        { text: lvl.percent !== null ? lvl.percent + '%' : 'لم يُقيَّم', style: 'td', bold: true, color: lvl.percent !== null ? gradeColor(lvl.percent) : '#9ca3af' },
        { text: lvl.assessment ? fmtDate(lvl.assessment.date) : '—', style: 'td' },
        { text: lvl.assessment ? (lvl.assessment.coach_name || '—') : '—', style: 'td' }
      ];
    });
    blocks.push({ table: { headerRows: 1, widths: ['26%', 50, 55, 75, 90, '*'], body: [
      [{ text: 'المستوى', style: 'th' }, { text: 'المهارات', style: 'th' }, { text: 'نسبة المهارات', style: 'th' }, { text: 'مع المعايير العامة', style: 'th' }, { text: 'آخر تقييم', style: 'th' }, { text: 'الكابتن', style: 'th' }]
    ].concat(lvlRows.length ? lvlRows : [[{ text: 'لا توجد مستويات مسجلة', style: 'td', colSpan: 6, alignment: 'center' }, {}, {}, {}, {}, {}]]) }, layout: 'lightHorizontalLines' });
    blocks.push({ text: 'الحضور: حضر ' + att.present + ' · غاب ' + att.absent + ' · بعذر ' + att.excused + ' · متأخر ' + att.late + ' · إجمالي ' + att.total + ' · نسبة الحضور ' + att.rate + '%', style: 'meta2', margin: [0, 3, 0, 0] });
  });
  return blocks;
}

function buildGroupReportPdf(data, todayStr) {
  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [28, 30, 28, 36],
    info: { title: 'التقرير الفني — ' + data.group.name, author: 'الأكاديمية' },
    defaultStyle: { font: 'Tahoma', fontSize: 9.5, color: '#111827', alignment: 'right' },
    styles: {
      academyTitle: { fontSize: 18, bold: true, color: '#0284c7', alignment: 'center' },
      reportTitle: { fontSize: 14, bold: true, alignment: 'center', margin: [0, 4, 0, 2] },
      meta: { fontSize: 9, color: '#6b7280', alignment: 'center' },
      meta2: { fontSize: 9, color: '#6b7280' },
      lbl: { bold: true, fontSize: 9.5, color: '#334155', alignment: 'center' },
      val: { fontSize: 10, alignment: 'center' },
      th: { bold: true, fontSize: 9.5, color: '#ffffff', fillColor: '#0284c7', alignment: 'center', margin: [2, 3, 2, 3] },
      td: { fontSize: 9, alignment: 'center', margin: [1, 2, 1, 2] },
      sectionTitle: { fontSize: 12, bold: true, color: '#0f172a' },
      subTitle: { fontSize: 11, bold: true, color: '#0f172a' },
      kpi: { fontSize: 15, bold: true, alignment: 'center' },
      sign: { alignment: 'center', fontSize: 11, bold: true, margin: [0, 0, 0, 34] }
    },
    footer: function (current, total) {
      return { text: 'الأكاديمية — التقرير الفني للمجموعة   •   صفحة ' + current + ' من ' + total, alignment: 'center', fontSize: 8, color: '#9ca3af' };
    },
    content: buildGroupReportContent(data, todayStr, 'التقرير الفني الشامل للمجموعة')
  };
}

function buildAllGroupsReportPdf(groups, todayStr) {
  let totalMembers = 0, totalAssessed = 0, grandSum = 0, grandCount = 0, totalPresent = 0, totalAbs = 0, totalSessions = 0;
  groups.forEach(function (g) {
    totalMembers += g.totals.members;
    totalAssessed += g.totals.assessed;
    g.swimmers.forEach(function (s) {
      if (s.allSkills) { grandSum += s.grandSum; grandCount += s.allSkills; }
      const a = s.attendance.stats;
      totalPresent += a.present; totalAbs += a.absent; totalSessions += a.total;
    });
  });
  const overallAvg = grandCount ? round(grandSum / grandCount) : 0;
  const overallRate = totalSessions ? Math.round((totalPresent / totalSessions) * 100) : 0;
  const content = [
    { text: 'الأكاديمية', style: 'academyTitle' },
    { text: 'التقرير الفني المجمع — كل المجموعات', style: 'reportTitle' },
    { text: 'تاريخ الإصدار: ' + todayStr, style: 'meta' },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 760, y2: 0, lineWidth: 1.6, lineColor: '#0284c7' }], margin: [0, 6, 0, 0] },
    { table: { widths: ['20%', '20%', '20%', '20%', '20%'], body: [[
      { text: [String(groups.length), { text: '\nمجموعة', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#0284c7' },
      { text: [String(totalMembers), { text: '\nلاعب', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#0284c7' },
      { text: [String(totalAssessed), { text: '\nلاعب مقيَّم', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#16a34a' },
      { text: [overallAvg + '%', { text: '\nمتوسط التقييم', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#0284c7' },
      { text: [overallRate + '%', { text: '\nنسبة الحضور', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#ca8a04' }
    ]] }, layout: { defaultBorder: true, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 6, paddingBottom: () => 6 }, margin: [0, 10, 0, 0] }
  ];
  groups.forEach(function (g, i) {
    if (i > 0) content.push({ text: '', pageBreak: 'before' });
    content.push.apply(content, buildGroupReportContent(g, todayStr, 'المجموعة: ' + g.group.name));
  });
  return {
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [28, 30, 28, 36],
    info: { title: 'التقرير الفني المجمع', author: 'الأكاديمية' },
    defaultStyle: { font: 'Tahoma', fontSize: 9.5, color: '#111827', alignment: 'right' },
    styles: {
      academyTitle: { fontSize: 18, bold: true, color: '#0284c7', alignment: 'center' },
      reportTitle: { fontSize: 14, bold: true, alignment: 'center', margin: [0, 4, 0, 2] },
      meta: { fontSize: 9, color: '#6b7280', alignment: 'center' },
      meta2: { fontSize: 9, color: '#6b7280' },
      lbl: { bold: true, fontSize: 9.5, color: '#334155', alignment: 'center' },
      val: { fontSize: 10, alignment: 'center' },
      th: { bold: true, fontSize: 9.5, color: '#ffffff', fillColor: '#0284c7', alignment: 'center', margin: [2, 3, 2, 3] },
      td: { fontSize: 9, alignment: 'center', margin: [1, 2, 1, 2] },
      sectionTitle: { fontSize: 12, bold: true, color: '#0f172a' },
      subTitle: { fontSize: 11, bold: true, color: '#0f172a' },
      kpi: { fontSize: 15, bold: true, alignment: 'center' },
      sign: { alignment: 'center', fontSize: 11, bold: true, margin: [0, 0, 0, 34] }
    },
    footer: function (current, total) {
      return { text: 'الأكاديمية — التقرير الفني المجمع   •   صفحة ' + current + ' من ' + total, alignment: 'center', fontSize: 8, color: '#9ca3af' };
    },
    content: content
  };
}

function round(v) { return Math.round(v * 1000) / 1000; }

/* جدول Excel أفقي: المستويات والمهارات في الصف العلوي، وكل لاعب في صف واحد */
function buildGroupXlsTable(data, opts) {
  opts = opts || {};
  const levelBlocks = (data.levels || []).map(function (lvl) {
    const criteria = (data.criteriaByLevel && data.criteriaByLevel[String(lvl.id)]) || [];
    return { level: lvl, criteria: criteria, colCount: criteria.length + 3 };
  }).filter(function (b) { return b.colCount > 3; });
  const fixedCols = 6; // اسم، عضوية، كابتن، مستوى حالي، حضور، متوسط عام
  const totalCols = fixedCols + levelBlocks.reduce(function (n, b) { return n + b.colCount; }, 0);

  let html = '';
  if (opts.showTitle !== false) {
    const entity = opts.entityName || 'مجموعة';
    html += '<thead><tr><th colspan="' + totalCols + '" style="font-size:15px;background:#0284c7;color:#fff">التقرير الفني ل' + entity + ': ' + xEsc(data.group.name) + ' — ' + xEsc(data.group.program_name || '') + ' — ' + todayISO() + '</th></tr>';
  } else {
    html += '<thead>';
  }

  // صف المستويات (الصف العلوي)
  let header1 = '<tr><th>اللاعب</th><th>رقم العضوية</th><th>الكابتن</th><th>المستوى الحالي</th><th>الحضور</th><th>المتوسط العام</th>';
  levelBlocks.forEach(function (b) {
    header1 += '<th colspan="' + b.colCount + '" style="background:#dbeafe">' + xEsc(b.level.name) + '</th>';
  });
  header1 += '</tr>';

  // صف المهارات / الملخصات
  let header2 = '<tr><th></th><th></th><th></th><th></th><th></th><th></th>';
  levelBlocks.forEach(function (b) {
    b.criteria.forEach(function (c) { header2 += '<th>' + xEsc(c.name) + '</th>'; });
    header2 += '<th>عدد</th><th>متوسط المهارات</th><th>مع العامة</th>';
  });
  header2 += '</tr>';

  const rows = data.swimmers.map(function (d) {
    const s = d.swimmer, att = d.attendance.stats;
    const attText = att.total ? att.present + '/' + att.total + ' (' + att.rate + '%)' : '—';
    const scoreMap = {};
    d.allLevels.forEach(function (l) {
      const m = scoreMap[l.level.id] = {};
      l.ownSkills.forEach(function (sk) { m[sk.id] = sk.score; });
    });
    let cells = xCell(s.full_name, 'font-weight:700')
      + xCell(s.membership_no)
      + xCell(s.coach_name || '—')
      + xCell(s.level_name || '—')
      + xCell(attText, 'text-align:center')
      + xCell(d.allSkills ? d.grandAvg + '%' : '—', 'text-align:center;font-weight:700');
    levelBlocks.forEach(function (b) {
      const lvl = d.allLevels.find(function (l) { return l.level.id === b.level.id; }) || null;
      b.criteria.forEach(function (c) {
        const sc = lvl ? (scoreMap[b.level.id] && scoreMap[b.level.id][c.id]) : undefined;
        cells += xCell(sc !== undefined ? sc + '%' : '', 'text-align:center');
      });
      cells += xCell(lvl && lvl.assessed ? lvl.count : '—', 'text-align:center')
        + xCell(lvl && lvl.ownPercent !== null ? lvl.ownPercent + '%' : '—', 'text-align:center')
        + xCell(lvl && lvl.percent !== null ? lvl.percent + '%' : '—', 'text-align:center');
    });
    return '<tr>' + cells + '</tr>';
  });

  return '<table dir="rtl" style="width:' + Math.max(900, totalCols * 90) + 'px">' + html
    + header1 + header2 + '</thead><tbody>' + (rows.join('') || ('<tr><td colspan="' + totalCols + '">لا يوجد لاعبون</td></tr>')) + '</tbody></table>';
}

function xlsWorkbook(sheetsHtml, opts) {
  opts = opts || {};
  let sheetsXml = '';
  sheetsHtml.forEach(function (sh, i) {
    sheetsXml += '<x:ExcelWorksheet><x:Name>' + xEsc(sh.name || ('Sheet' + (i + 1))) + '</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet>';
  });
  let body = (opts.body || '');
  sheetsHtml.forEach(function (sh) { body += sh.html; });
  return '\uFEFF' + '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">'
    + '<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>' + sheetsXml + '</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->'
    + '<style>table{border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #999;padding:4px 7px;font-size:12px;font-family:Tahoma,Arial,sans-serif;vertical-align:top}th{background:#e8eef7;font-weight:700}</style></head>'
    + '<body dir="rtl">' + body + '</body></html>';
}

router.get('/assessments/reports/group/:id.pdf', async function (req, res) {
  if (!canView(req.currentUser, 'assessments') || !canExport(req.currentUser, 'assessments')) {
    return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  }
  const data = await assessmentReports.groupReportData(Number(req.params.id), { from: req.query.from, to: req.query.to });
  if (!data) return res.redirect('/assessments');
  const doc = buildGroupReportPdf(data, todayISO());
  pdfmake.createPdf(doc).getBuffer().then(function (buf) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="group-assessment-report-' + data.group.id + '.pdf"');
    res.send(buf);
  }).catch(function (e) {
    console.error('خطأ في توليد تقرير المجموعة PDF:', e.message);
    res.status(500).send('تعذّر توليد ملف PDF: ' + e.message);
  });
});

router.get('/assessments/reports/group/:id.xls', async function (req, res) {
  if (!canView(req.currentUser, 'assessments') || !canExport(req.currentUser, 'assessments')) {
    return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  }
  const data = await assessmentReports.groupReportData(Number(req.params.id), { from: req.query.from, to: req.query.to });
  if (!data) return res.redirect('/assessments');
  const summary = '<table dir="rtl" style="width:700px"><tr><th>عدد اللاعبين</th><td>' + data.totals.members + '</td><th>لاعبون مقيَّمون</th><td>' + data.totals.assessed + '</td><th>متوسط التقييم</th><td>' + data.totals.average + '%</td></tr>'
    + '<tr><th>إجمالي الحضور</th><td>' + data.totals.attendance.total + '</td><th>حضر</th><td>' + data.totals.attendance.present + '</td><th>نسبة الحضور</th><td>' + data.totals.attendance.rate + '%</td></tr></table>';
  const html = xlsWorkbook([{ name: data.group.name || 'المجموعة', html: buildGroupXlsTable(data) }], { body: summary });
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', "attachment; filename=\"group-assessment-report.xls\"; filename*=UTF-8''" + encodeURIComponent('تقرير-فني-' + data.group.name + '.xls'));
  res.send(html);
});

router.get('/assessments/reports/all.pdf', async function (req, res) {
  if (!canView(req.currentUser, 'assessments') || !canExport(req.currentUser, 'assessments')) {
    return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  }
  const groups = await assessmentReports.allGroupsReportData(activeSport(req), { from: req.query.from, to: req.query.to });
  if (!groups.length) return res.redirect('/assessments');
  const doc = buildAllGroupsReportPdf(groups, todayISO());
  pdfmake.createPdf(doc).getBuffer().then(function (buf) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="all-groups-assessment-report.pdf"');
    res.send(buf);
  }).catch(function (e) {
    console.error('خطأ في توليد التقرير المجمع PDF:', e.message);
    res.status(500).send('تعذّر توليد ملف PDF: ' + e.message);
  });
});

router.get('/assessments/reports/all.xls', async function (req, res) {
  if (!canView(req.currentUser, 'assessments') || !canExport(req.currentUser, 'assessments')) {
    return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  }
  const groups = await assessmentReports.allGroupsReportData(activeSport(req), { from: req.query.from, to: req.query.to });
  if (!groups.length) return res.redirect('/assessments');
  let totalMembers = 0, totalAssessed = 0, grandSum = 0, grandCount = 0, totalPresent = 0, totalSessions = 0;
  groups.forEach(function (g) {
    totalMembers += g.totals.members;
    totalAssessed += g.totals.assessed;
    g.swimmers.forEach(function (s) {
      if (s.allSkills) { grandSum += s.grandSum; grandCount += s.allSkills; }
      totalPresent += s.attendance.stats.present;
      totalSessions += s.attendance.stats.total;
    });
  });
  const overallAvg = grandCount ? round(grandSum / grandCount) : 0;
  const overallRate = totalSessions ? Math.round((totalPresent / totalSessions) * 100) : 0;
  const titleBlock = '<table dir="rtl" style="width:900px"><tr><th colspan="6" style="font-size:16px;background:#0284c7;color:#fff">التقرير الفني المجمع — كل المجموعات — ' + todayISO() + '</th></tr></table>';
  const summary = '<table dir="rtl" style="width:700px"><tr><th>عدد المجموعات</th><td>' + groups.length + '</td><th>عدد اللاعبين</th><td>' + totalMembers + '</td><th>لاعبون مقيَّمون</th><td>' + totalAssessed + '</td></tr>'
    + '<tr><th>متوسط التقييم</th><td>' + overallAvg + '%</td><th>إجمالي الحضور</th><td>' + totalSessions + '</td><th>نسبة الحضور</th><td>' + overallRate + '%</td></tr></table>';
  const sheets = groups.map(function (g) { return { name: g.group.name || ('مجموعة ' + g.group.id), html: buildGroupXlsTable(g, { showTitle: false }) }; });
  const html = xlsWorkbook(sheets, { body: titleBlock + '<br>' + summary });
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', "attachment; filename=\"all-groups-assessment-report.xls\"; filename*=UTF-8''" + encodeURIComponent('تقرير-فني-كل-المجموعات.xls'));
  res.send(html);
});

/* تقارير الفرق (PDF + Excel) — نفس بيانات التقييم الفني لكن لأعضاء الفريق */
function buildTeamReportPdf(data, todayStr) {
  const doc = buildGroupReportPdf(data, todayStr);
  doc.info.title = 'التقرير الفني — ' + data.team.name;
  doc.content[1].text = 'التقرير الفني الشامل للفريق';
  doc.footer = function (current, total) {
    return { text: 'الأكاديمية — التقرير الفني للفريق   •   صفحة ' + current + ' من ' + total, alignment: 'center', fontSize: 8, color: '#9ca3af' };
  };
  return doc;
}

router.get('/assessments/reports/team/:id.pdf', async function (req, res) {
  if (!canView(req.currentUser, 'assessments') || !canExport(req.currentUser, 'assessments')) {
    return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  }
  const data = await assessmentReports.teamReportData(Number(req.params.id), { from: req.query.from, to: req.query.to });
  if (!data) return res.redirect('/teams');
  const doc = buildTeamReportPdf(data, todayISO());
  pdfmake.createPdf(doc).getBuffer().then(function (buf) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="team-assessment-report-' + data.team.id + '.pdf"');
    res.send(buf);
  }).catch(function (e) {
    console.error('خطأ في توليد تقرير الفريق PDF:', e.message);
    res.status(500).send('تعذّر توليد ملف PDF: ' + e.message);
  });
});

router.get('/assessments/reports/team/:id.xls', async function (req, res) {
  if (!canView(req.currentUser, 'assessments') || !canExport(req.currentUser, 'assessments')) {
    return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  }
  const data = await assessmentReports.teamReportData(Number(req.params.id), { from: req.query.from, to: req.query.to });
  if (!data) return res.redirect('/teams');
  const summary = '<table dir="rtl" style="width:700px"><tr><th>عدد اللاعبين</th><td>' + data.totals.members + '</td><th>لاعبون مقيَّمون</th><td>' + data.totals.assessed + '</td><th>متوسط التقييم</th><td>' + data.totals.average + '%</td></tr>'
    + '<tr><th>إجمالي الحضور</th><td>' + data.totals.attendance.total + '</td><th>حضر</th><td>' + data.totals.attendance.present + '</td><th>نسبة الحضور</th><td>' + data.totals.attendance.rate + '%</td></tr></table>';
  const html = xlsWorkbook([{ name: data.team.name || 'الفريق', html: buildGroupXlsTable(data, { entityName: 'فريق' }) }], { body: summary });
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', "attachment; filename=\"team-assessment-report.xls\"; filename*=UTF-8''" + encodeURIComponent('تقرير-فني-' + data.team.name + '.xls'));
  res.send(html);
});

/* دالة مساعدة: ألوان التقدير (نفس المستخدمة في تقرير اللاعب) */
function gradeColor(score) {
  if (score >= 85) return '#16a34a';
  if (score >= 70) return '#0284c7';
  if (score >= 50) return '#ca8a04';
  if (score >= 30) return '#f97316';
  return '#dc2626';
}

router.get('/assessments/log', async function (req, res) {
  if (!canView(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  /* التقييمات: نجمع صفوف اللاعب الواحد في نفس التاريخ في سطر واحد (كل المستويات معاً) */
  const rows = await db.prepare(`SELECT 'تقييم' AS kind,
      COALESCE(MIN(CASE WHEN a.level_id IS NOT NULL THEN a.id END), MIN(a.id)) AS id,
      a.date AS date,
      COALESCE(ROUND(AVG(CASE WHEN a.level_id IS NOT NULL THEN a.overall_percent END), 2), ROUND(AVG(a.overall_percent), 2)) AS overall_percent,
      MAX(a.ready_to_advance) AS ready_to_advance,
      MAX(a.level_id) AS level_id,
      MAX(a.coach_id) AS coach_id,
      MAX(a.notes) AS notes,
      a.swimmer_id AS swimmer_id,
      s.full_name AS swimmer_name,
      s.membership_no,
      MAX(c.full_name) AS coach_name,
      GROUP_CONCAT(DISTINCT l.name) AS level_name,
      COUNT(DISTINCT a.level_id) AS levels_count,
      NULL AS t_type, NULL AS t_race, NULL AS time_seconds, NULL AS test_status, NULL AS distance_m, NULL AS result_note
    FROM assessments a
    LEFT JOIN swimmers s ON s.id = a.swimmer_id AND s.deleted_at IS NULL
    LEFT JOIN coaches c ON c.id = a.coach_id
    LEFT JOIN levels l ON l.id = a.level_id
    WHERE 1=1` + progClause(activeSport(req), 'a') + `
    GROUP BY a.swimmer_id, a.date
    UNION ALL
    SELECT 'اختبار' AS kind, t.id AS id, t.date AS date, NULL AS overall_percent, t.passed AS ready_to_advance, NULL AS level_id, t.coach_id AS coach_id, t.result_note AS notes, t.swimmer_id AS swimmer_id, s.full_name AS swimmer_name, s.membership_no, c.full_name AS coach_name, l.name AS level_name, 1 AS levels_count, t.type AS t_type, t.race_type AS t_race, t.time_seconds AS time_seconds, t.status AS test_status, t.distance_m AS distance_m, t.result_note AS result_note FROM tests t
    LEFT JOIN swimmers s ON s.id = t.swimmer_id AND s.deleted_at IS NULL LEFT JOIN coaches c ON c.id = t.coach_id LEFT JOIN levels l ON l.id = t.level_id WHERE 1=1` + swimmerOfClause(activeSport(req), 't') + `
    ORDER BY date DESC`).all();
  const page = {
    title: 'التقييمات الفنية', subtitle: 'تقييم مهارات اللاعبين ونتائج الاختبارات', icon: 'fa-clipboard-check', module: 'assessments', active: 'assessments',
    columns: [
      { key: 'swimmer_name', label: 'اللاعب', html: row => `<div class="avatar-cell"><div class="avatar-sm" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)">${(row.swimmer_name || 'س').trim().charAt(0)}</div><div><div class="cell-title">${row.swimmer_name || '—'}</div><div class="cell-sub">${row.membership_no || ''}</div>${row.kind === 'تقييم' && row.level_name ? `<div class="cell-sub" style="max-width:260px;white-space:normal;line-height:1.5"><i class="fas fa-layer-group" style="font-size:10px"></i> ${row.level_name}</div>` : ''}</div></div>` },
      { key: 'kind', label: 'النوع', html: row => row.kind === 'اختبار' ? `<span class="badge badge-warning">اختبار · ${row.t_type || ''}</span>` : `<span class="badge badge-primary">تقييم</span>` },
      { key: 't_race', label: 'نوع السباق', html: row => row.kind === 'اختبار' && row.t_race ? `<span class="badge badge-info">${row.t_race}</span>` : '—' },
      { key: 'date', label: 'التاريخ', html: row => fmtDate(row.date) },
      { key: 'level_name', label: 'المستوى', html: row => row.kind === 'تقييم' && row.levels_count > 1 ? `<span class="badge badge-violet">${row.levels_count} مستويات</span>` : (row.level_name ? `<span class="badge badge-violet">${row.level_name}</span>` : '<span class="text-soft">—</span>') },
      { key: 'result', label: 'النتيجة', html: row => row.kind === 'اختبار'
        ? `<div><span class="badge ${row.test_status === 'اجتاز' ? 'badge-success' : 'badge-danger'}">${row.test_status || '—'}</span>${row.time_seconds != null ? `<div class="font-12 text-soft">${row.time_seconds}s${row.distance_m ? ' · ' + row.distance_m + 'م' : ''}</div>` : ''}</div>`
        : `<div class="progress-inline"><span class="badge ${row.overall_percent >= 80 ? 'badge-success' : row.overall_percent >= 60 ? 'badge-warning' : 'badge-danger'}">${row.overall_percent || 0}%</span></div>` },
      { key: 'status2', label: 'الترقية', html: row => row.kind === 'اختبار' ? '<span class="badge badge-gray">اختبار</span>' : (row.ready_to_advance ? '<span class="badge badge-success"><i class="fas fa-arrow-up"></i> جاهز</span>' : '<span class="badge badge-gray">قيد التدريب</span>') },
      { key: 'coach_name', label: 'الكابتن' }
    ],
    rows,
    filters: [
      { name: 'level_id', label: 'المستوى', options: await levelOptions(activeSport(req)) },
      { name: 'coach_id', label: 'الكابتن', options: await coachOptions(activeSport(req)) },
      { name: 'ready_to_advance', label: 'الترقية', options: [{ value: '1', label: 'جاهز للترقية' }, { value: '0', label: 'قيد التدريب' }] }
    ],
    canAdd: canAdd(req.currentUser, 'assessments'), addUrl: canAdd(req.currentUser, 'assessments') ? '/assessments/new' : null, addLabel: 'تقييم جديد',
    headerActions: [
      { href: '/assessments', label: 'تقييم المجموعات', icon: 'fa-people-group', cls: 'btn-primary' },
      { href: '/tests/new', label: 'اختبار (فردي/جماعي)', icon: 'fa-vial-circle-check', cls: 'btn-outline' }
    ],
    actions: () => row => row.kind === 'اختبار' ? [
      { label: 'تعديل', icon: 'fa-pen', href: '/tests/' + row.id + '/edit' },
      { label: 'اللاعب', icon: 'fa-person-swimming', href: '/swimmers/' + row.swimmer_id },
      { label: 'حذف', icon: 'fa-trash', href: '/tests/' + row.id + '/delete', confirm: 'حذف الاختبار؟', cls: 'text-danger' }
    ] : [
      ...(row.levels_count > 1 ? [] : [{ label: 'عرض', icon: 'fa-eye', href: '/assessments/' + row.id }]),
      { label: 'اللاعب', icon: 'fa-person-swimming', href: '/swimmers/' + row.swimmer_id },
      { label: 'تعديل', icon: 'fa-pen', href: '/assessments/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/assessments/' + row.id + '/delete', confirm: 'حذف تقييم اللاعب بكل مستوياته؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});

/* معايير المستوى (للتحديث الديناميكي في النموذج) */
router.get('/api/assessments/criteria', async function (req, res) {
  res.json(await criteriaFor(req.query.level_id ? Number(req.query.level_id) : null));
});

/* أحدث درجات لاعب واحد — لتحديث النموذج الكامل فور تغيير اللاعب (تزامن مع الكارت السريع) */
router.get('/api/assessments/swimmer/:id/scores', async function (req, res) {
  if (!canView(req.currentUser, 'assessments')) return res.status(403).json({ ok: false, error: 'لا تملك صلاحية العرض' });
  const sw = await db.prepare('SELECT id, level_id FROM swimmers WHERE id = ? AND deleted_at IS NULL').get(Number(req.params.id));
  if (!sw) return res.status(404).json({ ok: false, error: 'اللاعب غير موجود' });
  res.json({ ok: true, level_id: sw.level_id, scores: await latestScoresFor(sw.id) });
});

router.get('/assessments/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const values = {};
  let currentLevelId = null;
  if (req.query.swimmer) {
    const sw = await db.prepare('SELECT id, level_id FROM swimmers WHERE id=?').get(Number(req.query.swimmer));
    if (sw) {
      values.swimmer_id = sw.id;
      currentLevelId = sw.level_id;
      /* نفس بيانات الكارت السريع: أحدث تقييم لكل مستوى + المعايير العامة */
      Object.assign(values, await latestScoresFor(sw.id));
    }
  }
  /* فتح التقييم من داخل مجموعة: نعيد المستخدم لنفس المجموعة بعد الحفظ */
  let returnGroup = null;
  if (req.query.group) {
    returnGroup = await db.prepare('SELECT id, name, coach_id, program_id FROM groups WHERE id = ? AND deleted_at IS NULL').get(Number(req.query.group));
    if (returnGroup) {
      values.group_id = returnGroup.id;
      if (values.coach_id === undefined && returnGroup.coach_id) values.coach_id = returnGroup.coach_id;
      if (values.program_id === undefined && returnGroup.program_id) values.program_id = returnGroup.program_id;
    }
  }
  res.render('assessment_form', {
    title: 'تقييم فني جديد', active: 'assessments', isEdit: false, returnGroup,
    action: '/assessments/new', values, levelGroups: await levelGroups(activeSport(req), currentLevelId), generalCriteria: await generalCriteria(),
    swimmers: await swimmerOptions(activeSport(req)), coaches: await coachOptions(activeSport(req)), programs: await programOptions(activeSport(req))
  });
});
router.post('/assessments/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : todayISO();
  const swimmerId = Number(b.swimmer_id || 0);
  if (!swimmerId) {
    setFlash(res, { type: 'error', message: 'اختر اللاعب أولاً' });
    return res.redirect('/assessments/new');
  }
  const { perLevel, shared } = await parseScores(b);
  let firstId = null;
  let levelCount = 0;
  const savedLevelIds = [];
  for (const lid of Object.keys(perLevel)) {
    const g = perLevel[lid];
    if (!g || !g.n) continue;
    if (!hasNonZeroScore(g) && !(await assessmentExistsForDate(swimmerId, Number(lid), date))) continue;
    const rid = await upsertAssessmentForDate(swimmerId, Number(lid), date, g, b, req.currentUser.id, null);
    if (rid) {
      await saveAssessmentMeta(rid, b);
      savedLevelIds.push(Number(lid));
      if (firstId === null) firstId = rid;
      levelCount++;
    }
  }
  /* المعايير العامة تُحفظ في سجل واحد (مستوى NULL) وتُضمَّن تلقائياً في كل المستويات داخل التقرير */
  if (shared && shared.n && (hasNonZeroScore(shared) || await assessmentExistsForDate(swimmerId, null, date))) {
    const gid = await upsertAssessmentForDate(swimmerId, null, date, shared, b, req.currentUser.id, null);
    if (gid) {
      await saveAssessmentMeta(gid, b);
      if (firstId === null) firstId = gid;
    }
  }
  /* تعيين مستوى اللاعب إن لم يكن له مستوى (اختيار المدرب أو أول مستوى تم تقييمه) */
  await assignFirstLevel(swimmerId, b.level_id, savedLevelIds);
  if (levelCount) {
    audit(req.currentUser.id, req.currentUser.full_name, 'add', 'assessments', firstId, 'تقييم على ' + levelCount + ' مستوى', req);
    setFlash(res, { type: 'success', message: 'تم حفظ تقييمات ' + levelCount + ' مستوى بنجاح' });
  } else if (shared.n) {
    setFlash(res, { type: 'success', message: 'تم حفظ المعايير العامة' });
  } else {
    setFlash(res, { type: 'error', message: 'لم تُسجل أي نسب — تأكد من تقييم مهارة واحدة على الأقل' });
  }
  /* العودة للتقييمات (أو لصفحة المجموعة لو بدأ التقييم منها) وليس للاختبارات */
  const returnGroupId = Number(b.group_id || 0);
  res.redirect(returnGroupId ? '/assessments/groups/' + returnGroupId : '/assessments');
});

router.get('/assessments/:id', async function (req, res) {
  if (!canView(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const a = await db.prepare(`SELECT a.*, s.full_name AS swimmer_name, s.membership_no, s.birth_date, c.full_name AS coach_name, l.name AS level_name, p.name AS program_name FROM assessments a
    LEFT JOIN swimmers s ON s.id = a.swimmer_id LEFT JOIN coaches c ON c.id = a.coach_id LEFT JOIN levels l ON l.id = a.level_id LEFT JOIN programs p ON p.id = a.program_id WHERE a.id = ?`).get(id);
  if (!a) return res.redirect('/assessments');
  let scores = {};
  try { scores = JSON.parse(a.scores || '{}'); } catch (e) { scores = {}; }
  const criteriaMap = {};
  (await db.prepare('SELECT * FROM assessment_criteria').all()).forEach(c => { criteriaMap[c.id] = c; });
  let levelTotal = 0, levelCount = 0;
  Object.keys(scores).forEach(k => {
    if (criteriaMap[Number(k)]) { levelTotal += Number(scores[k]) || 0; levelCount++; }
  });
  const levelPercent = levelCount ? Math.round((levelTotal / levelCount) * 1000) / 1000 : 0;
  res.render('assessment_detail', { title: 'تفاصيل التقييم', active: 'assessments', a, scores, criteriaMap, levelTotal, levelCount, levelPercent, money,
    canEdit: canEdit(req.currentUser, 'assessments'), canDel: canDel(req.currentUser, 'assessments') });
});

/* ترقية اللاعب لمستوى أعلى من التقييم (خطوة واحدة فقط لمنع تخطي المستويات) */
router.post('/assessments/:id/advance', async function (req, res) {
  if (!canEdit(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const a = await db.prepare('SELECT * FROM assessments WHERE id=?').get(id);
  if (!a) return res.redirect('/assessments');
  if (!a.ready_to_advance) {
    setFlash(res, { type: 'error', message: 'لا يمكن الترقية: هذا التقييم غير مُعلَّم بأنه جاهز للانتقال' });
    return res.redirect('/assessments/' + id);
  }
  const sw = await db.prepare('SELECT id, level_id FROM swimmers WHERE id=?').get(a.swimmer_id);
  if (sw && sw.level_id && sw.level_id !== a.level_id) {
    setFlash(res, { type: 'error', message: 'لا يمكن الترقية: مستوى التقييم لا يطابق المستوى الحالي لللاعب — منعاً لتخطي المستويات' });
    return res.redirect('/assessments/' + id);
  }
  const level = await db.prepare('SELECT * FROM levels ORDER BY order_no').all();
  const curIdx = level.findIndex(l => l.id === a.level_id);
  const nextLvl = curIdx >= 0 ? level[curIdx + 1] : null;
  if (nextLvl) await db.prepare('UPDATE swimmers SET level_id=? WHERE id=?').run(nextLvl.id, a.swimmer_id);
  await db.prepare('INSERT INTO level_progress (swimmer_id, from_level_id, to_level_id, date, assessment_id, reason) VALUES (?,?,?,?,?,?)')
    .run(a.swimmer_id, a.level_id, nextLvl ? nextLvl.id : null, new Date().toISOString().slice(0, 10), id, 'اجتياز التقييم الفني');
  await db.prepare("UPDATE assessments SET ready_to_advance=0 WHERE id=?").run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'assessments', id, 'ترقية اللاعب إلى ' + (nextLvl ? nextLvl.name : 'مستوى أعلى'), req);
  setFlash(res, { type: 'success', message: 'تم ترقية اللاعب إلى ' + (nextLvl ? nextLvl.name : 'مستوى أعلى') });
  res.redirect('/assessments/' + id);
});

router.get('/assessments/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM assessments WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/assessments');
  let saved = {};
  try { saved = JSON.parse(row.scores || '{}'); } catch (e) { saved = {}; }
  const values = { ...row };
  Object.keys(saved).forEach(k => { values['score_' + k] = saved[k]; });
  /* تعبئة أحدث تقييم لكل مستوى آخر + المعايير العامة لللاعب (تعديل شامل لكل المستويات) */
  const seen = {};
  (await db.prepare('SELECT * FROM assessments WHERE swimmer_id=? AND level_id IS NOT NULL ORDER BY date DESC, id DESC').all(row.swimmer_id))
    .forEach(a => { if (!seen[a.level_id]) { seen[a.level_id] = a; } });
  Object.keys(seen).forEach(lid => {
    if (String(lid) === String(row.level_id)) return;
    let sc = {};
    try { sc = JSON.parse(seen[lid].scores || '{}'); } catch (e) { sc = {}; }
    Object.keys(sc).forEach(k => { values['score_' + k] = sc[k]; });
  });
  const genRow = await db.prepare(`SELECT * FROM assessments WHERE swimmer_id=? AND level_id IS NULL ORDER BY date DESC, id DESC`).get(row.swimmer_id);
  if (genRow) {
    let g = {};
    try { g = JSON.parse(genRow.scores || '{}'); } catch (e) { g = {}; }
    Object.keys(g).forEach(k => { values['score_' + k] = g[k]; });
  }
  let returnGroup = null;
  if (req.query.group) {
    returnGroup = await db.prepare('SELECT id, name FROM groups WHERE id = ? AND deleted_at IS NULL').get(Number(req.query.group));
    if (returnGroup) values.group_id = returnGroup.id;
  }
  res.render('assessment_form', {
    title: 'تعديل التقييم', active: 'assessments', isEdit: true, returnGroup,
    action: '/assessments/' + row.id + '/edit', values, levelGroups: await levelGroups(activeSport(req), row.level_id != null ? row.level_id : null), generalCriteria: await generalCriteria(),
    swimmers: await swimmerOptions(activeSport(req)), coaches: await coachOptions(activeSport(req)), programs: await programOptions(activeSport(req))
  });
});
router.post('/assessments/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  const row = await db.prepare('SELECT * FROM assessments WHERE id=?').get(id);
  if (!row) return res.redirect('/assessments');
  const swimmerId = Number(b.swimmer_id || row.swimmer_id);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : row.date;
  const { perLevel, shared } = await parseScores(b);
  const primaryIsGeneral = row.level_id == null;
  const primaryG = primaryIsGeneral
    ? shared
    : (perLevel[row.level_id] || { scores: {}, n: 0, sum: 0 });
  const overall = primaryG.n ? Math.round((primaryG.sum / primaryG.n) * 1000) / 1000 : 0;
  await db.prepare(`UPDATE assessments SET swimmer_id=?, coach_id=?, program_id=?, level_id=?, date=?, scores=?, strengths=?, weaknesses=?, recommendations=?, ready_to_advance=?, next_assessment_date=?, overall_percent=?, notes=? WHERE id=?`)
    .run(swimmerId, b.coach_id || null, b.program_id || null, primaryIsGeneral ? null : row.level_id, date, JSON.stringify(primaryG.scores), b.strengths || '', b.weaknesses || '', b.recommendations || '', b.ready_to_advance === '1' ? 1 : 0, b.next_assessment_date || null, overall, b.notes || '', id);

  /* بقية المستويات تُحفظ بنفس تاريخ التقييم (تزامن كامل مع الكارت السريع) */
  const savedLevelIds = [];
  for (const lid of Object.keys(perLevel)) {
    if (!primaryIsGeneral && String(lid) === String(row.level_id)) continue;
    const g = perLevel[lid];
    if (!g || !g.n) continue;
    if (!hasNonZeroScore(g) && !(await assessmentExistsForDate(swimmerId, Number(lid), date))) continue;
    await upsertAssessmentForDate(swimmerId, Number(lid), date, g, b, req.currentUser.id, null);
    savedLevelIds.push(Number(lid));
  }
  if (!primaryIsGeneral && shared && shared.n && (hasNonZeroScore(shared) || await assessmentExistsForDate(swimmerId, null, date))) {
    await upsertAssessmentForDate(swimmerId, null, date, shared, b, req.currentUser.id, null);
  }
  await assignFirstLevel(swimmerId, b.level_id, savedLevelIds);

  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'assessments', id, 'تعديل تقييم شامل', req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات على جميع المستويات' });
  const returnGroupId = Number(b.group_id || 0);
  res.redirect(returnGroupId ? '/assessments/groups/' + returnGroupId : '/assessments/' + id);
});
router.post('/assessments/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT swimmer_id, date FROM assessments WHERE id=?').get(id);
  if (row) {
    /* حذف تقييم اللاعب بالكامل (كل مستويات نفس التاريخ) */
    await db.prepare('DELETE FROM assessments WHERE swimmer_id=? AND date=?').run(row.swimmer_id, row.date);
    audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'assessments', id, 'حذف تقييم اللاعب بكل مستوياته', req);
    setFlash(res, { type: 'success', message: 'تم حذف تقييم اللاعب بكل مستوياته' });
  } else {
    setFlash(res, { type: 'error', message: 'التقييم غير موجود' });
  }
  res.redirect('/assessments/log');
});

/* ============================================================== */
/*                          الاختبارات                            */
/* ============================================================== */
const TEST_TYPES_DEFAULT = ['مستوى', 'زمن', 'بطولة', 'عام'];
async function testTypes() {
  const v = (await db.prepare("SELECT value FROM settings WHERE key = 'test_types'").get() || {}).value;
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) && a.length ? a : TEST_TYPES_DEFAULT; } catch (e) { return TEST_TYPES_DEFAULT; }
}
const testFields = async function (values, sid) {
  return [
    { key: 'swimmer_id', label: 'اللاعب', type: 'select', options: await swimmerOptions(sid), required: true, section: 'بيانات الاختبار', sectionIcon: 'fa-vial-circle-check' },
    { key: 'type', label: 'نوع الاختبار', type: 'select', options: (await testTypes()).map(v => ({ value: v, label: v })) },
    { key: 'race_type', label: 'نوع السباق (اكتبه يدوياً)', type: 'text', placeholder: 'مثال: حرة — ظهر — صدر — فراشة' },
    { key: 'level_id', label: 'المستوى (يظهر مع نوع "مستوى" فقط)', type: 'select', options: await levelOptions(sid) },
    { key: 'date', label: 'تاريخ الاختبار', type: 'date' },
    { key: 'distance_m', label: 'المسافة (متر)', type: 'number', number: true },
    { key: 'time_seconds', label: 'الزمن (ثانية)', type: 'number', number: true, step: '0.01' },
    { key: 'position', label: 'المركز', type: 'number', number: true },
    { key: 'passed', label: 'النتيجة', type: 'checkbox', checkLabel: 'اجتاز الاختبار' },
    { key: 'status', label: 'الحالة', type: 'select', options: [{ value: 'اجتاز', label: 'اجتاز' }, { value: 'لم يجتز', label: 'لم يجتز' }] },
    { key: 'result_note', label: 'ملاحظة النتيجة', type: 'textarea', full: true }
  ];
};

/* فرق السباحة مع اللاعبين (لنموذج الاختبار الجماعي) */
async function testTeamsWithSwimmers(sid) {
  const teams = await db.prepare('SELECT t.id, t.name, t.coach_id FROM teams t ORDER BY t.name').all();
  const result = [];
  for (const t of teams) {
    result.push({ id: t.id, name: t.name, coach_id: t.coach_id, swimmers: await teamSwimmers(t.id) });
  }
  return result;
}
async function teamSwimmers(tid) {
  return await db.prepare(`SELECT s.id, s.full_name, s.membership_no, l.name AS level_name FROM team_members tm
    JOIN swimmers s ON s.id = tm.swimmer_id LEFT JOIN levels l ON l.id = s.level_id WHERE tm.team_id = ? AND s.deleted_at IS NULL ORDER BY s.full_name`).all(tid);
}

/* حفظ نتيجة اختبار للاعب واحد (سجل مستقل في الاختبارات) + ترقية عند اجتياز اختبار المستوى */
async function saveTestResult(o) {
  const passed = o.passed === '1' || o.passed === 1 || o.passed === true;
  const status = o.status || (passed ? 'اجتاز' : 'لم يجتز');
  const info = await db.prepare(`INSERT INTO tests (swimmer_id, coach_id, type, race_type, level_id, date, distance_m, time_seconds, position, passed, result_note, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(o.swimmerId, o.coachId || null, o.type || 'مستوى', o.race || '', o.level || null, o.date || new Date().toISOString().slice(0, 10), Number(o.distance || 0), o.time !== '' && o.time != null && !isNaN(o.time) ? Number(o.time) : null, o.position !== '' && o.position != null && !isNaN(o.position) ? Number(o.position) : null, passed ? 1 : 0, o.note || '', status);
  if (passed && (o.type || 'مستوى') === 'مستوى') {
    const swimmer = await db.prepare('SELECT level_id FROM swimmers WHERE id=?').get(o.swimmerId);
    const levels = await db.prepare('SELECT * FROM levels ORDER BY order_no').all();
    const idx = levels.findIndex(l => l.id === (swimmer ? swimmer.level_id : null));
    const nextLvl = idx >= 0 ? levels[idx + 1] : null;
    if (nextLvl) {
      await db.prepare('INSERT INTO level_progress (swimmer_id, from_level_id, to_level_id, date, reason) VALUES (?,?,?,?,?)').run(o.swimmerId, swimmer.level_id, nextLvl.id, new Date().toISOString().slice(0, 10), 'اجتياز اختبار المستوى');
      await db.prepare('UPDATE swimmers SET level_id=? WHERE id=?').run(nextLvl.id, o.swimmerId);
    }
  }
  return info.lastInsertRowid;
}

router.get('/tests', async function (req, res) {
  if (!canView(req.currentUser, 'tests')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT t.*, l.name AS level_name, s.full_name AS swimmer_name, s.membership_no, c.full_name AS coach_name FROM tests t
    LEFT JOIN swimmers s ON s.id = t.swimmer_id AND s.deleted_at IS NULL LEFT JOIN coaches c ON c.id = t.coach_id LEFT JOIN levels l ON l.id = t.level_id WHERE 1=1` + swimmerOfClause(activeSport(req), 't') + ` ORDER BY t.date DESC`).all();
  const page = {
    title: 'الاختبارات', subtitle: 'اختبارات المستويات والأزمنة', icon: 'fa-vial-circle-check', module: 'tests', active: 'tests',
    columns: [
      { key: 'swimmer_name', label: 'اللاعب', html: row => `<div class="avatar-cell"><div class="avatar-sm" style="background:linear-gradient(135deg,#06b6d4,#0ea5e9)">${(row.swimmer_name || 'س').trim().charAt(0)}</div><div><div class="cell-title">${row.swimmer_name || '—'}</div><div class="cell-sub">${row.membership_no || ''}</div></div></div>` },
      { key: 'type', label: 'النوع', html: row => `<span class="badge badge-primary">${row.type}</span>` },
      { key: 'race_type', label: 'نوع السباق', html: row => row.race_type ? `<span class="badge badge-info">${row.race_type}</span>` : '—' },
      { key: 'level_name', label: 'المستوى', html: row => row.level_name ? `<span class="badge badge-violet">${row.level_name}</span>` : '—' },
      { key: 'date', label: 'التاريخ', html: row => fmtDate(row.date) },
      { key: 'distance_m', label: 'المسافة', html: row => `${row.distance_m || 0} م` },
      { key: 'time_seconds', label: 'الزمن', html: row => row.time_seconds != null ? `<span class="fw-700">${row.time_seconds}s</span>` : '—' },
      { key: 'status', label: 'النتيجة', html: row => `<span class="badge ${row.status === 'اجتاز' ? 'badge-success' : 'badge-danger'}">${row.status}</span>` }
    ],
    rows,
    filters: [
      { name: 'type', label: 'النوع', options: (await testTypes()).map(v => ({ value: v, label: v })) },
      { name: 'level_id', label: 'المستوى', options: await levelOptions(activeSport(req)) },
      { name: 'coach_id', label: 'الكابتن', options: await coachOptions(activeSport(req)) },
      { name: 'status', label: 'النتيجة', options: [{ value: 'اجتاز', label: 'اجتاز' }, { value: 'لم يجتز', label: 'لم يجتز' }] }
    ],
    canAdd: canAdd(req.currentUser, 'tests'), addUrl: canAdd(req.currentUser, 'tests') ? '/tests/new' : null, addLabel: 'اختبار جديد',
    actions: () => row => [
      { label: 'تعديل', icon: 'fa-pen', href: '/tests/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/tests/' + row.id + '/delete', confirm: 'حذف الاختبار؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});

router.get('/tests/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'tests')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('test_group_form', {
    form: { title: 'اختبار جديد', subtitle: 'تسجيل اختبار للاعب واحد أو لكل لاعب في فريق', icon: 'fa-plus', active: 'tests', action: '/tests/new', fields: await testFields({}, activeSport(req)), values: {}, submitLabel: 'حفظ الاختبار', cancelUrl: '/tests', csrf: '' },
    teams: await testTeamsWithSwimmers(activeSport(req)), testTypes: await testTypes(), levelOptions: await levelOptions(activeSport(req)), swimmerOptions: await swimmerOptions(activeSport(req))
  });
});
router.post('/tests/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'tests')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const date = b.date || b.t_date || new Date().toISOString().slice(0, 10);
  let saved = 0;
  const levelsOf = v => v === undefined || v === null ? [] : (Array.isArray(v) ? v : [v]);
  if (b.team_id) {
    const tm = await db.prepare('SELECT coach_id FROM teams WHERE id=?').get(Number(b.team_id));
    const coachId = (tm && tm.coach_id) || req.currentUser.coach_id || null;
    const programId = null;
    const rowsArr = Array.isArray(b.rows) ? b.rows : (b.rows ? [b.rows] : []);
    for (const r of rowsArr) {
      if (!r || !r.swimmer_id) continue;
      const levels = levelsOf(r.t_level);
      if ((r.t_type || 'مستوى') === 'مستوى' && levels.length) {
        const perLevel = await parseRowScores(r);
        for (const lv of levels) {
          const g = perLevel[String(lv)];
          if (g && g.n) {
            const overall = Math.round((g.sum / g.n) * 1000) / 1000;
            await db.prepare(`INSERT INTO assessments (swimmer_id, coach_id, program_id, level_id, date, scores, overall_percent, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?)`)
              .run(r.swimmer_id, coachId, programId || null, Number(lv), date, JSON.stringify(g.scores), overall, r.t_note || '', req.currentUser.id);
            saved++;
          }
        }
      } else {
        const base = { swimmerId: r.swimmer_id, coachId, type: r.t_type || 'مستوى', race: r.t_race, date, distance: r.t_distance, time: r.t_time, position: r.t_position, passed: r.t_passed, note: r.t_note, userId: req.currentUser.id };
        await saveTestResult(Object.assign({}, base, { level: levels[0] || null }));
        saved++;
      }
    }
    if (!saved) {
      setFlash(res, { type: 'error', message: 'لم تُسجل أي نتائج — أدخل درجات المهارات بعد اختيار المستوى' });
      return res.redirect('/tests/new');
    }
  } else {
    const levels = levelsOf(b.level_id);
    const base = { swimmerId: b.swimmer_id, coachId: req.currentUser.coach_id || null, type: b.type || 'مستوى', race: b.race_type, date, distance: b.distance_m, time: b.time_seconds, position: b.position, passed: b.passed, note: b.result_note, status: b.status, userId: req.currentUser.id };
    if (base.type === 'مستوى' && levels.length) {
      for (const lv of levels) { await saveTestResult(Object.assign({}, base, { level: lv })); saved++; }
    } else {
      await saveTestResult(Object.assign({}, base, { level: levels[0] || null }));
      saved = 1;
    }
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'tests', 0, 'اختبار جديد (' + saved + ' نتيجة)', req);
  setFlash(res, { type: 'success', message: 'تم حفظ ' + saved + ' نتيجة اختبار — تظهر في الاختبارات والتقييمات الفنية' });
  res.redirect('/tests');
});
router.get('/tests/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'tests')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM tests WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/tests');
  res.render('form', { form: { title: 'تعديل الاختبار', subtitle: 'تحديث نتيجة الاختبار', icon: 'fa-pen', active: 'tests', action: '/tests/' + row.id + '/edit', fields: await testFields(row, activeSport(req)), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/tests', csrf: '' } });
});
router.post('/tests/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'tests')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  await db.prepare(`UPDATE tests SET swimmer_id=?, type=?, race_type=?, level_id=?, date=?, distance_m=?, time_seconds=?, position=?, passed=?, result_note=?, status=? WHERE id=?`)
    .run(b.swimmer_id, b.type || 'مستوى', b.race_type || '', b.level_id || null, b.date, Number(b.distance_m || 0), b.time_seconds !== '' ? Number(b.time_seconds) : null, b.position !== '' ? Number(b.position) : null, b.passed === '1' ? 1 : 0, b.result_note || '', b.status || 'اجتاز', id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'tests', id, 'تعديل اختبار', req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/tests');
});
router.post('/tests/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'tests')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  await db.prepare('DELETE FROM tests WHERE id=?').run(Number(req.params.id));
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'tests', Number(req.params.id), 'حذف اختبار', req);
  setFlash(res, { type: 'success', message: 'تم حذف الاختبار' });
  res.redirect('/tests');
});

/* ============================================================== */
/*                        الأزمنة الشخصية                         */
/* ============================================================== */
router.get('/measurements', async function (req, res) {
  if (!canView(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT pm.*, s.full_name AS swimmer_name, s.membership_no FROM player_measurements pm LEFT JOIN swimmers s ON s.id = pm.swimmer_id WHERE 1=1` + swimmerOfClause(activeSport(req), 'pm') + ` ORDER BY pm.date DESC LIMIT 200`).all();
  const page = {
    title: 'الأزمنة الشخصية', subtitle: 'سجل أزمنة اللاعبين الشخصية (PB)', icon: 'fa-stopwatch', module: 'teams', active: 'teams',
    columns: [
      { key: 'swimmer_name', label: 'اللاعب', html: row => `<div class="avatar-cell"><div class="avatar-sm">${(row.swimmer_name || 'س').trim().charAt(0)}</div><div><div class="cell-title">${row.swimmer_name || '—'}</div><div class="cell-sub">${row.membership_no || ''}</div></div></div>` },
      { key: 'race_type', label: 'السباحة', html: row => `<span class="badge badge-primary">${row.race_type}</span>` },
      { key: 'distance_m', label: 'المسافة', html: row => `${row.distance_m} م` },
      { key: 'time_seconds', label: 'الزمن', html: row => `<span class="fw-700 text-primary">${row.time_seconds}s</span>` },
      { key: 'date', label: 'التاريخ', html: row => fmtDate(row.date) }
    ],
    rows,
    filters: [{ name: 'race_type', label: 'السباحة', options: ['حرة', 'ظهر', 'صدر', 'فراشة', 'متنوع'].map(v => ({ value: v, label: v })) }],
    canAdd: true, addUrl: '/measurements/new', addLabel: 'زمن جديد',
    actions: () => row => [
      { label: 'حذف', icon: 'fa-trash', href: '/measurements/' + row.id + '/delete', confirm: 'حذف الزمن؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});
router.get('/measurements/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'زمن شخصي جديد', subtitle: 'تسجيل أفضل زمن لللاعب', icon: 'fa-plus', active: 'teams', action: '/measurements/new',
    fields: [
      { key: 'swimmer_id', label: 'اللاعب', type: 'select', options: await swimmerOptions(activeSport(req)), required: true },
      { key: 'race_type', label: 'السباحة', type: 'select', options: ['حرة', 'ظهر', 'صدر', 'فراشة', 'متنوع'].map(v => ({ value: v, label: v })) },
      { key: 'distance_m', label: 'المسافة (متر)', type: 'number', number: true },
      { key: 'time_seconds', label: 'الزمن (ثانية)', type: 'number', number: true, step: '0.01', required: true },
      { key: 'date', label: 'التاريخ', type: 'date' },
      { key: 'note', label: 'ملاحظة', type: 'textarea', full: true }
    ], values: {}, submitLabel: 'حفظ الزمن', cancelUrl: '/measurements', csrf: '' } });
});
router.post('/measurements/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const info = await db.prepare('INSERT INTO player_measurements (swimmer_id, race_type, distance_m, time_seconds, date, note) VALUES (?,?,?,?,?,?)')
    .run(b.swimmer_id, b.race_type || 'حرة', Number(b.distance_m || 50), Number(b.time_seconds), b.date || new Date().toISOString().slice(0, 10), b.note || '');
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'player_measurements', info.lastInsertRowid, 'زمن شخصي جديد', req);
  setFlash(res, { type: 'success', message: 'تم حفظ الزمن' });
  res.redirect('/measurements');
});
router.post('/measurements/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  await db.prepare('DELETE FROM player_measurements WHERE id=?').run(Number(req.params.id));
  res.redirect('/measurements');
});

/* ============================================================== */
/*                           فرق السباحة                          */
/* ============================================================== */
const teamFields = async function (values, sports, defaultSport) {
  return [
    { key: 'name', label: 'اسم الفريق', type: 'text', required: true, section: 'بيانات الفريق', sectionIcon: 'fa-flag-checkered' },
    { key: 'sport_id', label: 'اللعبة', type: 'select', options: (sports || []).map(sp => ({ value: Number(sp.id), label: sp.name })), value: (!values.sport_id ? defaultSport : values.sport_id) },
    { key: 'age_group', label: 'الفئة العمرية', type: 'text', hint: 'مثال: تحت 12 سنة' },
    { key: 'coach_id', label: 'المدرب المسؤول', type: 'select', options: await coachOptions() },
    { key: 'branch_id', label: 'الفرع', type: 'select', options: (await db.prepare('SELECT * FROM branches').all()).map(b => ({ value: b.id, label: b.name })) },
    { key: 'description', label: 'الوصف', type: 'textarea', full: true },
    { key: 'training_plan', label: 'الخطة التدريبية', type: 'textarea', full: true }
  ];
};

router.get('/teams', async function (req, res) {
  if (!canView(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT t.*, c.full_name AS coach_name, (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS members FROM teams t LEFT JOIN coaches c ON c.id = t.coach_id WHERE 1=1` + sportClause(activeSport(req), 't') + ` ORDER BY t.id`).all();
  const page = {
    title: 'فرق السباحة', subtitle: 'فرق الناشئين والبطولات', icon: 'fa-flag-checkered', module: 'teams', active: 'teams',
    columns: [
      { key: 'name', label: 'الفريق', html: row => `<div class="avatar-cell"><div class="avatar-sm" style="background:linear-gradient(135deg,#f59e0b,#ef4444)">${(row.name || 'ف').trim().charAt(0)}</div><div><div class="cell-title">${row.name}</div><div class="cell-sub">${row.age_group || ''}</div></div></div>` },
      { key: 'members', label: 'الأعضاء', html: row => `<span class="badge badge-info">${row.members} لاعب</span>` },
      { key: 'coach_name', label: 'المدرب' },
      { key: 'training_plan', label: 'الخطة التدريبية', html: row => row.training_plan ? (row.training_plan.length > 40 ? row.training_plan.slice(0, 40) + '…' : row.training_plan) : '—' }
    ],
    rows,
    filters: [{ name: 'coach_id', label: 'المدرب', options: await coachOptions(activeSport(req)) }],
    canAdd: canAdd(req.currentUser, 'teams'), addUrl: canAdd(req.currentUser, 'teams') ? '/teams/new' : null, addLabel: 'فريق جديد',
    actions: () => row => [
      { label: 'الأعضاء', icon: 'fa-users', href: '/teams/' + row.id },
      { label: 'تعديل', icon: 'fa-pen', href: '/teams/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/teams/' + row.id + '/delete', confirm: 'حذف الفريق؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});

router.get('/teams/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'فريق جديد', subtitle: 'إنشاء فريق سباحة', icon: 'fa-plus', active: 'teams', action: '/teams/new', fields: await teamFields({}, res.locals.adminSports || [], activeSport(req)), values: {}, submitLabel: 'إنشاء الفريق', cancelUrl: '/teams', csrf: '' } });
});
router.post('/teams/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const info = await db.prepare('INSERT INTO teams (name, age_group, coach_id, branch_id, description, training_plan, sport_id) VALUES (?,?,?,?,?,?,?)')
    .run(b.name, b.age_group || '', b.coach_id || null, b.branch_id || null, b.description || '', b.training_plan || '', Number(b.sport_id) || activeSport(req) || 0);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'teams', info.lastInsertRowid, 'فريق جديد: ' + b.name, req);
  setFlash(res, { type: 'success', message: 'تم إنشاء الفريق' });
  res.redirect('/teams/' + info.lastInsertRowid);
});

/* تفاصيل الفريق + إدارة الأعضاء */
router.get('/teams/:id', async function (req, res) {
  if (!canView(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const t = await db.prepare(`SELECT t.*, c.full_name AS coach_name, b.name AS branch_name FROM teams t LEFT JOIN coaches c ON c.id = t.coach_id LEFT JOIN branches b ON b.id = t.branch_id WHERE t.id = ?` + sportClause(activeSport(req), 't')).get(id);
  if (!t) return res.redirect('/teams');
  const members = await db.prepare(`SELECT tm.*, s.full_name, s.membership_no, s.birth_date FROM team_members tm JOIN swimmers s ON s.id = tm.swimmer_id WHERE tm.team_id = ? ORDER BY s.full_name`).all(id);
  const swimmers = (await db.prepare(`SELECT id, full_name, membership_no FROM swimmers WHERE deleted_at IS NULL AND id NOT IN (SELECT swimmer_id FROM team_members WHERE team_id = ?)` + progClause(activeSport(req), 'swimmers') + ` ORDER BY full_name`).all(id))
    .map(s => ({ value: s.id, label: s.full_name + ' (' + s.membership_no + ')' }));
  res.render('team_detail', { title: 'تفاصيل الفريق', active: 'teams', t, members, swimmers, money,
    canEdit: canEdit(req.currentUser, 'teams'), canDel: canDel(req.currentUser, 'teams'),
    canExport: canExport(req.currentUser, 'assessments') });
});
router.get('/teams/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM teams WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/teams');
  res.render('form', { form: { title: 'تعديل الفريق', subtitle: row.name, icon: 'fa-pen', active: 'teams', action: '/teams/' + row.id + '/edit', fields: await teamFields(row, res.locals.adminSports || [], activeSport(req)), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/teams/' + row.id, csrf: '' } });
});
router.post('/teams/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  await db.prepare('UPDATE teams SET name=?, age_group=?, coach_id=?, branch_id=?, description=?, training_plan=?, sport_id=? WHERE id=?')
    .run(b.name, b.age_group || '', b.coach_id || null, b.branch_id || null, b.description || '', b.training_plan || '', Number(b.sport_id) || activeSport(req) || 0, id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'teams', id, 'تعديل فريق', req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/teams/' + id);
});
router.post('/teams/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  await db.prepare('DELETE FROM team_members WHERE team_id=?').run(id);
  await db.prepare('DELETE FROM teams WHERE id=?').run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'teams', id, 'حذف فريق', req);
  res.redirect('/teams');
});
/* إضافة عضو إلى الفريق */
router.post('/teams/:id/members', async function (req, res) {
  if (!canEdit(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  if (b.swimmer_id) {
    const exists = await db.prepare('SELECT id FROM team_members WHERE team_id=? AND swimmer_id=?').get(id, b.swimmer_id);
    if (!exists) {
      await db.prepare('INSERT INTO team_members (team_id, swimmer_id, joined_date, role) VALUES (?,?,?,?)').run(id, b.swimmer_id, new Date().toISOString().slice(0, 10), b.role || 'لاعب');
      audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'teams', id, 'إضافة عضو للفريق', req);
    }
  }
  res.redirect('/teams/' + id);
});
router.post('/teams/:id/members/:mid/delete', async function (req, res) {
  if (!canEdit(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  await db.prepare('DELETE FROM team_members WHERE id=?').run(Number(req.params.mid));
  res.redirect('/teams/' + Number(req.params.id));
});

/* ============================================================== */
/*                           البطولات                             */
/* ============================================================== */
const COMP_TYPES = ['محلية', 'إقليمية', 'وطنية', 'دولية', 'صيفية', 'أخرى'];
const compFields = async function (values, sports, defaultSport) {
  return [
    { key: 'name', label: 'اسم البطولة', type: 'text', required: true, section: 'بيانات البطولة', sectionIcon: 'fa-trophy' },
    { key: 'sport_id', label: 'اللعبة', type: 'select', options: (sports || []).map(sp => ({ value: Number(sp.id), label: sp.name })), value: (!values.sport_id ? defaultSport : values.sport_id) },
    { key: 'type', label: 'النوع', type: 'select', options: COMP_TYPES.map(v => ({ value: v, label: v })) },
    { key: 'status', label: 'الحالة', type: 'select', options: [{ value: 'قادمة', label: 'قادمة' }, { value: 'جارية', label: 'جارية' }, { value: 'منتهية', label: 'منتهية' }] },
    { key: 'date', label: 'تاريخ البطولة', type: 'date' },
    { key: 'end_date', label: 'تاريخ النهاية', type: 'date' },
    { key: 'place', label: 'المكان', type: 'text' },
    { key: 'branch_id', label: 'الفرع', type: 'select', options: (await db.prepare('SELECT * FROM branches').all()).map(b => ({ value: b.id, label: b.name })) },
    { key: 'note', label: 'ملاحظات', type: 'textarea', full: true }
  ];
};

router.get('/competitions', async function (req, res) {
  if (!canView(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT c.*, b.name AS branch_name, (SELECT COUNT(*) FROM competition_results cr WHERE cr.competition_id = c.id) AS results FROM competitions c LEFT JOIN branches b ON b.id = c.branch_id WHERE 1=1` + sportClause(activeSport(req), 'c') + ` ORDER BY c.date DESC`).all();
  const page = {
    title: 'البطولات', subtitle: 'البطولات والمسابقات ونتائجها', icon: 'fa-trophy', module: 'competitions', active: 'competitions',
    columns: [
      { key: 'name', label: 'البطولة', html: row => `<div class="avatar-cell"><div class="avatar-sm" style="background:linear-gradient(135deg,#f59e0b,#d97706)"><i class="fas fa-trophy"></i></div><div><div class="cell-title">${row.name}</div><div class="cell-sub">${row.place || ''}</div></div></div>` },
      { key: 'type', label: 'النوع', html: row => `<span class="badge badge-primary">${row.type}</span>` },
      { key: 'date', label: 'التاريخ', html: row => `${fmtDate(row.date)}${row.end_date ? ' — ' + fmtDate(row.end_date) : ''}` },
      { key: 'results', label: 'النتائج', html: row => `<span class="badge badge-info">${row.results} نتيجة</span>` },
      { key: 'status', label: 'الحالة', html: row => `<span class="badge ${row.status === 'قادمة' ? 'badge-primary' : row.status === 'جارية' ? 'badge-warning' : 'badge-success'}">${row.status}</span>` }
    ],
    rows,
    filters: [
      { name: 'type', label: 'النوع', options: COMP_TYPES.map(v => ({ value: v, label: v })) },
      { name: 'status', label: 'الحالة', options: [{ value: 'قادمة', label: 'قادمة' }, { value: 'جارية', label: 'جارية' }, { value: 'منتهية', label: 'منتهية' }] }
    ],
    canAdd: canAdd(req.currentUser, 'competitions'), addUrl: canAdd(req.currentUser, 'competitions') ? '/competitions/new' : null, addLabel: 'بطولة جديدة',
    actions: () => row => [
      { label: 'النتائج', icon: 'fa-medal', href: '/competitions/' + row.id },
      { label: 'تعديل', icon: 'fa-pen', href: '/competitions/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/competitions/' + row.id + '/delete', confirm: 'حذف البطولة؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});

router.get('/competitions/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'بطولة جديدة', subtitle: 'تسجيل بطولة أو مسابقة', icon: 'fa-plus', active: 'competitions', action: '/competitions/new', fields: await compFields({}, res.locals.adminSports || [], activeSport(req)), values: {}, submitLabel: 'إنشاء البطولة', cancelUrl: '/competitions', csrf: '' } });
});
router.post('/competitions/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const info = await db.prepare('INSERT INTO competitions (name, type, date, end_date, place, branch_id, status, note, sport_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(b.name, b.type || 'محلية', b.date || null, b.end_date || null, b.place || '', b.branch_id || null, b.status || 'قادمة', b.note || '', Number(b.sport_id) || activeSport(req) || 0);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'competitions', info.lastInsertRowid, 'بطولة جديدة: ' + b.name, req);
  setFlash(res, { type: 'success', message: 'تم إنشاء البطولة' });
  res.redirect('/competitions/' + info.lastInsertRowid);
});

/* تفاصيل البطولة + النتائج */
router.get('/competitions/:id', async function (req, res) {
  if (!canView(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const c = await db.prepare(`SELECT c.*, b.name AS branch_name FROM competitions c LEFT JOIN branches b ON b.id = c.branch_id WHERE c.id = ?` + sportClause(activeSport(req), 'c')).get(id);
  if (!c) return res.redirect('/competitions');
  const results = await db.prepare(`SELECT cr.*, s.full_name, s.membership_no FROM competition_results cr LEFT JOIN swimmers s ON s.id = cr.swimmer_id WHERE cr.competition_id = ? ORDER BY cr.distance_m, cr.time_seconds`).all(id);
  const teamIds = (await db.prepare('SELECT DISTINCT team_id FROM team_members').all()).map(t => t.team_id);
  const swimmers = (await db.prepare('SELECT id, full_name, membership_no FROM swimmers WHERE deleted_at IS NULL' + progClause(activeSport(req), 'swimmers') + ' ORDER BY full_name').all()).map(s => ({ value: s.id, label: s.full_name + ' (' + s.membership_no + ')' }));
  res.render('competition_detail', { title: 'تفاصيل البطولة', active: 'competitions', c, results, swimmers, money,
    canEdit: canEdit(req.currentUser, 'competitions'), canDel: canDel(req.currentUser, 'competitions') });
});
router.get('/competitions/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM competitions WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/competitions');
  res.render('form', { form: { title: 'تعديل البطولة', subtitle: row.name, icon: 'fa-pen', active: 'competitions', action: '/competitions/' + row.id + '/edit', fields: await compFields(row, res.locals.adminSports || [], activeSport(req)), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/competitions/' + row.id, csrf: '' } });
});
router.post('/competitions/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  await db.prepare('UPDATE competitions SET name=?, type=?, date=?, end_date=?, place=?, branch_id=?, status=?, note=?, sport_id=? WHERE id=?')
    .run(b.name, b.type || 'محلية', b.date || null, b.end_date || null, b.place || '', b.branch_id || null, b.status || 'قادمة', b.note || '', Number(b.sport_id) || activeSport(req) || 0, id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'competitions', id, 'تعديل بطولة', req);
  res.redirect('/competitions/' + id);
});
router.post('/competitions/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  await db.prepare('DELETE FROM competition_results WHERE competition_id=?').run(id);
  await db.prepare('DELETE FROM competitions WHERE id=?').run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'competitions', id, 'حذف بطولة', req);
  res.redirect('/competitions');
});
/* إضافة نتيجة */
router.post('/competitions/:id/results', async function (req, res) {
  if (!canEdit(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  if (b.swimmer_id) {
    await db.prepare('INSERT INTO competition_results (competition_id, swimmer_id, race_type, distance_m, time_seconds, previous_time_seconds, position, qualified, pb, note) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, b.swimmer_id, b.race_type || 'حرة', Number(b.distance_m || 50), b.time_seconds !== '' ? Number(b.time_seconds) : null, b.previous_time_seconds !== '' ? Number(b.previous_time_seconds) : null, b.position !== '' ? Number(b.position) : null, b.qualified === '1' ? 1 : 0, b.pb === '1' ? 1 : 0, b.note || '');
    if (b.pb === '1') {
      await db.prepare('INSERT INTO player_measurements (swimmer_id, race_type, distance_m, time_seconds, date, note) VALUES (?,?,?,?,?,?)')
        .run(b.swimmer_id, b.race_type || 'حرة', Number(b.distance_m || 50), Number(b.time_seconds), new Date().toISOString().slice(0, 10), 'أفضل زمن في ' + b.race_type);
    }
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'competitions', id, 'إضافة نتيجة', req);
  }
  res.redirect('/competitions/' + id);
});
router.post('/competitions/:id/results/:rid/delete', async function (req, res) {
  if (!canEdit(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  await db.prepare('DELETE FROM competition_results WHERE id=?').run(Number(req.params.rid));
  res.redirect('/competitions/' + Number(req.params.id));
});

module.exports = router;
