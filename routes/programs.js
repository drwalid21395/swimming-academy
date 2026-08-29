/** البرامج والدورات + المستويات + المجموعات + الفروع + حمامات السباحة */
const express = require('express');
const { db } = require('../lib/db');
const { audit, money, fmtDate, dayAr, parseJSON, canView, canAdd, canEdit, canDel } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const crud = require('../lib/crud');
const router = express.Router();

const PROGRAM_TYPES_DEFAULT = ['تعليم سباحة', 'تدريب سباحة', 'فرق', 'إنقاذ', 'سلامة في الماء', 'إعداد معلم سباحة', 'معسكر', 'دورة خاصة'];
const PROGRAM_STATUS = ['متاح', 'مكتمل العدد', 'متوقف', 'منتهي'];

/* أنواع البرامج تأتي من الإعدادات (قابلة للإضافة والتعديل من تبويب «أنواع البرامج») */
async function programTypes() {
  const v = (await db.prepare("SELECT value FROM settings WHERE key = 'program_types'").get() || {}).value;
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) && a.length ? a : PROGRAM_TYPES_DEFAULT; } catch (e) { return PROGRAM_TYPES_DEFAULT; }
}

/* ============================================================== */
/*                           المستويات                            */
/* ============================================================== */
router.get('/levels', async function (req, res) {
  if (!canView(req.currentUser, 'levels')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const levels = await db.prepare(`SELECT l.*, (SELECT COUNT(*) FROM assessment_criteria c WHERE c.level_id = l.id) AS skills_count,
    (SELECT COUNT(*) FROM swimmers s WHERE s.level_id = l.id) AS swimmers_count FROM levels l ORDER BY l.order_no`).all();
  const skillsByLevel = {};
  (await db.prepare('SELECT level_id, name FROM assessment_criteria ORDER BY order_no, id').all()).forEach(c => {
    (skillsByLevel[c.level_id] = skillsByLevel[c.level_id] || []).push(c.name);
  });
  const rows = levels.map(l => ({ ...l, skills: skillsByLevel[l.id] || [] }));
  const sharedCount = (await db.prepare('SELECT COUNT(*) c FROM assessment_criteria WHERE level_id IS NULL').get()).c;
  const page = {
    title: 'المستويات والمهارات', subtitle: 'المستويات التعليمية مع مهارات كل مستوى' + (sharedCount ? ' — ' + sharedCount + ' معيار عام مشترك يُضمَّن تلقائياً في كل المستويات' : ''), icon: 'fa-layer-group', module: 'levels', active: 'levels',
    columns: [
      { key: 'name', label: 'اسم المستوى', html: row => `<span class="badge" style="background:${row.color}18;color:${row.color}"><i class="fas fa-signal"></i> ${row.name}</span>` },
      { key: 'order_no', label: 'الترتيب' },
      { key: 'skills', label: 'المهارات', html: row => row.skills.length
        ? `<a href="/levels/${row.id}/edit" class="skills-link" title="اضغط لتعديل المهارات">${row.skills.map(s => `<span class="skill-chip">${s}</span>`).join('')}<span class="skill-edit"><i class="fas fa-pen"></i> تعديل</span></a>`
        : `<a href="/levels/${row.id}/edit" class="skills-link empty" title="إضافة مهارات"><span class="text-muted">لا توجد مهارات — اضغط للإضافة</span></a>` },
      { key: 'skills_count', label: 'العدد', html: row => `<span class="badge badge-info">${row.skills_count} مهارة</span>` },
      { key: 'swimmers_count', label: 'السباحون', html: row => `${row.swimmers_count} سباح` }
    ],
    rows,
    canAdd: canAdd(req.currentUser, 'levels'), addUrl: canAdd(req.currentUser, 'levels') ? '/levels/new' : null, addLabel: 'مستوى جديد',
    actions: () => row => [
      { label: 'تعديل المهارات', icon: 'fa-list-check', href: '/levels/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/levels/' + row.id + '/delete', confirm: 'حذف المستوى؟ سيتم حذف مهاراته وتقييماته، ورفع السباحين الموجودين عليه إلى بدون مستوى', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});

async function levelForm(values, skills) {
  const sharedSkills = await db.prepare('SELECT * FROM assessment_criteria WHERE level_id IS NULL ORDER BY order_no, id').all();
  return { title: values.id ? 'تعديل المستوى' : 'مستوى جديد', subtitle: values.id ? values.name : 'إضافة مستوى جديد بمهاراته', icon: values.id ? 'fa-pen' : 'fa-plus', active: 'levels', action: values.id ? '/levels/' + values.id + '/edit' : '/levels/new', values, skills, sharedSkills, submitLabel: 'حفظ', cancelUrl: '/levels' };
}

router.get('/levels/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'levels')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('levels_form', await levelForm({ order_no: (await db.prepare('SELECT COALESCE(MAX(order_no),0)+1 n FROM levels').get()).n }, []));
});
router.post('/levels/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'levels')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const info = await db.prepare('INSERT INTO levels (name, order_no, color, description) VALUES (?,?,?,?)')
    .run((b.name || '').trim(), Number(b.order_no || 1), b.color || '#0284c7', b.description || '');
  await saveSkills(info.lastInsertRowid, b);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'levels', info.lastInsertRowid, 'مستوى جديد: ' + b.name, req);
  setFlash(res, { type: 'success', message: 'تم حفظ المستوى ومهاراته' });
  res.redirect('/levels');
});
router.get('/levels/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'levels')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM levels WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.redirect('/levels');
  const skills = await db.prepare('SELECT * FROM assessment_criteria WHERE level_id = ? ORDER BY order_no').all(row.id);
  res.render('levels_form', await levelForm(row, skills));
});
router.post('/levels/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'levels')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  await db.prepare('UPDATE levels SET name=?, order_no=?, color=?, description=? WHERE id=?')
    .run((b.name || '').trim(), Number(b.order_no || 1), b.color || '#0284c7', b.description || '', id);
  await saveSkills(id, b);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'levels', id, 'تعديل مستوى: ' + b.name, req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/levels');
});
router.post('/levels/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'levels')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const levelName = await db.prepare('SELECT name FROM levels WHERE id=?').get(id);
  const swimmersMoved = (await db.prepare('SELECT COUNT(*) c FROM swimmers WHERE level_id=?').get(id)).c;
  await db.prepare('DELETE FROM assessment_criteria WHERE level_id = ?').run(id);
  await db.prepare('UPDATE swimmers SET level_id = NULL WHERE level_id = ?').run(id);
  await db.prepare('DELETE FROM assessments WHERE level_id = ?').run(id);
  await db.prepare('DELETE FROM level_progress WHERE to_level_id = ?').run(id);
  await db.prepare('DELETE FROM levels WHERE id = ?').run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'levels', id, 'حذف مستوى', req);
  setFlash(res, {
    type: 'success',
    message: 'تم حذف المستوى' + (swimmersMoved ? ' (' + swimmersMoved + ' سباح رُفع مستواهم وأصبح بدون مستوى)' : '')
  });
  res.redirect('/levels');
});

/* حفظ مهارات المستوى: يحذف القديمة ويضيف الجديدة ديناميكياً */
async function saveSkills(levelId, b) {
  const names = Array.isArray(b.skill_name) ? b.skill_name : (b.skill_name ? [b.skill_name] : []);
  const cats = Array.isArray(b.skill_category) ? b.skill_category : (b.skill_category ? [b.skill_category] : []);
  await db.prepare('DELETE FROM assessment_criteria WHERE level_id = ?').run(levelId);
  const ins = await db.prepare('INSERT INTO assessment_criteria (name, category, program_type, order_no, level_id) VALUES (?,?,?,?,?)');
  let i = 0;
  for (const n of names) {
    const name = String(n || '').trim();
    if (!name) continue;
    await ins.run(name, String(cats[i] || 'مهارات أساسية'), 'all', i + 1, levelId);
    i++;
  }
}

/* حفظ المعايير العامة (مشتركة تلقائياً في كل المستويات) */
router.post('/levels/shared', async function (req, res) {
  if (!canEdit(req.currentUser, 'levels')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const names = Array.isArray(b.shared_name) ? b.shared_name : (b.shared_name ? [b.shared_name] : []);
  await db.prepare('DELETE FROM assessment_criteria WHERE level_id IS NULL').run();
  const ins = await db.prepare('INSERT INTO assessment_criteria (name, category, program_type, order_no, level_id) VALUES (?,?,?,?,NULL)');
  let i = 0;
  for (const n of names) {
    const name = String(n || '').trim();
    if (!name) continue;
    await ins.run(name, 'معايير عامة', 'all', i + 1);
    i++;
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'levels', 0, 'تعديل المعايير العامة', req);
  setFlash(res, { type: 'success', message: 'تم حفظ المعايير العامة — تُضمَّن تلقائياً في كل المستويات' });
  res.redirect(req.get('Referer') || '/levels');
});

/* ============================================================== */
/*                           البرامج                              */
/* ============================================================== */
const programFields = async function (values) {
  const coaches = (await db.prepare('SELECT * FROM coaches').all()).map(c => ({ value: c.id, label: c.full_name }));
  const pools = (await db.prepare('SELECT * FROM pools').all()).map(p => ({ value: p.id, label: p.name }));
  const branches = (await db.prepare('SELECT * FROM branches').all()).map(b => ({ value: b.id, label: b.name }));
  return [
    { key: 'name', label: 'اسم البرنامج', type: 'text', required: true, section: 'البيانات الأساسية', sectionIcon: 'fa-file-lines' },
    { key: 'type', label: 'نوع البرنامج', type: 'select', required: true, options: (await programTypes()).map(v => ({ value: v, label: v })) },
    { key: 'status', label: 'الحالة', type: 'select', options: PROGRAM_STATUS.map(v => ({ value: v, label: v })) },
    { key: 'description', label: 'وصف البرنامج', type: 'textarea', full: true },
    { key: 'age_from', label: 'السن من', type: 'number', number: true, section: 'الفئة والمستوى', sectionIcon: 'fa-users' },
    { key: 'age_to', label: 'السن إلى', type: 'number', number: true },
    { key: 'level_required', label: 'المستوى المطلوب', type: 'text' },
    { key: 'sessions_count', label: 'عدد الحصص', type: 'number', number: true, required: true, hint: 'برنامج التعليم الابتدائي مضبوط افتراضياً على 8 حصص', section: 'الحصص والسعر', sectionIcon: 'fa-stopwatch' },
    { key: 'session_duration_min', label: 'مدة الحصة (دقيقة)', type: 'number', number: true },
    { key: 'weeks_count', label: 'عدد الأسابيع', type: 'number', number: true },
    { key: 'price', label: 'سعر البرنامج (ج.م)', type: 'number', number: true },
    { key: 'max_subscribers', label: 'الحد الأقصى للمشتركين', type: 'number', number: true },
    { key: 'schedule_note', label: 'مواعيد البرنامج', type: 'text', full: true },
    { key: 'schedule', label: 'المواعيد الأسبوعية', type: 'schedule-days', full: true, section: 'المواعيد الأسبوعية', sectionIcon: 'fa-calendar-week' },
    { key: 'coach_id', label: 'المدرب المسؤول', type: 'select', options: coaches, section: 'التنظيم والموقع', sectionIcon: 'fa-map-location-dot' },
    { key: 'pool_id', label: 'مكان التدريب / الحمام', type: 'select', options: pools },
    { key: 'branch_id', label: 'الفرع', type: 'select', options: branches },
    { key: 'tests_required', label: 'الاختبارات المطلوبة', type: 'text', section: 'الاختبارات والشهادات', sectionIcon: 'fa-award' },
    { key: 'success_conditions', label: 'شروط النجاح أو الانتقال', type: 'textarea', full: true },
    { key: 'certificate_name', label: 'الشهادة التي يحصل عليها المتدرب', type: 'text' }
  ];
};

const PROGRAM_COLS = ['name','type','description','age_from','age_to','level_required','sessions_count','session_duration_min','weeks_count','price','max_subscribers','schedule_note','coach_id','pool_id','branch_id','tests_required','success_conditions','certificate_name','status'];
const PROGRAM_FK = ['coach_id', 'pool_id', 'branch_id'];
function programVals(b) {
  return PROGRAM_COLS.map(function (c) {
    let v = b[c];
    if (v === '') v = (PROGRAM_FK.indexOf(c) >= 0 ? null : '');
    return v ?? null;
  });
}
function collectProgramSchedule(b) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const sched = [];
  days.forEach(function (d) {
    const st = b['day_' + d + '_start']; const en = b['day_' + d + '_end'];
    if (st && en) sched.push({ day: d, start: st, end: en });
  });
  return JSON.stringify(sched);
}

router.get('/programs', async function (req, res) {
  const rows = await db.prepare(`SELECT p.*, c.full_name AS coach_name, b.name AS branch_name, pool.name AS pool_name,
    (SELECT COUNT(*) FROM swimmers s WHERE s.program_id = p.id) AS enrolled
    FROM programs p LEFT JOIN coaches c ON c.id = p.coach_id LEFT JOIN branches b ON b.id = p.branch_id LEFT JOIN pools pool ON pool.id = p.pool_id
    ORDER BY p.id`).all();
  const page = {
    title: 'البرامج والدورات', subtitle: 'إدارة البرامج التدريبية والدورات المتخصصة', icon: 'fa-list-check', module: 'programs', active: 'programs',
    columns: [
      { key: 'name', label: 'البرنامج', html: row => `<div><b>${row.name}</b><div class="cell-sub">${row.description ? (row.description.length > 60 ? row.description.slice(0, 60) + '…' : row.description) : ''}</div></div>` },
      { key: 'type', label: 'النوع', html: row => `<span class="badge badge-primary">${row.type}</span>` },
      { key: 'sessions_count', label: 'الحصص', html: row => `<span class="fw-700">${row.sessions_count}</span> × ${row.session_duration_min} د` },
      { key: 'price', label: 'السعر', html: row => `<span class="fw-700 text-primary">${money(row.price)}</span>` },
      { key: 'enrolled', label: 'المشتركون', html: row => `${row.enrolled} / ${row.max_subscribers}` },
      { key: 'coach_name', label: 'المدرب' },
      { key: 'status', label: 'الحالة', html: row => `<span class="badge ${row.status === 'متاح' ? 'badge-success' : row.status === 'مكتمل العدد' ? 'badge-warning' : row.status === 'متوقف' ? 'badge-danger' : 'badge-gray'}">${row.status}</span>` }
    ],
    rows,
    filters: [
      { name: 'type', label: 'النوع', options: (await programTypes()).map(v => ({ value: v, label: v })) },
      { name: 'coach_id', label: 'الكابتن', options: (await db.prepare('SELECT * FROM coaches ORDER BY full_name').all()).map(c => ({ value: c.id, label: c.full_name })) },
      { name: 'status', label: 'الحالة', options: PROGRAM_STATUS.map(v => ({ value: v, label: v })) }
    ],
    canAdd: true, addUrl: '/programs/new', addLabel: 'برنامج جديد',
    actions: () => row => [
      { label: 'المجموعات', icon: 'fa-people-group', href: '/groups?program=' + row.id },
      { label: 'تعديل', icon: 'fa-pen', href: '/programs/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/programs/' + row.id + '/delete', confirm: 'حذف البرنامج؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});

router.get('/programs/new', async function (req, res) {
  res.render('form', { form: { title: 'برنامج جديد', subtitle: 'إنشاء برنامج أو دورة جديدة', icon: 'fa-plus', active: 'programs', action: '/programs/new', fields: await programFields({}), values: {}, submitLabel: 'إنشاء البرنامج', cancelUrl: '/programs', csrf: '' } });
});
router.post('/programs/new', async function (req, res) {
  const b = req.body;
  const cols = PROGRAM_COLS.concat(['schedule']);
  const vals = programVals(b).concat([collectProgramSchedule(b)]);
  const info = await db.prepare(`INSERT INTO programs (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'programs', info.lastInsertRowid, 'برنامج جديد: ' + b.name, req);
  setFlash(res, { type: 'success', message: 'تم إنشاء البرنامج بنجاح' });
  res.redirect('/programs');
});
router.get('/programs/:id/edit', async function (req, res) {
  const row = await db.prepare('SELECT * FROM programs WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.redirect('/programs');
  const values = { ...row };
  parseJSON(row.schedule, []).forEach(function (s) { values['day_' + s.day + '_start'] = s.start; values['day_' + s.day + '_end'] = s.end; });
  res.render('form', { form: { title: 'تعديل البرنامج', subtitle: row.name, icon: 'fa-pen', active: 'programs', action: '/programs/' + row.id + '/edit', fields: await programFields(row), values, submitLabel: 'حفظ التعديلات', cancelUrl: '/programs', csrf: '' } });
});
router.post('/programs/:id/edit', async function (req, res) {
  const id = Number(req.params.id);
  const b = req.body;
  const sets = PROGRAM_COLS.map(c => `${c} = ?`).join(', ');
  await db.prepare(`UPDATE programs SET ${sets}, schedule = ? WHERE id = ?`).run(...programVals(b), collectProgramSchedule(b), id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'programs', id, 'تعديل: ' + b.name, req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/programs');
});
router.post('/programs/:id/delete', async function (req, res) {
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'programs', Number(req.params.id), 'حذف برنامج', req);
  res.redirect('/programs');
});

/* ============================================================== */
/*                           المجموعات                            */
/* ============================================================== */
router.get('/groups', async function (req, res) {
  const prog = req.query.program;
  let rows;
  if (prog) rows = await db.prepare(`SELECT g.*, p.name AS program_name, c.full_name AS coach_name, pool.name AS pool_name, b.name AS branch_name,
    (SELECT COUNT(*) FROM swimmers s WHERE s.group_id = g.id) AS members FROM groups g
    LEFT JOIN programs p ON p.id = g.program_id LEFT JOIN coaches c ON c.id = g.coach_id LEFT JOIN pools pool ON pool.id = g.pool_id
    LEFT JOIN branches b ON b.id = g.branch_id WHERE g.program_id = ? ORDER BY g.id`).all(prog);
  else rows = await db.prepare(`SELECT g.*, p.name AS program_name, c.full_name AS coach_name, pool.name AS pool_name, b.name AS branch_name,
    (SELECT COUNT(*) FROM swimmers s WHERE s.group_id = g.id) AS members FROM groups g
    LEFT JOIN programs p ON p.id = g.program_id LEFT JOIN coaches c ON c.id = g.coach_id LEFT JOIN pools pool ON pool.id = g.pool_id
    LEFT JOIN branches b ON b.id = g.branch_id ORDER BY g.id`).all();
  const page = {
    title: 'المجموعات التدريبية', subtitle: 'تنظيم السباحين في مجموعات حسب البرنامج', icon: 'fa-people-group', module: 'groups', active: 'groups',
    columns: [
      { key: 'name', label: 'المجموعة', html: row => `<div class="avatar-cell"><div class="avatar-sm" style="background:linear-gradient(135deg,#14b8a6,#0d9488)">${(row.name || 'م').trim().charAt(0)}</div><div><div class="cell-title">${row.name}</div><div class="cell-sub">${row.program_name || ''}</div></div></div>` },
      { key: 'members', label: 'الأعضاء', html: row => `<span class="badge badge-info">${row.members} / ${row.capacity}</span>` },
      { key: 'coach_name', label: 'الكابتن' },
      { key: 'pool_name', label: 'الحمام' },
      { key: 'schedule', label: 'المواعيد', html: row => { try { const sch = JSON.parse(row.schedule || '[]'); return sch.map(x => `<span class="badge badge-primary">${dayAr(x.day)} ${x.start}</span>`).join(' ') || '—'; } catch (e) { return '—'; } } },
      { key: 'status', label: 'الحالة', html: row => `<span class="badge ${row.status === 'نشطة' ? 'badge-success' : 'badge-danger'}">${row.status}</span>` }
    ],
    rows,
    filters: [
      { name: 'program_id', label: 'البرنامج', options: (await db.prepare('SELECT * FROM programs ORDER BY name').all()).map(p => ({ value: p.id, label: p.name })) },
      { name: 'coach_id', label: 'الكابتن', options: (await db.prepare('SELECT * FROM coaches ORDER BY full_name').all()).map(c => ({ value: c.id, label: c.full_name })) },
      { name: 'status', label: 'الحالة', options: [{ value: 'نشطة', label: 'نشطة' }, { value: 'متوقفة', label: 'متوقفة' }] }
    ],
    canAdd: true, addUrl: '/groups/new', addLabel: 'مجموعة جديدة',
    actions: () => row => [
      { label: 'الحصص', icon: 'fa-calendar-days', href: '/sessions?group=' + row.id },
      { label: 'مزامنة الأعضاء', icon: 'fa-arrows-rotate', href: '/groups/' + row.id + '/sync', confirm: 'مزامنة أعضاء المجموعة من السباحين المسجلين فيها؟' },
      { label: 'تعديل', icon: 'fa-pen', href: '/groups/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/groups/' + row.id + '/delete', confirm: 'حذف المجموعة؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});

/* مزامنة أعضاء المجموعة من السباحين المرتبطين بها */
router.post('/groups/:id/sync', async function (req, res) {
  const id = Number(req.params.id);
  await db.prepare('INSERT OR IGNORE INTO swimmer_group (swimmer_id, group_id) SELECT id, ? FROM swimmers WHERE group_id = ?').run(id, id);
  await db.prepare('DELETE FROM swimmer_group WHERE group_id = ? AND swimmer_id NOT IN (SELECT id FROM swimmers WHERE group_id = ?)').run(id, id);
  const count = (await db.prepare('SELECT COUNT(*) c FROM swimmer_group WHERE group_id = ?').get(id)).c;
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'groups', id, 'مزامنة أعضاء المجموعة (' + count + ')', req);
  setFlash(res, { type: 'success', message: 'تمت المزامنة — ' + count + ' عضو' });
  res.redirect('/groups');
});

router.get('/groups/new', async function (req, res) {
  await renderGroupEdit(req, res, { row: null, values: {}, members: [], allSwimmers: [], editMode: false });
});
router.post('/groups/new', async function (req, res) {
  const b = req.body;
  const schedule = collectSchedule(b);
  const info = await db.prepare('INSERT INTO groups (name, program_id, coach_id, pool_id, branch_id, capacity, schedule, sessions_count, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(b.name, b.program_id || null, b.coach_id || null, b.pool_id || null, b.branch_id || null, b.capacity || 12, JSON.stringify(schedule), b.sessions_count || 8, b.status || 'نشطة', b.notes || '');
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'groups', info.lastInsertRowid, 'مجموعة جديدة: ' + b.name, req);
  setFlash(res, { type: 'success', message: 'تم إنشاء المجموعة — يمكنك الآن إضافة الأعضاء' });
  res.redirect('/groups/' + info.lastInsertRowid + '/edit');
});
router.get('/groups/:id/edit', async function (req, res) {
  const row = await db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.redirect('/groups');
  const values = { ...row };
  parseJSON(row.schedule, []).forEach(function (s) { values['day_' + s.day + '_start'] = s.start; values['day_' + s.day + '_end'] = s.end; });
  const members = await db.prepare(`SELECT s.id, s.full_name, s.membership_no, l.name AS level_name FROM swimmer_group sg JOIN swimmers s ON s.id = sg.swimmer_id LEFT JOIN levels l ON l.id = s.level_id WHERE sg.group_id = ? ORDER BY s.full_name`).all(row.id);
  const allSwimmers = await db.prepare(`SELECT s.id, s.full_name, s.membership_no, s.gender, s.birth_date FROM swimmers s WHERE s.id NOT IN (SELECT swimmer_id FROM swimmer_group WHERE group_id = ?) ORDER BY s.full_name`).all(row.id);
  await renderGroupEdit(req, res, { row, values, members, allSwimmers, editMode: true });
});
router.post('/groups/:id/edit', async function (req, res) {
  const id = Number(req.params.id);
  const b = req.body;
  const schedule = collectSchedule(b);
  await db.prepare('UPDATE groups SET name=?, program_id=?, coach_id=?, pool_id=?, branch_id=?, capacity=?, schedule=?, sessions_count=?, status=?, notes=? WHERE id=?')
    .run(b.name, b.program_id || null, b.coach_id || null, b.pool_id || null, b.branch_id || null, b.capacity || 12, JSON.stringify(schedule), b.sessions_count || 8, b.status || 'نشطة', b.notes || '', id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'groups', id, 'تعديل: ' + b.name, req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/groups/' + id + '/edit');
});

/* إضافة سباح إلى المجموعة (يُحدّث group_id ويتمّت المزامنة تلقائياً) */
router.post('/groups/:id/members/add', async function (req, res) {
  const id = Number(req.params.id);
  const swimmerId = Number(req.body.swimmer_id || 0);
  const g = await db.prepare('SELECT capacity FROM groups WHERE id = ?').get(id);
  const cap = (g && Number(g.capacity)) || 12;
  if (swimmerId && (await db.prepare('SELECT COUNT(*) c FROM swimmer_group WHERE group_id = ?').get(id)).c >= cap) {
    const full = { type: 'error', message: 'المجموعة ممتلئة — العدد الأقصى ' + cap + ' عضو' };
    if (req.xhr) return res.status(400).json({ ok: false, error: full.message });
    setFlash(res, full);
    return res.redirect('/groups/' + id + '/edit');
  }
  if (swimmerId) {
    await db.prepare('UPDATE swimmers SET group_id = ? WHERE id = ?').run(id, swimmerId);
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'groups', id, 'إضافة سباح #' + swimmerId + ' إلى المجموعة', req);
  }
  const flash = { type: 'success', message: 'تمت إضافة السباح إلى المجموعة' };
  if (req.xhr) {
    const row = swimmerId ? await db.prepare(`SELECT s.id, s.full_name, s.membership_no, l.name AS level_name FROM swimmers s LEFT JOIN levels l ON l.id = s.level_id WHERE s.id = ?`).get(swimmerId) : null;
    return res.json({ ok: true, message: flash.message, member: row, group_id: id });
  }
  setFlash(res, flash);
  res.redirect('/groups/' + id + '/edit');
});

/* إزالة سباح من المجموعة */
router.post('/groups/:id/members/remove', async function (req, res) {
  const id = Number(req.params.id);
  const swimmerId = Number(req.body.swimmer_id || 0);
  if (swimmerId) {
    await db.prepare('UPDATE swimmers SET group_id = NULL WHERE id = ? AND group_id = ?').run(swimmerId, id);
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'groups', id, 'إزالة سباح #' + swimmerId + ' من المجموعة', req);
  }
  const flash = { type: 'success', message: 'تمت إزالة السباح من المجموعة' };
  if (req.xhr) {
    const sw = swimmerId ? await db.prepare('SELECT full_name, membership_no FROM swimmers WHERE id = ?').get(swimmerId) : null;
    return res.json({ ok: true, message: flash.message, swimmer_id: swimmerId, removed_name: sw ? sw.full_name : '', removed_membership: sw ? sw.membership_no : '' });
  }
  setFlash(res, flash);
  res.redirect('/groups/' + id + '/edit');
});

function collectSchedule(b) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const schedule = [];
  days.forEach(function (d) {
    const st = b['day_' + d + '_start']; const en = b['day_' + d + '_end'];
    if (st && en) schedule.push({ day: d, start: st, end: en });
  });
  return schedule;
}

async function renderGroupEdit(req, res, o) {
  const programs = await db.prepare('SELECT * FROM programs ORDER BY name').all();
  const coaches = await db.prepare('SELECT * FROM coaches ORDER BY full_name').all();
  const pools = await db.prepare('SELECT * FROM pools ORDER BY name').all();
  const branches = await db.prepare('SELECT * FROM branches ORDER BY name').all();
  const days = [
    { k: 'sunday', a: 'الأحد' }, { k: 'monday', a: 'الإثنين' }, { k: 'tuesday', a: 'الثلاثاء' },
    { k: 'wednesday', a: 'الأربعاء' }, { k: 'thursday', a: 'الخميس' }, { k: 'friday', a: 'الجمعة' }, { k: 'saturday', a: 'السبت' }
  ];
  res.render('group_edit', {
    title: o.editMode ? 'تعديل المجموعة' : 'مجموعة جديدة',
    active: 'groups', group: o.row, values: o.values, members: o.members, allSwimmers: o.allSwimmers,
    editMode: o.editMode, programs, coaches, pools, branches, days,
    submitAction: o.editMode ? '/groups/' + o.row.id + '/edit' : '/groups/new',
    cancelUrl: '/groups'
  });
}
router.post('/groups/:id/delete', async function (req, res) {
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'groups', Number(req.params.id), 'حذف مجموعة', req);
  res.redirect('/groups');
});

/* ============================================================== */
/*                           الفروع                               */
/* ============================================================== */
crud(router, '/branches', {
  table: 'branches', module: 'branches', entity: 'branches',
  title: 'الفروع', singular: 'فرع', plural: 'الفروع', icon: 'fa-building',
  orderBy: 'name',
  columns: [
    { key: 'name', label: 'اسم الفرع', html: row => `<b><i class="fas fa-building text-primary"></i> ${row.name}</b>` },
    { key: 'address', label: 'العنوان' },
    { key: 'phone', label: 'الهاتف' },
    { key: 'manager_name', label: 'مدير الفرع' }
  ],
  fields: [
    { key: 'name', label: 'اسم الفرع', type: 'text', required: true },
    { key: 'address', label: 'العنوان', type: 'text', full: true },
    { key: 'phone', label: 'الهاتف', type: 'tel' },
    { key: 'email', label: 'البريد الإلكتروني', type: 'email' },
    { key: 'manager_name', label: 'مدير الفرع', type: 'text' },
    { key: 'notes', label: 'ملاحظات', type: 'textarea', full: true }
  ],
  view: true
});

/* ============================================================== */
/*                        حمامات السباحة                          */
/* ============================================================== */
crud(router, '/pools', {
  table: 'pools', module: 'pools', entity: 'pools',
  title: 'حمامات السباحة', singular: 'حمام سباحة', plural: 'حمامات السباحة', icon: 'fa-person-swimming',
  orderBy: 'name',
  beforeRender: async function (rows) {
    const bs = await db.prepare('SELECT id, name FROM branches').all();
    const m = {};
    bs.forEach(b => { m[b.id] = b.name; });
    return rows.map(r => ({ ...r, branch_name: m[r.branch_id] || '—' }));
  },
  columns: [
    { key: 'name', label: 'اسم الحمام', html: row => `<b><i class="fas fa-water text-primary"></i> ${row.name}</b>` },
    { key: 'branch_name', label: 'الفرع' },
    { key: 'lanes_count', label: 'عدد الممرات', html: row => `${row.lanes_count} ممرات` },
    { key: 'length_m', label: 'الطول', html: row => `${row.length_m} م` },
    { key: 'depth_m', label: 'العمق', html: row => `${row.depth_m} م` }
  ],
  filters: async () => [{ name: 'branch_id', label: 'الفرع', options: (await db.prepare('SELECT * FROM branches ORDER BY name').all()).map(b => ({ value: b.id, label: b.name })) }],
  fields: async () => [
    { key: 'name', label: 'اسم الحمام', type: 'text', required: true },
    { key: 'branch_id', label: 'الفرع', type: 'select', options: (await db.prepare('SELECT * FROM branches').all()).map(b => ({ value: b.id, label: b.name })) },
    { key: 'lanes_count', label: 'عدد الممرات', type: 'number', number: true },
    { key: 'length_m', label: 'الطول (متر)', type: 'number', number: true },
    { key: 'depth_m', label: 'العمق (متر)', type: 'number', number: true, step: '0.1' },
    { key: 'notes', label: 'ملاحظات', type: 'textarea', full: true }
  ],
  view: true
});

module.exports = router;
