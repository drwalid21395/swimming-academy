/** الحصص والجداول + الحضور والغياب */
const express = require('express');
const { db } = require('../lib/db');
const { audit, money, fmtDate, fmtDateTime, dayAr, today, pct, parseJSON, canView, canAdd, canEdit, canDel, canExport } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const { activeSport, sportClause, groupClause, sessionClause } = require('../lib/sport-context');
const { ensureGroupSession, ensureDateTimeSession, swimmerTimeClash } = require('../lib/attendance');
const { overlaps, validateRange, normalizeTime, toMinutes } = require('../lib/attendance-time');
const pdfmake = require('../lib/pdf');

function attendanceCounts(status) {
  return status === 'present' || status === 'late';
}

/* حالة اشتراك اللاعب (تاريخ الانتهاء ولونه) لعرضه بجوار الاسم في الحضور */
function subBadge(end) {
  if (!end) return null;
  const d = String(end).slice(0, 10);
  const days = Math.round((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000);
  if (isNaN(days)) return null;
  return { date: d, days: days, state: days < 0 ? 'expired' : (days <= 7 ? 'soon' : 'active') };
}

async function syncSubscriptionUsage(swimmerId, groupId, beforeStatus, afterStatus) {
  const before = attendanceCounts(beforeStatus);
  const after = attendanceCounts(afterStatus);
  if (before === after) return;
  const delta = after ? 1 : -1;
  /* اختيار الاشتراك الأنسب للخصم: تطابق المجموعة أولاً ثم البرنامج، مع تفضيل الاشتراك اللي عنده حصص متبقية */
  const gid = Number(groupId) || 0;
  const sub = await db.prepare(`SELECT sub.id FROM subscriptions sub
    LEFT JOIN groups g ON g.id = ?
    WHERE sub.swimmer_id = ? AND sub.status = 'نشط'
      AND (sub.group_id = ? OR (sub.group_id IS NULL AND sub.program_id = g.program_id))
    ORDER BY
      CASE WHEN sub.group_id = ? THEN 0 ELSE 1 END,
      CASE WHEN sub.sessions_total > sub.sessions_used THEN 0 ELSE 1 END,
      sub.id DESC
    LIMIT 1`).get(gid, Number(swimmerId), gid, gid);
  if (!sub) return;
  await db.prepare(`UPDATE subscriptions SET sessions_used = MIN(sessions_total, MAX(0, sessions_used + ?)) WHERE id = ?`)
    .run(delta, sub.id);
  /* تحديث فوري لحالة الاشتراك بحسب استهلاك الحصص */
  await db.prepare(`UPDATE subscriptions SET status = 'منتهي'
    WHERE id = ? AND status = 'نشط' AND sessions_total > 0 AND sessions_used >= sessions_total`).run(sub.id);
  await db.prepare(`UPDATE subscriptions SET status = 'نشط'
    WHERE id = ? AND status = 'منتهي' AND (end_date IS NULL OR date(end_date) >= date(?))
      AND (sessions_total = 0 OR sessions_used < sessions_total)`).run(sub.id, today());
}
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

/* مزامنة أعضاء المجموعة: من عمود group_id الأساسي + من الاشتراكات النشطة في نفس المجموعة */
async function syncGroup(groupId) {
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

/* وقت بدء افتراضي للمجموعة من جدولها */
function groupStartTime(g) {
  if (!g) return '16:00';
  const sch = parseJSON(g.schedule, []);
  if (sch.length && sch[0] && sch[0].start) return sch[0].start;
  return '16:00';
}

/* مجموعات الحصة (Primary + إضافية) */
function parseGroupIds(value) {
  if (value === 'all') return [];
  if (Array.isArray(value)) return value.map(Number).filter(id => id > 0);
  if (value) {
    const n = Number(value);
    return n > 0 ? [n] : [];
  }
  return [];
}

async function sessionGroupIds(sessionId) {
  const rows = await db.prepare('SELECT group_id FROM session_groups WHERE session_id = ?').all(sessionId);
  if (rows.length) return rows.map(r => r.group_id);
  const s = await db.prepare('SELECT group_id FROM sessions WHERE id = ?').get(sessionId);
  return s && s.group_id ? [s.group_id] : [];
}

/* المجموعة المناسبة لكل لاعب داخل الحصة (لخصم الاشتراك) */
async function sessionGroupForSwimmer(sessionId, swimmerId) {
  const rows = await db.prepare(`SELECT group_id FROM session_groups WHERE session_id = ? AND group_id IN (SELECT group_id FROM swimmer_group WHERE swimmer_id = ?) ORDER BY group_id LIMIT 1`).all(sessionId, swimmerId);
  if (rows.length) return rows[0].group_id;
  const s = await db.prepare('SELECT group_id FROM sessions WHERE id = ?').get(sessionId);
  return s && s.group_id;
}

/* مزامنة أعضاء عدة مجموعات: دفعة واحدة بنفس ترتيب المجموعات (إدراج ثم تنظيف لكل مجموعة) */
async function syncGroups(groupIds) {
  const ids = Array.from(new Set((groupIds || []).map(Number).filter(id => id > 0)));
  if (!ids.length) return;
  const stmts = [];
  ids.forEach(function (gid) {
    stmts.push(
      { sql: 'INSERT OR IGNORE INTO swimmer_group (swimmer_id, group_id) SELECT id, ? FROM swimmers WHERE group_id = ? AND deleted_at IS NULL', args: [gid, gid] },
      { sql: 'INSERT OR IGNORE INTO swimmer_group (swimmer_id, group_id) SELECT DISTINCT swimmer_id, ? FROM subscriptions WHERE group_id = ? AND status = \'نشط\'', args: [gid, gid] },
      { sql: 'DELETE FROM swimmer_group WHERE group_id = ? AND swimmer_id NOT IN (SELECT id FROM swimmers WHERE group_id = ? AND deleted_at IS NULL UNION SELECT DISTINCT swimmer_id FROM subscriptions WHERE group_id = ? AND status = \'نشط\')', args: [gid, gid, gid] }
    );
  });
  await db.batch(stmts, 'write');
}

/* صلاحية تحميل تقرير الحصة: عرض (حصص أو حضور) + تصدير (أي من الوحدات المرتبطة) */
function canExportSession(user) {
  const canSee = canView(user, 'sessions') || canView(user, 'attendance');
  const canDownload = canExport(user, 'sessions') || canExport(user, 'attendance') || canExport(user, 'reports');
  return !!(canSee && canDownload);
}

const ATT_LABEL = ATT_STATUS.reduce(function (m, s) { m[s.value] = s.label; return m; }, {});

/* بيانات حصة واحدة مجمّعة حسب المجموعات — تُستخدم للعرض ولملفي PDF/Excel */
async function sessionReportData(sessionId, req) {
  const id = Number(sessionId);
  const s = await db.prepare(`SELECT se.*, g.name AS group_name, c.full_name AS coach_name, p.name AS pool_name FROM sessions se
    LEFT JOIN groups g ON g.id = se.group_id LEFT JOIN coaches c ON c.id = se.coach_id LEFT JOIN pools p ON p.id = se.pool_id
    WHERE se.id = ? AND se.deleted_at IS NULL` + sessionClause(activeSport(req), 'se')).get(id);
  if (!s) return null;

  /* كل الحصص المتوافقة في نفس اليوم والتوقيت تُعرض كمجموعات داخل حصة واحدة */
  const siblings = await db.prepare(`SELECT se.id FROM sessions se
    WHERE se.date = ? AND se.start_time = ? AND se.deleted_at IS NULL` +
    sessionClause(activeSport(req), 'se') + ` ORDER BY se.id`).all(s.date, s.start_time);
  const sessionIds = siblings.map(function (x) { return Number(x.id); });
  if (!sessionIds.length) sessionIds.push(id);
  const siblingGroups = await Promise.all(sessionIds.map(function (sid) { return sessionGroupIds(sid); }));
  const groupIds = Array.from(new Set(siblingGroups.reduce(function (all, arr) { return all.concat(arr); }, [])));
  await syncGroups(groupIds);
  const placeholders = groupIds.length ? groupIds.map(function () { return '?'; }).join(',') : '0';
  const sPlace = sessionIds.map(function () { return '?'; }).join(',');
  const [groupRows, memberRows, attRows] = await Promise.all([
    groupIds.length ? db.prepare('SELECT id, name FROM groups WHERE id IN (' + placeholders + ') ORDER BY name, id').all(...groupIds) : Promise.resolve([]),
    groupIds.length ? db.prepare(`SELECT sg.group_id, sw.id, sw.full_name, sw.membership_no
      FROM swimmer_group sg JOIN swimmers sw ON sw.id = sg.swimmer_id
      WHERE sg.group_id IN (` + placeholders + `)
      ORDER BY sw.full_name, sw.id`).all(...groupIds) : Promise.resolve([]),
    db.prepare('SELECT swimmer_id, session_id, status, reason, coach_note FROM attendance WHERE session_id IN (' + sPlace + ')').all(...sessionIds)
  ]);
  const attMap = {};
  attRows.forEach(function (a) { attMap[String(a.swimmer_id)] = a; });
  memberRows.forEach(function (m) {
    const a = attMap[String(m.id)];
    m.att_status = a ? a.status : null;
    m.reason = a ? a.reason : '';
    m.coach_note = a ? a.coach_note : '';
    m.att_session_id = a ? a.session_id : s.id;
  });
  const membersByGroup = {};
  memberRows.forEach(function (m) {
    (membersByGroup[String(m.group_id)] = membersByGroup[String(m.group_id)] || []).push(m);
  });
  const groups = groupRows.map(function (g) {
    return { id: g.id, name: g.name, members: membersByGroup[String(g.id)] || [] };
  });
  return { s, groups, groupNames: groupRows.map(function (g) { return g.name; }) };
}

/* ---------- تصدير حصة واحدة: PDF + Excel ---------- */
function sessionPdfDoc(data) {
  const s = data.s;
  const content = [
    { text: 'تقرير الحضور والغياب — حصة تدريبية', style: 'reportTitle' },
    { text: fmtDate(s.date) + '  ·  ' + s.start_time + ' — ' + (s.end_time || '—'), style: 'meta' },
    { text: 'المجموعات: ' + ((data.groupNames.length ? data.groupNames : [s.group_name]).filter(Boolean).join('، ') || '—'), style: 'meta2' },
    { text: 'الكابتن: ' + (s.coach_name || '—') + '   ·   الحمام: ' + (s.pool_name || '—'), style: 'meta2' }
  ];
  data.groups.forEach(function (g) {
    const rows = [[
      { text: 'اللاعب', style: 'th' }, { text: 'رقم العضوية', style: 'th' },
      { text: 'الحالة', style: 'th' }, { text: 'ملاحظة', style: 'th' }
    ]];
    g.members.forEach(function (m) {
      rows.push([
        { text: m.full_name || '—', style: 'td' },
        { text: m.membership_no || '—', style: 'td' },
        { text: ATT_LABEL[m.att_status] || '—', style: 'td' },
        { text: m.coach_note || m.reason || '—', style: 'td' }
      ]);
    });
    content.push({ text: g.name, style: 'sectionTitle', margin: [0, 12, 0, 4] });
    content.push({
      table: { headerRows: 1, widths: ['*', 'auto', 'auto', '*'], body: rows },
      layout: 'lightHorizontalLines'
    });
  });
  if (!data.groups.length) content.push({ text: 'لا توجد مجموعات مرتبطة بهذه الحصة', style: 'meta2', margin: [0, 12, 0, 0] });
  return {
    content: content,
    defaultStyle: { font: 'Tahoma', fontSize: 9.5, color: '#111827', alignment: 'right' },
    styles: {
      reportTitle: { fontSize: 16, bold: true, color: '#0284c7', alignment: 'center', margin: [0, 0, 0, 4] },
      meta: { fontSize: 10, color: '#334155', alignment: 'center', margin: [0, 0, 0, 2] },
      meta2: { fontSize: 9, color: '#6b7280', alignment: 'center' },
      sectionTitle: { fontSize: 12, bold: true, color: '#0f172a' },
      th: { bold: true, fontSize: 9.5, color: '#ffffff', fillColor: '#0284c7', alignment: 'center', margin: [2, 3, 2, 3] },
      td: { fontSize: 9, alignment: 'right', margin: [1, 2, 1, 2] }
    }
  };
}

function xEsc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function xCell(v, style) {
  return '<td' + (style ? ' style="' + style + '"' : '') + '>' + (v === null || v === undefined || v === '' ? '—' : xEsc(v)) + '</td>';
}
function xlsWorkbook(sheetsHtml, opts) {
  opts = opts || {};
  let sheetsXml = '';
  sheetsHtml.forEach(function (sh, i) {
    sheetsXml += '<x:ExcelWorksheet><x:Name>' + xEsc(sh.name || ('Sheet' + (i + 1))) + '</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet>';
  });
  let body = opts.body || '';
  sheetsHtml.forEach(function (sh) { body += sh.html; });
  return '\uFEFF' + '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">'
    + '<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>' + sheetsXml + '</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->'
    + '<style>table{border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #999;padding:4px 7px;font-size:12px;font-family:Tahoma,Arial,sans-serif;vertical-align:top}th{background:#e8eef7;font-weight:700}h2,h3{font-family:Tahoma,Arial,sans-serif}</style></head>'
    + '<body dir="rtl">' + body + '</body></html>';
}
function sessionXlsHtml(data) {
  const s = data.s;
  const meta = '<table dir="rtl" style="width:760px;margin-bottom:10px">'
    + '<tr><th>التاريخ</th><td>' + xEsc(fmtDate(s.date)) + '</td><th>الوقت</th><td dir="ltr">' + xEsc(s.start_time + ' — ' + (s.end_time || '—')) + '</td></tr>'
    + '<tr><th>المجموعات</th><td colspan="3">' + xEsc((data.groupNames.length ? data.groupNames : [s.group_name]).filter(Boolean).join('، ') || '—') + '</td></tr>'
    + '<tr><th>الكابتن</th><td>' + xEsc(s.coach_name || '—') + '</td><th>الحمام</th><td>' + xEsc(s.pool_name || '—') + '</td></tr>'
    + '</table>';
  let html = '<h2 style="text-align:center">تقرير الحضور والغياب — حصة تدريبية</h2>' + meta;
  data.groups.forEach(function (g) {
    html += '<h3>' + xEsc(g.name) + ' (' + g.members.length + ' لاعب)</h3>'
      + '<table dir="rtl" style="width:760px"><thead><tr><th>اللاعب</th><th>رقم العضوية</th><th>الحالة</th><th>ملاحظة</th></tr></thead><tbody>';
    g.members.forEach(function (m) {
      html += '<tr>' + xCell(m.full_name) + xCell(m.membership_no)
        + xCell(ATT_LABEL[m.att_status] || '—', 'text-align:center')
        + xCell(m.coach_note || m.reason) + '</tr>';
    });
    if (!g.members.length) html += '<tr><td colspan="4">لا يوجد لاعبون</td></tr>';
    html += '</tbody></table><br/>';
  });
  if (!data.groups.length) html += '<p>لا توجد مجموعات مرتبطة بهذه الحصة</p>';
  return html;
}

/* ============================================================== */
/*                           الحصص والجداول                        */
/* ============================================================== */
router.get('/sessions', async function (req, res) {
  if (!canView(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const { group, coach, status, q } = req.query;
  let sql = `SELECT se.*, g.name AS group_name, g.program_id, c.full_name AS coach_name, p.name AS pool_name,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = se.id AND a.status IN ('present','late')) AS present_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = se.id AND a.status IN ('absent','excused')) AS absent_count
    FROM sessions se
    LEFT JOIN groups g ON g.id = se.group_id
    LEFT JOIN coaches c ON c.id = se.coach_id
    LEFT JOIN pools p ON p.id = se.pool_id
    WHERE 1=1 AND se.deleted_at IS NULL` + sessionClause(activeSport(req), 'se');
  const params = [];
  if (group) { sql += ' AND (se.group_id = ? OR EXISTS (SELECT 1 FROM session_groups sg WHERE sg.session_id = se.id AND sg.group_id = ?))'; params.push(group, group); }
  if (coach) { sql += ' AND se.coach_id = ?'; params.push(coach); }
  if (status) { sql += ' AND se.status = ?'; params.push(status); }
  if (q) { sql += ' AND (g.name LIKE ? OR se.title LIKE ?)'; const like = '%' + q + '%'; params.push(like, like); }
  sql += ' ORDER BY se.date DESC, se.start_time';
  const rowRows = await db.prepare(sql).all(...params);
  /* حصة واحدة لكل تاريخ+توقيت: تُجمع الحصص المسجّلة لمجموعات مختلفة في صف واحد */
  const buckets = new Map();
  rowRows.forEach(function (r) {
    const key = String(r.date || '') + '|' + String(r.start_time || '');
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { ...r, present_count: 0, absent_count: 0 };
      buckets.set(key, bucket);
    }
    bucket.present_count += Number(r.present_count) || 0;
    bucket.absent_count += Number(r.absent_count) || 0;
  });
  const merged = Array.from(buckets.values()).sort(function (a, b) {
    return String(b.date || '').localeCompare(String(a.date || ''))
      || String(a.start_time || '').localeCompare(String(b.start_time || ''))
      || Number(a.id) - Number(b.id);
  });
  const rows = merged.map(function (r, idx) {
    r.serial = idx + 1;
    return r;
  });
  /* فلاتر client-side سريعة تتيح فتح أي حصة مسجّلة بتاريخ ووقت محددين */
  const dateOptions = Array.from(new Set(rows.map(function (r) { return String(r.date || '').slice(0, 10); }).filter(Boolean)))
    .sort().reverse().map(function (d) { return { value: d, label: fmtDate(d) }; });
  const timeOptions = Array.from(new Set(rows.map(function (r) { return r.start_time; }).filter(Boolean)))
    .sort().map(function (t) { return { value: t, label: t }; });
  const page = {
    title: 'الحصص والجداول', subtitle: 'كل حصة تسجّل بتاريخها ووقتها — اضغط على التمرين لعرض المجموعات واللاعبين وحالتهم', icon: 'fa-calendar-days', module: 'sessions', active: 'sessions',
    tabs: true, activeTab: 'sessions',
    columns: [
      { key: 'serial', label: 'المسلسل', html: row => `<span class="text-soft">${row.serial}</span>` },
      { key: 'date', label: 'تاريخ التمرين', html: row => `<a href="/sessions/${row.id}" class="cell-title" style="color:var(--primary)">${fmtDate(row.date)}</a>` },
      { key: 'start_time', label: 'توقيت التمرين', html: row => `<a href="/sessions/${row.id}" class="cell-title" style="color:var(--primary)" dir="ltr">${row.start_time} — ${row.end_time || ''}</a>` },
      { key: 'present_count', label: 'عدد الحضور', html: row => `<span class="badge badge-success">${row.present_count}</span>` },
      { key: 'absent_count', label: 'عدد الغياب', html: row => `<span class="badge badge-danger">${row.absent_count}</span>` }
    ],
    rows,
    filters: [
      { name: 'date', label: 'التاريخ', options: dateOptions },
      { name: 'start_time', label: 'وقت التمرين', options: timeOptions }
    ],
    canAdd: canAdd(req.currentUser, 'sessions'),
    addUrl: canAdd(req.currentUser, 'sessions') ? '/sessions/new' : null,
    addLabel: 'حصة جديدة'
  };
  res.render('list', { page });
});

const sessionFields = async function (values, req) {
  const sid = activeSport(req);
  const groups = (await db.prepare('SELECT * FROM groups WHERE deleted_at IS NULL' + groupClause(sid)).all()).map(g => ({ value: g.id, label: g.name }));
  const coaches = (await db.prepare('SELECT * FROM coaches WHERE deleted_at IS NULL' + sportClause(sid, 'coaches')).all()).map(c => ({ value: c.id, label: c.full_name }));
  const pools = (await db.prepare('SELECT * FROM pools').all()).map(p => ({ value: p.id, label: p.name }));
  const selectedGroupIds = Array.isArray(values.group_ids) ? values.group_ids.map(String) : (values.group_ids ? [String(values.group_ids)] : (values.group_id ? [String(values.group_id)] : []));
  return [
    { key: 'group_ids', label: 'المجموعات التدريبية', type: 'multiselect', options: groups, required: true, value: selectedGroupIds, section: 'بيانات الحصة', sectionIcon: 'fa-calendar-days' },
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

router.get('/sessions/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const values = {
    group_ids: req.query.group_id ? [req.query.group_id] : [],
    date: req.query.date || today(),
    start_time: '16:00'
  };
  res.render('form', { form: { title: 'حصة جديدة', subtitle: 'جدولة حصة تدريبية', icon: 'fa-plus', active: 'sessions', action: '/sessions/new', fields: await sessionFields(values, req), values, submitLabel: 'إنشاء الحصة', cancelUrl: '/sessions', csrf: '' } });
});
router.post('/sessions/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const groupIds = parseGroupIds(b.group_ids || b.group_id);
  if (!groupIds.length) {
    setFlash(res, { type: 'danger', message: 'يرجى اختيار مجموعة واحدة على الأقل' });
    return res.redirect('/sessions/new');
  }
  const primaryGroup = await db.prepare('SELECT * FROM groups WHERE id = ?').get(groupIds[0]);
  const title = b.title || (primaryGroup ? primaryGroup.name + ' - ' + b.date : 'حصة تدريبية');
  const info = await db.prepare('INSERT INTO sessions (group_id, title, date, start_time, end_time, coach_id, pool_id, status, is_compensatory, original_date, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(groupIds[0], title, b.date, b.start_time || '16:00', b.end_time || null, b.coach_id || (primaryGroup ? primaryGroup.coach_id : null), b.pool_id || (primaryGroup ? primaryGroup.pool_id : null), b.status || 'scheduled', b.is_compensatory === '1' ? 1 : 0, b.original_date || null, b.note || '', req.currentUser.id);
  const sessionId = info.lastInsertRowid;
  for (const gid of groupIds) {
    await db.prepare('INSERT OR IGNORE INTO session_groups (session_id, group_id) VALUES (?,?)').run(sessionId, gid);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'sessions', sessionId, 'حصة جديدة: ' + title + ' (' + groupIds.length + ' مجموعة)', req);
  setFlash(res, { type: 'success', message: 'تم إنشاء الحصة لـ ' + groupIds.length + ' مجموعة' });
  res.redirect('/attendance/session/' + sessionId);
});

/* إضافة حصص لعدة مجموعات دفعة واحدة من شاشة الحضور */
router.get('/sessions/bulk-new', async function (req, res) {
  if (!canAdd(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const sid = activeSport(req);
  const groups = await db.prepare('SELECT * FROM groups WHERE deleted_at IS NULL' + groupClause(sid) + ' ORDER BY name').all();
  const coaches = await db.prepare('SELECT id, full_name FROM coaches WHERE deleted_at IS NULL' + sportClause(sid, 'coaches') + ' ORDER BY full_name').all();
  const pools = await db.prepare('SELECT id, name FROM pools ORDER BY name').all();
  res.render('sessions_bulk_new', {
    title: 'إضافة حصص للمجموعات', active: 'attendance',
    date: req.query.date || today(), start_time: '16:00', end_time: '',
    groups, coaches, pools, groupStartTime
  });
});
router.post('/sessions/bulk-new', async function (req, res) {
  if (!canAdd(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body;
  const sid = activeSport(req);
  const date = b.date || today();
  let groupIds = [];
  if (b.group_ids === 'all') {
    groupIds = (await db.prepare('SELECT id FROM groups WHERE deleted_at IS NULL' + groupClause(sid)).all()).map(r => r.id);
  } else {
    groupIds = parseGroupIds(b.group_ids);
  }
  if (!groupIds.length) {
    setFlash(res, { type: 'danger', message: 'يرجى اختيار مجموعة واحدة على الأقل' });
    return res.redirect('/sessions/bulk-new?date=' + date);
  }
  const primaryGroup = await db.prepare('SELECT * FROM groups WHERE id = ?').get(groupIds[0]);
  const title = (primaryGroup ? primaryGroup.name : 'مجموعات') + ' - ' + date + (groupIds.length > 1 ? ' (' + groupIds.length + ' مجموعات)' : '');
  const start = b.start_time || (primaryGroup ? groupStartTime(primaryGroup) : '16:00');
  const end = b.end_time || null;
  const coachId = b.coach_id || (primaryGroup ? primaryGroup.coach_id : null);
  const poolId = b.pool_id || (primaryGroup ? primaryGroup.pool_id : null);
  const info = await db.prepare('INSERT INTO sessions (group_id, title, date, start_time, end_time, coach_id, pool_id, status, is_compensatory, original_date, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(groupIds[0], title, date, start, end, coachId, poolId, 'scheduled', 0, null, 'أُنشئت من شاشة الحضور', req.currentUser.id);
  const sessionId = info.lastInsertRowid;
  for (const gid of groupIds) {
    await db.prepare('INSERT OR IGNORE INTO session_groups (session_id, group_id) VALUES (?,?)').run(sessionId, gid);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'sessions', sessionId, 'حصة لـ ' + groupIds.length + ' مجموعة يوم ' + date, req);
  setFlash(res, { type: 'success', message: 'تم إنشاء الحصة لـ ' + groupIds.length + ' مجموعة، يمكنك الآن تسجيل الحضور' });
  res.redirect('/attendance?date=' + date);
});

router.get('/sessions/:id/attendance.pdf', async function (req, res) {
  if (!canExportSession(req.currentUser)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const data = await sessionReportData(req.params.id, req);
  if (!data) return res.redirect('/sessions');
  pdfmake.createPdf(sessionPdfDoc(data)).getBuffer().then(function (buf) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="session-attendance-' + data.s.id + '.pdf"');
    res.send(buf);
  }).catch(function (e) {
    console.error('خطأ في توليد PDF للحصة:', e.message);
    res.status(500).send('تعذّر توليد ملف PDF: ' + e.message);
  });
});

router.get('/sessions/:id/attendance.xls', async function (req, res) {
  if (!canExportSession(req.currentUser)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const data = await sessionReportData(req.params.id, req);
  if (!data) return res.redirect('/sessions');
  const sheetName = 'حصة ' + String(data.s.date || '').slice(0, 10) + ' ' + (data.s.start_time || '');
  const html = xlsWorkbook([{ name: sheetName, html: sessionXlsHtml(data) }]);
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', "attachment; filename=\"session-attendance-" + data.s.id + ".xls\"");
  res.send(html);
});

router.get('/sessions/:id', async function (req, res) {
  if (!canView(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const data = await sessionReportData(req.params.id, req);
  if (!data) return res.redirect('/sessions');
  const s = data.s;
  const members = data.groups.reduce(function (all, g) { return all.concat(g.members); }, []);
  res.render('session_detail', {
    title: 'تفاصيل الحصة', active: 'sessions',
    s, members, groups: data.groups, groupNames: data.groupNames,
    attMap: ATT_STATUS,
    page: {
      canEdit: canEdit(req.currentUser, 'sessions'),
      canDel: canDel(req.currentUser, 'sessions'),
      canExport: canExportSession(req.currentUser),
      canSave: canEdit(req.currentUser, 'attendance') || canAdd(req.currentUser, 'attendance')
    }
  });
});

router.get('/sessions/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const row = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.redirect('/sessions');
  const groupRows = await db.prepare('SELECT group_id FROM session_groups WHERE session_id = ?').all(row.id);
  row.group_ids = groupRows.length ? groupRows.map(r => r.group_id) : (row.group_id ? [row.group_id] : []);
  res.render('form', { form: { title: 'تعديل الحصة', subtitle: fmtDate(row.date) + ' — ' + (row.title || ''), icon: 'fa-pen', active: 'sessions', action: '/sessions/' + row.id + '/edit', fields: await sessionFields(row, req), values: row, submitLabel: 'حفظ التعديلات', cancelUrl: '/sessions/' + row.id, csrf: '' } });
});
router.post('/sessions/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  const groupIds = parseGroupIds(b.group_ids || b.group_id);
  if (!groupIds.length) {
    setFlash(res, { type: 'danger', message: 'يرجى اختيار مجموعة واحدة على الأقل' });
    return res.redirect('/sessions/' + id + '/edit');
  }
  const primaryGroup = await db.prepare('SELECT * FROM groups WHERE id = ?').get(groupIds[0]);
  const title = b.title || (primaryGroup ? primaryGroup.name + ' - ' + b.date : 'حصة تدريبية');
  await db.prepare('UPDATE sessions SET group_id=?, title=?, date=?, start_time=?, end_time=?, coach_id=?, pool_id=?, status=?, is_compensatory=?, original_date=?, note=? WHERE id=?')
    .run(groupIds[0], title, b.date, b.start_time || '16:00', b.end_time || null, b.coach_id || (primaryGroup ? primaryGroup.coach_id : null), b.pool_id || (primaryGroup ? primaryGroup.pool_id : null), b.status || 'scheduled', b.is_compensatory === '1' ? 1 : 0, b.original_date || null, b.note || '', id);
  await db.prepare('DELETE FROM session_groups WHERE session_id = ?').run(id);
  for (const gid of groupIds) {
    await db.prepare('INSERT OR IGNORE INTO session_groups (session_id, group_id) VALUES (?,?)').run(id, gid);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'sessions', id, 'تعديل حصة (' + groupIds.length + ' مجموعة)', req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/sessions/' + id);
});
router.post('/sessions/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  await db.prepare("UPDATE sessions SET deleted_at = datetime('now','localtime') WHERE id = ?").run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'sessions', id, 'حذف حصة (مع الاحتفاظ بالسجل)', req);
  setFlash(res, { type: 'success', message: 'تم حذف الحصة مع الاحتفاظ بسجل الحضور' });
  res.redirect('/sessions');
});

/* ============================================================== */
/*                       الحضور والغياب                            */
/* ============================================================== */
router.get('/attendance', async function (req, res) {
  if (!canView(req.currentUser, 'attendance')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : today();
  const from = normalizeTime(req.query.from), to = normalizeTime(req.query.to);
  /* لا تُعرض قوائم الحضور إلا بعد اختيار التاريخ والوقت صراحةً */
  const slotMode = !!(from && to && toMinutes(to) > toMinutes(from));
  const groupFilter = Number(req.query.group) || 0;
  const canSave = canEdit(req.currentUser, 'attendance') || canAdd(req.currentUser, 'attendance');
  const groupRows = await db.prepare(`SELECT g.*, c.full_name AS coach_name, p.name AS pool_name FROM groups g
    LEFT JOIN coaches c ON c.id = g.coach_id LEFT JOIN pools p ON p.id = g.pool_id WHERE g.deleted_at IS NULL` + groupClause(activeSport(req)) + ` ORDER BY g.name`).all();
  const targetGroups = slotMode ? groupRows.filter(g => !groupFilter || g.id === groupFilter) : [];
  const groups = [];
  for (const g of targetGroups) {
    await syncGroup(g.id);
    const members = await db.prepare(`SELECT s.id, s.full_name, s.membership_no,
        (SELECT sub.end_date FROM subscriptions sub WHERE sub.swimmer_id = s.id ORDER BY (sub.status = 'نشط') DESC, sub.id DESC LIMIT 1) AS sub_end
      FROM swimmer_group sg JOIN swimmers s ON s.id = sg.swimmer_id WHERE sg.group_id = ? ORDER BY s.full_name`).all(g.id);
    members.forEach(m => { m.sub = subBadge(m.sub_end); });
    /* حصة موجودة في هذا المدى الزمني؟ تُعرض حالتها المحفوظة كما هي */
    let sessions = await db.prepare(`SELECT se.*, g2.name AS group_name, c.full_name AS coach_name, p.name AS pool_name
      FROM sessions se
      LEFT JOIN groups g2 ON g2.id = se.group_id
      LEFT JOIN coaches c ON c.id = se.coach_id
      LEFT JOIN pools p ON p.id = se.pool_id
      WHERE se.date = ? AND se.deleted_at IS NULL
        AND (se.group_id = ? OR EXISTS (SELECT 1 FROM session_groups sg WHERE sg.session_id = se.id AND sg.group_id = ?))
      ORDER BY se.start_time, se.id`).all(date, g.id, g.id);
    sessions = sessions.filter(function (s) { return overlaps(from, to, s.start_time, s.end_time); });
    let created = false;
    if (!sessions.length && canSave) {
      /* حصة واحدة لكل تاريخ+توقيت: المجموعة الجديدة تُنضم للحصة الموجودة بدل إنشاء حصة أخرى */
      const result = await ensureDateTimeSession(date, from, to, g, req.currentUser.id, 'أُنشئت من شاشة الحضور والغياب');
      if (result.session) {
        const sid = Number(result.session.id);
        for (const m of members) await db.prepare("INSERT OR IGNORE INTO attendance (session_id, swimmer_id, status) VALUES (?,?,'absent')").run(sid, m.id);
        sessions = [await db.prepare(`SELECT se.*, g2.name AS group_name, c.full_name AS coach_name, p.name AS pool_name
          FROM sessions se LEFT JOIN groups g2 ON g2.id = se.group_id LEFT JOIN coaches c ON c.id = se.coach_id LEFT JOIN pools p ON p.id = se.pool_id WHERE se.id = ?`).get(sid)];
        created = result.created;
        if (created) audit(req.currentUser.id, req.currentUser.full_name, 'add', 'sessions', sid,
          'حصة جديدة بالوقت: ' + g.name + ' — ' + date + ' (' + from + ' - ' + to + ')', req);
      }
    }
    for (const s of sessions) {
      s.attMap = {};
      (await db.prepare('SELECT swimmer_id, status FROM attendance WHERE session_id = ?').all(s.id)).forEach(function (a) { s.attMap[a.swimmer_id] = a.status; });
      s.marked = Object.keys(s.attMap).length;
      s.createdNow = created;
    }
    const session = sessions[0] || null;
    groups.push({ ...g, members, sessions, session, attMap: session ? session.attMap : {} });
  }
  const daySessions = await db.prepare(`SELECT se.id, se.date, se.start_time, se.end_time, se.title, se.coach_id, se.group_id,
      c.full_name AS coach_name, g.name AS group_name,
      (SELECT COUNT(*) FROM attendance a WHERE a.session_id = se.id) AS marked
    FROM sessions se
    LEFT JOIN groups g ON g.id = se.group_id
    LEFT JOIN coaches c ON c.id = se.coach_id
    WHERE se.date = ? AND se.deleted_at IS NULL
      AND se.group_id IS NOT NULL` + groupClause(activeSport(req), 'g') + `
    ORDER BY se.start_time, se.id`).all(date);
  const gScope = sessionClause(activeSport(req), 's');
  /* عدّات الحالات مستقلة؛ إرسالها معاً يوفّر رحلات قاعدة البيانات بنفس النتيجة. */
  const [presentC, absentC, excusedC, lateC] = await Promise.all([
    db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.deleted_at IS NULL AND s.date=? AND a.status='present'` + gScope).get(date),
    db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.deleted_at IS NULL AND s.date=? AND a.status='absent'` + gScope).get(date),
    db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.deleted_at IS NULL AND s.date=? AND a.status='excused'` + gScope).get(date),
    db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.deleted_at IS NULL AND s.date=? AND a.status='late'` + gScope).get(date)
  ]);
  const daily = {
    present: presentC.c,
    absent: absentC.c,
    excused: excusedC.c,
    late: lateC.c
  };
  res.render('attendance', { title: 'الحضور والغياب', active: 'attendance', groups, allGroups: groupRows, daySessions, daily, date, from, to, groupFilter, slotMode, today: today(), canSave,
    canAddSession: canAdd(req.currentUser, 'sessions'),
    canExport: canExportSession(req.currentUser),
    canScan: canEdit(req.currentUser, 'attendance') || canAdd(req.currentUser, 'attendance') || canEdit(req.currentUser, 'membershipCards') || canAdd(req.currentUser, 'membershipCards'),
    yday: addDays(today(), -1), dyday: addDays(today(), -2), tomorrow: addDays(today(), 1), isPast: date < today() });
});

router.get('/attendance/session/:id', async function (req, res) {
  if (!canView(req.currentUser, 'attendance')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const s = await db.prepare(`SELECT se.*, g.name AS group_name, c.full_name AS coach_name, p.name AS pool_name FROM sessions se
    LEFT JOIN groups g ON g.id = se.group_id LEFT JOIN coaches c ON c.id = se.coach_id LEFT JOIN pools p ON p.id = se.pool_id WHERE se.id = ?` + sessionClause(activeSport(req), 'se')).get(id);
  if (!s) return res.redirect('/attendance');
  const groupIds = await sessionGroupIds(s.id);
  await syncGroups(groupIds);
  const placeholders = groupIds.length ? groupIds.map(() => '?').join(',') : '0';
  const [groupRows, memberRows] = await Promise.all([
    groupIds.length ? db.prepare('SELECT id, name FROM groups WHERE id IN (' + placeholders + ') ORDER BY name, id').all(...groupIds) : Promise.resolve([]),
    groupIds.length ? db.prepare(`SELECT sg.group_id, s.id, s.full_name, s.membership_no, s.birth_date, a.status AS att_status, a.reason, a.coach_note, a.id AS att_id,
        (SELECT sub.end_date FROM subscriptions sub WHERE sub.swimmer_id = s.id ORDER BY (sub.status = 'نشط') DESC, sub.id DESC LIMIT 1) AS sub_end
      FROM swimmer_group sg
      JOIN swimmers s ON s.id = sg.swimmer_id LEFT JOIN attendance a ON a.session_id = ? AND a.swimmer_id = s.id
      WHERE sg.group_id IN (${placeholders}) ORDER BY s.full_name, s.id`).all(id, ...groupIds) : Promise.resolve([])
  ]);
  const membersByGroup = {};
  memberRows.forEach(function (m) {
    m.sub = subBadge(m.sub_end);
    (membersByGroup[String(m.group_id)] = membersByGroup[String(m.group_id)] || []).push(m);
  });
  const groups = groupRows.map(function (g) {
    return { id: g.id, name: g.name, members: membersByGroup[String(g.id)] || [] };
  });
  const members = groups.reduce(function (all, g) { return all.concat(g.members); }, []);
  const groupNames = groupRows.map(function (g) { return g.name; });
  const otherSessions = await db.prepare(`SELECT se.id, se.date, se.start_time, se.end_time, se.title,
      g.name AS group_name, (SELECT COUNT(*) FROM attendance a WHERE a.session_id = se.id) AS marked
    FROM sessions se LEFT JOIN groups g ON g.id = se.group_id
    WHERE se.date = ? AND se.deleted_at IS NULL AND se.id <> ? ORDER BY se.start_time, se.id`).all(s.date, s.id);
  res.render('attendance_session', {
    title: 'تسجيل الحضور', active: 'attendance',
    s, members, groups, groupNames, otherSessions, date: today(), today: today(), money,
    page: {
      canEdit: canEdit(req.currentUser, 'attendance') || canAdd(req.currentUser, 'attendance'),
      canExport: canExportSession(req.currentUser)
    },
    canSave: canEdit(req.currentUser, 'attendance') || canAdd(req.currentUser, 'attendance')
  });
});

/* حفظ حضور فردي (JSON) */
router.post('/attendance/save', async function (req, res) {
  if (!canEdit(req.currentUser, 'attendance') && !canAdd(req.currentUser, 'attendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const { session_id, swimmer_id, status, reason, coach_note } = req.body;
  if (!session_id || !swimmer_id) return res.status(400).json({ ok: false, error: 'بيانات ناقصة' });
  const session = await db.prepare('SELECT id, date, start_time, end_time FROM sessions WHERE id = ?').get(session_id);
  if (!session) return res.status(400).json({ ok: false, error: 'الحصة غير موجودة' });
  const previous = await db.prepare('SELECT status FROM attendance WHERE session_id = ? AND swimmer_id = ?').get(session_id, swimmer_id);
  const nextStatus = status || 'present';
  if (nextStatus === 'present' || nextStatus === 'late') {
    const clash = await swimmerTimeClash(swimmer_id, session.date, session.start_time, session.end_time, session_id);
    if (clash) return res.json({ ok: false, error: 'اللاعب مسجّل حاضراً بالفعل في حصة متداخلة: ' + ((clash && clash.title) || clash.start_time) });
  }
  await db.prepare(`INSERT INTO attendance (session_id, swimmer_id, status, reason, coach_note) VALUES (?,?,?,?,?)
    ON CONFLICT(session_id, swimmer_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, coach_note=excluded.coach_note`)
    .run(session_id, swimmer_id, nextStatus, reason || '', coach_note || '');
  const groupId = await sessionGroupForSwimmer(session_id, swimmer_id);
  await syncSubscriptionUsage(swimmer_id, groupId, previous && previous.status, nextStatus);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'attendance', session_id, 'تحديث حضور لاعب #' + swimmer_id, req);
  res.json({ ok: true });
});

/* حفظ حضور مجموعة كاملة (JSON) */
router.post('/attendance/mark-all', async function (req, res) {
  if (!canEdit(req.currentUser, 'attendance') && !canAdd(req.currentUser, 'attendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const { session_id, status } = req.body;
  const s = await db.prepare('SELECT id, date, start_time, end_time FROM sessions WHERE id = ?').get(session_id || 0);
  if (!s) return res.status(400).json({ ok: false, error: 'الحصة غير موجودة' });
  const groupIds = await sessionGroupIds(s.id);
  await syncGroups(groupIds);
  const placeholders = groupIds.length ? groupIds.map(() => '?').join(',') : '0';
  const members = await db.prepare(`SELECT sg.swimmer_id, sw.full_name FROM swimmer_group sg
    JOIN swimmers sw ON sw.id = sg.swimmer_id WHERE sg.group_id IN (${placeholders})`).all(...groupIds);
  const nextStatus = status || 'present';
  if (nextStatus === 'present' || nextStatus === 'late') {
    for (const m of members) {
      const clash = await swimmerTimeClash(m.swimmer_id, s.date, s.start_time, s.end_time, s.id);
      if (clash) return res.json({ ok: false, error: (m.full_name || 'لاعب') + ' مسجّل حاضراً بالفعل في حصة متداخلة: ' + ((clash && clash.title) || clash.start_time) });
    }
  }
  for (const m of members) {
    const previous = await db.prepare('SELECT status FROM attendance WHERE session_id = ? AND swimmer_id = ?').get(session_id, m.swimmer_id);
    await db.prepare(`INSERT INTO attendance (session_id, swimmer_id, status) VALUES (?,?,?)
      ON CONFLICT(session_id, swimmer_id) DO UPDATE SET status=excluded.status`).run(session_id, m.swimmer_id, nextStatus);
    const groupId = await sessionGroupForSwimmer(session_id, m.swimmer_id);
    await syncSubscriptionUsage(m.swimmer_id, groupId, previous && previous.status, nextStatus);
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'attendance', session_id, 'حضور جماعي: ' + status, req);
  res.json({ ok: true, count: members.length });
});

/* حفظ حضور مجموعة كاملة من صفحة الحضور والغياب (تنشئ الحصة تلقائياً إن لم توجد) */
router.post('/attendance/group-save', async function (req, res) {
  if (!canEdit(req.currentUser, 'attendance') && !canAdd(req.currentUser, 'attendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const gid = Number(req.body.group_id || 0);
  const d = req.body.date || today();
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  if (!group) return res.status(400).json({ ok: false, error: 'المجموعة غير موجودة' });
  /* إنشاء الحصة تلقائياً إن لم توجد (بدون اختيار حصة جديدة) */
  const session = await ensureGroupSession(group, d, req.currentUser.id);
  if (!session) return res.status(400).json({ ok: false, error: 'تعذر تجهيز الحصة' });
  await syncGroup(gid);
  const statuses = req.body.statuses || {};
  let n = 0;
  for (const sid of Object.keys(statuses)) {
    const id = Number(sid);
    if (!id) continue;
    const nextStatus = statuses[sid] || 'present';
    const previous = await db.prepare('SELECT status FROM attendance WHERE session_id = ? AND swimmer_id = ?').get(session.id, id);
    await db.prepare(`INSERT INTO attendance (session_id, swimmer_id, status, reason, coach_note) VALUES (?,?,?,?,?)
      ON CONFLICT(session_id, swimmer_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, coach_note=excluded.coach_note`)
      .run(session.id, id, nextStatus, '', '');
    await syncSubscriptionUsage(id, gid, previous && previous.status, nextStatus);
    n++;
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'attendance', session.id, 'حضور مجموعة #' + gid + ' (' + n + ' لاعب)', req);
  res.json({ ok: true, count: n });
});

/* إنشاء حصة جديدة بوقت محدد من شاشة الحضور والغياب.
   يُمنع تكرار الحصة لنفس المجموعة أو تكرار حضور اللاعب نفسه في وقت متداخل. */
router.post('/attendance/quick-session', async function (req, res) {
  if (!canEdit(req.currentUser, 'attendance') && !canAdd(req.currentUser, 'attendance')) return res.status(403).json({ ok: false, error: 'غير مصرح' });
  const date = String(req.body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: 'تاريخ غير صحيح' });
  const range = validateRange(req.body.time_from, req.body.time_to);
  if (range.error) return res.status(400).json({ ok: false, error: range.error });
  const gid = Number(req.body.group_id || 0);
  const group = await db.prepare('SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL').get(gid);
  if (!group) return res.status(400).json({ ok: false, error: 'اختر المجموعة أولاً' });

  /* حصة أخرى لنفس المجموعة في مدى زمني متداخل؟ */
  const clash = await db.prepare(`SELECT id, start_time FROM sessions
    WHERE date = ? AND deleted_at IS NULL
      AND (group_id = ? OR EXISTS (SELECT 1 FROM session_groups sg WHERE sg.session_id = sessions.id AND sg.group_id = ?))
      AND start_time < ? AND COALESCE(end_time, TIME(start_time, '+1 hour')) > ?
    ORDER BY start_time LIMIT 1`).get(date, gid, gid, range.to, range.from);
  if (clash) return res.json({ ok: false, error: 'توجد حصة أخرى لهذه المجموعة في هذا التوقيت', session_id: clash.id });

  /* لاعب من المجموعة مسجّل بالفعل في حصة متداخلة في نفس اليوم؟ */
  const members = await db.prepare('SELECT swimmer_id FROM swimmer_group WHERE group_id = ?').all(gid);
  const ids = members.map(m => m.swimmer_id);
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const dup = await db.prepare(`SELECT a.swimmer_id, se.start_time FROM attendance a
      JOIN sessions se ON se.id = a.session_id
      WHERE se.date = ? AND se.deleted_at IS NULL AND a.swimmer_id IN (${ph})
        AND a.status IN ('present','late')
        AND se.start_time < ? AND COALESCE(se.end_time, TIME(se.start_time, '+1 hour')) > ?
      LIMIT 1`).get(date, ...ids, range.to, range.from);
    if (dup) {
      const sw = await db.prepare('SELECT full_name FROM swimmers WHERE id = ?').get(dup.swimmer_id);
      return res.json({ ok: false, error: 'اللاعب ' + ((sw && sw.full_name) || ('#' + dup.swimmer_id)) + ' مسجّل بالفعل في حصة متداخلة في هذا اليوم' });
    }
  }

  /* حصة موجودة لنفس اليوم والتوقيت لمجموعة أخرى؟ تُضاف المجموعة لها بدل حصة جديدة */
  const shared = await db.prepare(`SELECT id FROM sessions
    WHERE date = ? AND start_time = ? AND deleted_at IS NULL
    ORDER BY id LIMIT 1`).get(date, range.from);
  if (shared) {
    await db.prepare('INSERT OR IGNORE INTO session_groups (session_id, group_id) VALUES (?,?)').run(shared.id, gid);
    return res.json({ ok: true, session_id: shared.id, url: '/attendance/session/' + shared.id, reused: true });
  }

  const info = await db.prepare(`INSERT INTO sessions
    (group_id, title, date, start_time, end_time, coach_id, pool_id, status, is_compensatory, note, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(gid, group.name + ' - ' + date + ' (' + range.from + ')', date, range.from, range.to,
      group.coach_id || null, group.pool_id || null, 'scheduled', 0, 'أُنشئت من شاشة الحضور والغياب', req.currentUser.id);
  const sessionId = Number(info.lastInsertRowid || 0);
  await db.prepare('INSERT OR IGNORE INTO session_groups (session_id, group_id) VALUES (?,?)').run(sessionId, gid);
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'sessions', sessionId,
    'حصة جديدة بالوقت: ' + group.name + ' — ' + date + ' (' + range.from + ' - ' + range.to + ')', req);
  res.json({ ok: true, session_id: sessionId, url: '/attendance/session/' + sessionId });
});

/* ============================================================== */
/*              إلغاء الحصة + حصص تعويضية + مدّ التاريخ             */
/* ============================================================== */
function addDaysStr(dateStr, n) {
  const d = new Date(String(dateStr) + 'T12:00:00');
  if (isNaN(d)) return '';
  d.setDate(d.getDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
}

/* صفحة إلغاء الحصة: اختيار المجموعات/اللاعبين/الأيام التعويضية + مد التاريخ */
router.get('/sessions/:id/cancel', async function (req, res) {
  if (!canEdit(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const s = await db.prepare(`SELECT se.*, g.name AS group_name, c.full_name AS coach_name, p.name AS pool_name
    FROM sessions se
    LEFT JOIN groups g ON g.id = se.group_id
    LEFT JOIN coaches c ON c.id = se.coach_id
    LEFT JOIN pools p ON p.id = se.pool_id
    WHERE se.id = ?` + sessionClause(activeSport(req), 'se')).get(id);
  if (!s) return res.redirect('/sessions');
  const groupIds = await sessionGroupIds(s.id);
  const placeholders = groupIds.length ? groupIds.map(() => '?').join(',') : '0';
  const members = groupIds.length
    ? await db.prepare(`SELECT s.id, s.full_name, s.membership_no FROM swimmer_group sg
        JOIN swimmers s ON s.id = sg.swimmer_id WHERE sg.group_id IN (${placeholders}) ORDER BY s.full_name`).all(...groupIds)
    : [];
  const groups = await db.prepare('SELECT id, name FROM groups WHERE deleted_at IS NULL' + groupClause(activeSport(req)) + ' ORDER BY name').all();
  const coaches = await db.prepare('SELECT id, full_name FROM coaches WHERE deleted_at IS NULL' + sportClause(activeSport(req), 'coaches') + ' ORDER BY full_name').all();
  const pools = await db.prepare('SELECT id, name FROM pools ORDER BY name').all();
  /* يوم افتراضي للحصة التعويضية: نفس يوم الأسبوع بعد أسبوع، بنفس موعد الحصة */
  const defaultDays = [{
    date: addDaysStr(s.date, 7) || '',
    start: s.start_time || '16:00',
    end: s.end_time || ''
  }];
  res.render('session_cancel', { title: 'إلغاء الحصة وتعويض', active: 'sessions', s, members, groups, coaches, pools, defaultDays });
});

/* تنفيذ الإلغاء وإنشاء الحصص التعويضية ومدّ التواريخ */
router.post('/sessions/:id/cancel', async function (req, res) {
  if (!canEdit(req.currentUser, 'sessions')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const b = req.body;
  const s = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!s) return res.redirect('/sessions');
  const reason = String(b.reason || '').trim();

  const toIds = (v) => {
    if (v === null || v === undefined) return [];
    if (Array.isArray(v)) return v.map(Number).filter(n => n > 0);
    const n = Number(v);
    return n > 0 ? [n] : [];
  };

  /* 1) تغيير حالة الحصة إلى "ملغاة" مع سبب الإلغاء */
  const note = [s.note || '', reason ? ('سبب الإلغاء: ' + reason) : ''].filter(x => String(x).trim()).join('\n').trim();
  await db.prepare("UPDATE sessions SET status = 'cancelled', note = ? WHERE id = ?").run(note, id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'sessions', id, 'إلغاء حصة' + (reason ? ' — ' + reason : ''), req);

  /* 2) الحصص التعويضية */
  const createdIds = [];
  let createdCount = 0;
  const sessionGroupIdsList = await sessionGroupIds(s.id);
  if (b.add_comp === '1') {
    const compGroupIds = toIds(b.groups).length ? toIds(b.groups) : sessionGroupIdsList;
    const days = Array.isArray(b.days)
      ? b.days.filter(d => d && (d.date || d.start || d.end))
      : [];
    const compCoach = Number(b.comp_coach_id) || s.coach_id || null;
    const compPool = Number(b.comp_pool_id) || s.pool_id || null;
    const ins = db.prepare(`INSERT INTO sessions (group_id, title, date, start_time, end_time, coach_id, pool_id, status, is_compensatory, original_date, note, created_by)
      VALUES (?,?,?,?,?,?,?,'scheduled',1,?,?,?)`);
    for (const gid of compGroupIds) {
      const g = await db.prepare('SELECT name FROM groups WHERE id = ?').get(gid);
      for (const d of days) {
        if (!d.date) continue;
        const info = await ins.run(gid, (g ? g.name : 'مجموعة') + ' - ' + d.date + ' (تعويضية عن ' + fmtDate(s.date) + ')', d.date, d.start || s.start_time || '16:00', d.end || null, compCoach, compPool, s.date, 'تعويضية عن حصة ' + fmtDate(s.date) + (reason ? ' — ' + reason : ''), req.currentUser.id);
        createdIds.push(info.lastInsertRowid);
        createdCount++;
      }
    }
    if (createdCount) audit(req.currentUser.id, req.currentUser.full_name, 'add', 'sessions', createdIds[0], 'إنشاء ' + createdCount + ' حصة تعويضية', req);
  } else {
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'sessions', id, 'إلغاء حصة بدون تعويض', req);
  }

  /* 3) نطاق اللاعبين (المستفيدون من مدّ التاريخ وإضافة الرصيد) */
  let swimmerIds = [];
  if (b.scope === 'selected') {
    swimmerIds = toIds(b.swimmers);
  } else if (sessionGroupIdsList.length) {
    const placeholders = sessionGroupIdsList.map(() => '?').join(',');
    swimmerIds = (await db.prepare(`SELECT swimmer_id FROM swimmer_group WHERE group_id IN (${placeholders})`).all(...sessionGroupIdsList)).map(r => r.swimmer_id);
  }

  /* 4) مدّ تاريخ انتهاء الاشتراك بعدد الأيام المحدد */
  let extendedCount = 0;
  if (b.extend === '1' && swimmerIds.length) {
    const ndays = Math.max(1, Math.min(365, Number(b.extend_days) || 1));
    const placeholders = swimmerIds.map(() => '?').join(',');
    const info = await db.prepare(`UPDATE subscriptions SET status = 'نشط', end_date = date(end_date, '+' || ? || ' days'), notes = COALESCE(notes || char(10), '') || 'تم مدّ الاشتراك ' || ? || ' يوم بعد إلغاء حصة بتاريخ ' || ?
      WHERE swimmer_id IN (${placeholders}) AND status IN ('نشط', 'منتهي') AND end_date IS NOT NULL`)
      .run(ndays, ndays, s.date, ...swimmerIds);
    extendedCount = info.changes;
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'subscriptions', id, 'مدّ ' + extendedCount + ' اشتراكاً بـ ' + ndays + ' يوم', req);
  }

  /* 5) إضافة الحصص التعويضية إلى رصيد الاشتراك */
  let balanceAdded = 0;
  if (b.add_to_balance === '1' && createdCount > 0 && swimmerIds.length) {
    const placeholders = swimmerIds.map(() => '?').join(',');
    const info = await db.prepare(`UPDATE subscriptions SET status = 'نشط', sessions_total = sessions_total + ?
      WHERE swimmer_id IN (${placeholders}) AND status IN ('نشط', 'منتهي')`).run(createdCount, ...swimmerIds);
    balanceAdded = info.changes;
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'subscriptions', id, 'إضافة ' + createdCount + ' حصة لرصيد ' + balanceAdded + ' اشتراك', req);
  }

  setFlash(res, {
    type: 'success',
    message: 'تم إلغاء الحصة' + (createdCount ? ' وإنشاء ' + createdCount + ' حصة تعويضية' : '') + (extendedCount ? ' ومدّ ' + extendedCount + ' اشتراكاً' : '') + (balanceAdded ? ' وإضافة ' + createdCount + ' حصة لرصيد ' + balanceAdded + ' اشتراك' : '')
  });
  res.redirect('/sessions/' + id);
});

module.exports = router;
