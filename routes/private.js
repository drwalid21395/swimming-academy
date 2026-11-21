/** التدريب الخاص: مواعيد أسبوعية ثابتة لكل مدرب (باسم اللاعب وتقييمه)
    + حجز الحصص + تسجيل الحضور + فترات عدم توفر لا يمكن تسكينها */
const express = require('express');
const { db } = require('../lib/db');
const { audit, money, fmtDate, today, canView, canAdd, canEdit, canDel } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const { activeSport, effectiveSport, sportClause, swimmerSportClause } = require('../lib/sport-context');
const { normalizeTime, toMinutes, overlaps, validateRange } = require('../lib/attendance-time');

const router = express.Router();

const DAY_FULL = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const PRIV_STATUS = {
  scheduled: { label: 'مجدولة', cls: 'badge-primary', icon: 'fa-clock' },
  present: { label: 'حاضر', cls: 'badge-success', icon: 'fa-check' },
  absent: { label: 'غائب', cls: 'badge-danger', icon: 'fa-xmark' },
  excused: { label: 'معتذر', cls: 'badge-info', icon: 'fa-hand' },
  late: { label: 'متأخر', cls: 'badge-warning', icon: 'fa-hourglass-half' },
  cancelled: { label: 'ملغاة', cls: 'badge-gray', icon: 'fa-ban' }
};
const ATTENDED = ['present', 'late'];
function attCounts(st) { return ATTENDED.indexOf(st) >= 0 ? 1 : 0; }

function statusBadge(st) {
  const m = PRIV_STATUS[st] || { label: st, cls: 'badge-gray', icon: 'fa-circle' };
  return `<span class="badge ${m.cls}"><i class="fas ${m.icon}"></i> ${m.label}</span>`;
}
function ratingValue(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n))) : 0;
}
function ratingStars(r) {
  const n = ratingValue(r);
  let stars = '';
  for (let i = 1; i <= 5; i++) stars += '<i class="fas fa-star' + (i <= n ? '' : '-regular') + '"></i>';
  return '<span class="pt-stars" title="' + n + ' من 5">' + stars + '</span>';
}
function weekdayOf(dateISO) { return new Date(dateISO + 'T12:00:00').getDay(); }

async function unavailableFor(coachId) {
  return db.prepare('SELECT * FROM private_unavailable WHERE coach_id = ? ORDER BY weekday, start_time').all(coachId);
}
function blockingWindow(blocks, weekday, start, end) {
  if (!start) return null;
  return blocks.find(function (b) {
    return Number(b.weekday) === Number(weekday) && overlaps(start, end, b.start_time, b.end_time);
  }) || null;
}
async function findActivePackage(swimmerId, coachId, preferredId) {
  if (preferredId) {
    const p = await db.prepare('SELECT * FROM private_packages WHERE id = ? AND swimmer_id = ? AND coach_id = ?').get(preferredId, swimmerId, coachId);
    if (p && p.status === 'نشط' && Number(p.sessions_used) < Number(p.sessions_total)) return p;
  }
  return db.prepare("SELECT * FROM private_packages WHERE swimmer_id = ? AND coach_id = ? AND status = 'نشط' AND sessions_used < sessions_total ORDER BY id LIMIT 1")
    .get(swimmerId, coachId);
}
/* منع التسكين نهائياً داخل فترات عدم التوفر أو في حصة متداخلة */
async function bookingIssue(coachId, date, start, end, ignoreSessionId) {
  const windows = await unavailableFor(coachId);
  const blocked = blockingWindow(windows, weekdayOf(date), start, end);
  if (blocked) {
    return 'هذا الوقت ضمن فترة عدم التوفر للمدرب (' + DAY_FULL[Number(blocked.weekday)] + ' ' +
      blocked.start_time + ' - ' + blocked.end_time + ') ولا يمكن تسكينه';
  }
  const rows = await db.prepare("SELECT id, start_time, end_time FROM private_sessions WHERE coach_id = ? AND date = ? AND status != 'cancelled' AND id <> ?")
    .all(coachId, date, ignoreSessionId || 0);
  const clash = rows.find(function (r) { return overlaps(start, end, r.start_time, r.end_time); });
  if (clash) return 'يوجد حجز آخر متداخل في هذا الموعد';
  return null;
}

/* إعادة حساب حالة الباقة وفق عدد الحصص المستهلكة (تنتهي باكتمال العدد) */
async function refreshPackage(packageId) {
  if (!packageId) return;
  const p = await db.prepare('SELECT * FROM private_packages WHERE id = ?').get(packageId);
  if (!p) return;
  const total = Number(p.sessions_total || 0);
  const used = Math.min(total, Math.max(0, Number(p.sessions_used || 0)));
  let status = p.status;
  if (status !== 'ملغي') status = (total > 0 && used >= total) ? 'منتهي' : 'نشط';
  await db.prepare('UPDATE private_packages SET sessions_used=?, status=? WHERE id=?').run(used, status, packageId);
}

function flashBack(res, type, message, coachId) {
  setFlash(res, { type: type, message: message });
  res.redirect('/private-training/coach/' + coachId);
}

/* ================================================================
   التقييم الفني للتدريب الخاص
   نفس نظام التقييمات العادية بالضبط: المستويات (levels)، المعايير
   (assessment_criteria)، درجات 0-100 في scores، ونسبة overall_percent،
   مع نفس النموذج والتنسيق. البيانات تُحفظ في private_assessments حتى
   لا تؤثر على تقارير التقييمات العادية أو ملف اللاعب أو الكارت.
================================================================ */
function paView(req) { return canView(req.currentUser, 'assessments') || canView(req.currentUser, 'privateTraining'); }
function paAdd(req) { return canAdd(req.currentUser, 'assessments') || canAdd(req.currentUser, 'privateTraining'); }
function paEdit(req) { return canEdit(req.currentUser, 'assessments') || canEdit(req.currentUser, 'privateTraining'); }
function paDel(req) { return canDel(req.currentUser, 'assessments') || canDel(req.currentUser, 'privateTraining'); }

async function paLevelOptions() {
  return (await db.prepare('SELECT * FROM levels ORDER BY order_no, id').all()).map(function (l) {
    return { value: l.id, label: l.name };
  });
}
async function paGeneralCriteria() {
  return db.prepare('SELECT * FROM assessment_criteria WHERE level_id IS NULL ORDER BY order_no, id').all();
}
async function paCriteriaByLevel() {
  const rows = await db.prepare('SELECT * FROM assessment_criteria WHERE level_id IS NOT NULL ORDER BY level_id, order_no, id').all();
  const by = {};
  rows.forEach(function (c) { const k = String(c.level_id); (by[k] = by[k] || []).push(c); });
  return by;
}
async function paLevelGroups(currentLevelId) {
  const levels = await paLevelOptions();
  const by = await paCriteriaByLevel();
  return levels.map(function (l) {
    return {
      level: { value: l.value, label: l.label, current: currentLevelId != null && String(l.value) === String(currentLevelId) },
      criteria: by[String(l.value)] || []
    };
  });
}
/* نفس تقسيم coaching.js: score_<criterionId> → مستوى المعيار أو معايير عامة */
async function paParseScores(b) {
  const crit = await db.prepare('SELECT id, level_id FROM assessment_criteria').all();
  const levelOf = {};
  crit.forEach(function (c) { levelOf[c.id] = c.level_id == null ? null : String(c.level_id); });
  const perLevel = {}, sharedScores = {};
  Object.keys(b || {}).forEach(function (k) {
    const m = /^score_(\d+)$/.exec(k);
    if (!m || b[k] === undefined || b[k] === '') return;
    const cid = Number(m[1]);
    const v = Math.min(100, Math.max(0, Number(b[k]) || 0));
    const lid = levelOf[cid];
    if (lid == null) sharedScores[cid] = v;
    else {
      const g = (perLevel[lid] = perLevel[lid] || { scores: {}, n: 0, sum: 0 });
      g.scores[cid] = v; g.n++; g.sum += v;
    }
  });
  const keys = Object.keys(sharedScores);
  const shared = { scores: sharedScores, n: keys.length, sum: keys.reduce(function (s, k) { return s + sharedScores[k]; }, 0) };
  return { perLevel: perLevel, shared: shared };
}
function paHasScore(g) { return !!(g && g.scores && Object.keys(g.scores).some(function (k) { return Number(g.scores[k]) > 0; })); }
async function paExists(swimmerId, levelId, date) {
  const row = levelId == null
    ? await db.prepare('SELECT 1 FROM private_assessments WHERE swimmer_id = ? AND level_id IS NULL AND date = ? LIMIT 1').get(swimmerId, date)
    : await db.prepare('SELECT 1 FROM private_assessments WHERE swimmer_id = ? AND level_id = ? AND date = ? LIMIT 1').get(swimmerId, levelId, date);
  return !!row;
}
async function paUpsert(swimmerId, levelId, date, g, b, ctx) {
  if (!g || !g.n) return null;
  const existing = levelId == null
    ? await db.prepare('SELECT id FROM private_assessments WHERE swimmer_id = ? AND level_id IS NULL AND date = ? ORDER BY id DESC LIMIT 1').get(swimmerId, date)
    : await db.prepare('SELECT id FROM private_assessments WHERE swimmer_id = ? AND level_id = ? AND date = ? ORDER BY id DESC LIMIT 1').get(swimmerId, levelId, date);
  const overall = Math.round((g.sum / g.n) * 1000) / 1000;
  const coachId = (b && b.coach_id) || (ctx && ctx.coachId) || null;
  const programId = (b && b.program_id) || (ctx && ctx.programId) || null;
  if (existing) {
    await db.prepare('UPDATE private_assessments SET scores = ?, overall_percent = ?, coach_id = COALESCE(?, coach_id), program_id = COALESCE(?, program_id) WHERE id = ?')
      .run(JSON.stringify(g.scores), overall, coachId, programId, existing.id);
    return existing.id;
  }
  const info = await db.prepare(`INSERT INTO private_assessments
    (swimmer_id, coach_id, program_id, level_id, date, scores, overall_percent, created_by, academy_id, sport_id, availability_id, session_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(swimmerId, coachId, programId, levelId == null ? null : Number(levelId), date,
      JSON.stringify(g.scores), overall, (ctx && ctx.userId) || null,
      (ctx && ctx.academyId) || 1, (ctx && ctx.sportId) || null,
      (ctx && ctx.availabilityId) || null, (ctx && ctx.sessionId) || null);
  return info.lastInsertRowid;
}
async function paSaveMeta(id, b) {
  if (!id || !b) return;
  await db.prepare(`UPDATE private_assessments SET strengths = ?, weaknesses = ?, recommendations = ?,
      ready_to_advance = ?, next_assessment_date = ?, notes = ? WHERE id = ?`)
    .run(b.strengths || '', b.weaknesses || '', b.recommendations || '',
      b.ready_to_advance === '1' ? 1 : 0, b.next_assessment_date || null, b.notes || '', id);
}
async function paLatestScores(swimmerId) {
  const rows = await db.prepare('SELECT * FROM private_assessments WHERE swimmer_id = ? ORDER BY date DESC, id DESC').all(swimmerId);
  const seen = {}, values = {};
  rows.forEach(function (a) {
    const key = a.level_id == null ? 'g' : String(a.level_id);
    if (seen[key]) return;
    seen[key] = true;
    let sc = {}; try { sc = JSON.parse(a.scores || '{}'); } catch (e) { sc = {}; }
    Object.keys(sc).forEach(function (cid) { values['score_' + cid] = sc[cid]; });
  });
  return values;
}
/* أحدث نسبة تقييم خاص لكل لاعب — تُعرض بجانب المواعيد في صفحة المدرب */
async function paLatestPercents(ids) {
  const out = {};
  if (!ids || !ids.length) return out;
  const ph = ids.map(function () { return '?'; }).join(',');
  const rows = await db.prepare('SELECT swimmer_id, overall_percent, date FROM private_assessments WHERE swimmer_id IN (' + ph + ') ORDER BY date DESC, id DESC')
    .all(...ids);
  rows.forEach(function (r) {
    if (!out[r.swimmer_id]) out[r.swimmer_id] = { percent: Math.round(Number(r.overall_percent || 0)), date: r.date };
  });
  return out;
}
async function paSwimmerOptions() {
  return (await db.prepare('SELECT id, full_name, membership_no, level_id FROM swimmers WHERE deleted_at IS NULL ORDER BY full_name').all())
    .map(function (s) { return { value: s.id, label: s.full_name + ' (' + s.membership_no + ')', level: s.level_id || '' }; });
}
async function paCoachOptions() {
  return (await db.prepare('SELECT id, full_name FROM coaches WHERE deleted_at IS NULL ORDER BY full_name').all())
    .map(function (c) { return { value: c.id, label: c.full_name }; });
}
async function paProgramOptions() {
  return (await db.prepare('SELECT id, name FROM programs WHERE deleted_at IS NULL ORDER BY name').all())
    .map(function (p) { return { value: p.id, label: p.name }; });
}
function paDate(b, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String((b && b.date) || '')) ? String(b.date) : (fallback || today());
}
function paCtx(req, b) {
  return {
    userId: req.currentUser.id,
    academyId: Number(req.currentUser.academy_id) || 1,
    sportId: effectiveSport(req) || null,
    coachId: (b && b.coach_id) || null,
    programId: (b && b.program_id) || null,
    availabilityId: (b && b.availability_id) || null,
    sessionId: (b && b.session_id) || null
  };
}

/* ================================================================
   قائمة المدربين
================================================================ */
router.get('/private-training', async function (req, res) {
  if (!canView(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const sid = activeSport(req);
  const coaches = await db.prepare('SELECT * FROM coaches WHERE deleted_at IS NULL' + sportClause(sid, '') + ' ORDER BY full_name').all();

  const stats = {};
  const put = (id, key, val) => { stats[id] = stats[id] || {}; stats[id][key] = val; };
  (await db.prepare("SELECT coach_id, COUNT(*) AS c FROM private_availability WHERE status='نشط' GROUP BY coach_id").all())
    .forEach(a => { put(a.coach_id, 'slots', a.c); });
  (await db.prepare("SELECT coach_id, COUNT(*) AS c FROM private_availability WHERE status='نشط' AND swimmer_id IS NOT NULL GROUP BY coach_id").all())
    .forEach(a => { put(a.coach_id, 'booked', a.c); });
  (await db.prepare("SELECT coach_id, COUNT(*) AS c FROM private_availability WHERE status='نشط' AND swimmer_id IS NULL GROUP BY coach_id").all())
    .forEach(a => { put(a.coach_id, 'free', a.c); });
  (await db.prepare('SELECT coach_id, COUNT(*) AS c FROM private_unavailable GROUP BY coach_id').all())
    .forEach(a => { put(a.coach_id, 'blocked', a.c); });
  (await db.prepare("SELECT coach_id, COUNT(*) AS c FROM private_packages WHERE status='نشط' GROUP BY coach_id").all())
    .forEach(a => { put(a.coach_id, 'packages', a.c); });
  const upc = await db.prepare("SELECT coach_id, COUNT(*) AS c FROM private_sessions WHERE status='scheduled' AND date >= ? GROUP BY coach_id").all(today());
  upc.forEach(a => { put(a.coach_id, 'upcoming', a.c); });

  res.render('private/coaches', {
    title: 'التدريب الخاص', active: 'privateTraining',
    coaches, stats, dayFull: DAY_FULL,
    canEdit: canEdit(req.currentUser, 'privateTraining'), money
  });
});

/* ================================================================
   تقييم التدريب الخاص — فئة مستقلة داخل التقييمات، بنفس نظام التقييم الفني
   (نفس المستويات والمعايير ونموذج التقييم الكامل والتنسيق وسجل التقييمات)
================================================================ */
router.get('/private-training/ratings', async function (req, res) {
  if (!paView(req)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const dateToday = today();
  const coachFilter = Number(req.query.coach || 0) || 0;

  /* اللاعبون الذين لهم تدريب خاص: موعد ثابت مُسكَّن أو حصة مسجلة */
  let members = await db.prepare(`SELECT DISTINCT s.id, s.full_name, s.membership_no, s.level_id, l.name AS level_name,
      (SELECT x.date FROM private_assessments x WHERE x.swimmer_id = s.id ORDER BY x.date DESC, x.id DESC LIMIT 1) AS last_date,
      (SELECT x.overall_percent FROM private_assessments x WHERE x.swimmer_id = s.id ORDER BY x.date DESC, x.id DESC LIMIT 1) AS last_percent,
      (SELECT COUNT(*) FROM private_assessments x WHERE x.swimmer_id = s.id AND x.date = ?) AS assessed_today
    FROM swimmers s LEFT JOIN levels l ON l.id = s.level_id
    WHERE s.deleted_at IS NULL
      AND (EXISTS (SELECT 1 FROM private_availability pa WHERE pa.swimmer_id = s.id)
        OR EXISTS (SELECT 1 FROM private_sessions ps WHERE ps.swimmer_id = s.id))
    ORDER BY s.full_name`).all(dateToday);

  const coaches = await db.prepare('SELECT id, full_name FROM coaches WHERE deleted_at IS NULL ORDER BY full_name').all();
  const coachName = {};
  coaches.forEach(function (c) { coachName[c.id] = c.full_name; });
  const coachesOf = {};
  (await db.prepare('SELECT swimmer_id, coach_id FROM private_availability WHERE swimmer_id IS NOT NULL').all()).forEach(function (r) {
    (coachesOf[r.swimmer_id] = coachesOf[r.swimmer_id] || {})[r.coach_id] = 1;
  });
  (await db.prepare('SELECT swimmer_id, coach_id FROM private_sessions WHERE swimmer_id IS NOT NULL').all()).forEach(function (r) {
    (coachesOf[r.swimmer_id] = coachesOf[r.swimmer_id] || {})[r.coach_id] = 1;
  });
  members.forEach(function (m) {
    const ids = Object.keys(coachesOf[m.id] || {}).filter(function (id) { return Number(id) && coachName[id]; });
    m.coaches = ids.map(function (id) { return coachName[id]; }).join('، ');
    /* المدرب المرتبط باللاعب: يُحفظ مع التقييم حتى في الحفظ السريع */
    m.coach_id = coachFilter && ids.indexOf(String(coachFilter)) !== -1 ? coachFilter : (ids.length ? Number(ids[0]) : '');
  });
  if (coachFilter) members = members.filter(function (m) { return !!(coachesOf[m.id] || {})[coachFilter]; });

  const general = await paGeneralCriteria();
  const byLevel = await paCriteriaByLevel();
  const levels = (await paLevelOptions()).filter(function (l) { return (byLevel[String(l.value)] || []).length; });

  /* أحدث درجات كل لاعب (كما في صفحة المجموعة بالتقييمات العادية) */
  const savedScores = {}, levelPercents = {};
  if (members.length) {
    const ph = members.map(function () { return '?'; }).join(',');
    const rows = await db.prepare('SELECT * FROM private_assessments WHERE swimmer_id IN (' + ph + ') ORDER BY date DESC, id DESC')
      .all(...members.map(function (m) { return m.id; }));
    const latest = {};
    rows.forEach(function (a) {
      const key = a.level_id == null ? 'g' : String(a.level_id);
      const box = (latest[a.swimmer_id] = latest[a.swimmer_id] || {});
      if (!box[key]) box[key] = a;
    });
    Object.keys(latest).forEach(function (sid) {
      savedScores[sid] = {}; levelPercents[sid] = {};
      Object.keys(latest[sid]).forEach(function (key) {
        const a = latest[sid][key];
        let sc = {}; try { sc = JSON.parse(a.scores || '{}'); } catch (e) { sc = {}; }
        Object.keys(sc).forEach(function (cid) { savedScores[sid][cid] = sc[cid]; });
        if (a.overall_percent !== null && a.overall_percent !== undefined)
          levelPercents[sid][key] = { percent: a.overall_percent, date: a.date };
      });
    });
  }
  const stats = await db.prepare('SELECT COUNT(DISTINCT swimmer_id) AS swimmers, ROUND(AVG(overall_percent),1) AS avg FROM private_assessments').get();
  const group = {
    id: 0,
    name: coachFilter && coachName[coachFilter] ? ('تقييم التدريب الخاص — ' + coachName[coachFilter]) : 'تقييم التدريب الخاص',
    program_name: 'التدريب الخاص',
    coach_name: coachFilter && coachName[coachFilter] ? coachName[coachFilter] : ''
  };
  res.render('private/assessment_group', {
    title: 'تقييم التدريب الخاص', active: 'assessments',
    group, members, coaches, coachFilter, generalCriteria: general, criteriaByLevel: byLevel,
    savedScores, levelPercents, ungrouped: [], today: dateToday, levels,
    criteriaJson: JSON.stringify(byLevel).replace(/</g, '\\u003c'),
    kpi: { swimmers: (stats && stats.swimmers) || 0, avg: (stats && stats.avg) || 0, coaches: coaches.length }
  });
});

/* سجل تقييمات التدريب الخاص (نفس فكرة سجل التقييمات العادي) */
router.get('/private-training/ratings/log', async function (req, res) {
  if (!paView(req)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT pa.id, pa.date, pa.overall_percent, pa.swimmer_id, pa.coach_id,
      s.full_name AS swimmer_name, s.membership_no, c.full_name AS coach_name, l.name AS level_name
    FROM private_assessments pa
    LEFT JOIN swimmers s ON s.id = pa.swimmer_id
    LEFT JOIN coaches c ON c.id = pa.coach_id
    LEFT JOIN levels l ON l.id = pa.level_id
    ORDER BY pa.date DESC, pa.id DESC LIMIT 600`).all();
  const grouped = [], seen = {};
  rows.forEach(function (a) {
    const key = a.swimmer_id + '|' + a.date;
    if (!seen[key]) {
      seen[key] = { swimmer_id: a.swimmer_id, swimmer_name: a.swimmer_name, membership_no: a.membership_no,
        date: a.date, coach_name: a.coach_name, id: a.id, levels: [], ids: [], sum: 0, n: 0 };
      grouped.push(seen[key]);
    }
    const g = seen[key];
    g.ids.push(a.id);
    if (a.level_name) g.levels.push(a.level_name);
    g.sum += Number(a.overall_percent || 0); g.n++;
  });
  grouped.forEach(function (g) {
    g.avg = g.n ? Math.round((g.sum / g.n) * 10) / 10 : 0;
    g.level_names = g.levels.join('، ');
  });
  res.render('private/assessment_log', { title: 'سجل تقييمات التدريب الخاص', active: 'assessments', rows: grouped });
});

/* النموذج الكامل — جديد */
router.get('/private-training/ratings/new', async function (req, res) {
  if (!paAdd(req)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const values = { date: today() };
  let currentLevelId = null;
  if (req.query.swimmer) {
    const sw = await db.prepare('SELECT id, level_id FROM swimmers WHERE id = ?').get(Number(req.query.swimmer));
    if (sw) {
      values.swimmer_id = sw.id;
      currentLevelId = sw.level_id;
      Object.assign(values, await paLatestScores(sw.id));
    }
  }
  if (req.query.coach) values.coach_id = Number(req.query.coach);
  res.render('private/assessment_form', {
    title: 'تقييم فني جديد — التدريب الخاص', active: 'assessments', isEdit: false, returnGroup: null,
    action: '/private-training/ratings/new', values,
    levelGroups: await paLevelGroups(currentLevelId), generalCriteria: await paGeneralCriteria(),
    swimmers: await paSwimmerOptions(), coaches: await paCoachOptions(), programs: await paProgramOptions()
  });
});

router.post('/private-training/ratings/new', async function (req, res) {
  if (!paAdd(req)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const swimmerId = Number(b.swimmer_id || 0);
  if (!swimmerId) {
    setFlash(res, { type: 'error', message: 'اختر اللاعب أولاً' });
    return res.redirect('/private-training/ratings/new');
  }
  const date = paDate(b);
  const { perLevel, shared } = await paParseScores(b);
  const ctx = paCtx(req, b);
  let firstId = null, levelCount = 0;
  for (const lid of Object.keys(perLevel)) {
    const g = perLevel[lid];
    if (!g || !g.n) continue;
    if (!paHasScore(g) && !(await paExists(swimmerId, Number(lid), date))) continue;
    const rid = await paUpsert(swimmerId, Number(lid), date, g, b, ctx);
    if (rid) { await paSaveMeta(rid, b); if (firstId === null) firstId = rid; levelCount++; }
  }
  if (shared.n && (paHasScore(shared) || await paExists(swimmerId, null, date))) {
    const gid = await paUpsert(swimmerId, null, date, shared, b, ctx);
    if (gid) { await paSaveMeta(gid, b); if (firstId === null) firstId = gid; }
  }
  if (firstId) {
    audit(req.currentUser.id, req.currentUser.full_name, 'add', 'privateTraining', firstId,
      'تقييم فني خاص على ' + levelCount + ' مستوى', req);
    setFlash(res, { type: 'success', message: 'تم حفظ تقييم التدريب الخاص بنجاح' });
  } else {
    setFlash(res, { type: 'error', message: 'لم تُسجل أي نسب — تأكد من تقييم مهارة واحدة على الأقل' });
  }
  res.redirect('/private-training/ratings');
});

/* حفظ سريع تلقائي من صفحة اللاعبين (نفس آلية حفظ المجموعة العادية) */
router.post('/private-training/ratings/:sid/quick', async function (req, res) {
  if (!paAdd(req) && !paEdit(req)) return res.status(403).json({ ok: false, error: 'لا تملك صلاحية التقييم' });
  const swimmerId = Number(req.params.sid);
  const sw = await db.prepare('SELECT id, level_id FROM swimmers WHERE id = ? AND deleted_at IS NULL').get(swimmerId);
  if (!sw) return res.status(404).json({ ok: false, error: 'اللاعب غير موجود' });
  const b = req.body || {};
  const date = paDate(b);
  const { perLevel, shared } = await paParseScores(b);
  const ctx = paCtx(req, b);
  const levelResults = {};
  for (const lid of Object.keys(perLevel)) {
    const g = perLevel[lid];
    if (!g || !g.n) continue;
    if (!paHasScore(g) && !(await paExists(swimmerId, Number(lid), date))) continue;
    await paUpsert(swimmerId, Number(lid), date, g, b, ctx);
    levelResults[lid] = Math.round((g.sum / g.n) * 1000) / 1000;
  }
  let generalPercent = null;
  if (shared.n && (paHasScore(shared) || await paExists(swimmerId, null, date))) {
    await paUpsert(swimmerId, null, date, shared, b, ctx);
    generalPercent = Math.round((shared.sum / shared.n) * 1000) / 1000;
  }
  const ids = Object.keys(levelResults);
  if (!ids.length && generalPercent === null) return res.status(400).json({ ok: false, error: 'لم تُسجل أي نسب — غيّر نسبة مهارة واحدة على الأقل' });
  const overall = ids.length
    ? Math.round((ids.reduce(function (s, k) { return s + levelResults[k]; }, 0) / ids.length) * 1000) / 1000
    : generalPercent;
  let assignedLevelId = sw.level_id != null ? Number(sw.level_id) : null;
  if (assignedLevelId == null && b.level_id) {
    const l = await db.prepare('SELECT id FROM levels WHERE id = ?').get(Number(b.level_id));
    if (l) assignedLevelId = Number(l.id);
  }
  res.json({
    ok: true, percent: overall,
    level_percent: assignedLevelId != null && levelResults[assignedLevelId] !== undefined ? levelResults[assignedLevelId] : null,
    general_percent: generalPercent, level_id: assignedLevelId, levels: levelResults,
    date: date, date_label: fmtDate(date),
    time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
  });
});

/* API: معايير المستوى + أحدث درجات اللاعب (لتعبئة النموذج الكامل) */
router.get('/api/private-training/ratings/criteria', async function (req, res) {
  if (!paView(req)) return res.status(403).json({ ok: false, error: 'لا تملك صلاحية العرض' });
  const lid = req.query.level_id ? Number(req.query.level_id) : null;
  res.json(lid
    ? await db.prepare('SELECT * FROM assessment_criteria WHERE level_id = ? ORDER BY order_no').all(lid)
    : await db.prepare('SELECT * FROM assessment_criteria WHERE level_id IS NULL ORDER BY order_no').all());
});
router.get('/api/private-training/ratings/swimmer/:id/scores', async function (req, res) {
  if (!paView(req)) return res.status(403).json({ ok: false, error: 'لا تملك صلاحية العرض' });
  const sw = await db.prepare('SELECT id, level_id FROM swimmers WHERE id = ? AND deleted_at IS NULL').get(Number(req.params.id));
  if (!sw) return res.status(404).json({ ok: false, error: 'اللاعب غير موجود' });
  res.json({ ok: true, level_id: sw.level_id, scores: await paLatestScores(sw.id) });
});

/* تفاصيل تقييم خاص */
router.get('/private-training/ratings/:id', async function (req, res) {
  if (!paView(req)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const a = await db.prepare(`SELECT pa.*, s.full_name AS swimmer_name, s.membership_no, c.full_name AS coach_name,
      l.name AS level_name, p.name AS program_name
    FROM private_assessments pa
    LEFT JOIN swimmers s ON s.id = pa.swimmer_id LEFT JOIN coaches c ON c.id = pa.coach_id
    LEFT JOIN levels l ON l.id = pa.level_id LEFT JOIN programs p ON p.id = pa.program_id
    WHERE pa.id = ?`).get(id);
  if (!a) return res.redirect('/private-training/ratings');
  let scores = {}; try { scores = JSON.parse(a.scores || '{}'); } catch (e) { scores = {}; }
  const criteriaMap = {};
  (await db.prepare('SELECT * FROM assessment_criteria').all()).forEach(function (c) { criteriaMap[c.id] = c; });
  let levelTotal = 0, levelCount = 0;
  Object.keys(scores).forEach(function (k) {
    if (criteriaMap[Number(k)]) { levelTotal += Number(scores[k]) || 0; levelCount++; }
  });
  const levelPercent = levelCount ? Math.round((levelTotal / levelCount) * 1000) / 1000 : 0;
  res.render('private/assessment_detail', {
    title: 'تفاصيل تقييم التدريب الخاص', active: 'assessments', a, scores, criteriaMap,
    levelTotal, levelCount, levelPercent, money, canEdit: paEdit(req), canDel: paDel(req)
  });
});

/* تعديل التقييم الكامل */
router.get('/private-training/ratings/:id/edit', async function (req, res) {
  if (!paEdit(req)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM private_assessments WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.redirect('/private-training/ratings');
  let saved = {}; try { saved = JSON.parse(row.scores || '{}'); } catch (e) { saved = {}; }
  const values = Object.assign({}, row);
  Object.keys(saved).forEach(function (k) { values['score_' + k] = saved[k]; });
  const seen = {};
  (await db.prepare('SELECT * FROM private_assessments WHERE swimmer_id = ? AND level_id IS NOT NULL ORDER BY date DESC, id DESC').all(row.swimmer_id))
    .forEach(function (a) { if (!seen[a.level_id]) seen[a.level_id] = a; });
  Object.keys(seen).forEach(function (lid) {
    if (String(lid) === String(row.level_id)) return;
    let sc = {}; try { sc = JSON.parse(seen[lid].scores || '{}'); } catch (e) { sc = {}; }
    Object.keys(sc).forEach(function (k) { values['score_' + k] = sc[k]; });
  });
  const gen = await db.prepare('SELECT * FROM private_assessments WHERE swimmer_id = ? AND level_id IS NULL ORDER BY date DESC, id DESC').get(row.swimmer_id);
  if (gen) {
    let g = {}; try { g = JSON.parse(gen.scores || '{}'); } catch (e) { g = {}; }
    Object.keys(g).forEach(function (k) { values['score_' + k] = g[k]; });
  }
  res.render('private/assessment_form', {
    title: 'تعديل تقييم التدريب الخاص', active: 'assessments', isEdit: true, returnGroup: null,
    action: '/private-training/ratings/' + row.id + '/edit', values,
    levelGroups: await paLevelGroups(row.level_id != null ? row.level_id : null),
    generalCriteria: await paGeneralCriteria(),
    swimmers: await paSwimmerOptions(), coaches: await paCoachOptions(), programs: await paProgramOptions()
  });
});

router.post('/private-training/ratings/:id/edit', async function (req, res) {
  if (!paEdit(req)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id), b = req.body;
  const row = await db.prepare('SELECT * FROM private_assessments WHERE id = ?').get(id);
  if (!row) return res.redirect('/private-training/ratings');
  const swimmerId = Number(b.swimmer_id || row.swimmer_id);
  const date = paDate(b, row.date);
  const { perLevel, shared } = await paParseScores(b);
  const primaryIsGeneral = row.level_id == null;
  const primaryG = primaryIsGeneral ? shared : (perLevel[row.level_id] || { scores: {}, n: 0, sum: 0 });
  const overall = primaryG.n ? Math.round((primaryG.sum / primaryG.n) * 1000) / 1000 : 0;
  await db.prepare(`UPDATE private_assessments SET swimmer_id=?, coach_id=?, program_id=?, date=?,
      scores=?, strengths=?, weaknesses=?, recommendations=?, ready_to_advance=?,
      next_assessment_date=?, overall_percent=?, notes=? WHERE id=?`)
    .run(swimmerId, b.coach_id || null, b.program_id || null, date, JSON.stringify(primaryG.scores),
      b.strengths || '', b.weaknesses || '', b.recommendations || '', b.ready_to_advance === '1' ? 1 : 0,
      b.next_assessment_date || null, overall, b.notes || '', id);
  const ctx = paCtx(req, b);
  for (const lid of Object.keys(perLevel)) {
    if (!primaryIsGeneral && String(lid) === String(row.level_id)) continue;
    const g = perLevel[lid];
    if (!g || !g.n) continue;
    if (!paHasScore(g) && !(await paExists(swimmerId, Number(lid), date))) continue;
    await paUpsert(swimmerId, Number(lid), date, g, b, ctx);
  }
  if (!primaryIsGeneral && shared.n && (paHasScore(shared) || await paExists(swimmerId, null, date))) {
    await paUpsert(swimmerId, null, date, shared, b, ctx);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'privateTraining', id, 'تعديل تقييم فني خاص', req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات على جميع المستويات' });
  res.redirect('/private-training/ratings/' + id);
});

router.post('/private-training/ratings/:id/delete', async function (req, res) {
  if (!paDel(req)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT swimmer_id, date FROM private_assessments WHERE id = ?').get(id);
  if (row) await db.prepare('DELETE FROM private_assessments WHERE swimmer_id = ? AND date = ?').run(row.swimmer_id, row.date);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'privateTraining', id, 'حذف تقييم فني خاص', req);
  setFlash(res, { type: 'success', message: 'تم حذف التقييم' });
  res.redirect('/private-training/ratings/log');
});

/* ================================================================
   صفحة المدرب: لوحة البيانات + المواعيد الثابتة + شبكة الأسبوع
================================================================ */
router.get('/private-training/coach/:id', async function (req, res) {
  if (!canView(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coachId = Number(req.params.id);
  const coach = await db.prepare('SELECT * FROM coaches WHERE id = ?').get(coachId);
  if (!coach) { setFlash(res, { type: 'error', message: 'المدرب غير موجود' }); return res.redirect('/private-training'); }

  const weekParam = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.week || '')) ? String(req.query.week) : today();
  const wStart = new Date(weekParam + 'T12:00:00');
  wStart.setDate(wStart.getDate() - wStart.getDay());
  const iso = function (d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), x = String(d.getDate()).padStart(2, '0'); return y + '-' + m + '-' + x; };
  const wEnd = new Date(wStart.getTime()); wEnd.setDate(wEnd.getDate() + 6);
  const weekStartISO = iso(wStart), weekEndISO = iso(wEnd);
  const prevWeek = iso(new Date(wStart.getTime() - 7 * 864e5));
  const nextWeek = iso(new Date(wStart.getTime() + 7 * 864e5));

  const availability = await db.prepare(`SELECT pa.*, sw.full_name AS swimmer_name FROM private_availability pa
    LEFT JOIN swimmers sw ON sw.id = pa.swimmer_id
    WHERE pa.coach_id = ? ORDER BY pa.weekday, pa.start_time`).all(coachId);
  const unavailable = await unavailableFor(coachId);
  const sessions = await db.prepare(`SELECT ps.*, sw.full_name AS swimmer_name, sw.membership_no FROM private_sessions ps
    LEFT JOIN swimmers sw ON sw.id = ps.swimmer_id
    WHERE ps.coach_id = ? AND ps.date BETWEEN ? AND ? ORDER BY ps.date, ps.start_time`).all(coachId, weekStartISO, weekEndISO);
  const allSessions = await db.prepare(`SELECT ps.*, sw.full_name AS swimmer_name FROM private_sessions ps
    LEFT JOIN swimmers sw ON sw.id = ps.swimmer_id
    WHERE ps.coach_id = ? ORDER BY ps.date DESC, ps.start_time DESC LIMIT 200`).all(coachId);

  const packages = await db.prepare(`SELECT pp.*, sw.full_name AS swimmer_name,
      MAX(0, pp.sessions_total - pp.sessions_used) AS sessions_left
    FROM private_packages pp LEFT JOIN swimmers sw ON sw.id = pp.swimmer_id
    WHERE pp.coach_id = ?
    ORDER BY CASE pp.status WHEN 'نشط' THEN 0 ELSE 1 END, pp.created_at DESC`).all(coachId);
  const swimmers = await db.prepare('SELECT id, full_name, membership_no FROM swimmers WHERE deleted_at IS NULL' + swimmerSportClause(activeSport(req), '') + " AND status != 'منسحب' ORDER BY full_name").all();

  // شبكة الأسبوع: فترات عدم التوفر + المواعيد الثابتة + حالة الحجز
  const sessByKey = {};
  sessions.forEach(function (s) { sessByKey[s.date + '|' + (s.start_time || '')] = s; });
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(wStart.getTime()); d.setDate(d.getDate() + i);
    const dateISO = iso(d);
    const wd = d.getDay();
    const entries = [];
    unavailable.filter(function (b) { return Number(b.weekday) === wd; }).forEach(function (b) {
      entries.push({ blocked: true, block: b, start: b.start_time, end: b.end_time, note: b.note });
    });
    availability.filter(function (a) { return Number(a.weekday) === wd && a.status === 'نشط'; }).forEach(function (a) {
      const key = dateISO + '|' + (a.start_time || '');
      const s = sessByKey[key] || null;
      if (s) delete sessByKey[key];
      const block = blockingWindow(unavailable, wd, a.start_time, a.end_time);
      entries.push({
        start: a.start_time, end: a.end_time, rate: a.rate,
        availability_id: a.id, availability: a, session: s,
        swimmer_id: a.swimmer_id, swimmer_name: a.swimmer_name, rating: a.rating,
        blocked: !!block, block: block
      });
    });
    sessions.filter(function (s) { return s.date === dateISO; }).forEach(function (s) {
      if (entries.some(function (e) { return e.session && e.session.id === s.id; })) return;
      entries.push({ start: s.start_time, end: s.end_time, rate: s.rate, availability_id: null, session: s, blocked: false });
    });
    entries.sort(function (x, y) { return String(x.start).localeCompare(String(y.start)); });
    days.push({ date: dateISO, weekday: wd, label: DAY_FULL[wd], isToday: dateISO === today(), isPast: dateISO < today(), entries: entries });
  }

  /* أحدث تقييم فني خاص لكل لاعب في هذه الصفحة */
  const paIds = [];
  availability.concat(allSessions).forEach(function (x) {
    if (x.swimmer_id && paIds.indexOf(x.swimmer_id) === -1) paIds.push(x.swimmer_id);
  });
  const paPercents = await paLatestPercents(paIds);

  const activeSlots = availability.filter(function (a) { return a.status === 'نشط'; });
  const slotBlocked = function (a) { return !!blockingWindow(unavailable, a.weekday, a.start_time, a.end_time); };
  const blockedSlotIds = activeSlots.filter(slotBlocked).map(function (a) { return a.id; });
  const kpi = {
    slots: activeSlots.length,
    booked: activeSlots.filter(function (a) { return a.swimmer_id; }).length,
    free: activeSlots.filter(function (a) { return !a.swimmer_id && !slotBlocked(a); }).length,
    blocked: unavailable.length,
    packages: packages.filter(function (p) { return p.status === 'نشط'; }).length,
    scheduled: allSessions.filter(function (s) { return s.status === 'scheduled'; }).length,
    used: packages.reduce(function (a, p) { return a + Number(p.sessions_used || 0); }, 0)
  };

  res.render('private/coach', {
    title: 'التدريب الخاص — ' + coach.full_name, active: 'privateTraining',
    coach, availability, unavailable, blockedSlotIds, days, weekStartISO, weekEndISO, prevWeek, nextWeek, packages, swimmers, allSessions, kpi, paPercents,
    dayFull: DAY_FULL, PRIV_STATUS, ATTENDED,
    canAdd: canAdd(req.currentUser, 'privateTraining'), canEdit: canEdit(req.currentUser, 'privateTraining'), canDel: canDel(req.currentUser, 'privateTraining'),
    money, fmtDate, statusBadge, ratingStars, ratingValue, today: today()
  });
});

/* ================================================================
   المواعيد الثابتة الأسبوعية (اسم اللاعب + التقييم اختياريان)
================================================================ */
router.post('/private-training/coach/:id/availability', async function (req, res) {
  if (!canAdd(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coachId = Number(req.params.id);
  const weekday = Number(req.body.weekday);
  const vr = validateRange(req.body.start_time, req.body.end_time);
  if (!(weekday >= 0 && weekday <= 6) || vr.error) return flashBack(res, 'error', 'حدد اليوم ووقت البداية ووقت النهاية بشكل صحيح', coachId);
  const windows = await unavailableFor(coachId);
  if (blockingWindow(windows, weekday, vr.from, vr.to)) return flashBack(res, 'error', 'هذا الوقت ضمن فترة عدم التوفر للمدرب', coachId);
  const dupe = await db.prepare('SELECT id FROM private_availability WHERE coach_id = ? AND weekday = ? AND start_time = ?').get(coachId, weekday, vr.from);
  if (dupe) return flashBack(res, 'error', 'هذا الموعد مضاف مسبقاً', coachId);
  const swimmerId = Number(req.body.swimmer_id) || null;
  if (swimmerId) {
    const sw = await db.prepare('SELECT id FROM swimmers WHERE id = ? AND deleted_at IS NULL').get(swimmerId);
    if (!sw) return flashBack(res, 'error', 'اللاعب المختار غير موجود', coachId);
  }
  await db.prepare(`INSERT INTO private_availability
    (coach_id, weekday, start_time, end_time, rate, status, note, swimmer_id, rating, sport_id, academy_id, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(coachId, weekday, vr.from, vr.to, Number(req.body.rate || 0), 'نشط', String(req.body.note || ''),
      swimmerId, ratingValue(req.body.rating), effectiveSport(req) || null, Number(req.currentUser.academy_id) || 1, req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'privateTraining', coachId,
    'إضافة موعد تدريب خاص: ' + DAY_FULL[weekday] + ' ' + vr.from + (swimmerId ? ' — لاعب مُسكَّن' : ''), req);
  setFlash(res, { type: 'success', message: swimmerId ? 'تمت إضافة الموعد وتسكين اللاعب' : 'تمت إضافة الموعد الأسبوعي' });
  res.redirect('/private-training/coach/' + coachId);
});

/* تسكين/إزالة اللاعب على موعد ثابت + تعديل التقييم */
router.post('/private-training/availability/:aid/assign', async function (req, res) {
  if (!canAdd(req.currentUser, 'privateTraining') && !canEdit(req.currentUser, 'privateTraining')) {
    return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  }
  const aid = Number(req.params.aid);
  const a = await db.prepare('SELECT * FROM private_availability WHERE id = ?').get(aid);
  if (!a) { setFlash(res, { type: 'error', message: 'الموعد غير موجود' }); return res.redirect('/private-training'); }
  const swimmerId = Number(req.body.swimmer_id) || 0;
  const rating = ratingValue(req.body.rating != null && req.body.rating !== '' ? req.body.rating : a.rating);
  if (swimmerId) {
    const sw = await db.prepare('SELECT id FROM swimmers WHERE id = ? AND deleted_at IS NULL').get(swimmerId);
    if (!sw) return flashBack(res, 'error', 'اللاعب المختار غير موجود', a.coach_id);
    const windows = await unavailableFor(a.coach_id);
    if (blockingWindow(windows, a.weekday, a.start_time, a.end_time)) {
      return flashBack(res, 'error', 'لا يمكن التسكين في فترة عدم التوفر', a.coach_id);
    }
  }
  await db.prepare('UPDATE private_availability SET swimmer_id = ?, rating = ? WHERE id = ?').run(swimmerId || null, rating, aid);
  await db.prepare('UPDATE private_sessions SET rating = ? WHERE availability_id = ?').run(rating, aid);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'privateTraining', aid,
    swimmerId ? 'تسكين لاعب في موعد تدريب خاص' : 'إزالة تسكين من موعد تدريب خاص', req);
  setFlash(res, { type: 'success', message: swimmerId ? 'تم تسكين اللاعب وحفظ التقييم' : 'تم إزالة التسكين' });
  res.redirect('/private-training/coach/' + a.coach_id);
});

router.post('/private-training/availability/:aid/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const aid = Number(req.params.aid);
  const a = await db.prepare('SELECT * FROM private_availability WHERE id = ?').get(aid);
  if (a) await db.prepare('DELETE FROM private_availability WHERE id = ?').run(aid);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'privateTraining', aid, 'حذف موعد تدريب خاص', req);
  setFlash(res, { type: 'success', message: 'تم حذف الموعد' });
  res.redirect('/private-training/coach/' + (a ? a.coach_id : ''));
});

/* ================================================================
   فترات عدم التوفر — ممنوع التسكين داخلها نهائياً
================================================================ */
router.post('/private-training/coach/:id/unavailable', async function (req, res) {
  if (!canAdd(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coachId = Number(req.params.id);
  const weekday = Number(req.body.weekday);
  const vr = validateRange(req.body.start_time, req.body.end_time);
  if (!(weekday >= 0 && weekday <= 6) || vr.error) return flashBack(res, 'error', 'حدد اليوم ووقت البداية ووقت النهاية بشكل صحيح', coachId);
  const windows = await unavailableFor(coachId);
  const dupe = windows.find(function (b) { return Number(b.weekday) === weekday && overlaps(vr.from, vr.to, b.start_time, b.end_time); });
  if (dupe) return flashBack(res, 'error', 'هذه الفترة مضافة مسبقاً', coachId);
  await db.prepare(`INSERT INTO private_unavailable
    (coach_id, weekday, start_time, end_time, note, sport_id, academy_id, created_by)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(coachId, weekday, vr.from, vr.to, String(req.body.note || ''), effectiveSport(req) || null,
      Number(req.currentUser.academy_id) || 1, req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'privateTraining', coachId,
    'فترة عدم توفر: ' + DAY_FULL[weekday] + ' ' + vr.from + ' - ' + vr.to, req);
  setFlash(res, { type: 'success', message: 'تمت إضافة فترة عدم التوفر — لا يمكن تسكين أي حصة داخلها' });
  res.redirect('/private-training/coach/' + coachId);
});

router.post('/private-training/unavailable/:uid/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const uid = Number(req.params.uid);
  const row = await db.prepare('SELECT * FROM private_unavailable WHERE id = ?').get(uid);
  if (row) await db.prepare('DELETE FROM private_unavailable WHERE id = ?').run(uid);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'privateTraining', uid, 'حذف فترة عدم توفر', req);
  setFlash(res, { type: 'success', message: 'تمت إزالة فترة عدم التوفر' });
  res.redirect('/private-training/coach/' + (row ? row.coach_id : ''));
});

/* ================================================================
   الباقات
================================================================ */
router.post('/private-training/coach/:id/package', async function (req, res) {
  if (!canAdd(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coachId = Number(req.params.id);
  const b = req.body;
  const swimmerId = Number(b.swimmer_id) || 0;
  const total = Math.max(0, Number(b.sessions_total) || 0);
  const perSession = Math.max(0, Number(b.price_per_session) || 0);
  if (!swimmerId || total <= 0) return flashBack(res, 'error', 'اختر اللاعب وعدد الحصص', coachId);
  const price = Math.round(total * perSession * 100) / 100;
  const paid = Math.max(0, Number(b.paid_amount) || 0);
  const remaining = Math.round((price - paid) * 100) / 100;
  await db.prepare(`INSERT INTO private_packages (academy_id, sport_id, swimmer_id, coach_id, sessions_total, sessions_used, price_per_session, price, paid_amount, remaining, start_date, status, notes, created_by)
    VALUES (?,?,?,?,?,0,?,?,?,?,?,'نشط',?,?)`)
    .run(Number(req.currentUser.academy_id) || 1, effectiveSport(req), swimmerId, coachId, total, perSession, price, paid, remaining, String(b.start_date || today()), String(b.notes || ''), req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'privateTraining', coachId, 'إنشاء باقة تدريب خاص (' + total + ' حصة)', req);
  setFlash(res, { type: 'success', message: 'تم إنشاء الباقة' });
  res.redirect('/private-training/coach/' + coachId);
});

router.post('/private-training/package/:pid/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const pid = Number(req.params.pid);
  const pkg = await db.prepare('SELECT * FROM private_packages WHERE id = ?').get(pid);
  if (!pkg) { setFlash(res, { type: 'error', message: 'الباقة غير موجودة' }); return res.redirect('/private-training'); }
  if (Number(pkg.sessions_used) > 0) return flashBack(res, 'error', 'لا يمكن حذف باقة بها حصص مسجلة', pkg.coach_id);
  await db.prepare('DELETE FROM private_sessions WHERE package_id = ?').run(pid);
  await db.prepare('DELETE FROM private_packages WHERE id = ?').run(pid);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'privateTraining', pid, 'حذف باقة تدريب خاص', req);
  setFlash(res, { type: 'success', message: 'تم حذف الباقة' });
  res.redirect('/private-training/coach/' + pkg.coach_id);
});

/* ================================================================
   حجز حصة داخل موعد ثابت (باسم اللاعب + التقييم)
================================================================ */
router.post('/private-training/coach/:id/book', async function (req, res) {
  if (!canAdd(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const coachId = Number(req.params.id);
  const b = req.body;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : '';
  const swimmerId = Number(b.swimmer_id) || 0;
  const availabilityId = Number(b.availability_id) || 0;
  let availability = null;
  if (availabilityId) {
    availability = await db.prepare('SELECT * FROM private_availability WHERE id = ? AND coach_id = ?').get(availabilityId, coachId);
    if (!availability) return flashBack(res, 'error', 'الموعد الثابت غير صحيح', coachId);
  }
  let start = normalizeTime(b.start_time);
  let end = normalizeTime(b.end_time);
  if (availability) {
    if (!start) start = normalizeTime(availability.start_time);
    if (!end) end = normalizeTime(availability.end_time);
  }
  const vr = validateRange(start, end);
  if (!date || !swimmerId || vr.error) return flashBack(res, 'error', 'اختر اللاعب والتاريخ ووقت الموعد بشكل صحيح', coachId);
  if (availability && Number(availability.weekday) !== weekdayOf(date)) {
    return flashBack(res, 'error', 'يوم التاريخ المختار لا يطابق يوم الموعد الثابت', coachId);
  }
  const sw = await db.prepare('SELECT id FROM swimmers WHERE id = ? AND deleted_at IS NULL').get(swimmerId);
  if (!sw) return flashBack(res, 'error', 'اللاعب المختار غير موجود', coachId);
  const issue = await bookingIssue(coachId, date, vr.from, vr.to);
  if (issue) return flashBack(res, 'error', issue, coachId);

  const pkg = await findActivePackage(swimmerId, coachId, Number(b.package_id) || 0);
  let rate = Number(b.rate) || 0;
  if (!rate && availability) rate = Number(availability.rate) || 0;
  if (!rate) {
    const tr = await db.prepare('SELECT private_rate FROM trainer_rates WHERE coach_id = ?').get(coachId);
    rate = Number((tr && tr.private_rate) || 0);
  }
  const rating = ratingValue(b.rating != null && b.rating !== '' ? b.rating : (availability && availability.rating));
  await db.prepare(`INSERT INTO private_sessions
    (academy_id, sport_id, package_id, swimmer_id, coach_id, availability_id, date, start_time, end_time, status, rate, rating, note, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,'scheduled',?,?,?,?)`)
    .run(Number(req.currentUser.academy_id) || 1, effectiveSport(req), pkg ? pkg.id : null, swimmerId, coachId,
      availabilityId || null, date, vr.from, vr.to, rate, rating, String(b.note || ''), req.currentUser.id);
  if (availability) {
    await db.prepare('UPDATE private_availability SET swimmer_id = ?, rating = ? WHERE id = ?').run(swimmerId, rating, availabilityId);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'privateTraining', coachId, 'حجز حصة تدريب خاص ' + date + ' ' + vr.from, req);
  setFlash(res, { type: 'success', message: 'تم حجز الحصة وتسكين اللاعب في الموعد' });
  res.redirect('/private-training/coach/' + coachId);
});

/* ================================================================
   تسجيل حضور/غياب الحصة
================================================================ */
router.post('/private-training/session/:sid/attendance', async function (req, res) {
  if (!canEdit(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const sid = Number(req.params.sid);
  const status = String(req.body.status || '');
  const coachRedirect = '/private-training/coach/' + (req.body.coach_id || '');
  if (!PRIV_STATUS[status]) { setFlash(res, { type: 'error', message: 'حالة غير صحيحة' }); return res.redirect(coachRedirect); }
  const before = await db.prepare('SELECT * FROM private_sessions WHERE id = ?').get(sid);
  if (!before) { setFlash(res, { type: 'error', message: 'الحصة غير موجودة' }); return res.redirect(coachRedirect); }
  await db.prepare('UPDATE private_sessions SET status=?, attendance_note=?, updated_at=? WHERE id=?')
    .run(status, String(req.body.attendance_note || ''), new Date().toLocaleString('sv-SE').replace('T', ' '), sid);
  const delta = attCounts(status) - attCounts(before.status);
  if (delta !== 0 && before.package_id) {
    await db.prepare('UPDATE private_packages SET sessions_used = MIN(sessions_total, MAX(0, sessions_used + ?)) WHERE id = ?').run(delta, before.package_id);
    await refreshPackage(before.package_id);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'privateTraining', sid, 'تسجيل حضور حصة تدريب خاص: ' + status, req);
  setFlash(res, { type: 'success', message: 'تم تسجيل الحضور' });
  res.redirect(coachRedirect);
});

router.post('/private-training/session/:sid/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'privateTraining')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const sid = Number(req.params.sid);
  const s = await db.prepare('SELECT * FROM private_sessions WHERE id = ?').get(sid);
  if (s) {
    await db.prepare('DELETE FROM private_sessions WHERE id = ?').run(sid);
    if (attCounts(s.status) && s.package_id) {
      await db.prepare('UPDATE private_packages SET sessions_used = MIN(sessions_total, MAX(0, sessions_used - 1)) WHERE id = ?').run(s.package_id);
      await refreshPackage(s.package_id);
    }
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'privateTraining', sid, 'حذف حصة تدريب خاص', req);
  setFlash(res, { type: 'success', message: 'تم حذف الحصة' });
  res.redirect('/private-training/coach/' + (s ? s.coach_id : ''));
});

module.exports = router;
