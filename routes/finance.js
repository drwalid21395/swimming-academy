/** المالية: الاشتراكات، المدفوعات، الإيرادات، المصروفات، مستحقات المدربين */
const express = require('express');
const { db } = require('../lib/db');
const { audit, money, fmtDate, today, daysAhead, canView, canAdd, canEdit, canDel } = require('../lib/helpers');
const { buildRenewalMessage, sendReminder, logMessage } = require('../lib/whatsapp');
const { setFlash } = require('../lib/auth-cookie');
const router = express.Router();

async function swimmerOptions() {
  return (await db.prepare('SELECT id, full_name, membership_no FROM swimmers WHERE deleted_at IS NULL ORDER BY full_name').all())
    .map(s => ({ value: s.id, label: s.full_name + ' (' + s.membership_no + ')' }));
}
async function programOptions() {
  return (await db.prepare('SELECT * FROM programs WHERE deleted_at IS NULL ORDER BY name').all()).map(p => ({ value: p.id, label: p.name }));
}
async function groupOptions() {
  return (await db.prepare('SELECT * FROM groups WHERE deleted_at IS NULL ORDER BY name').all()).map(g => ({ value: g.id, label: g.name }));
}

/* حساب الإجمالي بعد الخصم والضريبة */
function computeTotal(price, discount, tax) {
  const base = Number(price || 0) - Number(discount || 0);
  const taxAmt = Number(tax || 0) > 1 ? Number(tax) : (base * Number(tax || 0) / 100);
  return Math.round((base + taxAmt) * 100) / 100;
}

/* ============================================================== */
/*                          الاشتراكات                            */
/* ============================================================== */
router.get('/subscriptions', async function (req, res) {
  if (!canView(req.currentUser, 'subscriptions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT sub.*, s.full_name AS swimmer_name, s.membership_no, p.name AS program_name, g.name AS group_name, gu.whatsapp AS guardian_whatsapp FROM subscriptions sub
    LEFT JOIN swimmers s ON s.id = sub.swimmer_id LEFT JOIN programs p ON p.id = sub.program_id LEFT JOIN groups g ON g.id = sub.group_id LEFT JOIN guardians gu ON gu.id = s.guardian_id
    ORDER BY sub.created_at DESC`).all();
  const page = {
    title: 'الاشتراكات', subtitle: 'اشتراكات السباحين في البرامج', icon: 'fa-file-contract', module: 'subscriptions', active: 'subscriptions',
    columns: [
      { key: 'swimmer_name', label: 'السباح', html: row => `<div class="avatar-cell"><div class="avatar-sm" style="background:linear-gradient(135deg,#0ea5e9,#14b8a6)">${(row.swimmer_name || 'س').trim().charAt(0)}</div><div><div class="cell-title">${row.swimmer_name || '—'}</div><div class="cell-sub">${row.membership_no || ''}</div></div></div>` },
      { key: 'program_name', label: 'البرنامج' },
      { key: 'start_date', label: 'الفترة', html: row => `${fmtDate(row.start_date)}<div class="cell-sub">إلى ${fmtDate(row.end_date)}</div>` },
      { key: 'sessions_used', label: 'الحصص', html: row => `<span class="badge badge-info">${row.sessions_used} / ${row.sessions_total}</span>` },
      { key: 'total', label: 'الإجمالي', html: row => `<span class="fw-700 text-primary">${money(row.total)}</span>` },
      { key: 'remaining', label: 'المتبقي', html: row => row.remaining > 0 ? `<span class="fw-700 text-danger">${money(row.remaining)}</span>` : `<span class="fw-700 text-success">مسدد</span>` },
      { key: 'status', label: 'الحالة', html: row => `<span class="badge ${row.status === 'نشط' ? 'badge-success' : row.status === 'مكتمل' ? 'badge-primary' : row.status === 'منتهي' ? 'badge-gray' : row.status === 'مجمد' ? 'badge-info' : 'badge-danger'}">${row.status}</span>` }
    ],
    rows,
    filters: [
      { name: 'status', label: 'الحالة', options: ['نشط', 'مكتمل', 'منتهي', 'مجمد', 'ملغي'].map(v => ({ value: v, label: v })) },
      { name: 'payment_method', label: 'طريقة الدفع', options: ['نقدي', 'تحويل بنكي', 'بطاقة', 'محفظة إلكترونية', 'شيك'].map(v => ({ value: v, label: v })) },
      { name: 'program_id', label: 'البرنامج', options: (await db.prepare('SELECT * FROM programs WHERE deleted_at IS NULL ORDER BY name').all()).map(p => ({ value: p.id, label: p.name })) }
    ],
    canAdd: canAdd(req.currentUser, 'subscriptions'), addUrl: canAdd(req.currentUser, 'subscriptions') ? '/subscriptions/new' : null, addLabel: 'اشتراك جديد',
    actions: () => row => {
      const acts = [
        { label: 'التفاصيل', icon: 'fa-eye', href: '/subscriptions/' + row.id },
        { label: 'السباح', icon: 'fa-person-swimming', href: '/swimmers/' + row.swimmer_id },
        { label: 'تعديل', icon: 'fa-pen', href: '/subscriptions/' + row.id + '/edit' }
      ];
      if (row.guardian_whatsapp) acts.push({ label: 'تذكير واتساب', icon: 'fa-whatsapp', iconPrefix: 'fab', href: '/subscriptions/' + row.id + '/whatsapp' });
      return acts;
    }
  };
  res.render('list', { page });
});

const subFields = async function (values) {
  return [
    { key: 'swimmer_id', label: 'السباح', type: 'select', options: await swimmerOptions(), required: true, section: 'بيانات الاشتراك', sectionIcon: 'fa-file-contract' },
    { key: 'program_id', label: 'البرنامج', type: 'select', options: await programOptions() },
    { key: 'group_id', label: 'المجموعة', type: 'select', options: await groupOptions() },
    { key: 'start_date', label: 'تاريخ البداية', type: 'date' },
    { key: 'end_date', label: 'تاريخ النهاية', type: 'date' },
    { key: 'sessions_total', label: 'إجمالي الحصص', type: 'number', number: true },
    { key: 'price', label: 'سعر الاشتراك (ج.م)', type: 'number', number: true, section: 'المبلغ', sectionIcon: 'fa-sack-dollar' },
    { key: 'discount', label: 'الخصم (ج.م)', type: 'number', number: true },
    { key: 'tax', label: 'الضريبة (% أو مبلغ)', type: 'number', number: true, hint: 'أدخل نسبة مثل 14 أو مبلغاً مباشراً' },
    { key: 'total', label: 'الإجمالي (يُحسب تلقائياً)', type: 'number', number: true },
    { key: 'paid_amount', label: 'المدفوع', type: 'number', number: true },
    { key: 'payment_method', label: 'طريقة الدفع', type: 'select', options: ['نقدي', 'تحويل بنكي', 'بطاقة', 'محفظة إلكترونية', 'شيك'].map(v => ({ value: v, label: v })) },
    { key: 'receipt_no', label: 'رقم الإيصال', type: 'text' },
    { key: 'paid_date', label: 'تاريخ الدفع', type: 'date' },
    { key: 'is_installment', label: 'تقسيط', type: 'checkbox', checkLabel: 'دفع على دفعات' },
    { key: 'status', label: 'الحالة', type: 'select', options: ['نشط', 'مكتمل', 'منتهي', 'مجمد', 'ملغي'].map(v => ({ value: v, label: v })) },
    { key: 'notes', label: 'ملاحظات', type: 'textarea', full: true }
  ];
};

router.get('/subscriptions/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'subscriptions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'اشتراك جديد', subtitle: 'تسجيل اشتراك سباح', icon: 'fa-plus', active: 'subscriptions', action: '/subscriptions/new', fields: await subFields({ total: 0, paid_amount: 0 }), values: {}, submitLabel: 'حفظ الاشتراك', cancelUrl: '/subscriptions', csrf: '' } });
});
router.post('/subscriptions/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'subscriptions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const total = b.total !== '' && b.total != null ? Number(b.total) : computeTotal(b.price, b.discount, b.tax);
  const paid = Number(b.paid_amount || 0);
  const remaining = Math.round((total - paid) * 100) / 100;
  const info = await db.prepare(`INSERT INTO subscriptions (swimmer_id, program_id, group_id, start_date, end_date, sessions_total, sessions_used, price, discount, tax, total, paid_amount, remaining, payment_method, receipt_no, paid_date, is_installment, status, notes, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.swimmer_id, b.program_id || null, b.group_id || null, b.start_date || today(), b.end_date || null, Number(b.sessions_total || 8), 0, Number(b.price || 0), Number(b.discount || 0), Number(b.tax || 0), total, paid, remaining, b.payment_method || 'نقدي', b.receipt_no || '', b.paid_date || today(), b.is_installment === '1' ? 1 : 0, b.status || 'نشط', b.notes || '', req.currentUser.id);
  await db.prepare('INSERT INTO subscription_history (subscription_id, swimmer_id, action, details, user_name) VALUES (?,?,?,?,?)').run(info.lastInsertRowid, b.swimmer_id, 'إنشاء', 'اشتراك جديد بإجمالي ' + money(total), req.currentUser.full_name);
  if (paid > 0) {
    await db.prepare('INSERT INTO payments (subscription_id, swimmer_id, amount, method, receipt_no, paid_date, staff_id, note) VALUES (?,?,?,?,?,?,?,?)')
      .run(info.lastInsertRowid, b.swimmer_id, paid, b.payment_method || 'نقدي', b.receipt_no || '', b.paid_date || today(), req.currentUser.id, 'دفعة الاشتراك');
    await db.prepare(`INSERT INTO revenues (category, date, description, amount, payment_method, payer, status, created_by) VALUES ('اشتراكات', ?, ?, ?, ?, ?, 'معتمد', ?)`)
      .run(b.paid_date || today(), 'اشتراك: ' + b.swimmer_id + ' - إيصال ' + (b.receipt_no || ''), paid, b.payment_method || 'نقدي', req.currentUser.id);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'subscriptions', info.lastInsertRowid, 'اشتراك جديد', req);
  setFlash(res, { type: 'success', message: 'تم تسجيل الاشتراك' });
  res.redirect('/subscriptions/' + info.lastInsertRowid);
});

router.get('/subscriptions/:id', async function (req, res) {
  if (!canView(req.currentUser, 'subscriptions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const s = await db.prepare(`SELECT sub.*, sw.full_name AS swimmer_name, sw.membership_no, p.name AS program_name, g.name AS group_name, gu.full_name AS guardian_name, gu.whatsapp AS guardian_whatsapp, gu.phone AS guardian_phone FROM subscriptions sub
    LEFT JOIN swimmers sw ON sw.id = sub.swimmer_id LEFT JOIN programs p ON p.id = sub.program_id LEFT JOIN groups g ON g.id = sub.group_id LEFT JOIN guardians gu ON gu.id = sw.guardian_id WHERE sub.id = ?`).get(id);
  if (!s) return res.redirect('/subscriptions');
  const payments = await db.prepare('SELECT * FROM payments WHERE subscription_id = ? ORDER BY paid_date').all(id);
  const history = await db.prepare('SELECT * FROM subscription_history WHERE subscription_id = ? ORDER BY created_at DESC').all(id);
  res.render('subscription_detail', { title: 'تفاصيل الاشتراك', active: 'subscriptions', s, payments, history, money,
    canEdit: canEdit(req.currentUser, 'subscriptions'), canAdd: canAdd(req.currentUser, 'payments') });
});
/* تذكير واتساب لتجديد الاشتراك: إرسال تلقائي عبر Cloud API إن كان مفعلاً، وإلا رابط wa.me برسالة جاهزة */
router.get('/subscriptions/:id/whatsapp', async function (req, res) {
  if (!canView(req.currentUser, 'subscriptions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const sub = await db.prepare(`SELECT sub.*, sw.full_name AS swimmer_name, g.full_name AS guardian_name, COALESCE(g.whatsapp, g.phone) AS phone
    FROM subscriptions sub JOIN swimmers sw ON sw.id = sub.swimmer_id LEFT JOIN guardians g ON g.id = sw.guardian_id WHERE sub.id = ?`).get(id);
  if (!sub) return res.redirect('/subscriptions');
  const phone = String(sub.phone || '').trim();
  if (!phone) {
    setFlash(res, { type: 'error', message: 'لا يوجد رقم واتساب/هاتف مسجل لولي الأمر' });
    return res.redirect('/subscriptions/' + id);
  }
  const text = buildRenewalMessage({ swimmerName: sub.swimmer_name, guardianName: sub.guardian_name, endDate: sub.end_date, academyName: res.locals.settings.site_name });
  const r = await sendReminder({ phone, text });
  await logMessage({ subscription_id: id, swimmer_id: sub.swimmer_id, swimmer_name: sub.swimmer_name, guardian_name: sub.guardian_name,
    phone, message: text, mode: r.mode, status: r.ok ? 'sent' : 'failed', trigger: 'manual', error: r.apiError || '', created_by: req.currentUser.id });
  audit(req.currentUser.id, req.currentUser.full_name, 'send', 'whatsapp', id, 'تذكير تجديد اشتراك (واتساب، ' + r.mode + ')' + (r.apiError ? ' — ' + r.apiError : ''), req);
  if (r.mode === 'link' && r.url) return res.redirect(r.url);
  setFlash(res, { type: 'success', message: 'تم إرسال تذكير الواتساب تلقائياً لولي الأمر' });
  res.redirect('/subscriptions/' + id);
});
router.get('/subscriptions/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'subscriptions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM subscriptions WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/subscriptions');
  res.render('form', { form: { title: 'تعديل الاشتراك', subtitle: 'تحديث بيانات الاشتراك', icon: 'fa-pen', active: 'subscriptions', action: '/subscriptions/' + row.id + '/edit', fields: await subFields(row), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/subscriptions/' + row.id, csrf: '' } });
});
router.post('/subscriptions/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'subscriptions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  const total = b.total !== '' && b.total != null ? Number(b.total) : computeTotal(b.price, b.discount, b.tax);
  const paid = Number(b.paid_amount || 0);
  const remaining = Math.round((total - paid) * 100) / 100;
  await db.prepare(`UPDATE subscriptions SET swimmer_id=?, program_id=?, group_id=?, start_date=?, end_date=?, sessions_total=?, price=?, discount=?, tax=?, total=?, paid_amount=?, remaining=?, payment_method=?, receipt_no=?, paid_date=?, is_installment=?, status=?, notes=? WHERE id=?`)
    .run(b.swimmer_id, b.program_id || null, b.group_id || null, b.start_date || today(), b.end_date || null, Number(b.sessions_total || 8), Number(b.price || 0), Number(b.discount || 0), Number(b.tax || 0), total, paid, remaining, b.payment_method || 'نقدي', b.receipt_no || '', b.paid_date || today(), b.is_installment === '1' ? 1 : 0, b.status || 'نشط', b.notes || '', id);
  await db.prepare('INSERT INTO subscription_history (subscription_id, swimmer_id, action, details, user_name) VALUES (?,?,?,?,?)').run(id, b.swimmer_id, 'تعديل', 'تحديث بيانات الاشتراك', req.currentUser.full_name);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'subscriptions', id, 'تعديل اشتراك', req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/subscriptions/' + id);
});
router.post('/subscriptions/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'subscriptions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  await db.prepare('DELETE FROM payments WHERE subscription_id=?').run(Number(req.params.id));
  await db.prepare('DELETE FROM subscription_history WHERE subscription_id=?').run(Number(req.params.id));
  await db.prepare('DELETE FROM subscriptions WHERE id=?').run(Number(req.params.id));
  res.redirect('/subscriptions');
});

/* ============================================================== */
/*                          المدفوعات                             */
/* ============================================================== */
router.get('/payments', async function (req, res) {
  if (!canView(req.currentUser, 'payments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT p.*, s.full_name AS swimmer_name, s.membership_no FROM payments p LEFT JOIN swimmers s ON s.id = p.swimmer_id ORDER BY p.paid_date DESC, p.id DESC`).all();
  const page = {
    title: 'المدفوعات', subtitle: 'دفعات الاشتراكات والرسوم', icon: 'fa-money-bill-wave', module: 'payments', active: 'payments',
    columns: [
      { key: 'swimmer_name', label: 'السباح', html: row => `<div class="avatar-cell"><div class="avatar-sm" style="background:linear-gradient(135deg,#10b981,#059669)">${(row.swimmer_name || 'س').trim().charAt(0)}</div><div><div class="cell-title">${row.swimmer_name || '—'}</div><div class="cell-sub">${row.membership_no || ''}</div></div></div>` },
      { key: 'paid_date', label: 'التاريخ', html: row => fmtDate(row.paid_date) },
      { key: 'amount', label: 'المبلغ', html: row => `<span class="fw-700 text-success">${money(row.amount)}</span>` },
      { key: 'method', label: 'الطريقة', html: row => `<span class="badge badge-primary">${row.method}</span>` },
      { key: 'receipt_no', label: 'رقم الإيصال' },
      { key: 'note', label: 'ملاحظة' }
    ],
    rows,
    filters: [{ name: 'method', label: 'طريقة الدفع', options: ['نقدي', 'تحويل بنكي', 'بطاقة', 'محفظة إلكترونية', 'شيك'].map(v => ({ value: v, label: v })) }],
    canAdd: canAdd(req.currentUser, 'payments'), addUrl: canAdd(req.currentUser, 'payments') ? '/payments/new' : null, addLabel: 'دفعة جديدة',
    actions: () => row => [
      { label: 'حذف', icon: 'fa-trash', href: '/payments/' + row.id + '/delete', confirm: 'حذف الدفعة؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});
router.get('/payments/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'payments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'دفعة جديدة', subtitle: 'تسجيل دفعة مالية', icon: 'fa-plus', active: 'payments', action: '/payments/new',
    fields: [
      { key: 'swimmer_id', label: 'السباح', type: 'select', options: await swimmerOptions(), required: true },
      { key: 'subscription_id', label: 'الاشتراك (اختياري)', type: 'select', options: (await db.prepare("SELECT * FROM subscriptions WHERE status='نشط' ORDER BY id DESC").all()).map(x => ({ value: x.id, label: '#' + x.id + ' — ' + x.swimmer_id })) },
      { key: 'amount', label: 'المبلغ (ج.م)', type: 'number', number: true, required: true },
      { key: 'method', label: 'طريقة الدفع', type: 'select', options: ['نقدي', 'تحويل بنكي', 'بطاقة', 'محفظة إلكترونية', 'شيك'].map(v => ({ value: v, label: v })) },
      { key: 'receipt_no', label: 'رقم الإيصال', type: 'text' },
      { key: 'paid_date', label: 'تاريخ الدفع', type: 'date' },
      { key: 'note', label: 'ملاحظة', type: 'textarea', full: true }
    ], values: { paid_date: today() }, submitLabel: 'تسجيل الدفعة', cancelUrl: '/payments', csrf: '' } });
});
router.post('/payments/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'payments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const amount = Number(b.amount || 0);
  const info = await db.prepare('INSERT INTO payments (subscription_id, swimmer_id, amount, method, receipt_no, paid_date, staff_id, note) VALUES (?,?,?,?,?,?,?,?)')
    .run(b.subscription_id || null, b.swimmer_id, amount, b.method || 'نقدي', b.receipt_no || '', b.paid_date || today(), req.currentUser.id, b.note || '');
  if (b.subscription_id) {
    await db.prepare('UPDATE subscriptions SET paid_amount = paid_amount + ?, remaining = total - (paid_amount + ?) WHERE id = ?').run(amount, amount, b.subscription_id);
    await db.prepare("UPDATE subscriptions SET status = CASE WHEN remaining <= 0 THEN 'مكتمل' ELSE status END WHERE id = ?").run(b.subscription_id);
    await db.prepare('INSERT INTO subscription_history (subscription_id, swimmer_id, action, details, user_name) VALUES (?,?,?,?,?)').run(b.subscription_id, b.swimmer_id, 'دفع', 'دفعة ' + money(amount), req.currentUser.full_name);
  }
  await db.prepare("INSERT INTO revenues (category, date, description, amount, payment_method, payer, status, created_by) VALUES ('اشتراكات', ?, ?, ?, ?, ?, 'معتمد', ?)")
    .run(b.paid_date || today(), 'دفعة ' + money(amount) + ' — ' + (b.receipt_no || ''), amount, b.method || 'نقدي', req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'payments', info.lastInsertRowid, 'دفعة ' + money(amount), req);
  setFlash(res, { type: 'success', message: 'تم تسجيل الدفعة' });
  res.redirect('/payments');
});
router.post('/payments/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'payments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  await db.prepare('DELETE FROM payments WHERE id=?').run(Number(req.params.id));
  res.redirect('/payments');
});

/* ============================================================== */
/*                          الإيرادات                             */
/* ============================================================== */
const REV_CATEGORIES = ['اشتراكات', 'رسوم اختبارات', 'بطولات', 'معسكرات', 'مبيعات', 'شهادات', 'أخرى'];
const revFields = async function (values) {
  return [
    { key: 'category', label: 'الفئة', type: 'select', options: REV_CATEGORIES.map(v => ({ value: v, label: v })), section: 'بيانات الإيراد', sectionIcon: 'fa-arrow-up-right-dots' },
    { key: 'date', label: 'التاريخ', type: 'date' },
    { key: 'description', label: 'الوصف', type: 'text', required: true },
    { key: 'amount', label: 'المبلغ (ج.م)', type: 'number', number: true, required: true },
    { key: 'payment_method', label: 'طريقة الدفع', type: 'select', options: ['نقدي', 'تحويل بنكي', 'بطاقة', 'محفظة إلكترونية', 'شيك'].map(v => ({ value: v, label: v })) },
    { key: 'payer', label: 'الاسم الدافع', type: 'text' },
    { key: 'branch_id', label: 'الفرع', type: 'select', options: (await db.prepare('SELECT * FROM branches').all()).map(b => ({ value: b.id, label: b.name })) },
    { key: 'transaction_no', label: 'رقم المعاملة', type: 'text' },
    { key: 'status', label: 'الحالة', type: 'select', options: [{ value: 'معتمد', label: 'معتمد' }, { value: 'معلق', label: 'معلق' }] },
    { key: 'notes', label: 'ملاحظات', type: 'textarea', full: true }
  ];
};

router.get('/revenues', async function (req, res) {
  if (!canView(req.currentUser, 'revenues')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT r.*, b.name AS branch_name FROM revenues r LEFT JOIN branches b ON b.id = r.branch_id ORDER BY r.date DESC, r.id DESC`).all();
  const total = rows.reduce((t, r) => t + Number(r.amount || 0), 0);
  const page = {
    title: 'الإيرادات', subtitle: 'كل الإيرادات الواردة للأكاديمية', icon: 'fa-arrow-up-right-dots', module: 'revenues', active: 'revenues',
    columns: [
      { key: 'date', label: 'التاريخ', html: row => fmtDate(row.date) },
      { key: 'category', label: 'الفئة', html: row => `<span class="badge badge-success">${row.category}</span>` },
      { key: 'description', label: 'الوصف' },
      { key: 'amount', label: 'المبلغ', html: row => `<span class="fw-700 text-success">${money(row.amount)}</span>` },
      { key: 'payment_method', label: 'الطريقة' },
      { key: 'payer', label: 'الدافع' },
      { key: 'status', label: 'الحالة', html: row => `<span class="badge ${row.status === 'معتمد' ? 'badge-success' : 'badge-warning'}">${row.status}</span>` }
    ],
    rows,
    filters: [{ name: 'category', label: 'الفئة', options: REV_CATEGORIES.map(v => ({ value: v, label: v })) }],
    canAdd: canAdd(req.currentUser, 'revenues'), addUrl: canAdd(req.currentUser, 'revenues') ? '/revenues/new' : null, addLabel: 'إيراد جديد',
    actions: () => row => [
      { label: 'تعديل', icon: 'fa-pen', href: '/revenues/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/revenues/' + row.id + '/delete', confirm: 'حذف الإيراد؟', cls: 'text-danger' }
    ],
    footer: `<div class="page-head" style="margin-top:8px"><div class="stat-card" style="min-width:280px"><div class="stat-label">إجمالي الإيرادات المعروضة</div><div class="stat-value text-success">${money(total)}</div></div></div>`
  };
  res.render('list', { page });
});
router.get('/revenues/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'revenues')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'إيراد جديد', subtitle: 'تسجيل إيراد مالي', icon: 'fa-plus', active: 'revenues', action: '/revenues/new', fields: await revFields({}), values: {}, submitLabel: 'تسجيل الإيراد', cancelUrl: '/revenues', csrf: '' } });
});
router.post('/revenues/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'revenues')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const info = await db.prepare('INSERT INTO revenues (category, date, description, amount, payment_method, payer, branch_id, transaction_no, status, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(b.category || 'أخرى', b.date || today(), b.description, Number(b.amount || 0), b.payment_method || 'نقدي', b.payer || '', b.branch_id || null, b.transaction_no || '', b.status || 'معتمد', b.notes || '', req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'revenues', info.lastInsertRowid, 'إيراد: ' + b.description, req);
  setFlash(res, { type: 'success', message: 'تم تسجيل الإيراد' });
  res.redirect('/revenues');
});
router.get('/revenues/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'revenues')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM revenues WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/revenues');
  res.render('form', { form: { title: 'تعديل الإيراد', subtitle: 'تحديث بيانات الإيراد', icon: 'fa-pen', active: 'revenues', action: '/revenues/' + row.id + '/edit', fields: await revFields(row), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/revenues', csrf: '' } });
});
router.post('/revenues/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'revenues')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  await db.prepare('UPDATE revenues SET category=?, date=?, description=?, amount=?, payment_method=?, payer=?, branch_id=?, transaction_no=?, status=?, notes=? WHERE id=?')
    .run(b.category || 'أخرى', b.date || today(), b.description, Number(b.amount || 0), b.payment_method || 'نقدي', b.payer || '', b.branch_id || null, b.transaction_no || '', b.status || 'معتمد', b.notes || '', id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'revenues', id, 'تعديل إيراد', req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/revenues');
});
router.post('/revenues/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'revenues')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  await db.prepare('DELETE FROM revenues WHERE id=?').run(Number(req.params.id));
  res.redirect('/revenues');
});

/* ============================================================== */
/*                          المصروفات                             */
/* ============================================================== */
const EXP_CATEGORIES = ['رواتب مدربين', 'إيجار', 'أدوات', 'صيانة', 'تسويق', 'انتقالات', 'بطولات', 'إدارية', 'أخرى'];
const expFields = async function (values) {
  return [
    { key: 'category', label: 'الفئة', type: 'select', options: EXP_CATEGORIES.map(v => ({ value: v, label: v })), section: 'بيانات المصروف', sectionIcon: 'fa-arrow-down-right-dots' },
    { key: 'date', label: 'التاريخ', type: 'date' },
    { key: 'description', label: 'الوصف', type: 'text', required: true },
    { key: 'amount', label: 'المبلغ (ج.م)', type: 'number', number: true, required: true },
    { key: 'payment_method', label: 'طريقة الدفع', type: 'select', options: ['نقدي', 'تحويل بنكي', 'بطاقة', 'محفظة إلكترونية', 'شيك'].map(v => ({ value: v, label: v })) },
    { key: 'beneficiary', label: 'المستفيد', type: 'text' },
    { key: 'branch_id', label: 'الفرع', type: 'select', options: (await db.prepare('SELECT * FROM branches').all()).map(b => ({ value: b.id, label: b.name })) },
    { key: 'transaction_no', label: 'رقم المعاملة', type: 'text' },
    { key: 'status', label: 'الحالة', type: 'select', options: [{ value: 'معتمد', label: 'معتمد' }, { value: 'معلق', label: 'معلق' }] },
    { key: 'notes', label: 'ملاحظات', type: 'textarea', full: true }
  ];
};

router.get('/expenses', async function (req, res) {
  if (!canView(req.currentUser, 'expenses')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT e.*, b.name AS branch_name FROM expenses e LEFT JOIN branches b ON b.id = e.branch_id ORDER BY e.date DESC, e.id DESC`).all();
  const total = rows.reduce((t, r) => t + Number(r.amount || 0), 0);
  const page = {
    title: 'المصروفات', subtitle: 'كل المصروفات الخارجية', icon: 'fa-arrow-down-right-dots', module: 'expenses', active: 'expenses',
    columns: [
      { key: 'date', label: 'التاريخ', html: row => fmtDate(row.date) },
      { key: 'category', label: 'الفئة', html: row => `<span class="badge badge-danger">${row.category}</span>` },
      { key: 'description', label: 'الوصف' },
      { key: 'amount', label: 'المبلغ', html: row => `<span class="fw-700 text-danger">${money(row.amount)}</span>` },
      { key: 'payment_method', label: 'الطريقة' },
      { key: 'beneficiary', label: 'المستفيد' },
      { key: 'status', label: 'الحالة', html: row => `<span class="badge ${row.status === 'معتمد' ? 'badge-success' : 'badge-warning'}">${row.status}</span>` }
    ],
    rows,
    filters: [{ name: 'category', label: 'الفئة', options: EXP_CATEGORIES.map(v => ({ value: v, label: v })) }],
    canAdd: canAdd(req.currentUser, 'expenses'), addUrl: canAdd(req.currentUser, 'expenses') ? '/expenses/new' : null, addLabel: 'مصروف جديد',
    actions: () => row => [
      { label: 'تعديل', icon: 'fa-pen', href: '/expenses/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/expenses/' + row.id + '/delete', confirm: 'حذف المصروف؟', cls: 'text-danger' }
    ],
    footer: `<div class="page-head" style="margin-top:8px"><div class="stat-card" style="min-width:280px"><div class="stat-label">إجمالي المصروفات المعروضة</div><div class="stat-value text-danger">${money(total)}</div></div></div>`
  };
  res.render('list', { page });
});
router.get('/expenses/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'expenses')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'مصروف جديد', subtitle: 'تسجيل مصروف مالي', icon: 'fa-plus', active: 'expenses', action: '/expenses/new', fields: await expFields({}), values: {}, submitLabel: 'تسجيل المصروف', cancelUrl: '/expenses', csrf: '' } });
});
router.post('/expenses/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'expenses')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const info = await db.prepare('INSERT INTO expenses (category, date, description, amount, payment_method, beneficiary, branch_id, transaction_no, status, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(b.category || 'أخرى', b.date || today(), b.description, Number(b.amount || 0), b.payment_method || 'نقدي', b.beneficiary || '', b.branch_id || null, b.transaction_no || '', b.status || 'معتمد', b.notes || '', req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'expenses', info.lastInsertRowid, 'مصروف: ' + b.description, req);
  setFlash(res, { type: 'success', message: 'تم تسجيل المصروف' });
  res.redirect('/expenses');
});
router.get('/expenses/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'expenses')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM expenses WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/expenses');
  res.render('form', { form: { title: 'تعديل المصروف', subtitle: 'تحديث بيانات المصروف', icon: 'fa-pen', active: 'expenses', action: '/expenses/' + row.id + '/edit', fields: await expFields(row), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/expenses', csrf: '' } });
});
router.post('/expenses/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'expenses')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  await db.prepare('UPDATE expenses SET category=?, date=?, description=?, amount=?, payment_method=?, beneficiary=?, branch_id=?, transaction_no=?, status=?, notes=? WHERE id=?')
    .run(b.category || 'أخرى', b.date || today(), b.description, Number(b.amount || 0), b.payment_method || 'نقدي', b.beneficiary || '', b.branch_id || null, b.transaction_no || '', b.status || 'معتمد', b.notes || '', id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'expenses', id, 'تعديل مصروف', req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/expenses');
});
router.post('/expenses/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'expenses')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  await db.prepare('DELETE FROM expenses WHERE id=?').run(Number(req.params.id));
  res.redirect('/expenses');
});

/* ============================================================== */
/*                      مستحقات المدربين                          */
/* ============================================================== */
router.get('/coach-payments', async function (req, res) {
  if (!canView(req.currentUser, 'coachPayments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT cp.*, c.full_name AS coach_name FROM coach_payments cp LEFT JOIN coaches c ON c.id = cp.coach_id ORDER BY cp.period DESC`).all();
  const page = {
    title: 'مستحقات المدربين', subtitle: 'إدارة رواتب ومستحقات المدربين', icon: 'fa-coins', module: 'coachPayments', active: 'coachPayments',
    columns: [
      { key: 'coach_name', label: 'الكابتن', html: row => `<b><i class="fas fa-user-tie text-primary"></i> ${row.coach_name || '—'}</b>` },
      { key: 'period', label: 'الفترة', html: row => `<span class="badge badge-primary">${row.period}</span>` },
      { key: 'amount_due', label: 'المستحق', html: row => money(row.amount_due) },
      { key: 'bonus', label: 'مكافأة', html: row => `<span class="text-success">+ ${money(row.bonus)}</span>` },
      { key: 'deduction', label: 'خصم', html: row => `<span class="text-danger">- ${money(row.deduction)}</span>` },
      { key: 'total', label: 'الصافي', html: row => `<span class="fw-700">${money(row.total)}</span>` },
      { key: 'paid_amount', label: 'المدفوع', html: row => `<span class="fw-700 text-success">${money(row.paid_amount)}</span>` },
      { key: 'remaining', label: 'المتبقي', html: row => row.remaining > 0 ? `<span class="fw-700 text-danger">${money(row.remaining)}</span>` : `<span class="badge badge-success">مسدد</span>` },
      { key: 'status', label: 'الحالة', html: row => `<span class="badge ${row.status === 'مسدد' ? 'badge-success' : row.status === 'مستحق' ? 'badge-danger' : 'badge-warning'}">${row.status}</span>` }
    ],
    rows,
    filters: [
      { name: 'status', label: 'الحالة', options: ['مستحق', 'مدفوع جزئياً', 'مسدد'].map(v => ({ value: v, label: v })) },
      { name: 'coach_id', label: 'الكابتن', options: (await db.prepare('SELECT id, full_name FROM coaches WHERE deleted_at IS NULL ORDER BY full_name').all()).map(c => ({ value: c.id, label: c.full_name })) }
    ],
    canAdd: canAdd(req.currentUser, 'coachPayments'), addUrl: canAdd(req.currentUser, 'coachPayments') ? '/coach-payments/new' : null, addLabel: 'استحقاق جديد',
    actions: () => row => [
      { label: 'تعديل', icon: 'fa-pen', href: '/coach-payments/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/coach-payments/' + row.id + '/delete', confirm: 'حذف الاستحقاق؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});
const cpFields = async function (values) {
  return [
    { key: 'coach_id', label: 'الكابتن', type: 'select', options: (await db.prepare('SELECT id, full_name FROM coaches WHERE deleted_at IS NULL ORDER BY full_name').all()).map(c => ({ value: c.id, label: c.full_name })), required: true, section: 'بيانات الاستحقاق', sectionIcon: 'fa-coins' },
    { key: 'period', label: 'الفترة', type: 'text', placeholder: '2026-01', required: true },
    { key: 'amount_due', label: 'المبلغ المستحق', type: 'number', number: true, section: 'الحساب', sectionIcon: 'fa-calculator' },
    { key: 'bonus', label: 'المكافأة', type: 'number', number: true },
    { key: 'deduction', label: 'الخصم', type: 'number', number: true },
    { key: 'total', label: 'الصافي', type: 'number', number: true },
    { key: 'paid_amount', label: 'المدفوع', type: 'number', number: true },
    { key: 'status', label: 'الحالة', type: 'select', options: ['مستحق', 'مدفوع جزئياً', 'مسدد'].map(v => ({ value: v, label: v })) },
    { key: 'paid_date', label: 'تاريخ الدفع', type: 'date' },
    { key: 'note', label: 'ملاحظات', type: 'textarea', full: true }
  ];
};
function cpCompute(b) {
  const due = Number(b.amount_due || 0);
  const bonus = Number(b.bonus || 0);
  const deduction = Number(b.deduction || 0);
  const total = b.total !== '' && b.total != null ? Number(b.total) : (due + bonus - deduction);
  const paid = Number(b.paid_amount || 0);
  return { total, paid, remaining: Math.round((total - paid) * 100) / 100 };
}
router.get('/coach-payments/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'coachPayments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'استحقاق جديد', subtitle: 'تسجيل مستحقات مدرب', icon: 'fa-plus', active: 'coachPayments', action: '/coach-payments/new', fields: await cpFields({}), values: {}, submitLabel: 'حفظ الاستحقاق', cancelUrl: '/coach-payments', csrf: '' } });
});
router.post('/coach-payments/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'coachPayments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const c = cpCompute(b);
  const info = await db.prepare('INSERT INTO coach_payments (coach_id, period, amount_due, bonus, deduction, total, paid_amount, remaining, status, paid_date, note) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(b.coach_id, b.period, Number(b.amount_due || 0), Number(b.bonus || 0), Number(b.deduction || 0), c.total, c.paid, c.remaining, c.remaining <= 0 ? 'مسدد' : (c.paid > 0 ? 'مدفوع جزئياً' : 'مستحق'), b.paid_date || null, b.note || '');
  if (c.paid > 0) {
    await db.prepare("INSERT INTO expenses (category, date, description, amount, payment_method, beneficiary, status, created_by) VALUES ('رواتب مدربين', ?, ?, ?, 'نقدي', ?, 'معتمد', ?)")
      .run(b.paid_date || today(), 'مستحقات: ' + b.period, c.paid, req.currentUser.id);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'coach_payments', info.lastInsertRowid, 'استحقاق مدرب', req);
  setFlash(res, { type: 'success', message: 'تم تسجيل الاستحقاق' });
  res.redirect('/coach-payments');
});
router.get('/coach-payments/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'coachPayments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM coach_payments WHERE id=?').get(Number(req.params.id));
  if (!row) return res.redirect('/coach-payments');
  res.render('form', { form: { title: 'تعديل الاستحقاق', subtitle: 'تحديث مستحقات المدرب', icon: 'fa-pen', active: 'coachPayments', action: '/coach-payments/' + row.id + '/edit', fields: await cpFields(row), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/coach-payments', csrf: '' } });
});
router.post('/coach-payments/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'coachPayments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  const c = cpCompute(b);
  await db.prepare('UPDATE coach_payments SET coach_id=?, period=?, amount_due=?, bonus=?, deduction=?, total=?, paid_amount=?, remaining=?, status=?, paid_date=?, note=? WHERE id=?')
    .run(b.coach_id, b.period, Number(b.amount_due || 0), Number(b.bonus || 0), Number(b.deduction || 0), c.total, c.paid, c.remaining, c.remaining <= 0 ? 'مسدد' : (c.paid > 0 ? 'مدفوع جزئياً' : 'مستحق'), b.paid_date || null, b.note || '', id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'coach_payments', id, 'تعديل استحقاق', req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/coach-payments');
});
router.post('/coach-payments/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'coachPayments')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  await db.prepare('DELETE FROM coach_payments WHERE id=?').run(Number(req.params.id));
  res.redirect('/coach-payments');
});

module.exports = router;
