/** الإدارة والمراسلات: الوارد، الصادر، المستندات، الإشعارات، الشكاوى */
const express = require('express');
const path = require('node:path');
const { db } = require('../lib/db');
const { audit, money, fmtDate, fmtDateTime, today, canView, canAdd, canEdit, canDel, canExport, getPermissions } = require('../lib/helpers');
const { uploadAndStore, removeUploaded } = require('../lib/upload');
const { setFlash } = require('../lib/auth-cookie');
const router = express.Router();

function fileBadge(name, allowed) {
  if (!name) return '';
  if (!allowed) return `<span class="badge badge-gray" title="لا تملك صلاحية تحميل الملف"><i class="fas fa-lock"></i> <span class="font-12">${name}</span></span>`;
  const ext = path.extname(name).toLowerCase();
  const m = { '.pdf': ['fa-file-pdf', 'badge-danger'], '.png': ['fa-file-image', 'badge-success'], '.jpg': ['fa-file-image', 'badge-success'], '.jpeg': ['fa-file-image', 'badge-success'], '.xlsx': ['fa-file-excel', 'badge-success'], '.xls': ['fa-file-excel', 'badge-success'], '.docx': ['fa-file-word', 'badge-primary'], '.doc': ['fa-file-word', 'badge-primary'] };
  const r = m[ext] || ['fa-file', 'badge-gray'];
  return `<a href="/uploads/${name}?dl=1" target="_blank" class="btn btn-ghost btn-sm ${r[1]}" title="تحميل الملف"><i class="fas ${r[0]}"></i> تحميل</a>`;
}

function removeAttachment(row) {
  if (row && row.attachment) removeUploaded(row.attachment);
}

/* ============================================================== */
/*                            الوارد                              */
/* ============================================================== */
const IN_STATUS = ['جديد', 'قيد المتابعة', 'منجز', 'مؤجل'];
const incFields = async function (values) {
  values = values || {};
  return [
    { key: 'doc_no', label: 'رقم الوارد', type: 'text', section: 'بيانات الوارد', sectionIcon: 'fa-inbox' },
    { key: 'received_date', label: 'تاريخ الاستلام', type: 'date' },
    { key: 'sender', label: 'الجهة المرسِلة', type: 'text', required: true },
    { key: 'subject', label: 'الموضوع', type: 'text', required: true, full: true },
    { key: 'doc_type', label: 'نوع المستند', type: 'text' },
    { key: 'receiver', label: 'الجهة المستلِمة', type: 'text' },
    { key: 'required_action', label: 'المطلوب اتخاذه', type: 'textarea', full: true },
    { key: 'owner_id', label: 'المسؤول عن المتابعة', type: 'select', options: (await db.prepare("SELECT id, full_name FROM users WHERE status='active'").all()).map(u => ({ value: u.id, label: u.full_name })) },
    { key: 'due_date', label: 'تاريخ الاستحقاق', type: 'date' },
    { key: 'status', label: 'الحالة', type: 'select', options: IN_STATUS.map(v => ({ value: v, label: v })) },
    { key: 'attachment', label: 'المرفق', type: 'file', hint: values.attachment ? 'المرفق الحالي: ' + values.attachment + ' — اختر ملفاً لاستبداله' : 'اختر ملفاً للإرفاق (حتى 10MB)' },
    { key: 'notes', label: 'ملاحظات', type: 'textarea', full: true }
  ];
};

router.get('/incoming', async function (req, res) {
  if (!canView(req.currentUser, 'incoming')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT i.*, u.full_name AS owner_name FROM incoming_docs i LEFT JOIN users u ON u.id = i.owner_id ORDER BY i.received_date DESC, i.id DESC`).all();
  const page = {
    title: 'الوارد', subtitle: 'المستندات والمراسلات الواردة', icon: 'fa-inbox', module: 'incoming', active: 'incoming',
    columns: [
      { key: 'doc_no', label: 'الرقم', html: row => `<span class="fw-700">${row.doc_no || '—'}</span>` },
      { key: 'received_date', label: 'تاريخ الاستلام', html: row => fmtDate(row.received_date) },
      { key: 'sender', label: 'المرسِل' },
      { key: 'subject', label: 'الموضوع' },
      { key: 'owner_name', label: 'المسؤول', html: row => row.owner_name || '—' },
      { key: 'status', label: 'الحالة', html: row => `<span class="badge ${row.status === 'جديد' ? 'badge-primary' : row.status === 'قيد المتابعة' ? 'badge-warning' : row.status === 'منجز' ? 'badge-success' : 'badge-gray'}">${row.status}</span>` },
      { key: 'attachment', label: 'مرفق', html: row => row.attachment ? fileBadge(row.attachment) : '—' }
    ],
    rows,
    filters: [{ name: 'status', label: 'الحالة', options: IN_STATUS.map(v => ({ value: v, label: v })) }],
    canAdd: canAdd(req.currentUser, 'incoming'), addUrl: canAdd(req.currentUser, 'incoming') ? '/incoming/new' : null, addLabel: 'وارد جديد',
    actions: () => row => [
      { label: 'عرض', icon: 'fa-eye', href: '/incoming/' + row.id },
      { label: 'تعديل', icon: 'fa-pen', href: '/incoming/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/incoming/' + row.id + '/delete', confirm: 'حذف المستند؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});
router.get('/incoming/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'incoming')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'وارد جديد', subtitle: 'تسجيل مستند وارد', icon: 'fa-plus', active: 'incoming', action: '/incoming/new', encType: 'multipart/form-data', fields: await incFields({}), values: {}, submitLabel: 'حفظ', cancelUrl: '/incoming', csrf: '' } });
});
router.post('/incoming/new', uploadAndStore('attachment'), async function (req, res) {
  if (!canAdd(req.currentUser, 'incoming')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const info = await db.prepare(`INSERT INTO incoming_docs (doc_no, received_date, sender, subject, doc_type, receiver, required_action, owner_id, due_date, status, attachment, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.doc_no || '', b.received_date || today(), b.sender, b.subject, b.doc_type || '', b.receiver || '', b.required_action || '', b.owner_id || null, b.due_date || null, b.status || 'جديد', req.file ? req.file.filename : null, b.notes || '', req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'incoming_docs', info.lastInsertRowid, 'وارد: ' + b.subject, req);
  setFlash(res, { type: 'success', message: 'تم تسجيل المستند الوارد' });
  res.redirect('/incoming/' + info.lastInsertRowid);
});
router.get('/incoming/:id', async function (req, res) {
  if (!canView(req.currentUser, 'incoming')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const r = await db.prepare(`SELECT i.*, u.full_name AS owner_name FROM incoming_docs i LEFT JOIN users u ON u.id = i.owner_id WHERE i.id = ?`).get(id);
  if (!r) return res.redirect('/incoming');
  const fields = [
    { label: 'رقم الوارد', value: r.doc_no || '—' }, { label: 'تاريخ الاستلام', value: fmtDate(r.received_date) },
    { label: 'المرسِل', value: r.sender }, { label: 'الموضوع', value: r.subject },
    { label: 'نوع المستند', value: r.doc_type || '—' }, { label: 'الجهة المستلمة', value: r.receiver || '—' },
    { label: 'المطلوب', value: r.required_action || '—' }, { label: 'المسؤول', value: r.owner_name || '—' },
    { label: 'تاريخ الاستحقاق', value: r.due_date ? fmtDate(r.due_date) : '—' },
    { label: 'الحالة', value: r.status }, { label: 'المرفق', value: r.attachment ? fileBadge(r.attachment, canExport(req.currentUser, 'incoming')) : '—' },
    { label: 'ملاحظات', value: r.notes || '—' }
  ];
  res.render('detail', { page: { title: 'وارد — تفاصيل', subtitle: r.doc_no || '', icon: 'fa-inbox', fields, canEdit: canEdit(req.currentUser, 'incoming'), editUrl: '/incoming/' + r.id + '/edit', canDelete: canDel(req.currentUser, 'incoming'), deleteUrl: '/incoming/' + r.id + '/delete', backUrl: '/incoming' } });
});
router.get('/incoming/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'incoming')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM incoming_docs WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/incoming');
  res.render('form', { form: { title: 'تعديل الوارد', subtitle: 'تحديث بيانات المستند', icon: 'fa-pen', active: 'incoming', action: '/incoming/' + row.id + '/edit', encType: 'multipart/form-data', fields: await incFields(row), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/incoming/' + row.id, csrf: '' } });
});
router.post('/incoming/:id/edit', uploadAndStore('attachment'), async function (req, res) {
  if (!canEdit(req.currentUser, 'incoming')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const old = await db.prepare('SELECT * FROM incoming_docs WHERE id=?').get(id);
  const b = req.body;
  const attachment = req.file ? req.file.filename : (old ? old.attachment : null);
  await db.prepare(`UPDATE incoming_docs SET doc_no=?, received_date=?, sender=?, subject=?, doc_type=?, receiver=?, required_action=?, owner_id=?, due_date=?, status=?, attachment=?, notes=? WHERE id=?`)
    .run(b.doc_no || '', b.received_date || today(), b.sender, b.subject, b.doc_type || '', b.receiver || '', b.required_action || '', b.owner_id || null, b.due_date || null, b.status || 'جديد', attachment, b.notes || '', id);
  if (req.file) removeAttachment(old);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'incoming_docs', id, 'تعديل وارد', req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/incoming/' + id);
});
router.post('/incoming/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'incoming')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  removeAttachment(await db.prepare('SELECT * FROM incoming_docs WHERE id=?').get(id));
  await db.prepare('DELETE FROM incoming_docs WHERE id=?').run(id);
  res.redirect('/incoming');
});

/* ============================================================== */
/*                            الصادر                              */
/* ============================================================== */
const outFields = async function (values) {
  values = values || {};
  return [
    { key: 'doc_no', label: 'رقم الصادر', type: 'text', section: 'بيانات الصادر', sectionIcon: 'fa-paper-plane' },
    { key: 'sent_date', label: 'تاريخ الإرسال', type: 'date' },
    { key: 'recipient', label: 'الجهة المرسل إليها', type: 'text', required: true },
    { key: 'subject', label: 'الموضوع', type: 'text', required: true, full: true },
    { key: 'doc_type', label: 'نوع المستند', type: 'text' },
    { key: 'sender', label: 'الجهة المرسِلة', type: 'text' },
    { key: 'send_method', label: 'طريقة الإرسال', type: 'select', options: ['بريد', 'بريد إلكتروني', 'يد بيد', 'فاكس', 'أخرى'].map(v => ({ value: v, label: v })) },
    { key: 'delivery_status', label: 'حالة التسليم', type: 'select', options: [{ value: 'مرسل', label: 'مرسل' }, { value: 'تم الاستلام', label: 'تم الاستلام' }] },
    { key: 'attachment', label: 'المرفق', type: 'file', hint: values.attachment ? 'المرفق الحالي: ' + values.attachment + ' — اختر ملفاً لاستبداله' : 'اختر ملفاً للإرفاق (حتى 10MB)' },
    { key: 'notes', label: 'ملاحظات', type: 'textarea', full: true }
  ];
};
router.get('/outgoing', async function (req, res) {
  if (!canView(req.currentUser, 'outgoing')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare('SELECT * FROM outgoing_docs ORDER BY sent_date DESC, id DESC').all();
  const page = {
    title: 'الصادر', subtitle: 'المستندات والمراسلات الصادرة', icon: 'fa-paper-plane', module: 'outgoing', active: 'outgoing',
    columns: [
      { key: 'doc_no', label: 'الرقم', html: row => `<span class="fw-700">${row.doc_no || '—'}</span>` },
      { key: 'sent_date', label: 'تاريخ الإرسال', html: row => fmtDate(row.sent_date) },
      { key: 'recipient', label: 'الجهة المستلِمة' },
      { key: 'subject', label: 'الموضوع' },
      { key: 'send_method', label: 'الطريقة', html: row => `<span class="badge badge-primary">${row.send_method}</span>` },
      { key: 'delivery_status', label: 'التسليم', html: row => `<span class="badge ${row.delivery_status === 'تم الاستلام' ? 'badge-success' : 'badge-warning'}">${row.delivery_status}</span>` },
      { key: 'attachment', label: 'مرفق', html: row => row.attachment ? fileBadge(row.attachment) : '—' }
    ],
    rows,
    filters: [
      { name: 'delivery_status', label: 'التسليم', options: [{ value: 'مرسل', label: 'مرسل' }, { value: 'تم الاستلام', label: 'تم الاستلام' }] },
      { name: 'send_method', label: 'الطريقة', options: ['بريد', 'بريد إلكتروني', 'يد بيد', 'فاكس', 'أخرى'].map(v => ({ value: v, label: v })) }
    ],
    canAdd: canAdd(req.currentUser, 'outgoing'), addUrl: canAdd(req.currentUser, 'outgoing') ? '/outgoing/new' : null, addLabel: 'صادر جديد',
    actions: () => row => [
      { label: 'عرض', icon: 'fa-eye', href: '/outgoing/' + row.id },
      { label: 'تعديل', icon: 'fa-pen', href: '/outgoing/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/outgoing/' + row.id + '/delete', confirm: 'حذف المستند؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});
router.get('/outgoing/:id', async function (req, res) {
  if (!canView(req.currentUser, 'outgoing')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const r = await db.prepare('SELECT * FROM outgoing_docs WHERE id = ?').get(id);
  if (!r) return res.redirect('/outgoing');
  const fields = [
    { label: 'رقم الصادر', value: r.doc_no || '—' }, { label: 'تاريخ الإرسال', value: fmtDate(r.sent_date) },
    { label: 'الجهة المستلمة', value: r.recipient }, { label: 'الموضوع', value: r.subject },
    { label: 'نوع المستند', value: r.doc_type || '—' }, { label: 'الجهة المرسلة', value: r.sender || '—' },
    { label: 'طريقة الإرسال', value: r.send_method || '—' }, { label: 'حالة التسليم', value: r.delivery_status || '—' },
    { label: 'المرفق', value: r.attachment ? fileBadge(r.attachment, canExport(req.currentUser, 'outgoing')) : '—' },
    { label: 'ملاحظات', value: r.notes || '—' }
  ];
  res.render('detail', { page: { title: 'صادر — تفاصيل', subtitle: r.doc_no || '', icon: 'fa-paper-plane', fields, canEdit: canEdit(req.currentUser, 'outgoing'), editUrl: '/outgoing/' + r.id + '/edit', canDelete: canDel(req.currentUser, 'outgoing'), deleteUrl: '/outgoing/' + r.id + '/delete', backUrl: '/outgoing' } });
});
router.get('/outgoing/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'outgoing')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'صادر جديد', subtitle: 'تسجيل مستند صادر', icon: 'fa-plus', active: 'outgoing', action: '/outgoing/new', encType: 'multipart/form-data', fields: await outFields({}), values: {}, submitLabel: 'حفظ', cancelUrl: '/outgoing', csrf: '' } });
});
router.post('/outgoing/new', uploadAndStore('attachment'), async function (req, res) {
  if (!canAdd(req.currentUser, 'outgoing')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const info = await db.prepare(`INSERT INTO outgoing_docs (doc_no, sent_date, recipient, subject, doc_type, sender, send_method, delivery_status, attachment, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.doc_no || '', b.sent_date || today(), b.recipient, b.subject, b.doc_type || '', b.sender || '', b.send_method || 'بريد', b.delivery_status || 'مرسل', req.file ? req.file.filename : null, b.notes || '', req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'outgoing_docs', info.lastInsertRowid, 'صادر: ' + b.subject, req);
  setFlash(res, { type: 'success', message: 'تم تسجيل المستند الصادر' });
  res.redirect('/outgoing');
});
router.get('/outgoing/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'outgoing')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM outgoing_docs WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/outgoing');
  res.render('form', { form: { title: 'تعديل الصادر', subtitle: 'تحديث بيانات المستند', icon: 'fa-pen', active: 'outgoing', action: '/outgoing/' + row.id + '/edit', encType: 'multipart/form-data', fields: await outFields(row), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/outgoing/' + row.id, csrf: '' } });
});
router.post('/outgoing/:id/edit', uploadAndStore('attachment'), async function (req, res) {
  if (!canEdit(req.currentUser, 'outgoing')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const old = await db.prepare('SELECT * FROM outgoing_docs WHERE id=?').get(id);
  const b = req.body;
  const attachment = req.file ? req.file.filename : (old ? old.attachment : null);
  await db.prepare(`UPDATE outgoing_docs SET doc_no=?, sent_date=?, recipient=?, subject=?, doc_type=?, sender=?, send_method=?, delivery_status=?, attachment=?, notes=? WHERE id=?`)
    .run(b.doc_no || '', b.sent_date || today(), b.recipient, b.subject, b.doc_type || '', b.sender || '', b.send_method || 'بريد', b.delivery_status || 'مرسل', attachment, b.notes || '', id);
  if (req.file) removeAttachment(old);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'outgoing_docs', id, 'تعديل صادر', req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/outgoing/' + id);
});
router.post('/outgoing/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'outgoing')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  removeAttachment(await db.prepare('SELECT * FROM outgoing_docs WHERE id=?').get(id));
  await db.prepare('DELETE FROM outgoing_docs WHERE id=?').run(id);
  res.redirect('/outgoing');
});

/* ============================================================== */
/*                           المستندات                            */
/* ============================================================== */
router.get('/documents', async function (req, res) {
  if (!canView(req.currentUser, 'documents')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT d.*, u.full_name AS uploaded_name,
    CASE d.owner_type WHEN 'swimmer' THEN (SELECT full_name FROM swimmers WHERE id = d.owner_id)
      WHEN 'coach' THEN (SELECT full_name FROM coaches WHERE id = d.owner_id)
      WHEN 'guardian' THEN (SELECT full_name FROM guardians WHERE id = d.owner_id) END AS owner_name
    FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by ORDER BY d.created_at DESC`).all();
  const page = {
    title: 'المستندات', subtitle: 'ملفات السباحين والمستندات الإدارية', icon: 'fa-folder-open', module: 'documents', active: 'documents',
    columns: [
      { key: 'title', label: 'المستند', html: row => `<div><b>${row.title || row.file_name}</b><div class="cell-sub">${row.doc_type || ''}</div></div>` },
      { key: 'owner', label: 'الجهة', html: row => {
        if (!row.owner_name) return '<span class="badge badge-gray">عام</span>';
        const cls = row.owner_type === 'swimmer' ? 'badge-info' : row.owner_type === 'coach' ? 'badge-primary' : 'badge-warning';
        const lbl = row.owner_type === 'swimmer' ? 'سباح' : row.owner_type === 'coach' ? 'مدرب' : 'ولي أمر';
        return `<span class="badge ${cls}">${lbl}: ${row.owner_name}</span>`;
      } },
      { key: 'file', label: 'الملف', html: row => fileBadge(row.file_name, canExport(req.currentUser, 'documents')) },
      { key: 'visibility', label: 'الظهور', html: row => row.visibility },
      { key: 'uploaded_name', label: 'رفعه' }
    ],
    rows,
    filters: [
      { name: 'owner_type', label: 'الجهة', options: [{ value: 'general', label: 'عام' }, { value: 'swimmer', label: 'سباح' }, { value: 'coach', label: 'مدرب' }, { value: 'guardian', label: 'ولي أمر' }] },
      { name: 'visibility', label: 'الظهور', options: [{ value: 'staff', label: 'الإدارة' }, { value: 'coach', label: 'المدربون' }, { value: 'guardian', label: 'ولي الأمر' }] }
    ],
    canAdd: canAdd(req.currentUser, 'documents'), addUrl: canAdd(req.currentUser, 'documents') ? '/documents/new' : null, addLabel: 'رفع مستند',
    actions: () => row => [
      { label: 'حذف', icon: 'fa-trash', href: '/documents/' + row.id + '/delete', confirm: 'حذف المستند؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});
router.get('/documents/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'documents')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'رفع مستند', subtitle: 'إضافة ملف للأكاديمية', icon: 'fa-upload', active: 'documents', action: '/documents/new', encType: 'multipart/form-data',
    fields: [
      { key: 'owner_type', label: 'نوع الجهة', type: 'select', options: [{ value: 'general', label: 'عام' }, { value: 'swimmer', label: 'سباح' }, { value: 'coach', label: 'مدرب' }, { value: 'guardian', label: 'ولي أمر' }] },
      { key: 'owner_id', label: 'رقم الجهة (id)', type: 'number', number: true },
      { key: 'doc_type', label: 'نوع المستند', type: 'text', hint: 'مثال: شهادة ميلاد، تقرير طبي، عقد' },
      { key: 'title', label: 'العنوان', type: 'text' },
      { key: 'visibility', label: 'الظهور', type: 'select', options: [{ value: 'staff', label: 'الإدارة فقط' }, { value: 'coach', label: 'المدربون' }, { value: 'guardian', label: 'ولي الأمر' }] },
      { key: 'file_name', label: 'اختر الملف', type: 'file', full: true },
      { key: 'notes', label: 'ملاحظات', type: 'textarea', full: true }
    ], values: {}, submitLabel: 'رفع المستند', cancelUrl: '/documents', csrf: '' } });
});
router.post('/documents/new', uploadAndStore('file_name'), async function (req, res) {
  if (!canAdd(req.currentUser, 'documents')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  if (!req.file) { setFlash(res, { type: 'error', message: 'لم يتم اختيار ملف' }); return res.redirect('/documents/new'); }
  const info = await db.prepare('INSERT INTO documents (owner_type, owner_id, doc_type, title, file_path, file_name, mime, size, visibility, notes, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(b.owner_type || 'general', b.owner_id || null, b.doc_type || '', b.title || req.file.originalname, '/uploads/' + req.file.filename, req.file.filename, req.file.mimetype, req.file.size, b.visibility || 'staff', b.notes || '', req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'documents', info.lastInsertRowid, 'رفع مستند: ' + (b.title || req.file.originalname), req);
  setFlash(res, { type: 'success', message: 'تم رفع المستند' });
  res.redirect('/documents');
});
router.post('/documents/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'documents')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const d = await db.prepare('SELECT * FROM documents WHERE id=?').get(id);
  if (d) { try { const p = path.join(UPLOAD_DIR, d.file_name || ''); if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { } }
  await db.prepare('DELETE FROM documents WHERE id=?').run(id);
  res.redirect('/documents');
});

/* ============================================================== */
/*                          الإشعارات                             */
/* ============================================================== */
const NOTIFY_TYPES = ['عام', 'أكاديمي', 'مالي', 'تنبيه', 'بطولة'];
router.get('/notifications', async function (req, res) {
  if (!canView(req.currentUser, 'notifications')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const uid = req.currentUser.id;
  await db.prepare("UPDATE notification_recipients SET is_read = 1, read_at = datetime('now','localtime') WHERE user_id = ?").run(uid);
  const rows = await db.prepare(`SELECT n.*, u.full_name AS sender_name,
      (SELECT COUNT(*) FROM notification_recipients nr WHERE nr.notification_id = n.id AND nr.is_read = 0) AS unread
    FROM notifications n LEFT JOIN users u ON u.id = n.created_by
    ORDER BY n.created_at DESC LIMIT 200`).all();
  const page = {
    title: 'الإشعارات', subtitle: 'إشعارات النظام والتواصل', icon: 'fa-bell', module: 'notifications', active: 'notifications',
    columns: [
      { key: 'title', label: 'الإشعار', html: row => `<div><b>${row.title}</b><div class="cell-sub">${row.message}</div></div>` },
      { key: 'type', label: 'النوع', html: row => `<span class="badge badge-primary">${row.type}</span>` },
      { key: 'broadcast', label: 'الإرسال', html: row => row.is_broadcast ? '<span class="badge badge-success">للكل</span>' : '<span class="badge badge-gray">محدد</span>' },
      { key: 'sender_name', label: 'بواسطة' },
      { key: 'created_at', label: 'التاريخ', html: row => fmtDateTime(row.created_at) }
    ],
    rows,
    filters: [
      { name: 'type', label: 'النوع', options: NOTIFY_TYPES.map(v => ({ value: v, label: v })) },
      { name: 'is_broadcast', label: 'الإرسال', options: [{ value: '1', label: 'للكل' }, { value: '0', label: 'محدد' }] }
    ],
    canAdd: canAdd(req.currentUser, 'notifications'), addUrl: canAdd(req.currentUser, 'notifications') ? '/notifications/new' : null, addLabel: 'إشعار جديد',
    actions: () => row => [
      { label: 'حذف', icon: 'fa-trash', href: '/notifications/' + row.id + '/delete', confirm: 'حذف الإشعار؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});
router.get('/notifications/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'notifications')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'إشعار جديد', subtitle: 'إرسال إشعار إلى مستخدم', icon: 'fa-bell', active: 'notifications', action: '/notifications/new',
    fields: [
      { key: 'title', label: 'عنوان الإشعار', type: 'text', required: true },
      { key: 'message', label: 'النص', type: 'textarea', full: true },
      { key: 'type', label: 'النوع', type: 'select', options: NOTIFY_TYPES.map(v => ({ value: v, label: v })) },
      { key: 'is_broadcast', label: 'إرسال للجميع', type: 'checkbox', checkLabel: 'إشعار عام لجميع المستخدمين' },
      { key: 'link', label: 'رابط مرتبط', type: 'text', hint: 'مثال: /swimmers/5' },
      { key: 'user_id', label: 'أو لمستخدم محدد', type: 'select', options: (await db.prepare("SELECT id, full_name FROM users WHERE status='active'").all()).map(u => ({ value: u.id, label: u.full_name })) }
    ], values: {}, submitLabel: 'إرسال الإشعار', cancelUrl: '/notifications', csrf: '' } });
});
router.post('/notifications/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'notifications')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const info = await db.prepare('INSERT INTO notifications (title, message, type, link, is_broadcast, created_by) VALUES (?,?,?,?,?,?)')
    .run(b.title, b.message || '', b.type || 'عام', b.link || '', b.is_broadcast === '1' ? 1 : 0, req.currentUser.id);
  if (b.is_broadcast === '1') {
    const users = await db.prepare("SELECT id FROM users WHERE status='active'").all();
    const st = await db.prepare('INSERT INTO notification_recipients (notification_id, user_id) VALUES (?,?)');
    users.forEach(u => st.run(info.lastInsertRowid, u.id));
  } else if (b.user_id) {
    await db.prepare('INSERT INTO notification_recipients (notification_id, user_id) VALUES (?,?)').run(info.lastInsertRowid, b.user_id);
  } else {
    await db.prepare('INSERT INTO notification_recipients (notification_id, user_id) VALUES (?,?)').run(info.lastInsertRowid, req.currentUser.id);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'notifications', info.lastInsertRowid, 'إشعار: ' + b.title, req);
  setFlash(res, { type: 'success', message: 'تم إرسال الإشعار' });
  res.redirect('/notifications');
});
router.post('/notifications/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'notifications')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  await db.prepare('DELETE FROM notification_recipients WHERE notification_id=?').run(id);
  await db.prepare('DELETE FROM notifications WHERE id=?').run(id);
  res.redirect('/notifications');
});

/* ============================================================== */
/*                          الشكاوى                               */
/* ============================================================== */
const COMPL_STATUS = ['جديدة', 'قيد المعالجة', 'تمت المعالجة', 'مغلقة'];
router.get('/complaints', async function (req, res) {
  if (!canView(req.currentUser, 'complaints')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT c.*, g.full_name AS guardian_name, s.full_name AS swimmer_name, u.full_name AS responder_name FROM complaints c
    LEFT JOIN guardians g ON g.id = c.guardian_id LEFT JOIN swimmers s ON s.id = c.swimmer_id LEFT JOIN users u ON u.id = c.responded_by
    ORDER BY c.created_at DESC`).all();
  const page = {
    title: 'الشكاوى والطلبات', subtitle: 'شكاوى وطلبات أولياء الأمور', icon: 'fa-headset', module: 'complaints', active: 'complaints',
    columns: [
      { key: 'title', label: 'الشكوى', html: row => `<div><b>${row.title}</b><div class="cell-sub">${row.category} · ${(row.description || '').slice(0, 50)}</div></div>` },
      { key: 'guardian_name', label: 'ولي الأمر' },
      { key: 'swimmer_name', label: 'السباح', html: row => row.swimmer_name || '—' },
      { key: 'created_at', label: 'التاريخ', html: row => fmtDateTime(row.created_at) },
      { key: 'status', label: 'الحالة', html: row => `<span class="badge ${row.status === 'جديدة' ? 'badge-danger' : row.status === 'قيد المعالجة' ? 'badge-warning' : row.status === 'تمت المعالجة' ? 'badge-info' : 'badge-gray'}">${row.status}</span>` }
    ],
    rows,
    filters: [{ name: 'status', label: 'الحالة', options: COMPL_STATUS.map(v => ({ value: v, label: v })) }],
    canAdd: canAdd(req.currentUser, 'complaints'), addUrl: canAdd(req.currentUser, 'complaints') ? '/complaints/new' : null, addLabel: 'شكوى جديدة',
    actions: () => row => [
      { label: 'عرض', icon: 'fa-eye', href: '/complaints/' + row.id },
      { label: 'حذف', icon: 'fa-trash', href: '/complaints/' + row.id + '/delete', confirm: 'حذف الشكوى؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});
router.get('/complaints/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'complaints')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'شكوى جديدة', subtitle: 'تسجيل شكوى أو طلب', icon: 'fa-plus', active: 'complaints', action: '/complaints/new',
    fields: [
      { key: 'guardian_id', label: 'ولي الأمر', type: 'select', options: (await db.prepare('SELECT * FROM guardians').all()).map(g => ({ value: g.id, label: g.full_name })) },
      { key: 'swimmer_id', label: 'السباح', type: 'select', options: (await db.prepare('SELECT id, full_name FROM swimmers ORDER BY full_name').all()).map(s => ({ value: s.id, label: s.full_name })) },
      { key: 'category', label: 'الفئة', type: 'select', options: ['عام', 'مالية', 'تدريب', 'إداري', 'أخرى'].map(v => ({ value: v, label: v })) },
      { key: 'title', label: 'العنوان', type: 'text', required: true },
      { key: 'description', label: 'الوصف', type: 'textarea', full: true }
    ], values: {}, submitLabel: 'تسجيل الشكوى', cancelUrl: '/complaints', csrf: '' } });
});
router.post('/complaints/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'complaints')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const info = await db.prepare('INSERT INTO complaints (guardian_id, swimmer_id, category, title, description, status, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(b.guardian_id || null, b.swimmer_id || null, b.category || 'عام', b.title, b.description || '', 'جديدة', req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'complaints', info.lastInsertRowid, 'شكوى: ' + b.title, req);
  setFlash(res, { type: 'success', message: 'تم تسجيل الشكوى' });
  res.redirect('/complaints/' + info.lastInsertRowid);
});
router.get('/complaints/:id', async function (req, res) {
  if (!canView(req.currentUser, 'complaints')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const c = await db.prepare(`SELECT c.*, g.full_name AS guardian_name, s.full_name AS swimmer_name, u.full_name AS responder_name FROM complaints c
    LEFT JOIN guardians g ON g.id = c.guardian_id LEFT JOIN swimmers s ON s.id = c.swimmer_id LEFT JOIN users u ON u.id = c.responded_by WHERE c.id = ?`).get(id);
  if (!c) return res.redirect('/complaints');
  const fields = [
    { label: 'العنوان', value: c.title }, { label: 'الفئة', value: c.category },
    { label: 'ولي الأمر', value: c.guardian_name || '—' }, { label: 'السباح', value: c.swimmer_name || '—' },
    { label: 'الوصف', value: c.description || '—' }, { label: 'الحالة', value: c.status },
    { label: 'الرد', value: c.response || '—' }, { label: 'المعالج', value: c.responder_name || '—' },
    { label: 'تاريخ التسجيل', value: fmtDateTime(c.created_at) }
  ];
  res.render('complaint_detail', { title: 'تفاصيل الشكوى', active: 'complaints', c, fields, money,
    canEdit: canEdit(req.currentUser, 'complaints'), canDel: canDel(req.currentUser, 'complaints') });
});
router.post('/complaints/:id/respond', async function (req, res) {
  if (!canEdit(req.currentUser, 'complaints')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  await db.prepare("UPDATE complaints SET response=?, status=?, responded_by=?, updated_at=datetime('now','localtime') WHERE id=?")
    .run(b.response || '', b.status || 'قيد المعالجة', req.currentUser.id, id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'complaints', id, 'معالجة شكوى', req);
  setFlash(res, { type: 'success', message: 'تم تحديث الشكوى' });
  res.redirect('/complaints/' + id);
});
router.post('/complaints/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'complaints')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  await db.prepare('DELETE FROM complaints WHERE id=?').run(Number(req.params.id));
  res.redirect('/complaints');
});

module.exports = router;
