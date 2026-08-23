/** الحصص والجداول + الحضور والغياب */
const express = require('express');
const { db } = require('../lib/db');
const { audit, money, fmtDate, fmtDateTime, dayAr, today, pct, parseJSON, canView, canAdd, canEdit, canDel } = require('../lib/helpers');
const router = express.Router();

const SES_STATUS = [
  { value: 'scheduled', label: 'مجدولة' },
  { value: 'completed', label: 'منفذة' },
  { value: 'cancelled', label: 'ملغاة' },
  { value: 'rescheduled', label: 'مؤجلة' }
];
const ATT_STATUS = [
  { value: 'present', label: 'حاضر' },
  { value: 'absent', label: 'غائب' },
  { value: 'excused', label: 'معتذر' },
  { value: 'late', label: 'متأخر' }
];

function sesStatusBadge(st) {
  const m = {
    'scheduled': ['badge-primary', 'حصة مجدولة'],
    'completed': ['badge-success', 'منفذة'],
    'cancelled': ['badge-danger', 'ملغاة'],
    'rescheduled': ['badge-warning', 'مؤجلة']
  };
  const r = m[st] || ['badge-gray', st];
  return `<span class="badge ${r[0]}">${r[1]}</span>`;
}

/* مزامنة أعضاء المجموعة من عمود group_id في السباحين */
function syncGroup(groupId) {
  if (!groupId) return;
  db.prepare('INSERT OR IGNORE INTO swimmer_group (swimmer_id, group_id) SELECT id, ? FROM swimmers WHERE group_id = ?').run(groupId, groupId);
  db.prepare('DELETE FROM swimmer_group WHERE group_id = ? AND swimmer_id NOT IN (SELECT id FROM swimmers WHERE group_id = ?)').run(groupId, groupId);
}

/* وقت بدء افتراضي للمجموعة من جدولها */
function groupStartTime(g) {
  if (!g) return '16:00';
  const sch = parseJSON(g.schedule, []);
  if (sch.length && sch[0] && sch[0].start) return sch[0].start;
  return '16:00';
}

/* ============================================================== */
/*                           الحصص والجداول                        */
/* ============================================================== */
router.get('/sessions', function (req, res) {
  if (!canView(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const { group, coach, status, q } = req.query;
  let sql = `SELECT se.*, g.name AS group_name, g.program_id, c.full_name AS coach_name, p.name AS pool_name,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = se.id) AS att_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = se.id AND a.status = 'present') AS present_count
    FROM sessions se
    LEFT JOIN groups g ON g.id = se.group_id
    LEFT JOIN coaches c ON c.id = se.coach_id
    LEFT JOIN pools p ON p.id = se.pool_id
    WHERE 1=1`;
  const params = [];
  if (group) { sql += ' AND se.group_id = ?'; params.push(group); }
  if (coach) { sql += ' AND se.coach_id = ?'; params.push(coach); }
  if (status) { sql += ' AND se.status = ?'; params.push(status); }
  if (q) { sql += ' AND (g.name LIKE ? OR se.title LIKE ?)'; const like = '%' + q + '%'; params.push(like, like); }
  sql += ' ORDER BY se.date DESC, se.start_time';
  const rows = db.prepare(sql).all(...params).map(function (r) {
    r.status_badge = sesStatusBadge(r.status);
    return r;
  });

  const page = {
    title: 'الحصص والجداول', subtitle: 'إدارة الحصص التدريبية ومواعيد المجموعات', icon: 'fa-calendar-days', module: 'sessions', active: 'sessions',
    columns: [
      { key: 'date', label: 'التاريخ', html: row => `<div><b>${fmtDate(row.date)}</b><div class="cell-sub">${row.start_time} — ${row.end_time || ''}</div></div>` },
      { key: 'group_name', label: 'المجموعة', html: row => `<div class="avatar-cell"><div class="avatar-sm" style="background:linear-gradient(135deg,#0ea5e9,#2563eb)">${(row.group_name || 'م').trim().charAt(0)}</div><div><div class="cell-title">${row.group_name || '—'}</div><div class="cell-sub">${row.pool_name || ''}</div></div></div>` },
      { key: 'coach_name', label: 'الكابتن' },
      { key: 'att_count', label: 'الحضور', html: row => `<span class="badge ${row.present_count === row.att_count && row.att_count > 0 ? 'badge-success' : 'badge-info'}">${row.present_count} / ${row.att_count}</span>` },
      { key: 'status', label: 'الحالة', html: row => row.status_badge }
    ],
    rows,
    filters: [
      { name: 'group_id', label: 'المجموعة', options: db.prepare('SELECT * FROM groups ORDER BY name').all().map(g => ({ value: g.id, label: g.name })) },
      { name: 'coach_id', label: 'الكابتن', options: db.prepare('SELECT * FROM coaches ORDER BY full_name').all().map(c => ({ value: c.id, label: c.full_name })) },
      { name: 'status', label: 'الحالة', options: SES_STATUS }
    ],
    canAdd: canAdd(req.currentUser, 'sessions'),
    addUrl: canAdd(req.currentUser, 'sessions') ? '/sessions/new' : null,
    addLabel: 'حصة جديدة',
    actions: () => row => [
      { label: 'الحضور', icon: 'fa-clipboard-user', href: '/attendance/session/' + row.id },
      { label: 'عرض', icon: 'fa-eye', href: '/sessions/' + row.id },
      { label: 'تعديل', icon: 'fa-pen', href: '/sessions/' + row.id + '/edit' },
      { label: 'حذف', icon: 'fa-trash', href: '/sessions/' + row.id + '/delete', confirm: 'هل أنت متأكد من حذف الحصة؟', cls: 'text-danger' }
    ]
  };
  res.render('list', { page });
});

const sessionFields = function (values) {
  const groups = db.prepare('SELECT * FROM groups').all().map(g => ({ value: g.id, label: g.name }));
  const coaches = db.prepare('SELECT * FROM coaches').all().map(c => ({ value: c.id, label: c.full_name }));
  const pools = db.prepare('SELECT * FROM pools').all().map(p => ({ value: p.id, label: p.name }));
  return [
    { key: 'group_id', label: 'المجموعة التدريبية', type: 'select', options: groups, required: true, section: 'بيانات الحصة', sectionIcon: 'fa-calendar-days' },
    { key: 'title', label: 'عنوان الحصة', type: 'text', hint: 'يُترك فارغاً لإنشائه تلقائياً' },
    { key: 'date', label: 'تاريخ الحصة', type: 'date', required: true },
    { key: 'start_time', label: 'وقت البداية', type: 'time', required: true },
    { key: 'end_time', label: 'وقت النهاية', type: 'time' },
    { key: 'coach_id', label: 'الكابتن', type: 'select', options: coaches },
    { key: 'pool_id', label: 'حمام السباحة', type: 'select', options: pools },
    { key: 'is_compensatory', label: 'حصة تعويضية', type: 'checkbox', checkLabel: 'حصة تعويضية عن حصة سابقة', full: true },
    { key: 'original_date', label: 'التاريخ الأصلي (للتعويضية)', type: 'date', full: true },
    { key: 'status', label: 'الحالة', type: 'select', options: SES_STATUS },
    { key: 'note', label: 'ملاحظات', type: 'textarea', full: true }
  ];
};

router.get('/sessions/new', function (req, res) {
  if (!canAdd(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('form', { form: { title: 'حصة جديدة', subtitle: 'جدولة حصة تدريبية', icon: 'fa-plus', active: 'sessions', action: '/sessions/new', fields: sessionFields({ date: today(), start_time: '16:00' }), values: {}, submitLabel: 'إنشاء الحصة', cancelUrl: '/sessions', csrf: '' } });
});
router.post('/sessions/new', function (req, res) {
  if (!canAdd(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(b.group_id || 0);
  const title = b.title || (group ? group.name + ' - ' + b.date : 'حصة تدريبية');
  const info = db.prepare('INSERT INTO sessions (group_id, title, date, start_time, end_time, coach_id, pool_id, status, is_compensatory, original_date, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(b.group_id || null, title, b.date, b.start_time || '16:00', b.end_time || null, b.coach_id || (group ? group.coach_id : null), b.pool_id || (group ? group.pool_id : null), b.status || 'scheduled', b.is_compensatory === '1' ? 1 : 0, b.original_date || null, b.note || '', req.currentUser.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'sessions', info.lastInsertRowid, 'حصة جديدة: ' + title, req);
  req.session.flash = { type: 'success', message: 'تم إنشاء الحصة' };
  res.redirect('/attendance/session/' + info.lastInsertRowid);
});

router.get('/sessions/:id', function (req, res) {
  if (!canView(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const s = db.prepare(`SELECT se.*, g.name AS group_name, c.full_name AS coach_name, p.name AS pool_name FROM sessions se
    LEFT JOIN groups g ON g.id = se.group_id LEFT JOIN coaches c ON c.id = se.coach_id LEFT JOIN pools p ON p.id = se.pool_id WHERE se.id = ?`).get(Number(req.params.id));
  if (!s) return res.redirect('/sessions');
  syncGroup(s.group_id);
  const members = db.prepare(`SELECT s.id, s.full_name, s.membership_no, a.status AS att_status, a.reason, a.coach_note FROM swimmer_group sg
    JOIN swimmers s ON s.id = sg.swimmer_id LEFT JOIN attendance a ON a.session_id = ? AND a.swimmer_id = s.id
    WHERE sg.group_id = ? ORDER BY s.full_name`).all(s.group_id, s.group_id);
  res.render('session_detail', {
    title: 'تفاصيل الحصة', active: 'sessions',
    s, members,
    attMap: ATT_STATUS,
    page: { canEdit: canEdit(req.currentUser, 'sessions'), canDel: canDel(req.currentUser, 'sessions') }
  });
});

router.get('/sessions/:id/edit', function (req, res) {
  if (!canEdit(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.redirect('/sessions');
  res.render('form', { form: { title: 'تعديل الحصة', subtitle: fmtDate(row.date) + ' — ' + (row.title || ''), icon: 'fa-pen', active: 'sessions', action: '/sessions/' + row.id + '/edit', fields: sessionFields(row), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/sessions/' + row.id, csrf: '' } });
});
router.post('/sessions/:id/edit', function (req, res) {
  if (!canEdit(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(b.group_id || 0);
  const title = b.title || (group ? group.name + ' - ' + b.date : 'حصة تدريبية');
  db.prepare('UPDATE sessions SET group_id=?, title=?, date=?, start_time=?, end_time=?, coach_id=?, pool_id=?, status=?, is_compensatory=?, original_date=?, note=? WHERE id=?')
    .run(b.group_id || null, title, b.date, b.start_time || '16:00', b.end_time || null, b.coach_id || (group ? group.coach_id : null), b.pool_id || (group ? group.pool_id : null), b.status || 'scheduled', b.is_compensatory === '1' ? 1 : 0, b.original_date || null, b.note || '', id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'sessions', id, 'تعديل حصة', req);
  req.session.flash = { type: 'success', message: 'تم حفظ التعديلات' };
  res.redirect('/sessions/' + id);
});
router.post('/sessions/:id/delete', function (req, res) {
  if (!canDel(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  db.prepare('DELETE FROM attendance WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'sessions', id, 'حذف حصة', req);
  req.session.flash = { type: 'success', message: 'تم حذف الحصة' };
  res.redirect('/sessions');
});

/* ============================================================== */
/*                       الحضور والغياب                            */
/* ============================================================== */
router.get('/attendance', function (req, res) {
  if (!canView(req.currentUser, 'attendance')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  const date = req.query.date || today();
  const groupRows = db.prepare(`SELECT g.*, c.full_name AS coach_name, p.name AS pool_name FROM groups g
    LEFT JOIN coaches c ON c.id = g.coach_id LEFT JOIN pools p ON p.id = g.pool_id ORDER BY g.name`).all();
  const groups = groupRows.map(function (g) {
    syncGroup(g.id);
    const members = db.prepare(`SELECT s.id, s.full_name, s.membership_no FROM swimmer_group sg JOIN swimmers s ON s.id = sg.swimmer_id WHERE sg.group_id = ? ORDER BY s.full_name`).all(g.id);
    const session = db.prepare(`SELECT * FROM sessions WHERE group_id = ? AND date = ? ORDER BY start_time LIMIT 1`).get(g.id, date);
    const attMap = {};
    if (session) db.prepare('SELECT swimmer_id, status FROM attendance WHERE session_id = ?').all(session.id).forEach(function (a) { attMap[a.swimmer_id] = a.status; });
    return { ...g, members, session, attMap };
  });
  const daily = {
    present: db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.date=? AND a.status='present'`).get(date).c,
    absent: db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.date=? AND a.status='absent'`).get(date).c,
    excused: db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.date=? AND a.status='excused'`).get(date).c,
    late: db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.date=? AND a.status='late'`).get(date).c
  };
  res.render('attendance', { title: 'الحضور والغياب', active: 'attendance', groups, daily, date, today: today(), canSave: canEdit(req.currentUser, 'attendance') || canAdd(req.currentUser, 'attendance'),
    yday: addDays(today(), -1), dyday: addDays(today(), -2), tomorrow: addDays(today(), 1), isPast: date < today() });
});

router.get('/attendance/session/:id', function (req, res) {
  if (!canView(req.currentUser, 'attendance')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const s = db.prepare(`SELECT se.*, g.name AS group_name, c.full_name AS coach_name, p.name AS pool_name FROM sessions se
    LEFT JOIN groups g ON g.id = se.group_id LEFT JOIN coaches c ON c.id = se.coach_id LEFT JOIN pools p ON p.id = se.pool_id WHERE se.id = ?`).get(id);
  if (!s) return res.redirect('/attendance');
  syncGroup(s.group_id);
  const members = db.prepare(`SELECT s.id, s.full_name, s.membership_no, s.birth_date, a.status AS att_status, a.reason, a.coach_note, a.id AS att_id FROM swimmer_group sg
    JOIN swimmers s ON s.id = sg.swimmer_id LEFT JOIN attendance a ON a.session_id = ? AND a.swimmer_id = s.id
    WHERE sg.group_id = ? ORDER BY s.full_name`).all(id, s.group_id);
  res.render('attendance_session', {
    title: 'تسجيل الحضور', active: 'attendance',
    s, members, date: today(), money,
    canSave: canEdit(req.currentUser, 'attendance') || canAdd(req.currentUser, 'attendance')
  });
});

/* حفظ حضور فردي (JSON) */
router.post('/attendance/save', function (req, res) {
  if (!canEdit(req.currentUser, 'attendance') && !canAdd(req.currentUser, 'attendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const { session_id, swimmer_id, status, reason, coach_note } = req.body;
  if (!session_id || !swimmer_id) return res.status(400).json({ ok: false, error: 'بيانات ناقصة' });
  db.prepare(`INSERT INTO attendance (session_id, swimmer_id, status, reason, coach_note) VALUES (?,?,?,?,?)
    ON CONFLICT(session_id, swimmer_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, coach_note=excluded.coach_note`)
    .run(session_id, swimmer_id, status || 'present', reason || '', coach_note || '');
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'attendance', session_id, 'تحديث حضور سباح #' + swimmer_id, req);
  res.json({ ok: true });
});

/* حفظ حضور مجموعة كاملة (JSON) */
router.post('/attendance/mark-all', function (req, res) {
  if (!canEdit(req.currentUser, 'attendance') && !canAdd(req.currentUser, 'attendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const { session_id, status } = req.body;
  const s = db.prepare('SELECT group_id FROM sessions WHERE id = ?').get(session_id || 0);
  if (!s) return res.status(400).json({ ok: false, error: 'الحصة غير موجودة' });
  syncGroup(s.group_id);
  const members = db.prepare('SELECT swimmer_id FROM swimmer_group WHERE group_id = ?').all(s.group_id);
  const st = db.prepare(`INSERT INTO attendance (session_id, swimmer_id, status) VALUES (?,?,?)
    ON CONFLICT(session_id, swimmer_id) DO UPDATE SET status=excluded.status`);
  for (const m of members) st.run(session_id, m.swimmer_id, status || 'present');
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'attendance', session_id, 'حضور جماعي: ' + status, req);
  res.json({ ok: true, count: members.length });
});

/* حفظ حضور مجموعة كاملة من صفحة الحضور والغياب (تنشئ الحصة تلقائياً إن لم توجد) */
router.post('/attendance/group-save', function (req, res) {
  if (!canEdit(req.currentUser, 'attendance') && !canAdd(req.currentUser, 'attendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const gid = Number(req.body.group_id || 0);
  const d = req.body.date || today();
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  if (!group) return res.status(400).json({ ok: false, error: 'المجموعة غير موجودة' });
  let session = db.prepare('SELECT * FROM sessions WHERE group_id = ? AND date = ? ORDER BY start_time LIMIT 1').get(gid, d);
  if (!session) {
    const info = db.prepare(`INSERT INTO sessions (group_id, title, date, start_time, end_time, coach_id, pool_id, status, is_compensatory, note) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(gid, group.name + ' - ' + d, d, groupStartTime(group), null, group.coach_id, group.pool_id, 'scheduled', 0, 'أُنشئت تلقائياً من شاشة الحضور');
    session = { id: info.lastInsertRowid };
  }
  syncGroup(gid);
  const statuses = req.body.statuses || {};
  const st = db.prepare(`INSERT INTO attendance (session_id, swimmer_id, status, reason, coach_note) VALUES (?,?,?,?,?)
    ON CONFLICT(session_id, swimmer_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, coach_note=excluded.coach_note`);
  let n = 0;
  for (const sid of Object.keys(statuses)) {
    const id = Number(sid);
    if (!id) continue;
    st.run(session.id, id, statuses[sid] || 'present', '', '');
    n++;
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'attendance', session.id, 'حضور مجموعة #' + gid + ' (' + n + ' سباح)', req);
  res.json({ ok: true, count: n });
});

module.exports = router;
