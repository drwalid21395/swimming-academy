/** السباحون (ملف شامل) + أولياء الأمور + المدربون + الموظفون */
const express = require('express');
const { db } = require('../lib/db');
const { audit, money, fmtDate, fmtDateTime, dayAr, calcAge, pct, parseJSON, today, canView } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const crud = require('../lib/crud');
const { uploadAndStore, removeUploaded } = require('../lib/upload');
const pdfmake = require('../lib/pdf');
const router = express.Router();

const GUARDIAN_RELATIONS = ['أب', 'أم', 'عم', 'خال', 'أخ', 'أخت', 'جد', 'جدة', 'أخرى'];

/* ============================================================== */
/*                        أولياء الأمور                           */
/* ============================================================== */
crud(router, '/guardians', {
  table: 'guardians', module: 'guardians', entity: 'guardians',
  title: 'أولياء الأمور', singular: 'ولي أمر', plural: 'أولياء الأمور', icon: 'fa-people-roof',
  orderBy: 'full_name',
  columns: [
    { key: 'full_name', label: 'الاسم' },
    { key: 'relation', label: 'صلة القرابة' },
    { key: 'phone', label: 'الهاتف' },
    { key: 'whatsapp', label: 'واتساب' },
    { key: 'email', label: 'البريد الإلكتروني' }
  ],
  filters: [{ name: 'relation', label: 'صلة القرابة', options: ['أب', 'أم', 'جد', 'جدة', 'خال', 'عم'].map(v => ({ value: v, label: v })) }],
  fields: [
    { key: 'full_name', label: 'الاسم الكامل', type: 'text', required: true, section: 'البيانات الأساسية', sectionIcon: 'fa-user' },
    { key: 'phone', label: 'رقم الهاتف', type: 'tel' },
    { key: 'whatsapp', label: 'رقم واتساب', type: 'tel' },
    { key: 'email', label: 'البريد الإلكتروني', type: 'email' },
    { key: 'address', label: 'العنوان', type: 'text' },
    { key: 'national_id', label: 'الرقم القومي', type: 'text' },
    { key: 'relation', label: 'صلة القرابة', type: 'select', options: ['أب', 'أم', 'جد', 'جدة', 'خال', 'عم', 'أخرى'].map(v => ({ value: v, label: v })) },
    { key: 'notes', label: 'ملاحظات', type: 'textarea', full: true }
  ],
  search: ['full_name', 'phone'],
  view: true,
  viewTitle: row => 'وليّ أمر — ' + row.full_name
});

/* ============================================================== */
/*                        الكباتن والمدربون                       */
/* ============================================================== */
const contractTypes = ['ثابت', 'بالحصة', 'نسبة'].map(v => ({ value: v, label: v }));
const salaryTypes = [
  { value: 'monthly', label: 'راتب شهري' }, { value: 'per_session', label: 'قيمة الحصة' }, { value: 'percent', label: 'نسبة من الاشتراكات' }
];
function cvLink(cv) {
  return cv ? `<a href="${cv}" target="_blank" class="btn btn-ghost btn-sm" title="تحميل السيرة الذاتية"><i class="fas fa-file-pdf text-danger"></i> تحميل</a>` : '—';
}
crud(router, '/coaches', {
  table: 'coaches', module: 'coaches', entity: 'coaches',
  title: 'الكباتن والمدربون', singular: 'مدرب', plural: 'المدربون', icon: 'fa-user-tie',
  orderBy: 'full_name',
  upload: { field: 'cv' },
  columns: [
    { key: 'full_name', label: 'الاسم', html: row => `<div class="avatar-cell"><div class="avatar-sm">${(row.full_name || 'م').trim().charAt(0)}</div><div><div class="cell-title">${row.full_name}</div><div class="cell-sub">${row.specialization || ''}</div></div></div>` },
    { key: 'phone', label: 'الهاتف' },
    { key: 'experience_years', label: 'سنوات الخبرة', html: row => row.experience_years + ' سنوات' },
    { key: 'cv', label: 'السيرة الذاتية', html: row => cvLink(row.cv) },
    { key: 'contract_type', label: 'نوع التعاقد', html: row => `<span class="badge badge-info">${row.contract_type}</span>` },
      { key: 'status', label: 'الحالة', html: row => `<span class="badge ${row.status === 'active' ? 'badge-success' : 'badge-danger'}">${row.status === 'active' ? 'نشط' : 'متوقف'}</span>` }
    ],
    filters: [
      { name: 'status', label: 'الحالة', options: [{ value: 'active', label: 'نشط' }, { value: 'inactive', label: 'متوقف' }] },
      { name: 'contract_type', label: 'نوع التعاقد', options: contractTypes },
      { name: 'gender', label: 'النوع', options: [{ value: 'ذكر', label: 'ذكر' }, { value: 'أنثى', label: 'أنثى' }] }
    ],
    fields: [
      { key: 'full_name', label: 'الاسم الكامل', type: 'text', required: true, section: 'البيانات الأساسية', sectionIcon: 'fa-user' },
    { key: 'gender', label: 'النوع', type: 'select', options: [{ value: 'ذكر', label: 'ذكر' }, { value: 'أنثى', label: 'أنثى' }] },
    { key: 'phone', label: 'رقم الهاتف', type: 'tel' },
    { key: 'email', label: 'البريد الإلكتروني', type: 'email' },
    { key: 'address', label: 'العنوان', type: 'text' },
    { key: 'cv', label: 'السيرة الذاتية (PDF)', type: 'file', accept: '.pdf', hint: 'يُرفع ملف PDF بسيرة المدرب الذاتية' },
    { key: 'qualification', label: 'المؤهل الدراسي', type: 'text' },
    { key: 'specialization', label: 'التخصص', type: 'text' },
    { key: 'experience_years', label: 'سنوات الخبرة', type: 'number', number: true },
    { key: 'certificates', label: 'الشهادات والدورات', type: 'textarea', full: true },
    { key: 'hire_date', label: 'تاريخ التعيين', type: 'date', section: 'بيانات التعاقد', sectionIcon: 'fa-file-signature' },
    { key: 'contract_type', label: 'نوع التعاقد', type: 'select', options: contractTypes },
    { key: 'salary_type', label: 'نظام الأجر', type: 'select', options: salaryTypes },
    { key: 'salary_amount', label: 'قيمة الأجر', type: 'number', number: true },
    { key: 'license_expiry', label: 'تاريخ انتهاء الشهادات / التراخيص', type: 'date' },
    { key: 'work_days', label: 'أيام العمل (يوم،يوم2...)', type: 'text', hint: 'مثال: sunday,tuesday', json: true },
    { key: 'status', label: 'الحالة', type: 'select', options: [{ value: 'active', label: 'نشط' }, { value: 'inactive', label: 'متوقف' }] },
    { key: 'notes', label: 'ملاحظات', type: 'textarea', full: true }
  ],
  view: true,
  viewTitle: row => 'مدرب — ' + row.full_name,
  viewFields: [
    { key: 'full_name', label: 'الاسم الكامل' },
    { key: 'gender', label: 'النوع' },
    { key: 'phone', label: 'الهاتف' },
    { key: 'email', label: 'البريد الإلكتروني' },
    { key: 'cv', label: 'السيرة الذاتية', html: v => cvLink(v) },
    { key: 'qualification', label: 'المؤهل الدراسي' },
    { key: 'specialization', label: 'التخصص' },
    { key: 'experience_years', label: 'سنوات الخبرة', html: v => v + ' سنوات' },
    { key: 'certificates', label: 'الشهادات والدورات' },
    { key: 'hire_date', label: 'تاريخ التعيين' },
    { key: 'contract_type', label: 'نوع التعاقد' },
    { key: 'salary_type', label: 'نظام الأجر', html: v => ({ monthly: 'راتب شهري', per_session: 'قيمة الحصة', percent: 'نسبة من الاشتراكات' })[v] || v },
    { key: 'salary_amount', label: 'قيمة الأجر', html: v => money(v) },
    { key: 'license_expiry', label: 'انتهاء الشهادات / التراخيص' },
    { key: 'work_days', label: 'أيام العمل', html: v => Array.isArray(parseJSON(v, [])) ? parseJSON(v, []).join('، ') : v },
    { key: 'status', label: 'الحالة', html: v => v === 'active' ? 'نشط' : 'متوقف' },
    { key: 'notes', label: 'ملاحظات' }
  ]
});

/* ============================================================== */
/*                           الموظفون                             */
/* ============================================================== */
crud(router, '/staff', {
  table: 'staff', module: 'staff', entity: 'staff',
  title: 'الموظفون', singular: 'موظف', plural: 'الموظفون', icon: 'fa-user-gear',
  orderBy: 'full_name',
  upload: { field: 'cv' },
  columns: [
    { key: 'full_name', label: 'الاسم' },
    { key: 'job_title', label: 'المسمى الوظيفي', html: row => `<span class="badge badge-primary">${row.job_title || '—'}</span>` },
    { key: 'phone', label: 'الهاتف' },
    { key: 'email', label: 'البريد الإلكتروني' },
    { key: 'cv', label: 'السيرة الذاتية', html: row => cvLink(row.cv) },
    { key: 'status', label: 'الحالة', html: row => `<span class="badge ${row.status === 'active' ? 'badge-success' : 'badge-danger'}">${row.status === 'active' ? 'نشط' : 'متوقف'}</span>` }
  ],
  filters: async () => [
    { name: 'status', label: 'الحالة', options: [{ value: 'active', label: 'نشط' }, { value: 'inactive', label: 'متوقف' }] },
    { name: 'branch_id', label: 'الفرع', options: (await db.prepare('SELECT * FROM branches ORDER BY name').all()).map(b => ({ value: b.id, label: b.name })) }
  ],
  fields: [
    { key: 'full_name', label: 'الاسم الكامل', type: 'text', required: true },
    { key: 'job_title', label: 'المسمى الوظيفي', type: 'text', required: true },
    { key: 'phone', label: 'الهاتف', type: 'tel' },
    { key: 'email', label: 'البريد الإلكتروني', type: 'email' },
    { key: 'cv', label: 'السيرة الذاتية (PDF)', type: 'file', accept: '.pdf', hint: 'يُرفع ملف PDF بسيرة الموظف الذاتية' },
    { key: 'hire_date', label: 'تاريخ التعيين', type: 'date' },
    { key: 'salary', label: 'الراتب', type: 'number', number: true },
    { key: 'status', label: 'الحالة', type: 'select', options: [{ value: 'active', label: 'نشط' }, { value: 'inactive', label: 'متوقف' }] }
  ],
  view: true,
  viewTitle: row => 'موظف — ' + row.full_name,
  viewFields: [
    { key: 'full_name', label: 'الاسم الكامل' },
    { key: 'job_title', label: 'المسمى الوظيفي' },
    { key: 'phone', label: 'الهاتف' },
    { key: 'email', label: 'البريد الإلكتروني' },
    { key: 'cv', label: 'السيرة الذاتية', html: v => cvLink(v) },
    { key: 'hire_date', label: 'تاريخ التعيين' },
    { key: 'salary', label: 'الراتب', html: v => money(v) },
    { key: 'status', label: 'الحالة', html: v => v === 'active' ? 'نشط' : 'متوقف' }
  ]
});

/* ============================================================== */
/*                           السباحون                             */
/* ============================================================== */
const SW_STATUS = ['نشط', 'متوقف مؤقتاً', 'مجمد', 'منسحب', 'خريج'];
const SW_GENDER = ['ذكر', 'أنثى'];

const swimmerFields = async function (values) {
  const levels = (await db.prepare('SELECT * FROM levels ORDER BY order_no').all()).map(l => ({ value: l.id, label: l.name }));
  const groups = (await db.prepare('SELECT * FROM groups').all()).map(g => ({ value: g.id, label: g.name, coach: g.coach_id }));
  const coaches = (await db.prepare('SELECT * FROM coaches').all()).map(c => ({ value: c.id, label: c.full_name }));
  const programs = (await db.prepare('SELECT * FROM programs').all()).map(p => ({ value: p.id, label: p.name }));
  const guardians = await db.prepare('SELECT id, full_name FROM guardians ORDER BY full_name').all();
  const blood = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(v => ({ value: v, label: v }));
  let guardianName = '';
  if (values && values.guardian_id) {
    const g = await db.prepare('SELECT full_name, phone FROM guardians WHERE id = ?').get(values.guardian_id);
    if (g) { guardianName = g.full_name; if (!values.guardian_phone) values.guardian_phone = g.phone; }
  }
  const schoolList = (await db.prepare('SELECT * FROM schools ORDER BY name').all()).map(s => ({ value: s.name, label: s.name + (s.type && s.type !== 'مدرسة' ? ' (' + s.type + ')' : '') }));
  if (values && values.school && !schoolList.some(o => o.value === values.school)) schoolList.unshift({ value: values.school, label: values.school + ' (أخرى)' });
  schoolList.unshift({ value: '', label: '— لا توجد —' });
  return [
    { key: 'full_name', label: 'الاسم بالكامل', type: 'text', required: true, section: 'البيانات الشخصية', sectionIcon: 'fa-user', full: true },
    { key: 'membership_no', label: 'رقم العضوية', type: 'text', hint: 'يُترك فارغاً لإنشائه تلقائياً', value: values.membership_no || '' },
    { key: 'birth_date', label: 'تاريخ الميلاد', type: 'date' },
    { key: 'gender', label: 'النوع', type: 'select', options: SW_GENDER.map(v => ({ value: v, label: v })) },
    { key: 'phone', label: 'رقم هاتف السباح', type: 'tel' },
    { key: 'address', label: 'العنوان', type: 'text' },
    { key: 'avatar', label: 'الصورة الشخصية', type: 'file', accept: 'image/*', hint: 'صورة شخصية للسباح (JPG/PNG)', preview: true, initial: (values && values.full_name ? values.full_name.trim().charAt(0) : 'س') },
    { key: 'school', label: 'المدرسة / جهة الدراسة', type: 'select', options: schoolList },
    { key: 'blood_type', label: 'فصيلة الدم', type: 'select', options: blood },
    { key: 'registration_date', label: 'تاريخ التسجيل', type: 'date' },
    { key: 'guardian_name', label: 'اسم ولي الأمر', type: 'text', value: guardianName, datalist: guardians.map(g => g.full_name), hint: 'يُقترح الاسم تلقائياً من أولياء الأمور المسجلين، ويُسجَّل ولي أمر جديد تلقائياً عند الإضافة', section: 'ولي الأمر', sectionIcon: 'fa-people-roof', full: true },
    { key: 'guardian_relation', label: 'صلة القرابة', type: 'select', options: GUARDIAN_RELATIONS.map(v => ({ value: v, label: v })) },
    { key: 'guardian_phone', label: 'هاتف ولي الأمر', type: 'tel' },
    { key: 'emergency_name', label: 'اسم جهة الطوارئ', type: 'text', section: 'البيانات الصحية والطوارئ', sectionIcon: 'fa-kit-medical' },
    { key: 'emergency_phone', label: 'هاتف الطوارئ', type: 'tel' },
    { key: 'allergies', label: 'الحساسية', type: 'text', full: true },
    { key: 'chronic_diseases', label: 'الأمراض المزمنة', type: 'text', full: true },
    { key: 'medical_note', label: 'ملاحظات طبية', type: 'textarea', full: true },
    { key: 'level_id', label: 'المستوى الحالي', type: 'select', options: levels, section: 'البيانات التدريبية', sectionIcon: 'fa-signal' },
    { key: 'level_percent', label: 'نسبة المستوى المحدد', type: 'info', html: function (v, vals) {
      const lvl = (vals && vals.level_id) || '';
      const sw = (vals && vals.id) || '';
      return `<div class="level-percent-badge" data-level="${lvl}" data-swimmer="${sw}"><i class="fas fa-signal"></i> <span class="lp-val">—</span></div>`;
    } },
    { key: 'program_id', label: 'البرنامج المشترك', type: 'select', options: programs },
    { key: 'group_id', label: 'المجموعة التدريبية', type: 'select', options: groups },
    { key: 'coach_id', label: 'الكابتن المسؤول', type: 'coach_auto', groupField: 'group_id', coaches },
    { key: 'status', label: 'حالة السباح', type: 'select', options: SW_STATUS.map(v => ({ value: v, label: v })) },
    { key: 'notes', label: 'ملاحظات عامة', type: 'textarea', full: true }
  ];
};

/* القائمة */
router.get('/swimmers', async function (req, res) {
  const { status, program, level, q } = req.query;
  let sql = `SELECT s.*, g.full_name AS guardian_name, l.name AS level_name, gr.name AS group_name, c.full_name AS coach_name, p.name AS program_name,
    COALESCE((SELECT sub.sessions_used FROM subscriptions sub WHERE sub.swimmer_id = s.id AND sub.status='نشط' ORDER BY sub.id DESC LIMIT 1),0) AS used,
    COALESCE((SELECT sub.sessions_total FROM subscriptions sub WHERE sub.swimmer_id = s.id AND sub.status='نشط' ORDER BY sub.id DESC LIMIT 1),0) AS stotal
    FROM swimmers s
    LEFT JOIN guardians g ON g.id = s.guardian_id
    LEFT JOIN levels l ON l.id = s.level_id
    LEFT JOIN groups gr ON gr.id = s.group_id
    LEFT JOIN coaches c ON c.id = s.coach_id
    LEFT JOIN programs p ON p.id = s.program_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND s.status = ?'; params.push(status); }
  if (program) { sql += ' AND s.program_id = ?'; params.push(program); }
  if (level) { sql += ' AND s.level_id = ?'; params.push(level); }
  if (q) { sql += ' AND (s.full_name LIKE ? OR s.membership_no LIKE ? OR s.phone LIKE ?)'; const like = '%' + q + '%'; params.push(like, like, like); }
  sql += ' ORDER BY s.id DESC';
  const rows = await db.prepare(sql).all(...params);

  const page = {
    title: 'السباحون واللاعبون', subtitle: 'إدارة الملفات الكاملة للسباحين', icon: 'fa-person-swimming', module: 'swimmers', active: 'swimmers',
    columns: [
      { key: 'full_name', label: 'السباح', html: row => `<div class="avatar-cell">${row.avatar ? `<div class="avatar-sm avatar-img"><img src="${row.avatar}" alt=""></div>` : `<div class="avatar-sm">${(row.full_name || 'س').trim().charAt(0)}</div>`}<div><div class="cell-title">${row.full_name}</div><div class="cell-sub">${row.membership_no}</div></div></div>` },
      { key: 'guardian_name', label: 'ولي الأمر' },
      { key: 'level_name', label: 'المستوى', html: row => `<span class="badge badge-primary">${row.level_name || '—'}</span>` },
      { key: 'group_name', label: 'المجموعة' },
      { key: 'coach_name', label: 'الكابتن' },
      { key: 'used', label: 'الحصص', html: row => `<span class="fw-700">${row.used} / ${row.stotal}</span>` },
      { key: 'status', label: 'الحالة', html: row => statusBadge(row.status) }
    ],
    rows,
    filters: [
      { name: 'status', label: 'الحالة', options: SW_STATUS.map(v => ({ value: v, label: v })) },
      { name: 'program_id', label: 'البرنامج', options: (await db.prepare('SELECT * FROM programs ORDER BY name').all()).map(p => ({ value: p.id, label: p.name })) },
      { name: 'level_id', label: 'المستوى', options: (await db.prepare('SELECT * FROM levels ORDER BY order_no').all()).map(l => ({ value: l.id, label: l.name })) },
      { name: 'coach_id', label: 'الكابتن', options: (await db.prepare('SELECT * FROM coaches ORDER BY full_name').all()).map(c => ({ value: c.id, label: c.full_name })) }
    ],
    canAdd: true,
    addUrl: '/swimmers/new',
    addLabel: 'تسجيل سباح جديد',
    headerActions: [
      { href: '/reports/swimmers-print', label: 'ملف السباحين PDF', icon: 'fa-file-pdf', cls: 'btn-outline' },
      { href: '/reports/swimmers.xls', label: 'ملف السباحين Excel', icon: 'fa-file-excel', cls: 'btn-outline' }
    ],
    actions: user => row => [
      { label: 'عرض', icon: 'fa-eye', href: '/swimmers/' + row.id },
      { label: 'تعديل', icon: 'fa-pen', href: '/swimmers/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/swimmers/' + row.id + '/delete', confirm: 'هل أنت متأكد من حذف هذا السباح؟ سيتم الاحتفاظ بسجل بياناته.', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});

/* نموذج إضافة/تعديل */
router.get('/swimmers/new', async function (req, res) {
  res.render('form', { form: { title: 'تسجيل سباح جديد', subtitle: 'إنشاء ملف متكامل لسباح جديد', icon: 'fa-user-plus', active: 'swimmers', action: '/swimmers/new', encType: 'multipart/form-data', fields: await swimmerFields({}), values: {}, submitLabel: 'تسجيل السباح', cancelUrl: '/swimmers', csrf: '' } });
});

const SW_FK_COLS = ['guardian_id', 'level_id', 'group_id', 'coach_id', 'program_id'];

async function resolveGuardian(b) {
  const name = (b.guardian_name || '').trim();
  if (b.guardian_id) return Number(b.guardian_id);
  if (!name) return null;
  const existing = await db.prepare('SELECT id FROM guardians WHERE full_name = ?').get(name);
  if (existing) return existing.id;
  const info = await db.prepare('INSERT INTO guardians (full_name, relation, phone) VALUES (?,?,?)')
    .run(name, b.guardian_relation || 'أب', b.guardian_phone || null);
  return info.lastInsertRowid;
}

function swimmerVal(c, b, avatar, guardianId) {
  if (c === 'avatar') return avatar;
  if (c === 'guardian_id') return guardianId;
  let v = b[c] ?? null;
  if (SW_FK_COLS.includes(c) && v === '') v = null;
  return v;
}

async function syncSwimmerGroups(swimmerId, groupId) {
  await db.prepare('DELETE FROM swimmer_group WHERE swimmer_id = ?').run(swimmerId);
  if (groupId) await db.prepare('INSERT OR IGNORE INTO swimmer_group (swimmer_id, group_id) VALUES (?,?)').run(swimmerId, groupId);
}

router.post('/swimmers/new', uploadAndStore('avatar'), async function (req, res) {
  const b = req.body;
  const membership = b.membership_no || await nextMembership();
  const guardianId = await resolveGuardian(b);
  const avatar = req.file ? '/uploads/' + req.file.filename : null;
  const cols = ['membership_no','full_name','birth_date','gender','phone','address','school','guardian_id','blood_type','emergency_name','emergency_phone','allergies','chronic_diseases','medical_note','level_id','program_id','group_id','coach_id','registration_date','status','notes','avatar'];
  const vals = cols.map(c => swimmerVal(c, b, avatar, guardianId));
  if (!vals[1]) return res.status(400).send('الاسم مطلوب');
  vals[18] = b.registration_date || today();
  vals[19] = b.status || 'نشط';
  const info = await db.prepare(`INSERT INTO swimmers (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(membership, ...vals.slice(1));
  await syncSwimmerGroups(info.lastInsertRowid, b.group_id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'swimmers', info.lastInsertRowid, 'تسجيل سباح جديد: ' + b.full_name, req);
  setFlash(res, { type: 'success', message: 'تم تسجيل السباح بنجاح' });
  res.redirect('/swimmers/' + info.lastInsertRowid);
});

router.get('/swimmers/:id/edit', async function (req, res) {
  const row = await db.prepare('SELECT * FROM swimmers WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.redirect('/swimmers');
  const tg = await db.prepare('SELECT g.*, c.full_name AS coach_name FROM groups g LEFT JOIN coaches c ON c.id = g.coach_id ORDER BY g.name').all();
  const tc = await db.prepare('SELECT id, full_name FROM coaches ORDER BY full_name').all();
  const curG = row.group_id ? await db.prepare('SELECT name FROM groups WHERE id = ?').get(row.group_id) : null;
  const curC = row.coach_id ? await db.prepare('SELECT full_name FROM coaches WHERE id = ?').get(row.coach_id) : null;
  res.render('form', { form: { title: 'تعديل ملف السباح', subtitle: row.full_name, icon: 'fa-user-pen', active: 'swimmers', action: '/swimmers/' + row.id + '/edit', encType: 'multipart/form-data', fields: await swimmerFields(row), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/swimmers/' + row.id, csrf: '', transfer: { action: '/swimmers/' + row.id + '/transfer', groups: tg, coaches: tc, current_group: row.group_id, current_group_name: curG ? curG.name : 'بدون مجموعة', current_coach_name: curC ? curC.full_name : '—' } } });
});
router.post('/swimmers/:id/edit', uploadAndStore('avatar'), async function (req, res) {
  const id = Number(req.params.id);
  const b = req.body;
  const old = await db.prepare('SELECT avatar, guardian_id FROM swimmers WHERE id = ?').get(id);
  const guardianId = await resolveGuardian(b);
  let avatar = old ? old.avatar : null;
  if (req.file) {
    if (old && old.avatar) removeUploaded(old.avatar);
    avatar = '/uploads/' + req.file.filename;
  }
  const cols = ['full_name','birth_date','gender','phone','address','school','guardian_id','blood_type','emergency_name','emergency_phone','allergies','chronic_diseases','medical_note','level_id','program_id','group_id','coach_id','registration_date','status','notes','avatar'];
  const sets = cols.map(c => `${c} = ?`).join(', ');
  const vals = cols.map(c => swimmerVal(c, b, avatar, guardianId));
  await db.prepare(`UPDATE swimmers SET ${sets} WHERE id = ?`).run(...vals, id);
  await syncSwimmerGroups(id, b.group_id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'swimmers', id, 'تعديل ملف: ' + b.full_name, req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/swimmers/' + id);
});

/* نسبة آخر تقييم للمستوى المحدد (تعرض في نموذج السباح) */
router.get('/api/swimmers/level-percent', async function (req, res) {
  const level = Number(req.query.level_id || 0);
  const swimmer = Number(req.query.swimmer_id || 0);
  if (!level) return res.json({ percent: null, skills: 0 });
  let percent = null;
  if (swimmer) {
    const a = await db.prepare('SELECT overall_percent FROM assessments WHERE level_id = ? AND swimmer_id = ? ORDER BY date DESC, id DESC LIMIT 1').get(level, swimmer);
    if (a && a.overall_percent !== null && a.overall_percent !== undefined) percent = a.overall_percent;
  }
  const skills = (await db.prepare('SELECT COUNT(*) c FROM assessment_criteria WHERE level_id = ?').get(level)).c;
  res.json({ percent, skills });
});

router.post('/swimmers/:id/delete', async function (req, res) {
  const id = Number(req.params.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'swimmers', id, 'حذف سباح', req);
  res.redirect('/swimmers');
});

/* الملف الشامل */
router.get('/swimmers/:id', async function (req, res) {
  const id = Number(req.params.id);
  const s = await db.prepare(`SELECT s.*, g.full_name AS guardian_name, g.phone AS guardian_phone, g.whatsapp AS guardian_whatsapp, g.email AS guardian_email, l.name AS level_name, gr.name AS group_name, gr.schedule AS group_schedule, c.full_name AS coach_name, p.name AS program_name, p.type AS program_type FROM swimmers s
    LEFT JOIN guardians g ON g.id = s.guardian_id LEFT JOIN levels l ON l.id = s.level_id
    LEFT JOIN groups gr ON gr.id = s.group_id LEFT JOIN coaches c ON c.id = s.coach_id
    LEFT JOIN programs p ON p.id = s.program_id WHERE s.id = ?`).get(id);
  if (!s) return res.redirect('/swimmers');
  const age = calcAge(s.birth_date);

  const subs = await db.prepare(`SELECT sub.*, p.name AS program_name FROM subscriptions sub LEFT JOIN programs p ON p.id = sub.program_id WHERE sub.swimmer_id = ? ORDER BY sub.id DESC`).all(id);
  const payments = await db.prepare('SELECT * FROM payments WHERE swimmer_id = ? ORDER BY paid_date DESC LIMIT 12').all(id);
  const assessments = await db.prepare(`SELECT a.*, c.full_name AS coach_name, l.name AS level_name FROM assessments a LEFT JOIN coaches c ON c.id=a.coach_id LEFT JOIN levels l ON l.id=a.level_id WHERE a.swimmer_id = ? ORDER BY a.date DESC`).all(id);
  const tests = await db.prepare('SELECT * FROM tests WHERE swimmer_id = ? ORDER BY date DESC').all(id);
  const attRecords = await db.prepare(`SELECT a.*, s.date, s.title, s.status AS session_status FROM attendance a JOIN sessions s ON s.id = a.session_id WHERE a.swimmer_id = ? ORDER BY s.date DESC LIMIT 15`).all(id);
  const attStats = await db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) present, SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) absent, SUM(CASE WHEN a.status='excused' THEN 1 ELSE 0 END) excused FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE a.swimmer_id=?`).get(id);
  const nextSessions = await db.prepare(`SELECT se.*, gr.name AS group_name FROM sessions se JOIN groups gr ON gr.id = se.group_id WHERE gr.id = ? AND se.date >= ? AND se.status='scheduled' ORDER BY se.date, se.start_time LIMIT 6`).all(s.group_id, today());
  const docs = await db.prepare("SELECT * FROM documents WHERE owner_type='swimmer' AND owner_id = ?").all(id);
  const progress = await db.prepare(`SELECT lp.*, fl.name AS from_level, tl.name AS to_level FROM level_progress lp LEFT JOIN levels fl ON fl.id=lp.from_level_id LEFT JOIN levels tl ON tl.id=lp.to_level_id WHERE lp.swimmer_id = ? ORDER BY lp.date`).all(id);
  const teamRows = await db.prepare(`SELECT t.name FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.swimmer_id = ?`).all(id);
  const pbs = await db.prepare('SELECT * FROM player_measurements WHERE swimmer_id = ? ORDER BY date').all(id);
  const compResults = await db.prepare(`SELECT cr.*, c.name AS comp_name FROM competition_results cr JOIN competitions c ON c.id = cr.competition_id WHERE cr.swimmer_id = ? ORDER BY c.date DESC`).all(id);
  const history = await db.prepare('SELECT * FROM subscription_history WHERE swimmer_id = ? ORDER BY created_at DESC LIMIT 12').all(id);
  const transfers = await db.prepare(`SELECT t.*, fg.name AS from_group, fc.full_name AS from_coach, tg.name AS to_group, tc.full_name AS to_coach, u.full_name AS by_user
    FROM swimmer_transfers t
    LEFT JOIN groups fg ON fg.id = t.from_group_id LEFT JOIN coaches fc ON fc.id = t.from_coach_id
    LEFT JOIN groups tg ON tg.id = t.to_group_id LEFT JOIN coaches tc ON tc.id = t.to_coach_id
    LEFT JOIN users u ON u.id = t.created_by
    WHERE t.swimmer_id = ? ORDER BY t.id DESC LIMIT 10`).all(id);
  const activeSub = subs.find(x => x.status === 'نشط');
  const allGroups = await db.prepare('SELECT * FROM groups ORDER BY name').all();
  const allCoaches = await db.prepare('SELECT * FROM coaches ORDER BY full_name').all();

  /* بيانات التقييم للتخطيط */
  const assessHistory = assessments.slice().reverse().map(a => ({ date: a.date, percent: a.overall_percent }));
  const schoolInfo = s.school ? await db.prepare('SELECT * FROM schools WHERE name = ?').get(s.school) : null;
  const assessTotal = assessments.reduce((sum, a) => sum + Number(a.overall_percent || 0), 0);
  const assessCount = assessments.length;
  const assessFinal = assessCount ? Math.round((assessTotal / assessCount) * 10) / 10 : 0;

  res.render('swimmer_profile', {
    title: 'ملف السباح',
    active: 'swimmers',
    s, age, subs, payments, assessments, tests, attRecords, attStats, nextSessions, docs, progress, teamRows, pbs, compResults, history, activeSub,
    transfers, allGroups, allCoaches,
    schoolInfo, assessTotal, assessCount, assessFinal,
    groupSchedule: parseJSON(s.group_schedule, []),
    today: today(),
    inlineScript: chartScript(assessHistory, s.full_name)
  });
});

/* نقل السباح إلى مجموعة/كابتن آخر (تبقى كل بياناته من تقييمات وحضور واشتراكات) */
router.post('/swimmers/:id/transfer', async function (req, res) {
  const id = Number(req.params.id);
  const s = await db.prepare('SELECT * FROM swimmers WHERE id = ?').get(id);
  if (!s) return res.redirect('/swimmers');
  const toGroup = Number(req.body.group_id || 0);
  let toCoach = Number(req.body.coach_id || 0);
  if (!toGroup) {
    setFlash(res, { type: 'error', message: 'اختر المجموعة الجديدة' });
    return res.redirect('/swimmers/' + id);
  }
  if (!toCoach) {
    const g = await db.prepare('SELECT coach_id FROM groups WHERE id = ?').get(toGroup);
    toCoach = g && g.coach_id ? g.coach_id : s.coach_id;
  }
  await db.prepare('UPDATE swimmers SET group_id = ?, coach_id = ? WHERE id = ?').run(toGroup, toCoach, id);
  await syncSwimmerGroups(id, toGroup);
  await db.prepare('INSERT INTO swimmer_transfers (swimmer_id, from_group_id, from_coach_id, to_group_id, to_coach_id, note, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(id, s.group_id, s.coach_id, toGroup, toCoach, req.body.note || null, req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'swimmers', id, 'نقل السباح ' + s.full_name + ' إلى مجموعة/كابتن جديد', req);
  setFlash(res, { type: 'success', message: 'تم نقل السباح إلى المجموعة والكابتن الجديد مع الاحتفاظ بكل بياناته' });
  res.redirect('/swimmers/' + id);
});

/* نسخة طباعة سجل الحضور والغياب لسباح واحد */
router.get('/swimmers/:id/attendance-print', async function (req, res) {
  const id = Number(req.params.id);
  const s = await db.prepare(`SELECT s.*, g.full_name AS guardian_name, l.name AS level_name, gr.name AS group_name, c.full_name AS coach_name, p.name AS program_name FROM swimmers s
    LEFT JOIN guardians g ON g.id = s.guardian_id LEFT JOIN levels l ON l.id = s.level_id
    LEFT JOIN groups gr ON gr.id = s.group_id LEFT JOIN coaches c ON c.id = s.coach_id
    LEFT JOIN programs p ON p.id = s.program_id WHERE s.id = ?`).get(id);
  if (!s) return res.redirect('/swimmers');
  const records = await db.prepare(`SELECT a.*, se.date, se.title, se.start_time FROM attendance a JOIN sessions se ON se.id = a.session_id WHERE a.swimmer_id = ? ORDER BY se.date DESC, se.start_time`).all(id);
  const stats = {
    total: records.length,
    present: records.filter(r => r.status === 'present').length,
    absent: records.filter(r => r.status === 'absent').length,
    excused: records.filter(r => r.status === 'excused').length,
    late: records.filter(r => r.status === 'late').length
  };
  stats.rate = stats.total ? pct(stats.present, stats.total) : 0;
  res.render('swimmer_attendance_print', {
    title: 'سجل حضور السباح', active: 'swimmers',
    s, records, stats, today: today(), fmtDate, pct
  });
});

/* ============================================================== */
/*        ملف السباحين الشامل: بيانات شخصية + صور + ملفات + تقييمات       */
/* ============================================================== */
function buildSkills(sc, criteriaMap) {
  const skills = Object.entries(sc).map(function (e) {
    const c = criteriaMap[Number(e[0])];
    return {
      name: c ? c.name : String(e[0]),
      score: Number(e[1]) || 0,
      isGeneral: !!(c && (c.level_id === null || c.level_id === undefined)),
      category: c ? c.category : ''
    };
  });
  const total = skills.reduce((s, k) => s + k.score, 0);
  const avg = skills.length ? Math.round((total / skills.length) * 1000) / 1000 : 0;
  return { skills, total, avg, count: skills.length };
}

async function swimmerAssessmentReport(swimmerId) {
  const swimmer = await db.prepare(`SELECT s.*, l.name AS level_name, gr.name AS group_name, c.full_name AS coach_name, p.name AS program_name FROM swimmers s
    LEFT JOIN levels l ON l.id = s.level_id LEFT JOIN groups gr ON gr.id = s.group_id
    LEFT JOIN coaches c ON c.id = s.coach_id LEFT JOIN programs p ON p.id = s.program_id WHERE s.id = ?`).get(swimmerId);
  if (!swimmer) return null;
  const criteriaMap = {};
  (await db.prepare('SELECT * FROM assessment_criteria').all()).forEach(c => { criteriaMap[c.id] = c; });
  /* أحدث تقييم للمعايير العامة (مستوى NULL) — مصدر واحد يُضمَّن في كل المستويات */
  const genRow = await db.prepare(`SELECT a.*, c.full_name AS coach_name FROM assessments a LEFT JOIN coaches c ON c.id = a.coach_id
    WHERE a.swimmer_id = ? AND a.level_id IS NULL ORDER BY a.date DESC, a.id DESC`).get(swimmerId);
  let gen = { skills: [], total: 0, avg: 0, count: 0 };
  if (genRow) {
    let sc = {};
    try { sc = JSON.parse(genRow.scores || '{}'); } catch (e) { sc = {}; }
    gen = buildSkills(sc, criteriaMap);
    gen.assessment = genRow;
  }
  const raw = await db.prepare(`SELECT a.*, l.name AS level_name, l.order_no AS level_order, c.full_name AS coach_name FROM assessments a
    LEFT JOIN levels l ON l.id = a.level_id LEFT JOIN coaches c ON c.id = a.coach_id
    WHERE a.swimmer_id = ? AND a.level_id IS NOT NULL ORDER BY a.date DESC, a.id DESC`).all(swimmerId);
  const seen = {};
  const latest = [];
  raw.forEach(a => { if (!seen[a.level_id]) { seen[a.level_id] = true; latest.push(a); } });
  latest.sort((x, y) => (x.level_order || 0) - (y.level_order || 0));
  const levels = latest.map(function (a) {
    let sc = {};
    try { sc = JSON.parse(a.scores || '{}'); } catch (e) { sc = {}; }
    const own = buildSkills(sc, criteriaMap);
    const skills = own.skills.concat(gen.skills);
    const total = own.total + gen.total;
    const count = own.count + gen.count;
    const avg = count ? Math.round((total / count) * 1000) / 1000 : 0;
    return { assessment: a, skills, total, avg, count, ownCount: own.count };
  }).filter(l => l.skills.length);
  const allSkills = levels.reduce((n, l) => n + l.count, 0);
  const grandSum = levels.reduce((s, l) => s + l.total, 0);
  const grandAvg = allSkills ? Math.round((grandSum / allSkills) * 1000) / 1000 : 0;
  return { swimmer, levels, general: gen, totalLevels: levels.length, allSkills, grandSum, grandAvg };
}

/* تقرير شامل: تقييمات السباح على كل المستويات (مستوى ← مهارات + نسب) */
router.get('/swimmers/:id/assessment-report', async function (req, res) {
  if (!canView(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const data = await swimmerAssessmentReport(Number(req.params.id));
  if (!data) return res.redirect('/swimmers');
  res.render('assessment_report', {
    title: 'تقرير تقييمات السباح', active: 'assessments', data,
    today: today(), fmtDate
  });
});

function grade(score) {
  if (score >= 85) return 'ممتاز';
  if (score >= 70) return 'جيد جداً';
  if (score >= 50) return 'جيد';
  if (score >= 30) return 'مقبول';
  return 'ضعيف';
}

function gradeColor(score) {
  if (score >= 85) return '#16a34a';
  if (score >= 70) return '#0284c7';
  if (score >= 50) return '#ca8a04';
  if (score >= 30) return '#f97316';
  return '#dc2626';
}

/* بناء مستند تقرير التقييمات كملف PDF منسق */
function buildReportPdf(data, todayStr) {
  const s = data.swimmer;
  const gradeCell = sc => ({ text: grade(sc), color: gradeColor(sc), alignment: 'center', fontSize: 9 });
  const content = [
    { text: 'الأكاديمية', style: 'academyTitle' },
    { text: 'تقرير التقييم الفني الشامل', style: 'reportTitle' },
    { text: 'تاريخ الإصدار: ' + todayStr, style: 'meta' },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.6, lineColor: '#0284c7' }], margin: [0, 6, 0, 0] },
    { table: { headerRows: 0, widths: ['14%', '36%', '14%', '36%'], body: [
      [{ text: 'السباح', style: 'lbl' }, { text: s.full_name, style: 'val' }, { text: 'رقم العضوية', style: 'lbl' }, { text: s.membership_no || '—', style: 'val' }],
      [{ text: 'المستوى', style: 'lbl' }, { text: s.level_name || '—', style: 'val' }, { text: 'المجموعة', style: 'lbl' }, { text: s.group_name || '—', style: 'val' }],
      [{ text: 'الكابتن', style: 'lbl' }, { text: s.coach_name || '—', style: 'val' }, { text: 'البرنامج', style: 'lbl' }, { text: s.program_name || '—', style: 'val' }]
    ] }, layout: 'noBorders', margin: [0, 10, 0, 4] },
    { table: { widths: ['25%', '25%', '25%', '25%'], body: [[
      { text: [String(data.totalLevels), { text: '\nمستوى', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#0284c7' },
      { text: [String(data.allSkills), { text: '\nمهارة', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#0284c7' },
      { text: [String(data.grandSum), { text: '\nمجموع النسب', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#ca8a04' },
      { text: [data.grandAvg + '%', { text: '\nالمتوسط العام', fontSize: 9, color: '#6b7280' }], style: 'kpi', color: '#16a34a' }
    ]] }, layout: { defaultBorder: true, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 6, paddingBottom: () => 6 }, margin: [0, 2, 0, 0] },
    { text: 'ملاحظة: المعايير العامة (مثل السرعة، الالتزام، الانضباط) مُضمَّنة تلقائياً في متوسط كل مستوى وتُقاس مرّة واحدة.', style: 'note', margin: [0, 6, 0, 0] }
  ];

  const buildSection = function (title, tag, tableRows, avg, coach, dateStr, ready) {
    return [
      { columns: [
        { text: title, style: 'sectionTitle' },
        { text: tag, alignment: 'left', fontSize: 8, color: '#f59e0b', bold: true },
        { text: avg + '%', alignment: 'left', bold: true, color: gradeColor(avg), fontSize: 12 }
      ], margin: [0, 12, 0, 4] },
      { table: { headerRows: 1, widths: [26, '*', 60, 70], body: [
        [{ text: '#', style: 'th' }, { text: 'المهارة / المعيار', style: 'th' }, { text: 'النسبة %', style: 'th' }, { text: 'التقدير', style: 'th' }]
      ].concat(tableRows) }, layout: 'lightHorizontalLines', margin: [0, 2, 0, 0] },
      { columns: [
        { text: 'تاريخ التقييم: ' + dateStr, style: 'meta2' },
        { text: 'الكابتن المقيّم: ' + (coach || '—'), style: 'meta2' },
        { text: ready ? '✓ جاهز للترقية' : '—', color: '#16a34a', bold: true, fontSize: 9 }
      ], margin: [0, 4, 0, 0] }
    ];
  };

  if (data.levels.length) {
    data.levels.forEach(function (lvl, i) {
      const rows = lvl.skills.map(function (sk, si) {
        return [
          { text: String(si + 1), style: 'td' },
          { text: sk.name + (sk.isGeneral ? ' (عام)' : ''), style: 'td', alignment: 'right' },
          { text: sk.score + '%', style: 'td', bold: true },
          gradeCell(sk.score)
        ];
      });
      const tag = 'تقييم المستوى';
      content.push.apply(content, buildSection(
        'المستوى ' + (i + 1) + ' — ' + lvl.assessment.level_name,
        tag,
        rows,
        lvl.avg,
        lvl.assessment.coach_name,
        fmtDate(lvl.assessment.date),
        lvl.assessment.ready_to_advance
      ));
    });
  } else if (data.general && data.general.count) {
    const rows = data.general.skills.map(function (sk, si) {
      return [
        { text: String(si + 1), style: 'td' },
        { text: sk.name + ' (عام)', style: 'td', alignment: 'right' },
        { text: sk.score + '%', style: 'td', bold: true },
        gradeCell(sk.score)
      ];
    });
    content.push.apply(content, buildSection('المعايير العامة', 'قسم منفصل', rows, data.general.avg, data.general.assessment.coach_name, fmtDate(data.general.assessment.date), data.general.assessment.ready_to_advance));
  } else {
    content.push({ text: 'لا توجد تقييمات مسجلة لهذا السباح حتى الآن.', style: 'note', alignment: 'center', margin: [0, 16, 0, 0] });
  }

  /* الملاحظات (من أحدث تقييم) */
  const genA = data.general.assessment || (data.levels[0] && data.levels[0].assessment) || null;
  if (genA) {
    const noteRows = [
      [genA.strengths ? 'نقاط القوة' : null, genA.strengths || ''],
      [genA.weaknesses ? 'نقاط الضعف' : null, genA.weaknesses || ''],
      [genA.recommendations ? 'التوصيات' : null, genA.recommendations || '']
    ].filter(r => r[0]);
    if (noteRows.length) {
      content.push({ text: 'الملاحظات والتوصيات', style: 'sectionTitle', margin: [0, 14, 0, 4] });
      content.push({ table: { headerRows: 0, widths: ['18%', '*'], body: noteRows.map(r => [{ text: r[0], style: 'lbl' }, { text: r[1], style: 'val' }]) }, layout: 'lightHorizontalLines' });
    }
  }

  /* الملخص العام */
  if (data.levels.length) {
    content.push({ text: 'الملخص العام', style: 'sectionTitle', margin: [0, 14, 0, 4] });
    content.push({ table: { headerRows: 0, widths: ['50%', '50%'], body: [
      [{ text: 'المستويات المقيّمة', style: 'lbl' }, { text: String(data.totalLevels), style: 'val', alignment: 'center' }],
      [{ text: 'مجموع كل النسب', style: 'lbl' }, { text: data.grandSum + ' / ' + (data.allSkills * 100), style: 'val', alignment: 'center' }],
      [{ text: 'المتوسط العام (جميع المستويات)', style: 'lbl' }, { text: data.grandAvg + '%', style: 'val', alignment: 'center', bold: true, color: '#16a34a', fontSize: 12 }]
    ] }, layout: 'lightHorizontalLines' });
  }

  /* التوقيعات */
  content.push({ table: { widths: ['33.3%', '33.3%', '33.3%'], body: [[
    { text: 'مدير الأكاديمية', style: 'sign' },
    { text: 'المدرب المقيّم', style: 'sign' },
    { text: 'ولّي الأمر', style: 'sign' }
  ]] }, layout: 'noBorders', margin: [0, 22, 0, 0] });

  return {
    pageSize: 'A4',
    pageMargins: [28, 30, 28, 36],
    info: { title: 'تقرير التقييمات — ' + s.full_name, author: 'الأكاديمية' },
    defaultStyle: { font: 'Tahoma', fontSize: 10, color: '#111827', alignment: 'right' },
    styles: {
      academyTitle: { fontSize: 18, bold: true, color: '#0284c7', alignment: 'center' },
      reportTitle: { fontSize: 14, bold: true, alignment: 'center', margin: [0, 4, 0, 2] },
      meta: { fontSize: 9, color: '#6b7280', alignment: 'center' },
      meta2: { fontSize: 9, color: '#6b7280' },
      note: { fontSize: 9, color: '#64748b' },
      lbl: { bold: true, fontSize: 9.5, color: '#334155', alignment: 'center' },
      val: { fontSize: 10, alignment: 'center' },
      th: { bold: true, fontSize: 10, color: '#ffffff', fillColor: '#0284c7', alignment: 'center', margin: [2, 3, 2, 3] },
      td: { fontSize: 9.5, alignment: 'center', margin: [1, 2, 1, 2] },
      sectionTitle: { fontSize: 12, bold: true, color: '#0f172a' },
      kpi: { fontSize: 15, bold: true, alignment: 'center' },
      sign: { alignment: 'center', fontSize: 11, bold: true, margin: [0, 0, 0, 34] }
    },
    footer: function (current, total) {
      return { text: 'الأكاديمية — تقرير التقييم الفني   •   صفحة ' + current + ' من ' + total, alignment: 'center', fontSize: 8, color: '#9ca3af' };
    },
    content
  };
}

/* توليد ملف PDF حقيقي منسق (يُفتح في تبويب جديد / يُحمّل مباشرة) */
router.get('/swimmers/:id/assessment-report/pdf', async function (req, res) {
  if (!canView(req.currentUser, 'assessments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const data = await swimmerAssessmentReport(Number(req.params.id));
  if (!data) return res.redirect('/swimmers');
  const doc = buildReportPdf(data, today());
  pdfmake.createPdf(doc).getBuffer().then(function (buf) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="assessment-report-' + (data.swimmer.membership_no || data.swimmer.id) + '.pdf"');
    res.send(buf);
  }).catch(function (e) {
    console.error('خطأ في توليد PDF:', e.message);
    res.status(500).send('تعذّر توليد ملف PDF: ' + e.message);
  });
});

async function swimmerReportBlock(s) {
  const guardian = await db.prepare('SELECT full_name, phone, whatsapp, email FROM guardians WHERE id = ?').get(s.guardian_id);
  const docs = await db.prepare("SELECT * FROM documents WHERE owner_type = 'swimmer' AND owner_id = ? ORDER BY id DESC").all(s.id);
  const assessments = await db.prepare(`SELECT a.date, a.overall_percent, a.ready_to_advance, a.next_assessment_date, l.name AS level_name, c.full_name AS coach_name
    FROM assessments a LEFT JOIN levels l ON l.id = a.level_id LEFT JOIN coaches c ON c.id = a.coach_id
    WHERE a.swimmer_id = ? ORDER BY a.date DESC, a.id DESC`).all(s.id);
  return {
    id: s.id, full_name: s.full_name, membership_no: s.membership_no, avatar: s.avatar,
    birth_date: s.birth_date, gender: s.gender, phone: s.phone, address: s.address,
    school: s.school, status: s.status, age: calcAge(s.birth_date),
    level_name: s.level_name || '', coach_name: s.coach_name || '',
    guardian: guardian || {}, docs, assessments
  };
}

async function buildSwimmerReport(groupRows) {
  const result = [];
  for (const g of groupRows) {
    const members = await db.prepare('SELECT * FROM swimmers WHERE group_id = ? ORDER BY full_name').all(g.id);
    const swimmers = [];
    for (const m of members) swimmers.push(await swimmerReportBlock(m));
    result.push({ id: g.id, name: g.name, coach_name: g.coach_name || '', schedule: parseJSON(g.schedule, []), swimmerCount: swimmers.length, swimmers });
  }
  return result;
}

async function unassignedSwimmerBlock() {
  const rows = await db.prepare(`SELECT s.*, l.name AS level_name, c.full_name AS coach_name FROM swimmers s
    LEFT JOIN levels l ON l.id = s.level_id LEFT JOIN coaches c ON c.id = s.coach_id
    WHERE s.group_id IS NULL ORDER BY s.full_name`).all();
  const blocks = [];
  for (const r of rows) blocks.push(await swimmerReportBlock(r));
  return blocks;
}

async function reportGroupsSql(where, params) {
  const sql = `SELECT g.*, c.full_name AS coach_name FROM groups g LEFT JOIN coaches c ON c.id = g.coach_id ${where} ORDER BY g.name`;
  return await db.prepare(sql).all(...params);
}

/* طباعة ملف السباحين — كل المجاميع */
router.get('/reports/swimmers-print', async function (req, res) {
  if (!canView(req.currentUser, 'swimmers')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const data = await buildSwimmerReport(await reportGroupsSql('', []));
  const un = await unassignedSwimmerBlock();
  if (un.length) data.push({ id: 0, name: 'بدون مجموعة', coach_name: '', schedule: [], swimmerCount: un.length, swimmers: un });
  res.render('swimmer_report_print', {
    title: 'ملف السباحين الشامل', active: 'swimmers', mode: 'all',
    groups: data, total: data.reduce((n, g) => n + g.swimmerCount, 0),
    today: today(), fmtDate
  });
});

/* طباعة ملف السباحين — مجموعة واحدة */
router.get('/groups/:id/swimmers-print', async function (req, res) {
  if (!canView(req.currentUser, 'swimmers')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const g = await db.prepare('SELECT g.*, c.full_name AS coach_name FROM groups g LEFT JOIN coaches c ON c.id = g.coach_id WHERE g.id = ?').get(Number(req.params.id));
  if (!g) return res.redirect('/groups');
  const data = await buildSwimmerReport([g]);
  res.render('swimmer_report_print', {
    title: 'ملف سباحي المجموعة — ' + g.name, active: 'groups', mode: 'group',
    groups: data, total: data[0].swimmerCount, today: today(), fmtDate
  });
});

function xlsCell(v, cls) {
  return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + String(v === null || v === undefined || v === '' ? '—' : v) + '</td>';
}

function swimmerXlsHtml(groups) {
  const rows = groups.map(function (g) {
    return g.swimmers.map(function (s) {
      const docs = s.docs.map(function (d) { return d.title || d.file_name || 'ملف'; }).join('<br>');
      const assess = s.assessments.map(function (a) {
        const p = (a.overall_percent !== null && a.overall_percent !== undefined) ? a.overall_percent + '%' : '—';
        return fmtDate(a.date) + ' — ' + (a.level_name || '—') + ' — ' + p;
      }).join('<br>');
      const gName = g.name === 'بدون مجموعة' ? '' : g.name;
      return '<tr>'
        + xlsCell(gName)
        + xlsCell(s.full_name, 'b')
        + xlsCell(s.membership_no)
        + xlsCell(s.age === '' || s.age === null ? '—' : s.age + ' سنة')
        + xlsCell(s.gender)
        + xlsCell(s.level_name)
        + xlsCell(s.phone)
        + xlsCell(s.guardian ? s.guardian.full_name : '')
        + xlsCell(s.guardian ? s.guardian.phone : '')
        + xlsCell(docs, 'big')
        + xlsCell(assess, 'big')
        + '</tr>';
    }).join('');
  }).join('');
  const widths = [22, 26, 15, 11, 9, 17, 16, 22, 16, 30, 60];
  const colgroup = widths.map(function (w) { return `<col width="${w}">`; }).join('');
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">
    <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>السباحين</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
    <style>
      table { border-collapse: collapse; table-layout: fixed; }
      td, th { border: 1px solid #999; padding: 4px 7px; font-size: 12px; vertical-align: top; font-family: Tahoma, Arial, sans-serif; }
      th { background: #e8eef7; font-weight: 700; }
      td.b { font-weight: 700; }
      td.big { white-space: normal; word-wrap: break-word; }
    </style></head><body dir="rtl"><table dir="rtl" style="width:900px"><colgroup>${colgroup}</colgroup>
      <thead><tr><th>المجموعة</th><th>السباح</th><th>رقم العضوية</th><th>العمر</th><th>النوع</th><th>المستوى</th><th>الهاتف</th><th>ولي الأمر</th><th>هاتف ولي الأمر</th><th>الملفات</th><th>التقييمات (التاريخ — المستوى — النسبة)</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function sendXls(res, groups, total, filename) {
  const html = '\uFEFF' + swimmerXlsHtml(groups);
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', "attachment; filename=\"report.xls\"; filename*=UTF-8''" + encodeURIComponent(filename));
  res.send(html);
}

/* Excel ملف السباحين — كل المجاميع */
router.get('/reports/swimmers.xls', async function (req, res) {
  if (!canView(req.currentUser, 'swimmers')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const data = buildSwimmerReport(reportGroupsSql('', []));
  const un = unassignedSwimmerBlock();
  if (un.length) data.push({ id: 0, name: 'بدون مجموعة', coach_name: '', schedule: [], swimmerCount: un.length, swimmers: un });
  sendXls(res, data, data.reduce((n, g) => n + g.swimmerCount, 0), 'ملف-السباحين.xls');
});

/* Excel ملف السباحين — مجموعة واحدة */
router.get('/groups/:id/swimmers.xls', async function (req, res) {
  if (!canView(req.currentUser, 'swimmers')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const g = await db.prepare('SELECT g.*, c.full_name AS coach_name FROM groups g LEFT JOIN coaches c ON c.id = g.coach_id WHERE g.id = ?').get(Number(req.params.id));
  if (!g) return res.redirect('/groups');
  sendXls(res, buildSwimmerReport([g]), 0, 'مجموعة-' + g.name + '.xls');
});

function statusBadge(st) {
  const map = { 'نشط': ['badge-success', 'fa-user-check'], 'متوقف مؤقتاً': ['badge-warning', 'fa-pause'], 'مجمد': ['badge-info', 'fa-snowflake'], 'منسحب': ['badge-danger', 'fa-user-minus'], 'خريج': ['badge-purple', 'fa-graduation-cap'] };
  const m = map[st] || ['badge-gray', 'fa-circle'];
  return `<span class="badge ${m[0]}"><i class="fas ${m[1]}"></i> ${st}</span>`;
}

async function nextMembership() {
  const last = await db.prepare('SELECT membership_no FROM swimmers ORDER BY id DESC LIMIT 1').get();
  if (!last) return 'SW-0001';
  const num = parseInt(last.membership_no.replace(/\D/g, ''), 10) || 0;
  return 'SW-' + String(num + 1).padStart(4, '0');
}

function chartScript(history, name) {
  return `
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  Chart.defaults.color = isDark ? '#94a3b8' : '#64748b';
  Chart.defaults.font.family = 'Cairo, sans-serif';
  Chart.defaults.font.size = 11;
  var el = document.getElementById('progressChart');
  if (el && ${history.length} > 0) {
    new Chart(el, { type: 'line', data: { labels: ${JSON.stringify(history.map(h => h.date))}, datasets: [{ label: 'درجة التقييم %', data: ${JSON.stringify(history.map(h => h.percent))}, borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,.12)', fill: true, tension: .35 }]}, options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100, grid: { color: isDark ? 'rgba(255,255,255,.06)' : 'rgba(15,23,42,.08)' } }, x: { grid: { display: false } } } } });
  }
`;
}

module.exports = router;
