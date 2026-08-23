/** الجوانب الفنية: التقييمات، الاختبارات، الفرق، البطولات، الأزمنة الشخصية */
const express = require('express');
const { db } = require('../lib/db');
const { audit, money, fmtDate, canView, canAdd, canEdit, canDel } = require('../lib/helpers');
const router = express.Router();

function swimmerOptions() {
  return db.prepare('SELECT id, full_name, membership_no, level_id FROM swimmers ORDER BY full_name').all()
    .map(s => ({ value: s.id, label: s.full_name + ' (' + s.membership_no + ')', level: s.level_id || '' }));
}
function coachOptions() {
  return db.prepare('SELECT * FROM coaches ORDER BY full_name').all().map(c => ({ value: c.id, label: c.full_name }));
}
function programOptions() {
  return db.prepare('SELECT * FROM programs ORDER BY name').all().map(p => ({ value: p.id, label: p.name }));
}
function levelOptions() {
  return db.prepare('SELECT * FROM levels ORDER BY order_no').all().map(l => ({ value: l.id, label: l.name }));
}

function criteriaFor(levelId) {
  return levelId
    ? db.prepare('SELECT * FROM assessment_criteria WHERE level_id = ? ORDER BY order_no').all(levelId)
    : db.prepare('SELECT * FROM assessment_criteria WHERE level_id IS NULL ORDER BY order_no').all();
}

/* المعايير العامة (مشتركة): تظهر مرة واحدة في قسم مستقل وتُضمّن في كل المستويات */
function generalCriteria() {
  return db.prepare('SELECT * FROM assessment_criteria WHERE level_id IS NULL ORDER BY order_no, id').all();
}

/* كل المستويات مع مهاراتها (لنموذج التقييم الشامل) */
function levelGroups(currentLevelId) {
  const levels = levelOptions();
  return levels.map(l => ({
    level: { ...l, current: currentLevelId !== null && currentLevelId !== undefined && String(l.value) === String(currentLevelId) },
    criteria: criteriaFor(l.value)
  }));
}

/* حفظ/تحديث تقييم مستوى معيّن أو المعايير العامة (levelId = null). يحدّث أحدث سجل للمستوى أو يُنشئ جديداً */
function upsertAssessment(swimmerId, levelId, g, b, userId) {
  if (!g || !g.n) return null;
  const row = levelId == null
    ? db.prepare(`SELECT * FROM assessments WHERE swimmer_id = ? AND level_id IS NULL ORDER BY date DESC, id DESC`).get(swimmerId)
    : db.prepare(`SELECT * FROM assessments WHERE swimmer_id = ? AND level_id = ? ORDER BY date DESC, id DESC`).get(swimmerId, levelId);
  const overall = Math.round((g.sum / g.n) * 1000) / 1000;
  if (row) {
    db.prepare(`UPDATE assessments SET coach_id=?, program_id=?, date=?, scores=?, strengths=?, weaknesses=?, recommendations=?, ready_to_advance=?, next_assessment_date=?, overall_percent=?, notes=? WHERE id=?`)
      .run(b.coach_id || null, b.program_id || null, b.date, JSON.stringify(g.scores), b.strengths || '', b.weaknesses || '', b.recommendations || '', b.ready_to_advance === '1' ? 1 : 0, b.next_assessment_date || null, overall, b.notes || '', row.id);
    return row.id;
  }
  const info = db.prepare(`INSERT INTO assessments (swimmer_id, coach_id, program_id, level_id, date, scores, strengths, weaknesses, recommendations, ready_to_advance, next_assessment_date, overall_percent, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(swimmerId, b.coach_id || null, b.program_id || null, levelId, b.date, JSON.stringify(g.scores), b.strengths || '', b.weaknesses || '', b.recommendations || '', b.ready_to_advance === '1' ? 1 : 0, b.next_assessment_date || null, overall, b.notes || '', userId);
  return info.lastInsertRowid;
}

/* قراءة تقييم (scores) من req.body مقسّمة إلى: مستوى محدد + معايير عامة */
function parseScores(b) {
  const critLevel = {};
  db.prepare('SELECT id, level_id FROM assessment_criteria').all().forEach(c => { critLevel[c.id] = c.level_id; });
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

/* ============================================================== */
/*                          التقييمات الفنية                       */
/* ============================================================== */

router.get('/assessments', function (req, res) {
  if (!canView(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = db.prepare(`SELECT 'تقييم' AS kind, a.id AS id, a.date AS date, a.overall_percent AS overall_percent, a.ready_to_advance AS ready_to_advance, a.level_id AS level_id, a.coach_id AS coach_id, a.notes AS notes, a.swimmer_id AS swimmer_id, s.full_name AS swimmer_name, s.membership_no, c.full_name AS coach_name, l.name AS level_name, NULL AS t_type, NULL AS t_race, NULL AS time_seconds, NULL AS test_status, NULL AS distance_m, NULL AS result_note FROM assessments a
    LEFT JOIN swimmers s ON s.id = a.swimmer_id LEFT JOIN coaches c ON c.id = a.coach_id LEFT JOIN levels l ON l.id = a.level_id
    UNION ALL
    SELECT 'اختبار' AS kind, t.id AS id, t.date AS date, NULL AS overall_percent, t.passed AS ready_to_advance, NULL AS level_id, t.coach_id AS coach_id, t.result_note AS notes, t.swimmer_id AS swimmer_id, s.full_name AS swimmer_name, s.membership_no, c.full_name AS coach_name, l.name AS level_name, t.type AS t_type, t.race_type AS t_race, t.time_seconds AS time_seconds, t.status AS test_status, t.distance_m AS distance_m, t.result_note AS result_note FROM tests t
    LEFT JOIN swimmers s ON s.id = t.swimmer_id LEFT JOIN coaches c ON c.id = t.coach_id LEFT JOIN levels l ON l.id = t.level_id
    ORDER BY date DESC`).all();
  const page = {
    title: 'التقييمات الفنية', subtitle: 'تقييم مهارات السباحين ونتائج الاختبارات', icon: 'fa-clipboard-check', module: 'assessments', active: 'assessments',
    columns: [
      { key: 'swimmer_name', label: 'السباح', html: row => `<div class="avatar-cell"><div class="avatar-sm" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)">${(row.swimmer_name || 'س').trim().charAt(0)}</div><div><div class="cell-title">${row.swimmer_name || '—'}</div><div class="cell-sub">${row.membership_no || ''}</div></div></div>` },
      { key: 'kind', label: 'النوع', html: row => row.kind === 'اختبار' ? `<span class="badge badge-warning">اختبار · ${row.t_type || ''}</span>` : `<span class="badge badge-primary">تقييم</span>` },
      { key: 't_race', label: 'نوع السباق', html: row => row.kind === 'اختبار' && row.t_race ? `<span class="badge badge-info">${row.t_race}</span>` : '—' },
      { key: 'date', label: 'التاريخ', html: row => fmtDate(row.date) },
      { key: 'level_name', label: 'المستوى', html: row => row.level_name ? `<span class="badge badge-violet">${row.level_name}</span>` : '<span class="text-soft">—</span>' },
      { key: 'result', label: 'النتيجة', html: row => row.kind === 'اختبار'
        ? `<div><span class="badge ${row.test_status === 'اجتاز' ? 'badge-success' : 'badge-danger'}">${row.test_status || '—'}</span>${row.time_seconds != null ? `<div class="font-12 text-soft">${row.time_seconds}s${row.distance_m ? ' · ' + row.distance_m + 'م' : ''}</div>` : ''}</div>`
        : `<div class="progress-inline"><span class="badge ${row.overall_percent >= 80 ? 'badge-success' : row.overall_percent >= 60 ? 'badge-warning' : 'badge-danger'}">${row.overall_percent || 0}%</span></div>` },
      { key: 'status2', label: 'الترقية', html: row => row.kind === 'اختبار' ? '<span class="badge badge-gray">اختبار</span>' : (row.ready_to_advance ? '<span class="badge badge-success"><i class="fas fa-arrow-up"></i> جاهز</span>' : '<span class="badge badge-gray">قيد التدريب</span>') },
      { key: 'coach_name', label: 'الكابتن' }
    ],
    rows,
    filters: [
      { name: 'level_id', label: 'المستوى', options: levelOptions() },
      { name: 'coach_id', label: 'الكابتن', options: coachOptions() },
      { name: 'ready_to_advance', label: 'الترقية', options: [{ value: '1', label: 'جاهز للترقية' }, { value: '0', label: 'قيد التدريب' }] }
    ],
    canAdd: canAdd(req.currentUser, 'assessments'), addUrl: canAdd(req.currentUser, 'assessments') ? '/assessments/new' : null, addLabel: 'تقييم جديد',
    headerActions: [{ href: '/tests/new', label: 'اختبار (فردي/جماعي)', icon: 'fa-vial-circle-check', cls: 'btn-outline' }],
    actions: () => row => row.kind === 'اختبار' ? [
      { label: 'تعديل', icon: 'fa-pen', href: '/tests/' + row.id + '/edit' },
      { label: 'السباح', icon: 'fa-person-swimming', href: '/swimmers/' + row.swimmer_id },
      { label: 'حذف', icon: 'fa-trash', href: '/tests/' + row.id + '/delete', confirm: 'حذف الاختبار؟', cls: 'text-danger' }
    ] : [
      { label: 'عرض', icon: 'fa-eye', href: '/assessments/' + row.id },
      { label: 'السباح', icon: 'fa-person-swimming', href: '/swimmers/' + row.swimmer_id },
      { label: 'تعديل', icon: 'fa-pen', href: '/assessments/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/assessments/' + row.id + '/delete', confirm: 'حذف التقييم؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});

/* معايير المستوى (للتحديث الديناميكي في النموذج) */
router.get('/api/assessments/criteria', function (req, res) {
  res.json(criteriaFor(req.query.level_id ? Number(req.query.level_id) : null));
});

router.get('/assessments/new', function (req, res) {
  if (!canAdd(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const values = {};
  let currentLevelId = null;
  if (req.query.swimmer) {
    const sw = db.prepare('SELECT id, level_id FROM swimmers WHERE id=?').get(Number(req.query.swimmer));
    if (sw) { values.swimmer_id = sw.id; currentLevelId = sw.level_id; }
  }
  res.render('assessment_form', {
    title: 'تقييم فني جديد', active: 'assessments', isEdit: false,
    action: '/assessments/new', values, levelGroups: levelGroups(currentLevelId), generalCriteria: generalCriteria(),
    swimmers: swimmerOptions(), coaches: coachOptions(), programs: programOptions()
  });
});
router.post('/assessments/new', function (req, res) {
  if (!canAdd(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const { perLevel, shared } = parseScores(b);
  let firstId = null;
  Object.keys(perLevel).forEach(lid => {
    const g = perLevel[lid];
    const overall = g.n ? Math.round((g.sum / g.n) * 1000) / 1000 : 0;
    const info = db.prepare(`INSERT INTO assessments (swimmer_id, coach_id, program_id, level_id, date, scores, strengths, weaknesses, recommendations, ready_to_advance, next_assessment_date, overall_percent, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(b.swimmer_id, b.coach_id || null, b.program_id || null, Number(lid), b.date || new Date().toISOString().slice(0, 10), JSON.stringify(g.scores), b.strengths || '', b.weaknesses || '', b.recommendations || '', b.ready_to_advance === '1' ? 1 : 0, b.next_assessment_date || null, overall, b.notes || '', req.currentUser.id);
    if (firstId === null) firstId = info.lastInsertRowid;
  });
  /* المعايير العامة تُحفظ في سجل واحد (مستوى NULL) وتُضمَّن تلقائياً في كل المستويات داخل التقرير */
  upsertAssessment(b.swimmer_id, null, shared, b, req.currentUser.id);
  const levelCount = Object.keys(perLevel).length;
  if (levelCount) {
    audit(req.currentUser.id, req.currentUser.full_name, 'add', 'assessments', firstId, 'تقييم على ' + levelCount + ' مستوى', req);
    req.session.flash = { type: 'success', message: 'تم حفظ تقييمات ' + levelCount + ' مستوى بنجاح' };
  } else if (shared.n) {
    req.session.flash = { type: 'success', message: 'تم حفظ المعايير العامة' };
  } else {
    req.session.flash = { type: 'error', message: 'لم تُسجل أي نسب — تأكد من تقييم مهارة واحدة على الأقل' };
  }
  res.redirect('/swimmers/' + b.swimmer_id);
});

router.get('/assessments/:id', function (req, res) {
  if (!canView(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const a = db.prepare(`SELECT a.*, s.full_name AS swimmer_name, s.membership_no, s.birth_date, c.full_name AS coach_name, l.name AS level_name, p.name AS program_name FROM assessments a
    LEFT JOIN swimmers s ON s.id = a.swimmer_id LEFT JOIN coaches c ON c.id = a.coach_id LEFT JOIN levels l ON l.id = a.level_id LEFT JOIN programs p ON p.id = a.program_id WHERE a.id = ?`).get(id);
  if (!a) return res.redirect('/assessments');
  let scores = {};
  try { scores = JSON.parse(a.scores || '{}'); } catch (e) { scores = {}; }
  const criteriaMap = {};
  db.prepare('SELECT * FROM assessment_criteria').all().forEach(c => { criteriaMap[c.id] = c; });
  let levelTotal = 0, levelCount = 0;
  Object.keys(scores).forEach(k => {
    if (criteriaMap[Number(k)]) { levelTotal += Number(scores[k]) || 0; levelCount++; }
  });
  const levelPercent = levelCount ? Math.round((levelTotal / levelCount) * 1000) / 1000 : 0;
  res.render('assessment_detail', { title: 'تفاصيل التقييم', active: 'assessments', a, scores, criteriaMap, levelTotal, levelCount, levelPercent, money,
    canEdit: canEdit(req.currentUser, 'assessments'), canDel: canDel(req.currentUser, 'assessments') });
});

/* ترقية السباح لمستوى أعلى من التقييم (خطوة واحدة فقط لمنع تخطي المستويات) */
router.post('/assessments/:id/advance', function (req, res) {
  if (!canEdit(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const a = db.prepare('SELECT * FROM assessments WHERE id=?').get(id);
  if (!a) return res.redirect('/assessments');
  if (!a.ready_to_advance) {
    req.session.flash = { type: 'error', message: 'لا يمكن الترقية: هذا التقييم غير مُعلَّم بأنه جاهز للانتقال' };
    return res.redirect('/assessments/' + id);
  }
  const sw = db.prepare('SELECT id, level_id FROM swimmers WHERE id=?').get(a.swimmer_id);
  if (sw && sw.level_id && sw.level_id !== a.level_id) {
    req.session.flash = { type: 'error', message: 'لا يمكن الترقية: مستوى التقييم لا يطابق المستوى الحالي للسباح — منعاً لتخطي المستويات' };
    return res.redirect('/assessments/' + id);
  }
  const level = db.prepare('SELECT * FROM levels ORDER BY order_no').all();
  const curIdx = level.findIndex(l => l.id === a.level_id);
  const nextLvl = curIdx >= 0 ? level[curIdx + 1] : null;
  if (nextLvl) db.prepare('UPDATE swimmers SET level_id=? WHERE id=?').run(nextLvl.id, a.swimmer_id);
  db.prepare('INSERT INTO level_progress (swimmer_id, from_level_id, to_level_id, date, assessment_id, reason) VALUES (?,?,?,?,?,?)')
    .run(a.swimmer_id, a.level_id, nextLvl ? nextLvl.id : null, new Date().toISOString().slice(0, 10), id, 'اجتياز التقييم الفني');
  db.prepare("UPDATE assessments SET ready_to_advance=0 WHERE id=?").run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'assessments', id, 'ترقية السباح إلى ' + (nextLvl ? nextLvl.name : 'مستوى أعلى'), req);
  req.session.flash = { type: 'success', message: 'تم ترقية السباح إلى ' + (nextLvl ? nextLvl.name : 'مستوى أعلى') };
  res.redirect('/assessments/' + id);
});

router.get('/assessments/:id/edit', function (req, res) {
  if (!canEdit(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = db.prepare('SELECT * FROM assessments WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/assessments');
  let saved = {};
  try { saved = JSON.parse(row.scores || '{}'); } catch (e) { saved = {}; }
  const values = { ...row };
  Object.keys(saved).forEach(k => { values['score_' + k] = saved[k]; });
  /* تعبئة أحدث تقييم لكل مستوى آخر + المعايير العامة للسباح (تعديل شامل لكل المستويات) */
  const seen = {};
  db.prepare('SELECT * FROM assessments WHERE swimmer_id=? AND level_id IS NOT NULL ORDER BY date DESC, id DESC').all(row.swimmer_id)
    .forEach(a => { if (!seen[a.level_id]) { seen[a.level_id] = a; } });
  Object.keys(seen).forEach(lid => {
    if (String(lid) === String(row.level_id)) return;
    let sc = {};
    try { sc = JSON.parse(seen[lid].scores || '{}'); } catch (e) { sc = {}; }
    Object.keys(sc).forEach(k => { values['score_' + k] = sc[k]; });
  });
  const genRow = db.prepare(`SELECT * FROM assessments WHERE swimmer_id=? AND level_id IS NULL ORDER BY date DESC, id DESC`).get(row.swimmer_id);
  if (genRow) {
    let g = {};
    try { g = JSON.parse(genRow.scores || '{}'); } catch (e) { g = {}; }
    Object.keys(g).forEach(k => { values['score_' + k] = g[k]; });
  }
  res.render('assessment_form', {
    title: 'تعديل التقييم', active: 'assessments', isEdit: true,
    action: '/assessments/' + row.id + '/edit', values, levelGroups: levelGroups(row.level_id != null ? row.level_id : null), generalCriteria: generalCriteria(),
    swimmers: swimmerOptions(), coaches: coachOptions(), programs: programOptions()
  });
});
router.post('/assessments/:id/edit', function (req, res) {
  if (!canEdit(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  const row = db.prepare('SELECT * FROM assessments WHERE id=?').get(id);
  if (!row) return res.redirect('/assessments');
  const { perLevel, shared } = parseScores(b);
  const primaryIsGeneral = row.level_id == null;
  const primaryG = primaryIsGeneral
    ? shared
    : (perLevel[row.level_id] || { scores: {}, n: 0, sum: 0 });
  const overall = primaryG.n ? Math.round((primaryG.sum / primaryG.n) * 1000) / 1000 : 0;
  db.prepare(`UPDATE assessments SET swimmer_id=?, coach_id=?, program_id=?, level_id=?, date=?, scores=?, strengths=?, weaknesses=?, recommendations=?, ready_to_advance=?, next_assessment_date=?, overall_percent=?, notes=? WHERE id=?`)
    .run(b.swimmer_id, b.coach_id || null, b.program_id || null, primaryIsGeneral ? null : row.level_id, b.date, JSON.stringify(primaryG.scores), b.strengths || '', b.weaknesses || '', b.recommendations || '', b.ready_to_advance === '1' ? 1 : 0, b.next_assessment_date || null, overall, b.notes || '', id);
  if (!primaryIsGeneral) {
    delete perLevel[row.level_id];
    Object.keys(perLevel).forEach(lid => upsertAssessment(b.swimmer_id, Number(lid), perLevel[lid], b, req.currentUser.id));
    upsertAssessment(b.swimmer_id, null, shared, b, req.currentUser.id);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'assessments', id, 'تعديل تقييم شامل', req);
  req.session.flash = { type: 'success', message: 'تم حفظ التعديلات على جميع المستويات' };
  res.redirect('/assessments/' + id);
});
router.post('/assessments/:id/delete', function (req, res) {
  if (!canDel(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  db.prepare('DELETE FROM assessments WHERE id=?').run(Number(req.params.id));
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'assessments', Number(req.params.id), 'حذف تقييم', req);
  req.session.flash = { type: 'success', message: 'تم حذف التقييم' };
  res.redirect('/assessments');
});

/* ============================================================== */
/*                          الاختبارات                            */
/* ============================================================== */
const TEST_TYPES_DEFAULT = ['مستوى', 'زمن', 'بطولة', 'عام'];
function testTypes() {
  const v = (db.prepare("SELECT value FROM settings WHERE key = 'test_types'").get() || {}).value;
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) && a.length ? a : TEST_TYPES_DEFAULT; } catch (e) { return TEST_TYPES_DEFAULT; }
}
const testFields = function (values) {
  return [
    { key: 'swimmer_id', label: 'السباح', type: 'select', options: swimmerOptions(), required: true, section: 'بيانات الاختبار', sectionIcon: 'fa-vial-circle-check' },
    { key: 'type', label: 'نوع الاختبار', type: 'select', options: testTypes().map(v => ({ value: v, label: v })) },
    { key: 'race_type', label: 'نوع السباق (اكتبه يدوياً)', type: 'text', placeholder: 'مثال: حرة — ظهر — صدر — فراشة' },
    { key: 'level_id', label: 'المستوى (يظهر مع نوع "مستوى" فقط)', type: 'select', options: levelOptions() },
    { key: 'date', label: 'تاريخ الاختبار', type: 'date' },
    { key: 'distance_m', label: 'المسافة (متر)', type: 'number', number: true },
    { key: 'time_seconds', label: 'الزمن (ثانية)', type: 'number', number: true, step: '0.01' },
    { key: 'position', label: 'المركز', type: 'number', number: true },
    { key: 'passed', label: 'النتيجة', type: 'checkbox', checkLabel: 'اجتاز الاختبار' },
    { key: 'status', label: 'الحالة', type: 'select', options: [{ value: 'اجتاز', label: 'اجتاز' }, { value: 'لم يجتز', label: 'لم يجتز' }] },
    { key: 'result_note', label: 'ملاحظة النتيجة', type: 'textarea', full: true }
  ];
};

/* مجموعات التدريب مع السباحين (لنموذج الاختبار الجماعي) */
function testGroupsWithSwimmers() {
  return db.prepare('SELECT g.id, g.name, g.coach_id FROM groups g ORDER BY g.name').all()
    .map(function (g) {
      return { id: g.id, name: g.name, coach_id: g.coach_id, swimmers: groupSwimmers(g.id) };
    });
}
function groupSwimmers(gid) {
  return db.prepare(`SELECT s.id, s.full_name, s.membership_no, l.name AS level_name FROM swimmer_group sg
    JOIN swimmers s ON s.id = sg.swimmer_id LEFT JOIN levels l ON l.id = s.level_id WHERE sg.group_id = ? ORDER BY s.full_name`).all(gid);
}

/* حفظ نتيجة اختبار لسباح واحد (سجل مستقل في الاختبارات) + ترقية عند اجتياز اختبار المستوى */
function saveTestResult(o) {
  const passed = o.passed === '1' || o.passed === 1 || o.passed === true;
  const status = o.status || (passed ? 'اجتاز' : 'لم يجتز');
  const info = db.prepare(`INSERT INTO tests (swimmer_id, coach_id, type, race_type, level_id, date, distance_m, time_seconds, position, passed, result_note, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(o.swimmerId, o.coachId || null, o.type || 'مستوى', o.race || '', o.level || null, o.date || new Date().toISOString().slice(0, 10), Number(o.distance || 0), o.time !== '' && o.time != null && !isNaN(o.time) ? Number(o.time) : null, o.position !== '' && o.position != null && !isNaN(o.position) ? Number(o.position) : null, passed ? 1 : 0, o.note || '', status);
  if (passed && (o.type || 'مستوى') === 'مستوى') {
    const swimmer = db.prepare('SELECT level_id FROM swimmers WHERE id=?').get(o.swimmerId);
    const levels = db.prepare('SELECT * FROM levels ORDER BY order_no').all();
    const idx = levels.findIndex(l => l.id === (swimmer ? swimmer.level_id : null));
    const nextLvl = idx >= 0 ? levels[idx + 1] : null;
    if (nextLvl) {
      db.prepare('INSERT INTO level_progress (swimmer_id, from_level_id, to_level_id, date, reason) VALUES (?,?,?,?,?)').run(o.swimmerId, swimmer.level_id, nextLvl.id, new Date().toISOString().slice(0, 10), 'اجتياز اختبار المستوى');
      db.prepare('UPDATE swimmers SET level_id=? WHERE id=?').run(nextLvl.id, o.swimmerId);
    }
  }
  return info.lastInsertRowid;
}

router.get('/tests', function (req, res) {
  if (!canView(req.currentUser, 'tests')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = db.prepare(`SELECT t.*, l.name AS level_name, s.full_name AS swimmer_name, s.membership_no, c.full_name AS coach_name FROM tests t
    LEFT JOIN swimmers s ON s.id = t.swimmer_id LEFT JOIN coaches c ON c.id = t.coach_id LEFT JOIN levels l ON l.id = t.level_id ORDER BY t.date DESC`).all();
  const page = {
    title: 'الاختبارات', subtitle: 'اختبارات المستويات والأزمنة', icon: 'fa-vial-circle-check', module: 'tests', active: 'tests',
    columns: [
      { key: 'swimmer_name', label: 'السباح', html: row => `<div class="avatar-cell"><div class="avatar-sm" style="background:linear-gradient(135deg,#06b6d4,#0ea5e9)">${(row.swimmer_name || 'س').trim().charAt(0)}</div><div><div class="cell-title">${row.swimmer_name || '—'}</div><div class="cell-sub">${row.membership_no || ''}</div></div></div>` },
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
      { name: 'type', label: 'النوع', options: testTypes().map(v => ({ value: v, label: v })) },
      { name: 'level_id', label: 'المستوى', options: levelOptions() },
      { name: 'coach_id', label: 'الكابتن', options: coachOptions() },
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

router.get('/tests/new', function (req, res) {
  if (!canAdd(req.currentUser, 'tests')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('test_group_form', {
    form: { title: 'اختبار جديد', subtitle: 'تسجيل اختبار لسباح واحد أو لكل سباح في مجموعة', icon: 'fa-plus', active: 'tests', action: '/tests/new', fields: testFields({}), values: {}, submitLabel: 'حفظ الاختبار', cancelUrl: '/tests', csrf: '' },
    groups: testGroupsWithSwimmers(), testTypes: testTypes(), levelOptions: levelOptions(), swimmerOptions: swimmerOptions()
  });
});
router.post('/tests/new', function (req, res) {
  if (!canAdd(req.currentUser, 'tests')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const date = b.date || b.t_date || new Date().toISOString().slice(0, 10);
  let saved = 0;
  const levelsOf = v => v === undefined || v === null ? [] : (Array.isArray(v) ? v : [v]);
  if (b.group_id) {
    const grp = db.prepare('SELECT coach_id FROM groups WHERE id=?').get(Number(b.group_id));
    const coachId = (grp && grp.coach_id) || req.currentUser.coach_id || null;
    const rowsArr = Array.isArray(b.rows) ? b.rows : (b.rows ? [b.rows] : []);
    rowsArr.forEach(function (r) {
      if (!r || !r.swimmer_id) return;
      const levels = levelsOf(r.t_level);
      const base = { swimmerId: r.swimmer_id, coachId, type: r.t_type || 'مستوى', race: r.t_race, date, distance: r.t_distance, time: r.t_time, position: r.t_position, passed: r.t_passed, note: r.t_note, userId: req.currentUser.id };
      if (base.type === 'مستوى' && levels.length) {
        levels.forEach(function (lv) { saveTestResult(Object.assign({}, base, { level: lv })); saved++; });
      } else {
        saveTestResult(Object.assign({}, base, { level: levels[0] || null }));
        saved++;
      }
    });
    if (!saved) {
      req.session.flash = { type: 'error', message: 'لم تُسجل أي نتائج — أضف اختباراً لواحد من السباحين أولاً' };
      return res.redirect('/tests/new');
    }
  } else {
    const levels = levelsOf(b.level_id);
    const base = { swimmerId: b.swimmer_id, coachId: req.currentUser.coach_id || null, type: b.type || 'مستوى', race: b.race_type, date, distance: b.distance_m, time: b.time_seconds, position: b.position, passed: b.passed, note: b.result_note, status: b.status, userId: req.currentUser.id };
    if (base.type === 'مستوى' && levels.length) {
      levels.forEach(function (lv) { saveTestResult(Object.assign({}, base, { level: lv })); saved++; });
    } else {
      saveTestResult(Object.assign({}, base, { level: levels[0] || null }));
      saved = 1;
    }
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'tests', 0, 'اختبار جديد (' + saved + ' نتيجة)', req);
  req.session.flash = { type: 'success', message: 'تم حفظ ' + saved + ' نتيجة اختبار — تظهر في الاختبارات والتقييمات الفنية' };
  res.redirect('/tests');
});
router.get('/tests/:id/edit', function (req, res) {
  if (!canEdit(req.currentUser, 'tests')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = db.prepare('SELECT * FROM tests WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/tests');
  res.render('form', { form: { title: 'تعديل الاختبار', subtitle: 'تحديث نتيجة الاختبار', icon: 'fa-pen', active: 'tests', action: '/tests/' + row.id + '/edit', fields: testFields(row), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/tests', csrf: '' } });
});
router.post('/tests/:id/edit', function (req, res) {
  if (!canEdit(req.currentUser, 'tests')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  db.prepare(`UPDATE tests SET swimmer_id=?, type=?, race_type=?, level_id=?, date=?, distance_m=?, time_seconds=?, position=?, passed=?, result_note=?, status=? WHERE id=?`)
    .run(b.swimmer_id, b.type || 'مستوى', b.race_type || '', b.level_id || null, b.date, Number(b.distance_m || 0), b.time_seconds !== '' ? Number(b.time_seconds) : null, b.position !== '' ? Number(b.position) : null, b.passed === '1' ? 1 : 0, b.result_note || '', b.status || 'اجتاز', id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'tests', id, 'تعديل اختبار', req);
  req.session.flash = { type: 'success', message: 'تم حفظ التعديلات' };
  res.redirect('/tests');
});
router.post('/tests/:id/delete', function (req, res) {
  if (!canDel(req.currentUser, 'tests')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  db.prepare('DELETE FROM tests WHERE id=?').run(Number(req.params.id));
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'tests', Number(req.params.id), 'حذف اختبار', req);
  req.session.flash = { type: 'success', message: 'تم حذف الاختبار' };
  res.redirect('/tests');
});

/* ============================================================== */
/*                        الأزمنة الشخصية                         */
/* ============================================================== */
router.get('/measurements', function (req, res) {
  if (!canView(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = db.prepare(`SELECT pm.*, s.full_name AS swimmer_name, s.membership_no FROM player_measurements pm LEFT JOIN swimmers s ON s.id = pm.swimmer_id ORDER BY pm.date DESC LIMIT 200`).all();
  const page = {
    title: 'الأزمنة الشخصية', subtitle: 'سجل أزمنة السباحين الشخصية (PB)', icon: 'fa-stopwatch', module: 'teams', active: 'teams',
    columns: [
      { key: 'swimmer_name', label: 'السباح', html: row => `<div class="avatar-cell"><div class="avatar-sm">${(row.swimmer_name || 'س').trim().charAt(0)}</div><div><div class="cell-title">${row.swimmer_name || '—'}</div><div class="cell-sub">${row.membership_no || ''}</div></div></div>` },
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
router.get('/measurements/new', function (req, res) {
  if (!canAdd(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'زمن شخصي جديد', subtitle: 'تسجيل أفضل زمن للسباح', icon: 'fa-plus', active: 'teams', action: '/measurements/new',
    fields: [
      { key: 'swimmer_id', label: 'السباح', type: 'select', options: swimmerOptions(), required: true },
      { key: 'race_type', label: 'السباحة', type: 'select', options: ['حرة', 'ظهر', 'صدر', 'فراشة', 'متنوع'].map(v => ({ value: v, label: v })) },
      { key: 'distance_m', label: 'المسافة (متر)', type: 'number', number: true },
      { key: 'time_seconds', label: 'الزمن (ثانية)', type: 'number', number: true, step: '0.01', required: true },
      { key: 'date', label: 'التاريخ', type: 'date' },
      { key: 'note', label: 'ملاحظة', type: 'textarea', full: true }
    ], values: {}, submitLabel: 'حفظ الزمن', cancelUrl: '/measurements', csrf: '' } });
});
router.post('/measurements/new', function (req, res) {
  if (!canAdd(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const info = db.prepare('INSERT INTO player_measurements (swimmer_id, race_type, distance_m, time_seconds, date, note) VALUES (?,?,?,?,?,?)')
    .run(b.swimmer_id, b.race_type || 'حرة', Number(b.distance_m || 50), Number(b.time_seconds), b.date || new Date().toISOString().slice(0, 10), b.note || '');
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'player_measurements', info.lastInsertRowid, 'زمن شخصي جديد', req);
  req.session.flash = { type: 'success', message: 'تم حفظ الزمن' };
  res.redirect('/measurements');
});
router.post('/measurements/:id/delete', function (req, res) {
  if (!canDel(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  db.prepare('DELETE FROM player_measurements WHERE id=?').run(Number(req.params.id));
  res.redirect('/measurements');
});

/* ============================================================== */
/*                           فرق السباحة                          */
/* ============================================================== */
const teamFields = function (values) {
  return [
    { key: 'name', label: 'اسم الفريق', type: 'text', required: true, section: 'بيانات الفريق', sectionIcon: 'fa-flag-checkered' },
    { key: 'age_group', label: 'الفئة العمرية', type: 'text', hint: 'مثال: تحت 12 سنة' },
    { key: 'coach_id', label: 'المدرب المسؤول', type: 'select', options: coachOptions() },
    { key: 'branch_id', label: 'الفرع', type: 'select', options: db.prepare('SELECT * FROM branches').all().map(b => ({ value: b.id, label: b.name })) },
    { key: 'description', label: 'الوصف', type: 'textarea', full: true },
    { key: 'training_plan', label: 'الخطة التدريبية', type: 'textarea', full: true }
  ];
};

router.get('/teams', function (req, res) {
  if (!canView(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = db.prepare(`SELECT t.*, c.full_name AS coach_name, (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS members FROM teams t LEFT JOIN coaches c ON c.id = t.coach_id ORDER BY t.id`).all();
  const page = {
    title: 'فرق السباحة', subtitle: 'فرق الناشئين والبطولات', icon: 'fa-flag-checkered', module: 'teams', active: 'teams',
    columns: [
      { key: 'name', label: 'الفريق', html: row => `<div class="avatar-cell"><div class="avatar-sm" style="background:linear-gradient(135deg,#f59e0b,#ef4444)">${(row.name || 'ف').trim().charAt(0)}</div><div><div class="cell-title">${row.name}</div><div class="cell-sub">${row.age_group || ''}</div></div></div>` },
      { key: 'members', label: 'الأعضاء', html: row => `<span class="badge badge-info">${row.members} لاعب</span>` },
      { key: 'coach_name', label: 'المدرب' },
      { key: 'training_plan', label: 'الخطة التدريبية', html: row => row.training_plan ? (row.training_plan.length > 40 ? row.training_plan.slice(0, 40) + '…' : row.training_plan) : '—' }
    ],
    rows,
    filters: [{ name: 'coach_id', label: 'المدرب', options: coachOptions() }],
    canAdd: canAdd(req.currentUser, 'teams'), addUrl: canAdd(req.currentUser, 'teams') ? '/teams/new' : null, addLabel: 'فريق جديد',
    actions: () => row => [
      { label: 'الأعضاء', icon: 'fa-users', href: '/teams/' + row.id },
      { label: 'تعديل', icon: 'fa-pen', href: '/teams/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/teams/' + row.id + '/delete', confirm: 'حذف الفريق؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});

router.get('/teams/new', function (req, res) {
  if (!canAdd(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'فريق جديد', subtitle: 'إنشاء فريق سباحة', icon: 'fa-plus', active: 'teams', action: '/teams/new', fields: teamFields({}), values: {}, submitLabel: 'إنشاء الفريق', cancelUrl: '/teams', csrf: '' } });
});
router.post('/teams/new', function (req, res) {
  if (!canAdd(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const info = db.prepare('INSERT INTO teams (name, age_group, coach_id, branch_id, description, training_plan) VALUES (?,?,?,?,?,?)')
    .run(b.name, b.age_group || '', b.coach_id || null, b.branch_id || null, b.description || '', b.training_plan || '');
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'teams', info.lastInsertRowid, 'فريق جديد: ' + b.name, req);
  req.session.flash = { type: 'success', message: 'تم إنشاء الفريق' };
  res.redirect('/teams/' + info.lastInsertRowid);
});

/* تفاصيل الفريق + إدارة الأعضاء */
router.get('/teams/:id', function (req, res) {
  if (!canView(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const t = db.prepare(`SELECT t.*, c.full_name AS coach_name, b.name AS branch_name FROM teams t LEFT JOIN coaches c ON c.id = t.coach_id LEFT JOIN branches b ON b.id = t.branch_id WHERE t.id = ?`).get(id);
  if (!t) return res.redirect('/teams');
  const members = db.prepare(`SELECT tm.*, s.full_name, s.membership_no, s.birth_date FROM team_members tm JOIN swimmers s ON s.id = tm.swimmer_id WHERE tm.team_id = ? ORDER BY s.full_name`).all(id);
  const swimmers = db.prepare(`SELECT id, full_name, membership_no FROM swimmers WHERE id NOT IN (SELECT swimmer_id FROM team_members WHERE team_id = ?) ORDER BY full_name`).all(id)
    .map(s => ({ value: s.id, label: s.full_name + ' (' + s.membership_no + ')' }));
  res.render('team_detail', { title: 'تفاصيل الفريق', active: 'teams', t, members, swimmers, money,
    canEdit: canEdit(req.currentUser, 'teams'), canDel: canDel(req.currentUser, 'teams') });
});
router.get('/teams/:id/edit', function (req, res) {
  if (!canEdit(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = db.prepare('SELECT * FROM teams WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/teams');
  res.render('form', { form: { title: 'تعديل الفريق', subtitle: row.name, icon: 'fa-pen', active: 'teams', action: '/teams/' + row.id + '/edit', fields: teamFields(row), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/teams/' + row.id, csrf: '' } });
});
router.post('/teams/:id/edit', function (req, res) {
  if (!canEdit(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  db.prepare('UPDATE teams SET name=?, age_group=?, coach_id=?, branch_id=?, description=?, training_plan=? WHERE id=?')
    .run(b.name, b.age_group || '', b.coach_id || null, b.branch_id || null, b.description || '', b.training_plan || '', id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'teams', id, 'تعديل فريق', req);
  req.session.flash = { type: 'success', message: 'تم حفظ التعديلات' };
  res.redirect('/teams/' + id);
});
router.post('/teams/:id/delete', function (req, res) {
  if (!canDel(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  db.prepare('DELETE FROM team_members WHERE team_id=?').run(id);
  db.prepare('DELETE FROM teams WHERE id=?').run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'teams', id, 'حذف فريق', req);
  res.redirect('/teams');
});
/* إضافة عضو إلى الفريق */
router.post('/teams/:id/members', function (req, res) {
  if (!canEdit(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  if (b.swimmer_id) {
    const exists = db.prepare('SELECT id FROM team_members WHERE team_id=? AND swimmer_id=?').get(id, b.swimmer_id);
    if (!exists) {
      db.prepare('INSERT INTO team_members (team_id, swimmer_id, joined_date, role) VALUES (?,?,?,?)').run(id, b.swimmer_id, new Date().toISOString().slice(0, 10), b.role || 'لاعب');
      audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'teams', id, 'إضافة عضو للفريق', req);
    }
  }
  res.redirect('/teams/' + id);
});
router.post('/teams/:id/members/:mid/delete', function (req, res) {
  if (!canEdit(req.currentUser, 'teams')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  db.prepare('DELETE FROM team_members WHERE id=?').run(Number(req.params.mid));
  res.redirect('/teams/' + Number(req.params.id));
});

/* ============================================================== */
/*                           البطولات                             */
/* ============================================================== */
const COMP_TYPES = ['محلية', 'إقليمية', 'وطنية', 'دولية', 'صيفية', 'أخرى'];
const compFields = function (values) {
  return [
    { key: 'name', label: 'اسم البطولة', type: 'text', required: true, section: 'بيانات البطولة', sectionIcon: 'fa-trophy' },
    { key: 'type', label: 'النوع', type: 'select', options: COMP_TYPES.map(v => ({ value: v, label: v })) },
    { key: 'status', label: 'الحالة', type: 'select', options: [{ value: 'قادمة', label: 'قادمة' }, { value: 'جارية', label: 'جارية' }, { value: 'منتهية', label: 'منتهية' }] },
    { key: 'date', label: 'تاريخ البطولة', type: 'date' },
    { key: 'end_date', label: 'تاريخ النهاية', type: 'date' },
    { key: 'place', label: 'المكان', type: 'text' },
    { key: 'branch_id', label: 'الفرع', type: 'select', options: db.prepare('SELECT * FROM branches').all().map(b => ({ value: b.id, label: b.name })) },
    { key: 'note', label: 'ملاحظات', type: 'textarea', full: true }
  ];
};

router.get('/competitions', function (req, res) {
  if (!canView(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = db.prepare(`SELECT c.*, b.name AS branch_name, (SELECT COUNT(*) FROM competition_results cr WHERE cr.competition_id = c.id) AS results FROM competitions c LEFT JOIN branches b ON b.id = c.branch_id ORDER BY c.date DESC`).all();
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

router.get('/competitions/new', function (req, res) {
  if (!canAdd(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'بطولة جديدة', subtitle: 'تسجيل بطولة أو مسابقة', icon: 'fa-plus', active: 'competitions', action: '/competitions/new', fields: compFields({}), values: {}, submitLabel: 'إنشاء البطولة', cancelUrl: '/competitions', csrf: '' } });
});
router.post('/competitions/new', function (req, res) {
  if (!canAdd(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const info = db.prepare('INSERT INTO competitions (name, type, date, end_date, place, branch_id, status, note) VALUES (?,?,?,?,?,?,?,?)')
    .run(b.name, b.type || 'محلية', b.date || null, b.end_date || null, b.place || '', b.branch_id || null, b.status || 'قادمة', b.note || '');
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'competitions', info.lastInsertRowid, 'بطولة جديدة: ' + b.name, req);
  req.session.flash = { type: 'success', message: 'تم إنشاء البطولة' };
  res.redirect('/competitions/' + info.lastInsertRowid);
});

/* تفاصيل البطولة + النتائج */
router.get('/competitions/:id', function (req, res) {
  if (!canView(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const c = db.prepare(`SELECT c.*, b.name AS branch_name FROM competitions c LEFT JOIN branches b ON b.id = c.branch_id WHERE c.id = ?`).get(id);
  if (!c) return res.redirect('/competitions');
  const results = db.prepare(`SELECT cr.*, s.full_name, s.membership_no FROM competition_results cr LEFT JOIN swimmers s ON s.id = cr.swimmer_id WHERE cr.competition_id = ? ORDER BY cr.distance_m, cr.time_seconds`).all(id);
  const teamIds = db.prepare('SELECT DISTINCT team_id FROM team_members').all().map(t => t.team_id);
  const swimmers = db.prepare('SELECT id, full_name, membership_no FROM swimmers ORDER BY full_name').all().map(s => ({ value: s.id, label: s.full_name + ' (' + s.membership_no + ')' }));
  res.render('competition_detail', { title: 'تفاصيل البطولة', active: 'competitions', c, results, swimmers, money,
    canEdit: canEdit(req.currentUser, 'competitions'), canDel: canDel(req.currentUser, 'competitions') });
});
router.get('/competitions/:id/edit', function (req, res) {
  if (!canEdit(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = db.prepare('SELECT * FROM competitions WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/competitions');
  res.render('form', { form: { title: 'تعديل البطولة', subtitle: row.name, icon: 'fa-pen', active: 'competitions', action: '/competitions/' + row.id + '/edit', fields: compFields(row), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/competitions/' + row.id, csrf: '' } });
});
router.post('/competitions/:id/edit', function (req, res) {
  if (!canEdit(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  db.prepare('UPDATE competitions SET name=?, type=?, date=?, end_date=?, place=?, branch_id=?, status=?, note=? WHERE id=?')
    .run(b.name, b.type || 'محلية', b.date || null, b.end_date || null, b.place || '', b.branch_id || null, b.status || 'قادمة', b.note || '', id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'competitions', id, 'تعديل بطولة', req);
  res.redirect('/competitions/' + id);
});
router.post('/competitions/:id/delete', function (req, res) {
  if (!canDel(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  db.prepare('DELETE FROM competition_results WHERE competition_id=?').run(id);
  db.prepare('DELETE FROM competitions WHERE id=?').run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'competitions', id, 'حذف بطولة', req);
  res.redirect('/competitions');
});
/* إضافة نتيجة */
router.post('/competitions/:id/results', function (req, res) {
  if (!canEdit(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  if (b.swimmer_id) {
    db.prepare('INSERT INTO competition_results (competition_id, swimmer_id, race_type, distance_m, time_seconds, previous_time_seconds, position, qualified, pb, note) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, b.swimmer_id, b.race_type || 'حرة', Number(b.distance_m || 50), b.time_seconds !== '' ? Number(b.time_seconds) : null, b.previous_time_seconds !== '' ? Number(b.previous_time_seconds) : null, b.position !== '' ? Number(b.position) : null, b.qualified === '1' ? 1 : 0, b.pb === '1' ? 1 : 0, b.note || '');
    if (b.pb === '1') {
      db.prepare('INSERT INTO player_measurements (swimmer_id, race_type, distance_m, time_seconds, date, note) VALUES (?,?,?,?,?,?)')
        .run(b.swimmer_id, b.race_type || 'حرة', Number(b.distance_m || 50), Number(b.time_seconds), new Date().toISOString().slice(0, 10), 'أفضل زمن في ' + b.race_type);
    }
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'competitions', id, 'إضافة نتيجة', req);
  }
  res.redirect('/competitions/' + id);
});
router.post('/competitions/:id/results/:rid/delete', function (req, res) {
  if (!canEdit(req.currentUser, 'competitions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  db.prepare('DELETE FROM competition_results WHERE id=?').run(Number(req.params.rid));
  res.redirect('/competitions/' + Number(req.params.id));
});

module.exports = router;
