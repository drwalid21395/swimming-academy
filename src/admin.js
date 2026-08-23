'use strict';
const db = require('./db');
const { esc, money, fmtDate, fmtDateShort, calcAge, nl2br, today, daysUntil, parseJSON } = require('./util');
const { can, requireUser, audit } = require('./auth');
const { ENTITIES, PAY_METHOD, ATT_STATUS, PROG_TYPE } = require('./config');
const { icon, adminShell, renderTable, renderModal, statCards, pageHead, toolbarSearch, card, getSettings, badge } = require('./render');
const { renderReport } = require('./reports');

const ALIAS = {
  swimmers: 's', guardians: 'g', coaches: 'c', users: 'u', programs: 'p', levels: 'l',
  groups: 'gr', sessions: 'se', subscriptions: 'su', payments: 'pay', revenues: 'r',
  expenses: 'e', coach_dues: 'cd', teams: 't', tournaments: 'to', incoming: 'inc',
  outgoing: 'out', documents: 'doc', complaints: 'cp', news: 'n', branches: 'b',
  pools: 'po', subscription_requests: 'sr', contact_messages: 'cm', gallery: 'ga',
  faqs: 'f', certificates: 'ce', notifications: 'no', team_members: 'tm', team_times: 'tt',
  tournaments_participations: 'tp', messages: 'me', audit: 'al', assessments: 'a', tests: 'te'
};

function countsFor(user) {
  const counts = {};
  try {
    if (can(user, 'subscriptions', 'view')) counts.expiring = db.prepare(`SELECT COUNT(*) c FROM subscriptions WHERE status='expiring'`).get().c;
    if (can(user, 'complaints', 'view')) counts.openComplaints = db.prepare(`SELECT COUNT(*) c FROM complaints WHERE status='open'`).get().c;
    if (can(user, 'reception', 'view')) counts.requests = db.prepare(`SELECT COUNT(*) c FROM subscription_requests WHERE status='new'`).get().c;
  } catch (e) {}
  return counts;
}

function notificationsFor(user) {
  if (!user) return [];
  try {
    if (['admin', 'academy_manager'].includes(user.role)) {
      return db.prepare(`SELECT * FROM notifications ORDER BY id DESC LIMIT 6`).all();
    }
    return db.prepare(`SELECT * FROM notifications WHERE user_id=? OR user_id IS NULL ORDER BY id DESC LIMIT 6`).all(user.id);
  } catch (e) { return []; }
}

function buildWhere(entity, q, filters) {
  const conf = ENTITIES[entity];
  const alias = ALIAS[entity] || conf.table;
  const where = [];
  const params = [];
  if (q && conf.search) {
    const cols = conf.search.split(',');
    const ors = cols.map(c => `${alias}.${c} LIKE ?`);
    where.push('(' + ors.join(' OR ') + ')');
    const like = `%${q}%`;
    cols.forEach(() => params.push(like));
  }
  if (filters && conf.filterBy) {
    conf.filterBy.split(',').forEach(f => {
      const v = filters[f.split('.')[1]] || filters[f.replace(alias + '.', '')];
      if (v) { where.push(`${alias}.${f.split('.')[1] || f} = ?`); params.push(v); }
    });
  }
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

function listPage(entity, user, query) {
  const conf = ENTITIES[entity];
  if (!conf) return { status: 404, body: 'غير موجود' };
  if (!can(user, conf.module, 'view')) return { status: 403, body: 'ليس لديك صلاحية' };
  const q = (query.q || '').toString().trim();
  const filters = {};
  if (conf.filterBy) {
    conf.filterBy.split(',').forEach(f => { const k = f.split('.')[1] || f; if (query[k]) filters[f] = query[k]; });
  }
  const { where, params } = buildWhere(entity, q, filters);
  const rows = db.prepare(`${conf.listQuery} ${where} ${conf.orderBy ? 'ORDER BY ' + conf.orderBy : ''} LIMIT 300`).all(...params);

  const canAdd = can(user, conf.module, 'add');
  const actions = [];
  actions.push(toolbarSearch(q, `بحث في ${conf.title}`));
  if (can(user, conf.module, 'view')) actions.push(`<a class="btn btn-outline btn-sm" href="/api/export/${entity}?q=${esc(q)}">${icon('download')} تصدير Excel</a>`);
  actions.push(`<button class="icon-btn" data-print title="طباعة">${icon('print')}</button>`);
  if (canAdd && !conf.readOnly) actions.push(`<button class="btn btn-primary" data-load-modal="/admin/${entity}/modal?mode=add">${icon('plus')} إضافة</button>`);

  let filtersHtml = '';
  if (conf.filterBy && conf.filterBy.includes('status')) {
    const statusOptions = [];
    const map = { swimmers: ENTITIES.swimmers.columns.find(c => c.k === 'status').map, subscriptions: { active: ['سارٍ', 'green'], expiring: ['أوشك على الانتهاء', 'amber'], expired: ['منتهٍ', 'red'], frozen: ['مجمد', 'purple'], cancelled: ['ملغى', 'red'] } }[entity];
    if (map) {
      Object.keys(map).forEach(k => statusOptions.push(`<option value="${k}" ${filters['s.status'] === k || filters['su.status'] === k ? 'selected' : ''}>${esc(map[k][0])}</option>`));
      const fname = entity === 'swimmers' ? 's.status' : 'su.status';
      const key = entity === 'swimmers' ? 'status' : 'status';
      filtersHtml += `<form method="get" style="display:flex;gap:8px;align-items:center;"><select name="${key}" onchange="this.form.submit()" style="padding:8px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-family:inherit;font-size:13px;"><option value="">كل الحالات</option>${statusOptions}</select></form>`;
    }
  }

  const content = `
    ${pageHead(conf.title, `${rows.length} سجل${conf.title.includes('طلبات') ? '' : ''}`, actions.join(''))}
    ${filtersHtml}
    ${renderTable(entity, rows, user, {})}
  `;
  return { status: 200, body: adminShell(user, { content, active: entity, counts: countsFor(user), notifications: notificationsFor(user), title: conf.title }) };
}

function modalFragment(entity, user, query) {
  const conf = ENTITIES[entity];
  if (!conf || conf.custom) return { status: 404, body: 'غير موجود' };
  const mode = query.mode === 'edit' ? 'edit' : 'add';
  const perm = mode === 'edit' ? 'edit' : 'add';
  if (!can(user, conf.module, perm)) return { status: 403, body: 'لا صلاحية' };
  let row = null;
  if (mode === 'edit') row = db.prepare(`SELECT * FROM ${conf.table} WHERE id=?`).get(Number(query.id));
  return { status: 200, body: renderModal(entity, row, mode) };
}

// ===== صفحة ملف السباح =====
function swimmerProfile(user, id, query) {
  const sw = db.prepare(`SELECT s.*, g.full_name AS guardian_name, l.name AS level_name, pr.name AS program_name, pr.program_type, gr.name AS group_name, c.full_name AS coach_name FROM swimmers s LEFT JOIN guardians g ON g.id=s.guardian_id LEFT JOIN levels l ON l.id=s.current_level_id LEFT JOIN programs pr ON pr.id=s.program_id LEFT JOIN groups gr ON gr.id=s.group_id LEFT JOIN coaches c ON c.id=s.coach_id WHERE s.id=?`).get(id);
  if (!sw) return { status: 404, body: 'السباح غير موجود' };
  if (!can(user, 'swimmers', 'view')) return { status: 403, body: 'لا صلاحية' };

  const age = calcAge(sw.birth_date);
  const pct = sw.total_sessions > 0 ? Math.round(sw.done_sessions / sw.total_sessions * 100) : 0;
  const assessments = db.prepare(`SELECT a.*, c.full_name AS coach_name, l.name AS level_name FROM assessments a LEFT JOIN coaches c ON c.id=a.coach_id LEFT JOIN levels l ON l.id=a.level_id WHERE a.swimmer_id=? ORDER BY a.date DESC`).all(id);
  const tests = db.prepare(`SELECT * FROM tests WHERE swimmer_id=? ORDER BY date DESC`).all(id);
  const subs = db.prepare(`SELECT su.*, pr.name AS program_name FROM subscriptions su LEFT JOIN programs pr ON pr.id=su.program_id WHERE su.swimmer_id=? ORDER BY id DESC`).all(id);
  const payments = db.prepare(`SELECT p.* FROM payments p WHERE p.swimmer_id=? ORDER BY id DESC`).all(id);
  const attendance = db.prepare(`SELECT a.*, se.date AS sdate, se.title AS stitle FROM attendance a LEFT JOIN sessions se ON se.id=a.session_id WHERE a.swimmer_id=? ORDER BY se.date DESC LIMIT 20`).all(id);
  const transitions = db.prepare(`SELECT t.*, fl.name AS from_level, tl.name AS to_level FROM level_transitions t LEFT JOIN levels fl ON fl.id=t.from_level_id LEFT JOIN levels tl ON tl.id=t.to_level_id WHERE t.swimmer_id=? ORDER BY t.date DESC`).all(id);
  const docs = db.prepare(`SELECT * FROM documents WHERE entity_type='swimmer' AND entity_id=?`).all(id);
  const teamRows = db.prepare(`SELECT tm.*, t.name AS team_name FROM team_members tm LEFT JOIN teams t ON t.id=tm.team_id WHERE tm.swimmer_id=?`).all(id);
  const times = db.prepare(`SELECT tt.*, t.name AS team_name FROM team_times tt LEFT JOIN teams t ON t.id=tt.team_id WHERE tt.swimmer_id=? ORDER BY record_date DESC`).all(id);

  const statusMap = ENTITIES.swimmers.columns.find(c => c.k === 'status').map;
  const attStats = { present: 0, absent: 0, apology: 0 };
  const attTotal = db.prepare(`SELECT COUNT(*) c, SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) p FROM attendance WHERE swimmer_id=?`).get(id);
  const attPct = attTotal.c > 0 ? Math.round(attTotal.p / attTotal.c * 100) : 0;

  const stats = statCards([
    { val: esc(sw.status ? statusMap[sw.status] ? statusMap[sw.status][0] : sw.status : '—'), label: 'حالة اللاعب', color: 'blue', icon: 'users' },
    { val: `${age} سنة`, label: 'العمر', color: 'cyan', icon: 'calendar' },
    { val: `${pct}%`, label: 'نسبة الحضور', color: 'green', icon: 'attendance' },
    { val: `${sw.remaining_sessions} حصة`, label: 'الحصص المتبقية', color: 'amber', icon: 'sessions' },
    { val: money(sw.subscription_value || 0), label: 'قيمة الاشتراك', color: 'purple', icon: 'revenues' }
  ]);

  let assessmentsHtml = '';
  assessments.forEach(a => {
    const scores = parseJSON(a.scores, {});
    const vals = Object.values(scores).filter(v => v !== null && v !== undefined);
    const avg = vals.length ? (vals.reduce((s, v) => s + Number(v), 0) / vals.length).toFixed(1) : '—';
    const topScores = Object.entries(scores).slice(0, 6).map(([cid, v]) => {
      const crit = db.prepare('SELECT name_ar FROM assessment_criteria WHERE id=?').get(cid);
      return `<div class="detail-item"><div class="k">${esc(crit ? crit.name_ar : 'معيار')}</div><div class="v">${v !== null ? Number(v).toFixed(1) + ' / 10' : '—'}</div></div>`;
    }).join('');
    assessmentsHtml += `<div class="card" style="margin-bottom:14px;"><div class="card-head"><div class="card-title">تقييم ${fmtDate(a.date)} - ${esc(a.coach_name || '')}</div><div>${badge(a.ready_to_advance, { 1: ['جاهز للانتقال', 'green'], 0: ['يحتاج تدريباً', 'amber'] })} <span class="badge badge-blue">المتوسط ${avg}</span></div></div>
    <div class="card-body">
      <div class="detail-grid" style="margin-bottom:12px;">${topScores}</div>
      <div class="detail-grid"><div class="detail-item"><div class="k">نقاط القوة</div><div class="v" style="font-weight:600;color:var(--green);">${nl2br(a.strengths)}</div></div><div class="detail-item"><div class="k">نقاط الضعف</div><div class="v" style="font-weight:600;color:var(--amber);">${nl2br(a.weaknesses)}</div></div><div class="detail-item"><div class="k">التوصيات</div><div class="v" style="font-weight:600;">${nl2br(a.recommendations)}</div></div><div class="detail-item"><div class="k">التقييم القادم</div><div class="v">${fmtDate(a.next_assessment_date)}</div></div></div>
    </div></div>`;
  });

  const sessionsHtml = attendance.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>الحصة</th><th>التاريخ</th><th>الحالة</th><th>السبب</th><th>خصم الحصة</th></tr></thead><tbody>${attendance.map(a => `<tr><td>${esc(a.stitle || '')}</td><td>${fmtDateShort(a.sdate)}</td><td>${badge(a.status, ATT_STATUS)}</td><td>${esc(a.reason || '—')}</td><td>${a.deducted_session ? '<span class="badge badge-red">خصمت</span>' : '<span class="badge badge-green">لم تخصم</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">لا توجد سجلات حضور</div>';

  const testsHtml = tests.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>الاختبار</th><th>التاريخ</th><th>السباق</th><th>المسافة</th><th>الزمن</th><th>النتيجة</th></tr></thead><tbody>${tests.map(t => `<tr><td>${esc(t.name)}</td><td>${fmtDateShort(t.date)}</td><td>${esc(t.stroke)}</td><td>${t.distance} م</td><td><b>${t.time_seconds ? Math.floor(t.time_seconds / 60) + ':' + String(Math.round(t.time_seconds % 60)).padStart(2, '0') : '—'}</b></td><td>${esc(t.result || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">لا توجد اختبارات</div>';

  const subsHtml = subs.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>البرنامج</th><th>البداية</th><th>النهاية</th><th>الحصص</th><th>المبلغ</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>${subs.map(x => `<tr><td>${esc(x.program_name || '')}</td><td>${fmtDateShort(x.start_date)}</td><td>${fmtDateShort(x.end_date)}</td><td>${x.sessions_count}</td><td>${money(x.price)}</td><td>${money(x.paid_amount)}</td><td style="${x.remaining_amount > 0 ? 'color:var(--red);font-weight:800' : 'color:var(--green)'}">${money(x.remaining_amount)}</td><td>${badge(x.status, { active: ['سارٍ', 'green'], expiring: ['قرب الانتهاء', 'amber'], expired: ['منتهٍ', 'red'], frozen: ['مجمد', 'purple'], cancelled: ['ملغى', 'red'] })}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">لا توجد اشتراكات</div>';

  const timesHtml = times.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>الفريق</th><th>السباق</th><th>المسافة</th><th>أفضل زمن</th><th>الزمن السابق</th><th>التطور</th></tr></thead><tbody>${times.map(t => `<tr><td>${esc(t.team_name || '')}</td><td>${esc(t.race_type)}</td><td>${t.distance} م</td><td><b>${t.best_time ? t.best_time : '—'}</b></td><td>${t.previous_time || '—'}</td><td>${badge(t.improvement_pct, {})} ${t.improvement_pct ? t.improvement_pct + '%' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">لا توجد أزمنة مسجلة</div>';

  const details = `<div class="detail-grid">
    <div class="detail-item"><div class="k">رقم العضوية</div><div class="v">${esc(sw.membership_no)}</div></div>
    <div class="detail-item"><div class="k">تاريخ الميلاد</div><div class="v">${fmtDate(sw.birth_date)}</div></div>
    <div class="detail-item"><div class="k">النوع</div><div class="v">${esc(sw.gender)}</div></div>
    <div class="detail-item"><div class="k">رقم الهاتف</div><div class="v">${esc(sw.phone || '—')}</div></div>
    <div class="detail-item"><div class="k">البريد</div><div class="v">${esc(sw.email || '—')}</div></div>
    <div class="detail-item"><div class="k">المدرسة</div><div class="v">${esc(sw.school || '—')}</div></div>
    <div class="detail-item"><div class="k">ولي الأمر</div><div class="v">${esc(sw.guardian_name || '—')}</div></div>
    <div class="detail-item"><div class="k">صلة القرابة</div><div class="v">${esc(sw.guardian_relation || '—')}</div></div>
    <div class="detail-item"><div class="k">هاتف ولي الأمر</div><div class="v">${esc(sw.guardian_phone || '—')}</div></div>
    <div class="detail-item"><div class="k">بيانات الطوارئ</div><div class="v">${esc(sw.emergency_name || '—')} - ${esc(sw.emergency_phone || '')}</div></div>
    <div class="detail-item"><div class="k">الحالة الصحية</div><div class="v">${esc(sw.health_status || '—')}</div></div>
    <div class="detail-item"><div class="k">الحساسية</div><div class="v" style="${sw.allergies ? 'color:var(--amber)' : ''}">${esc(sw.allergies || 'لا يوجد')}</div></div>
    <div class="detail-item"><div class="k">ملاحظات طبية</div><div class="v">${esc(sw.medical_notes || '—')}</div></div>
    <div class="detail-item"><div class="k">المستوى الحالي</div><div class="v">${esc(sw.level_name || '—')}</div></div>
    <div class="detail-item"><div class="k">البرنامج</div><div class="v">${esc(sw.program_name || '—')}</div></div>
    <div class="detail-item"><div class="k">المجموعة</div><div class="v">${esc(sw.group_name || '—')}</div></div>
    <div class="detail-item"><div class="k">الكابتن</div><div class="v">${esc(sw.coach_name || '—')}</div></div>
    <div class="detail-item"><div class="k">أيام التدريب</div><div class="v">${esc(sw.training_days || '—')}</div></div>
    <div class="detail-item"><div class="k">موعد التدريب</div><div class="v">${esc(sw.training_time || '—')}</div></div>
    <div class="detail-item"><div class="k">تاريخ التسجيل</div><div class="v">${fmtDate(sw.register_date)}</div></div>
    <div class="detail-item"><div class="k">العنوان</div><div class="v">${esc(sw.address || '—')}</div></div>
  </div>`;

  const transitionsHtml = transitions.length ? transitions.map(t => `<div class="badge badge-blue">${fmtDateShort(t.date)}: ${esc(t.from_level || '—')} ← ${esc(t.to_level || '—')}</div>`).join(' ') : '<div class="empty-state">لا توجد انتقالات</div>';

  const docsHtml = docs.length ? docs.map(d => `<a class="btn btn-outline btn-sm" href="/admin/documents">${icon('documents')}${esc(d.title)}</a>`).join(' ') : '<div class="empty-state">لا توجد مستندات</div>';

  const tabs = `
  <div class="tabs">
    <a href="#overview" class="active" data-tab="overview">الملخص</a>
    <a href="#attendance" data-tab="attendance">الحضور والغياب</a>
    <a href="#assessments" data-tab="assessments">التقييمات</a>
    <a href="#tests" data-tab="tests">الاختبارات</a>
    <a href="#subs" data-tab="subs">الاشتراكات والمدفوعات</a>
    <a href="#times" data-tab="times">الفرق والأزمنة</a>
    <a href="#docs" data-tab="docs">المستندات</a>
  </div>
  <div data-tabpanel="overview">
    <div class="detail-grid" style="margin-bottom:14px;">${details}</div>
    ${card('سجل الانتقال بين المستويات', transitionsHtml)}
  </div>
  <div data-tabpanel="attendance" style="display:none;">${sessionsHtml}</div>
  <div data-tabpanel="assessments" style="display:none;">${assessmentsHtml || '<div class="empty-state">لا توجد تقييمات</div>'}</div>
  <div data-tabpanel="tests" style="display:none;">${testsHtml}</div>
  <div data-tabpanel="subs" style="display:none;">${subsHtml}</div>
  <div data-tabpanel="times" style="display:none;">${timesHtml}</div>
  <div data-tabpanel="docs" style="display:none;">${docsHtml}</div>`;

  const content = `
    <div class="profile-head">
      <div class="big-ava">${esc((sw.full_name || '?')[0])}</div>
      <div>
        <h2>${esc(sw.full_name)}</h2>
        <div class="sub">رقم العضوية: ${esc(sw.membership_no)} • ${esc(sw.program_name || '')} • ${esc(sw.group_name || '')}</div>
        <div class="badges">
          ${badge(sw.status, statusMap)}
          ${badge(sw.payment_status, { paid: ['مدفوع', 'green'], partial: ['سداد جزئي', 'amber'], unpaid: ['غير مسدد', 'red'] })}
        </div>
      </div>
      <div style="margin-inline-start:auto;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn" data-load-modal="/admin/swimmers/modal?mode=edit&id=${id}" style="background:rgba(255,255,255,.18);color:#fff;">${icon('edit')} تعديل</button>
        <a class="btn" href="/api/export/swimmers?id=${id}" style="background:rgba(255,255,255,.18);color:#fff;">${icon('download')} تصدير</a>
        <a class="btn" href="/admin/subscriptions/new?swimmer_id=${id}" style="background:rgba(255,255,255,.18);color:#fff;">${icon('plus')} اشتراك جديد</a>
      </div>
    </div>
    ${stats}
    ${tabs}
  `;
  return { status: 200, body: adminShell(user, { content, active: 'swimmers', counts: countsFor(user), notifications: notificationsFor(user), title: `ملف السباح - ${sw.full_name}` }) };
}

// ===== صفحة الحضور =====
function attendancePage(user, query) {
  if (!can(user, 'attendance', 'view')) return { status: 403, body: 'لا صلاحية' };
  const date = query.date || today();
  const sessions = db.prepare(`SELECT se.*, gr.name AS group_name, c.full_name AS coach_name, (SELECT COUNT(*) FROM attendance a WHERE a.session_id=se.id AND a.status='present') AS present FROM sessions se LEFT JOIN groups gr ON gr.id=se.group_id LEFT JOIN coaches c ON c.id=se.coach_id WHERE se.date=? ORDER BY se.start_time`).all(date);
  const recent = db.prepare(`SELECT a.*, se.date AS sdate, se.title AS stitle, sw.full_name AS swimmer_name FROM attendance a LEFT JOIN sessions se ON se.id=a.session_id LEFT JOIN swimmers sw ON sw.id=a.swimmer_id ORDER BY a.id DESC LIMIT 40`).all();

  const todayCards = sessions.map(se => {
    const count = db.prepare(`SELECT COUNT(*) c FROM swimmers WHERE group_id=?`).get(se.group_id).c;
    return `<div class="card" style="margin-bottom:10px;padding:14px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
      <div>${icon('clock', '')} <b>${se.start_time || '—'}</b></div>
      <div><b>${esc(se.title || '')}</b><div class="card-sub">${esc(se.group_name || '')} • ${esc(se.coach_name || '')}</div></div>
      <div style="margin-inline-start:auto;display:flex;gap:8px;align-items:center;">
        <span class="badge badge-green">حاضر ${se.present}</span>
        <span class="badge badge-gray">مسجل ${count}</span>
        <a class="btn btn-sm btn-primary" href="/admin/attendance/session/${se.id}">${icon('attendance')} تسجيل الحضور</a>
      </div>
    </div>`;
  }).join('');

  const recentRows = recent.map(a => `<tr><td>${esc(a.swimmer_name || '')}</td><td>${fmtDateShort(a.sdate)}</td><td>${esc(a.stitle || '')}</td><td>${badge(a.status, ATT_STATUS)}</td><td>${esc(a.reason || '—')}</td><td>${a.deducted_session ? '<span class="badge badge-red">خصمت</span>' : '<span class="badge badge-green">لم تخصم</span>'}</td></tr>`).join('');

  const content = `
    ${pageHead('الحضور والغياب', `سجل الحضور اليومي وحصص ${fmtDate(date)}`, `<form method="get" style="display:flex;gap:8px;"><input type="date" name="date" value="${date}" onchange="this.form.submit()" style="padding:8px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-family:inherit;"><a class="btn btn-outline" href="/api/export/attendance?date=${esc(date)}">${icon('download')} تصدير</a></form>`)}
    <div class="grid-2" style="align-items:start;">
      <div>${card(`حصص ${fmtDate(date)}`, todayCards || '<div class="empty-state">لا توجد حصص في هذا اليوم</div>', { icon: 'sessions' })}</div>
      <div>${card('آخر سجلات الحضور', `<div class="table-wrap"><table class="tbl"><thead><tr><th>السباح</th><th>التاريخ</th><th>الحصة</th><th>الحالة</th><th>السبب</th><th>الخصم</th></tr></thead><tbody>${recentRows}</tbody></table></div>`, { icon: 'attendance' })}</div>
    </div>
  `;
  return { status: 200, body: adminShell(user, { content, active: 'attendance', counts: countsFor(user), notifications: notificationsFor(user), title: 'الحضور والغياب' }) };
}

function attendanceSessionPage(user, id) {
  if (!can(user, 'attendance', 'add') && !can(user, 'attendance', 'edit')) return { status: 403, body: 'لا صلاحية' };
  const se = db.prepare(`SELECT se.*, gr.name AS group_name, c.full_name AS coach_name FROM sessions se LEFT JOIN groups gr ON gr.id=se.group_id LEFT JOIN coaches c ON c.id=se.coach_id WHERE se.id=?`).get(id);
  if (!se) return { status: 404, body: 'الحصة غير موجودة' };
  const swimmers = db.prepare(`SELECT * FROM swimmers WHERE group_id=? ORDER BY full_name`).all(se.group_id);
  const existing = db.prepare(`SELECT * FROM attendance WHERE session_id=?`).all(id);
  const exMap = {};
  existing.forEach(e => exMap[e.swimmer_id] = e);

  const rows = swimmers.map(s => {
    const e = exMap[s.id];
    const sel = (v) => (e && e.status === v) || (!e && v === 'present') ? 'selected' : '';
    return `<tr>
      <td>${esc(s.full_name)}</td>
      <td>${esc(s.membership_no)}</td>
      <td><select name="status_${s.id}" class="att-status">
        <option value="present" ${sel('present')}>حاضر</option>
        <option value="absent" ${sel('absent')}>غائب</option>
        <option value="apology" ${sel('apology')}>معتذر</option>
        <option value="justified" ${sel('justified')}>غياب بعذر</option>
      </select></td>
      <td><input type="text" name="reason_${s.id}" value="${esc(e ? e.reason : '')}" placeholder="السبب/الملاحظة" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);"></td>
      <td><select name="deduct_${s.id}"><option value="1" ${e && !e.deducted_session ? '' : 'selected'}>خصم الحصة</option><option value="0" ${e && !e.deducted_session ? 'selected' : ''}>بدون خصم</option></select></td>
    </tr>`;
  }).join('');

  const content = `
    ${pageHead('تسجيل الحضور', `${esc(se.title || '')} • ${fmtDate(se.date)} ${se.start_time || ''} • ${esc(se.group_name || '')} • ${esc(se.coach_name || '')}`, `<a class="btn btn-ghost" href="/admin/attendance">${icon('x')} رجوع</a>`)}
    <div class="card">
      <div class="card-body">
        <form id="attForm" data-session="${id}">
          <div class="table-wrap"><table class="tbl"><thead><tr><th>السباح</th><th>رقم العضوية</th><th>الحالة</th><th>السبب / الملاحظة</th><th>السياسة</th></tr></thead><tbody>${rows}</tbody></table></div>
          <div class="form-actions">
            <button type="button" class="btn btn-outline" id="allPresent">الكل حاضر</button>
            <button type="submit" class="btn btn-primary">${icon('check')} حفظ الحضور</button>
          </div>
        </form>
      </div>
    </div>
    <script>
      document.getElementById('allPresent').onclick = () => document.querySelectorAll('.att-status').forEach(s => s.value = 'present');
      document.getElementById('attForm').onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        const body = {};
        f.querySelectorAll('[name^="status_"]').forEach(i => body[i.name.replace('status_','s:')] = i.value);
        f.querySelectorAll('[name^="reason_"]').forEach(i => body[i.name.replace('reason_','r:')] = i.value);
        f.querySelectorAll('[name^="deduct_"]').forEach(i => body[i.name.replace('deduct_','d:')] = i.value);
        const res = await fetch('/api/attendance/session/' + f.dataset.session, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
        const data = await res.json();
        toast(data.message, data.ok ? 'success' : 'error');
        if (data.ok) setTimeout(() => window.location.href = '/admin/attendance', 700);
      };
    </script>
  `;
  return { status: 200, body: adminShell(user, { content, active: 'attendance', counts: countsFor(user), notifications: notificationsFor(user), title: 'تسجيل الحضور' }) };
}

// ===== التقييمات =====
function assessmentsPage(user, query) {
  if (!can(user, 'assessments', 'view')) return { status: 403, body: 'لا صلاحية' };
  const rows = db.prepare(`SELECT a.*, sw.full_name AS swimmer_name, c.full_name AS coach_name, l.name AS level_name FROM assessments a LEFT JOIN swimmers sw ON sw.id=a.swimmer_id LEFT JOIN coaches c ON c.id=a.coach_id LEFT JOIN levels l ON l.id=a.level_id ORDER BY a.id DESC LIMIT 200`).all();
  const bodyRows = rows.map(a => {
    const scores = parseJSON(a.scores, {});
    const vals = Object.values(scores).filter(v => v !== null && v !== undefined);
    const avg = vals.length ? (vals.reduce((s, v) => s + Number(v), 0) / vals.length).toFixed(1) : '—';
    return `<tr>
      <td>${esc(a.swimmer_name || '')}</td><td>${esc(a.coach_name || '')}</td>
      <td>${fmtDateShort(a.date)}</td><td>${esc(a.level_name || '')}</td>
      <td><span class="badge badge-blue">★ ${avg}</span></td>
      <td>${badge(a.ready_to_advance, { 1: ['نعم', 'green'], 0: ['لا', 'amber'] })}</td>
      <td><div class="actions">
        <button class="btn btn-ghost btn-sm" data-load-modal="/admin/assessments/modal?mode=edit&id=${a.id}">${icon('edit')} عرض/تعديل</button>
        <a class="btn btn-danger-outline btn-sm" href="/api/assessments/${a.id}" data-delete data-confirm="حذف هذا التقييم؟">${icon('trash')}</a>
      </div></td>
    </tr>`;
  }).join('');
  const canAdd = can(user, 'assessments', 'add');
  const content = `
    ${pageHead('التقييمات الفنية', 'نموذج تقييم شامل حسب نوع البرنامج', `${canAdd ? `<button class="btn btn-primary" data-load-modal="/admin/assessments/modal?mode=add">${icon('plus')} تقييم جديد</button>` : ''}`)}
    ${card('آخر التقييمات', `<div class="table-wrap"><table class="tbl"><thead><tr><th>السباح</th><th>المقيم</th><th>التاريخ</th><th>المستوى</th><th>المتوسط</th><th>جاهز للانتقال</th><th>إجراءات</th></tr></thead><tbody>${bodyRows}</tbody></table></div>`, { icon: 'assessments' })}
  `;
  return { status: 200, body: adminShell(user, { content, active: 'assessments', counts: countsFor(user), notifications: notificationsFor(user), title: 'التقييمات الفنية' }) };
}

function assessmentModal(user, query) {
  const mode = query.mode === 'edit' ? 'edit' : 'add';
  const perm = mode === 'edit' ? 'edit' : 'add';
  if (!can(user, 'assessments', perm)) return { status: 403, body: 'لا صلاحية' };
  let row = null;
  if (mode === 'edit') row = db.prepare(`SELECT * FROM assessments WHERE id=?`).get(Number(query.id));
  const swimmers = db.prepare(`SELECT id, full_name FROM swimmers ORDER BY full_name`).all();
  const coaches = db.prepare(`SELECT id, full_name FROM coaches ORDER BY full_name`).all();
  const programs = db.prepare(`SELECT id, name, program_type FROM programs ORDER BY name`).all();
  let criteria = [];
  let scores = {};
  if (row) {
    scores = parseJSON(row.scores, {});
    const prog = programs.find(p => p.id === row.program_id);
    if (prog) criteria = db.prepare(`SELECT * FROM assessment_criteria WHERE program_type=? ORDER BY order_index`).all(prog.program_type);
  }
  const swOpts = `<option value="">— اختر —</option>` + swimmers.map(s => `<option value="${s.id}" ${row && row.swimmer_id === s.id ? 'selected' : ''}>${esc(s.full_name)}</option>`).join('');
  const coOpts = `<option value="">— اختر —</option>` + coaches.map(c => `<option value="${c.id}" ${row && row.coach_id === c.id ? 'selected' : ''}>${esc(c.full_name)}</option>`).join('');
  const prOpts = `<option value="">— اختر —</option>` + programs.map(p => `<option value="${p.id}" data-type="${p.program_type}" ${row && row.program_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const critHtml = criteria.map(c => `<div class="field"><label>${esc(c.name_ar)} (0-10)</label><input type="number" step="0.5" min="0" max="10" name="score_${c.id}" value="${scores[c.id] !== undefined && scores[c.id] !== null ? scores[c.id] : ''}"></div>`).join('') || '<div class="empty-state">اختر البرنامج لعرض معايير التقييم</div>';

  return { status: 200, body: `<div class="modal" style="max-width:860px;">
  <div class="modal-head"><h3>${mode === 'edit' ? 'تعديل التقييم' : 'تقييم فني جديد'}</h3><button class="icon-btn" data-close-modal>${icon('x')}</button></div>
  <form data-post="/api/assessments" data-method="${mode === 'edit' ? 'PUT' : 'POST'}" ${mode === 'edit' ? `data-id="${row.id}"` : ''}>
    <div class="modal-body">
      <div class="form-grid" style="margin-bottom:16px;">
        <div class="field"><label>السباح <span class="req">*</span></label><select name="swimmer_id" required>${swOpts}</select></div>
        <div class="field"><label>الكابتن المقيم</label><select name="coach_id">${coOpts}</select></div>
        <div class="field"><label>البرنامج</label><select name="program_id" id="progSel">${prOpts}</select></div>
        <div class="field"><label>تاريخ التقييم</label><input type="date" name="date" value="${row ? row.date : today()}"></div>
      </div>
      <div class="form-grid" id="critGrid" style="background:var(--surface-2);padding:14px;border-radius:12px;">${critHtml}</div>
      <div class="form-grid" style="margin-top:16px;">
        <div class="field full"><label>نقاط القوة</label><textarea name="strengths">${esc(row ? row.strengths : '')}</textarea></div>
        <div class="field full"><label>نقاط الضعف</label><textarea name="weaknesses">${esc(row ? row.weaknesses : '')}</textarea></div>
        <div class="field full"><label>التوصيات</label><textarea name="recommendations">${esc(row ? row.recommendations : '')}</textarea></div>
        <div class="field"><label>جاهز للانتقال للمستوى التالي</label><label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer;"><input type="checkbox" data-bool name="ready_to_advance" value="1" ${row && row.ready_to_advance ? 'checked' : ''} style="width:18px;height:18px;"><span>نعم</span></label></div>
        <div class="field"><label>تاريخ التقييم القادم</label><input type="date" name="next_assessment_date" value="${row ? row.next_assessment_date : ''}"></div>
        <div class="field full"><label>ملاحظات</label><textarea name="notes">${esc(row ? row.notes : '')}</textarea></div>
      </div>
    </div>
    <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close-modal>إلغاء</button><button type="submit" class="btn btn-primary">${icon('check')} حفظ</button></div>
  </form>
</div>
<script>
document.getElementById('progSel').addEventListener('change', async (e) => {
  const opt = e.target.selectedOptions[0];
  if (!opt) return;
  const t = opt.dataset.type;
  const res = await fetch('/api/criteria/' + t);
  const crits = await res.json();
  const grid = document.getElementById('critGrid');
  if (!crits.length) { grid.innerHTML = '<div class="empty-state">لا توجد معايير لهذا النوع</div>'; return; }
  grid.innerHTML = crits.map(c => '<div class="field"><label>' + c.name_ar + ' (0-10)</label><input type="number" step="0.5" min="0" max="10" name="score_' + c.id + '"></div>').join('');
});
</script>` };
}

// ===== الإعدادات =====
function settingsPage(user) {
  if (!can(user, 'settings', 'edit')) return { status: 403, body: 'لا صلاحية' };
  const settings = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => settings[r.key] = r.value);
  const field = (k, label, type, hint) => `<div class="field"><label>${esc(label)}</label><input type="${type || 'text'}" name="${k}" value="${esc(settings[k] || '')}">${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
  const content = `
    ${pageHead('إعدادات النظام', 'الإعدادات العامة للأكاديمية والموقع', '')}
    <form data-post="/api/settings" style="max-width:900px;">
      <div class="card" style="margin-bottom:16px;"><div class="card-head"><div class="card-title">معلومات الأكاديمية</div></div><div class="card-body"><div class="form-grid">
        ${field('academy_name', 'اسم الأكاديمية')}
        ${field('academy_slogan', 'الشعار / الوصف المختصر')}
        ${field('phone', 'الهاتف', 'tel')}
        ${field('whatsapp', 'رقم واتساب', 'tel')}
        ${field('email', 'البريد الإلكتروني', 'email')}
        ${field('address', 'العنوان')}
        ${field('currency', 'العملة')}
      </div></div></div>
      <div class="card" style="margin-bottom:16px;"><div class="card-head"><div class="card-title">إعدادات البرامج</div></div><div class="card-body"><div class="form-grid">
        ${field('learn_sessions', 'عدد حصص برنامج تعليم السباحة الافتراضي', 'number', 'يستخدم افتراضياً عند إنشاء برنامج جديد من نوع تعليم سباحة')}
        ${field('policies', 'سياسة خصم الحصص', 'text', 'تظهر في إشعارات أولياء الأمور والبوابة')}
      </div></div></div>
      <div class="card" style="margin-bottom:16px;"><div class="card-head"><div class="card-title">وسائل التواصل الاجتماعي</div></div><div class="card-body"><div class="form-grid">
        ${field('social_facebook', 'فيسبوك')}
        ${field('social_instagram', 'إنستغرام')}
        ${field('social_twitter', 'تويتر')}
        ${field('social_youtube', 'يوتيوب')}
      </div></div></div>
      <div class="card"><div class="card-head"><div class="card-title">نظام النسخ الاحتياطي</div></div><div class="card-body">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <a class="btn btn-outline" href="/api/backup">${icon('download')} إنشاء نسخة احتياطية الآن</a>
          <span class="card-sub">يتم حفظ النسخ في مجلد backups/ داخل المشروع</span>
        </div>
      </div></div>
      <div class="form-actions" style="max-width:900px;"><button type="submit" class="btn btn-primary">${icon('check')} حفظ الإعدادات</button></div>
    </form>
  `;
  return { status: 200, body: adminShell(user, { content, active: 'settings', counts: countsFor(user), notifications: notificationsFor(user), title: 'إعدادات النظام' }) };
}

// ===== الصلاحيات =====
function rolesPage(user, query) {
  if (!can(user, 'users', 'edit')) return { status: 403, body: 'لا صلاحية' };
  const roles = db.prepare('SELECT * FROM roles ORDER BY is_system DESC').all();
  const modAr = {
    dashboard: 'لوحة التحكم', swimmers: 'السباحون', guardians: 'أولياء الأمور', coaches: 'المدربون',
    staff: 'الموظفون', programs: 'البرامج', levels: 'المستويات', groups: 'المجموعات', sessions: 'الحصص',
    attendance: 'الحضور', assessments: 'التقييمات', tests: 'الاختبارات', teams: 'الفرق', tournaments: 'البطولات',
    subscriptions: 'الاشتراكات', payments: 'المدفوعات', revenues: 'الإيرادات', expenses: 'المصروفات',
    coach_dues: 'مستحقات المدربين', incoming: 'الوارد', outgoing: 'الصادر', documents: 'المستندات',
    notifications: 'الإشعارات', complaints: 'الشكاوى', reports: 'التقارير', branches: 'الفروع', pools: 'الحمامات',
    users: 'المستخدمون', settings: 'الإعدادات', audit: 'سجل النشاط'
  };
  const actAr = { view: 'عرض', add: 'إضافة', edit: 'تعديل', del: 'حذف', approve: 'اعتماد' };
  const cards = roles.map(r => {
    let perms = {};
    try { perms = JSON.parse(r.permissions || '{}'); } catch (e) {}
    const grid = Object.keys(perms).map(m => {
      const p = perms[m] || {};
      const checks = ['view', 'add', 'edit', 'del', 'approve'].map(a =>
        `<label style="display:flex;align-items:center;gap:5px;font-size:12px;"><input type="checkbox" data-role="${r.role}" data-mod="${m}" data-act="${a}" ${p[a] ? 'checked' : ''}>${actAr[a]}</label>`).join('');
      return `<div class="detail-item"><div class="k">${esc(modAr[m] || m)}</div><div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">${checks}</div></div>`;
    }).join('');
    return `<div class="card" style="margin-bottom:14px;"><div class="card-head"><div class="card-title">${esc(r.name_ar)} <span class="badge badge-blue">${esc(r.role)}</span></div><button class="btn btn-sm btn-primary" onclick="saveRole('${r.role}')">${icon('check')} حفظ</button></div><div class="card-body"><div class="detail-grid">${grid}</div></div></div>`;
  }).join('');
  const content = `
    ${pageHead('الأدوار والصلاحيات', 'حدد الصفحات والإجراءات المتاحة لكل دور', '')}
    ${cards}
    <script>
    async function saveRole(role) {
      const perms = {};
      document.querySelectorAll('[data-role="' + role + '"]').forEach(cb => {
        const m = cb.dataset.mod, a = cb.dataset.act;
        perms[m] = perms[m] || {};
        perms[m][a] = cb.checked ? 1 : 0;
      });
      const res = await fetch('/api/roles/' + role, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(perms) });
      const data = await res.json();
      toast(data.message, data.ok ? 'success' : 'error');
    }
    </script>
  `;
  return { status: 200, body: adminShell(user, { content, active: 'roles', counts: countsFor(user), notifications: notificationsFor(user), title: 'الصلاحيات' }) };
}

// ===== الإشعارات =====
function notificationsPage(user, query) {
  if (!can(user, 'notifications', 'view')) return { status: 403, body: 'لا صلاحية' };
  const rows = db.prepare(`SELECT no.*, u.full_name AS user_name FROM notifications no LEFT JOIN users u ON u.id=no.user_id ORDER BY no.id DESC LIMIT 100`).all();
  const bodyRows = rows.map(n => `<tr>
    <td>${esc(n.type || 'عام')}</td><td>${esc(n.title)}</td><td style="max-width:360px;">${esc(n.body)}</td>
    <td>${esc(n.user_name || 'الكل')}</td><td>${fmtDate(n.created_at, true)}</td>
    <td>${badge(n.is_read, { 1: ['مقروء', 'green'], 0: ['جديد', 'amber'] })}</td>
    <td><a class="btn btn-ghost btn-sm" href="/api/notifications/${n.id}/read">تم القراءة</a><a class="btn btn-danger-outline btn-sm" href="/api/notifications/${n.id}" data-delete data-confirm="حذف الإشعار؟">${icon('trash')}</a></td></tr>`).join('');
  const users = db.prepare(`SELECT id, full_name FROM users WHERE role IN ('admin','academy_manager','reception','finance','coach','team_manager','rescue_manager') ORDER BY full_name`).all();
  const content = `
    ${pageHead('الإشعارات', 'إرسال ومتابعة الإشعارات', `<button class="btn btn-primary" data-load-modal="/admin/notifications/modal?mode=add">${icon('plus')} إشعار جديد</button>`)}
    ${card('إرسال إشعار سريع', `<form data-post="/api/notifications" style="display:flex;gap:10px;flex-wrap:wrap;">
      <select name="user_id" style="padding:9px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);"><option value="">للجميع</option>${users.map(u => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('')}</select>
      <input name="title" placeholder="عنوان الإشعار" required style="padding:9px;border:1px solid var(--border);border-radius:10px;flex:1;min-width:200px;background:var(--surface);color:var(--text);">
      <button class="btn btn-primary" type="submit">${icon('check')} إرسال</button>
    </form>`, { icon: 'notifications' })}
    ${card('سجل الإشعارات', `<div class="table-wrap"><table class="tbl"><thead><tr><th>النوع</th><th>العنوان</th><th>المحتوى</th><th>المستلم</th><th>التاريخ</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>${bodyRows}</tbody></table></div>`, { icon: 'bell' })}
  `;
  return { status: 200, body: adminShell(user, { content, active: 'notifications', counts: countsFor(user), notifications: notificationsFor(user), title: 'الإشعارات' }) };
}

// ===== إيصال اشتراك =====
function receiptPage(user, id) {
  if (!can(user, 'subscriptions', 'view')) return { status: 403, body: 'لا صلاحية' };
  const su = db.prepare(`SELECT su.*, sw.full_name AS swimmer_name, sw.membership_no, pr.name AS program_name, gr.name AS group_name FROM subscriptions su LEFT JOIN swimmers sw ON sw.id=su.swimmer_id LEFT JOIN programs pr ON pr.id=su.program_id LEFT JOIN groups gr ON gr.id=su.group_id WHERE su.id=?`).get(id);
  if (!su) return { status: 404, body: 'الاشتراك غير موجود' };
  const settings = getSettings();
  const content = `
    <div class="card" style="max-width:720px;margin:0 auto;">
      <div class="card-body" style="text-align:center;">
        <div style="font-size:22px;font-weight:900;color:var(--primary);">${esc(settings.academy_name || '')}</div>
        <div class="card-sub">${esc(settings.address || '')} • ${esc(settings.phone || '')}</div>
        <div style="margin:16px 0;border-top:2px dashed var(--border);padding-top:16px;">
          <div style="font-size:18px;font-weight:900;">إيصال اشتراك</div>
          <div class="card-sub">رقم الإيصال: ${esc(su.receipt_no || '—')}</div>
        </div>
        <div class="detail-grid" style="text-align:right;">
          <div class="detail-item"><div class="k">السباح</div><div class="v">${esc(su.swimmer_name)}</div></div>
          <div class="detail-item"><div class="k">رقم العضوية</div><div class="v">${esc(su.membership_no)}</div></div>
          <div class="detail-item"><div class="k">البرنامج</div><div class="v">${esc(su.program_name || '—')}</div></div>
          <div class="detail-item"><div class="k">المجموعة</div><div class="v">${esc(su.group_name || '—')}</div></div>
          <div class="detail-item"><div class="k">عدد الحصص</div><div class="v">${su.sessions_count}</div></div>
          <div class="detail-item"><div class="k">مدة الاشتراك</div><div class="v">${fmtDateShort(su.start_date)} ← ${fmtDateShort(su.end_date)}</div></div>
          <div class="detail-item"><div class="k">سعر الاشتراك</div><div class="v">${money(su.price)}</div></div>
          <div class="detail-item"><div class="k">المدفوع</div><div class="v" style="color:var(--green);">${money(su.paid_amount)}</div></div>
          <div class="detail-item"><div class="k">المتبقي</div><div class="v" style="color:${su.remaining_amount > 0 ? 'var(--red)' : 'var(--green)'};">${money(su.remaining_amount)}</div></div>
          <div class="detail-item"><div class="k">طريقة الدفع</div><div class="v">${esc(PAY_METHOD[su.payment_method] || su.payment_method || '—')}</div></div>
          <div class="detail-item"><div class="k">تاريخ الدفع</div><div class="v">${fmtDateShort(su.pay_date)}</div></div>
        </div>
        <div class="form-actions" style="justify-content:center;">
          <a class="btn btn-ghost" href="/admin/subscriptions">${icon('x')} رجوع</a>
          <button class="btn btn-primary" data-print>${icon('print')} طباعة</button>
        </div>
      </div>
    </div>
  `;
  return { status: 200, body: adminShell(user, { content, active: 'subscriptions', counts: countsFor(user), notifications: notificationsFor(user), title: 'إيصال اشتراك' }) };
}

// ===== ملف الكابتن =====
function coachProfile(user, id) {
  if (!can(user, 'coaches', 'view')) return { status: 403, body: 'لا صلاحية' };
  const c = db.prepare(`SELECT * FROM coaches WHERE id=?`).get(id);
  if (!c) return { status: 404, body: 'غير موجود' };
  const swimmers = db.prepare(`SELECT * FROM swimmers WHERE coach_id=?`).all(id);
  const groups = db.prepare(`SELECT gr.*, pr.name AS program_name FROM groups gr LEFT JOIN programs pr ON pr.id=gr.program_id WHERE gr.coach_id=?`).all(id);
  const dues = db.prepare(`SELECT * FROM coach_dues WHERE coach_id=? ORDER BY id DESC`).all(id);
  const swRows = swimmers.map(s => `<tr><td>${esc(s.full_name)}</td><td>${esc(s.membership_no)}</td><td>${esc(s.group_id || '—')}</td><td>${badge(s.status, ENTITIES.swimmers.columns.find(c => c.k === 'status').map)}</td></tr>`).join('');
  const content = `
    <div class="profile-head">
      <div class="big-ava">${esc((c.full_name || '?')[0])}</div>
      <div>
        <h2>${esc(c.full_name)}</h2>
        <div class="sub">${esc(c.specialty || '')} • خبرة ${c.experience_years || 0} سنة • ${esc(c.qualification || '')}</div>
      </div>
      <div style="margin-inline-start:auto;display:flex;gap:8px;">
        <button class="btn" data-load-modal="/admin/coaches/modal?mode=edit&id=${id}" style="background:rgba(255,255,255,.18);color:#fff;">${icon('edit')} تعديل</button>
      </div>
    </div>
    ${statCards([
      { val: swimmers.length, label: 'عدد السباحين', color: 'blue', icon: 'swimmers' },
      { val: groups.length, label: 'المجموعات', color: 'cyan', icon: 'groups' },
      { val: c.performance_rating ? c.performance_rating.toFixed(1) : '—', label: 'تقييم الأداء', color: 'amber', icon: 'assessments' },
      { val: fmtDateShort(c.license_expiry), label: 'انتهاء الترخيص', color: 'purple', icon: 'calendar' }
    ])}
    <div class="grid-2">
      ${card('المجموعات', groups.length ? groups.map(g => `<a href="/admin/groups" class="badge badge-blue" style="margin:3px;">${esc(g.name)} • ${esc(g.program_name || '')}</a>`).join('') : '<div class="empty-state">لا توجد مجموعات</div>', { icon: 'groups' })}
      ${card('مستحقات مالية', dues.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>الشهر</th><th>المستحق</th><th>الصافي</th><th>الحالة</th></tr></thead><tbody>${dues.map(d => `<tr><td>${esc(d.month)}</td><td>${money(d.amount)}</td><td>${money(d.net_amount)}</td><td>${badge(d.status, { paid: ['مدفوع', 'green'], pending: ['معلق', 'amber'] })}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">لا توجد مستحقات</div>', { icon: 'coach_dues' })}
    </div>
    ${card('السباحين المسؤول عنهم', swRows ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>الاسم</th><th>رقم العضوية</th><th>المجموعة</th><th>الحالة</th></tr></thead><tbody>${swRows}</tbody></table></div>` : '<div class="empty-state">لا يوجد سباحون</div>', { icon: 'swimmers' })}
  `;
  return { status: 200, body: adminShell(user, { content, active: 'coaches', counts: countsFor(user), notifications: notificationsFor(user), title: `ملف الكابتن - ${c.full_name}` }) };
}

// ===== البحث الشامل =====
function searchPage(user, query) {
  const q = (query.q || '').trim();
  const results = [];
  if (q) {
    try {
      const swimmers = db.prepare(`SELECT * FROM swimmers WHERE full_name LIKE ? OR membership_no LIKE ? OR phone LIKE ? OR guardian_phone LIKE ? LIMIT 15`).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      swimmers.forEach(s => results.push({ title: s.full_name, sub: `سباح • ${s.membership_no}`, link: `/admin/swimmers/${s.id}`, icon: 'swimmers' }));
      const guardians = db.prepare(`SELECT * FROM guardians WHERE full_name LIKE ? OR phone LIKE ? LIMIT 10`).all(`%${q}%`, `%${q}%`);
      guardians.forEach(g => results.push({ title: g.full_name, sub: `ولي أمر`, link: `/admin/guardians`, icon: 'guardians' }));
      const coaches = db.prepare(`SELECT * FROM coaches WHERE full_name LIKE ? OR phone LIKE ? LIMIT 10`).all(`%${q}%`, `%${q}%`);
      coaches.forEach(c => results.push({ title: c.full_name, sub: `كابتن`, link: `/admin/coaches/${c.id}`, icon: 'coaches' }));
      const subs = db.prepare(`SELECT su.*, sw.full_name AS n FROM subscriptions su LEFT JOIN swimmers sw ON sw.id=su.swimmer_id WHERE su.receipt_no LIKE ? LIMIT 10`).all(`%${q}%`);
      subs.forEach(su => results.push({ title: su.receipt_no, sub: `اشتراك ${su.n}`, link: `/admin/subscriptions`, icon: 'subscriptions' }));
      const progs = db.prepare(`SELECT * FROM programs WHERE name LIKE ? LIMIT 10`).all(`%${q}%`);
      progs.forEach(p => results.push({ title: p.name, sub: 'برنامج', link: '/admin/programs', icon: 'programs' }));
    } catch (e) {}
  }
  const rows = results.map(r => `<a class="detail-item" href="${r.link}" style="display:flex;align-items:center;gap:12px;text-decoration:none;">
    <div class="avatar-sm">${icon(r.icon)}</div><div><div style="font-weight:800;">${esc(r.title)}</div><div class="card-sub">${esc(r.sub)}</div></div></a>`).join('');
  const content = `
    ${pageHead('بحث شامل', 'نتائج البحث عن: ' + esc(q || '—'), '')}
    ${card('النتائج', rows || '<div class="empty-state">لا توجد نتائج مطابقة</div>', { icon: 'search' })}
  `;
  return { status: 200, body: adminShell(user, { content, counts: countsFor(user), notifications: notificationsFor(user), title: 'بحث' }) };
}

// ===== الصفحات الفرعية (الحصص) =====
function sessionQuick(user, query) {
  return listPage('sessions', user, query);
}

const adminRoutes = {
  '/admin': (u, q) => require('./dashboard').dashboardPage(u, q),
  '/admin/search': searchPage,
  '/admin/attendance': attendancePage,
  '/admin/assessments': assessmentsPage,
  '/admin/settings': settingsPage,
  '/admin/roles': rolesPage,
  '/admin/notifications': notificationsPage,
  '/admin/reports': (u, q) => require('./reports').reportsPage(u, q)
};

function adminRoute(req, res, user, path, query) {
  // ملف السباح
  let m = path.match(/^\/admin\/swimmers\/(\d+)$/);
  if (m) return swimmerProfile(user, Number(m[1]), query);
  m = path.match(/^\/admin\/coaches\/(\d+)$/);
  if (m) return coachProfile(user, Number(m[1]), query);
  m = path.match(/^\/admin\/subscriptions\/(\d+)\/receipt$/);
  if (m) return receiptPage(user, Number(m[1]), query);
  m = path.match(/^\/admin\/attendance\/session\/(\d+)$/);
  if (m) return attendanceSessionPage(user, Number(m[1]), query);
  m = path.match(/^\/admin\/(\w+)\/modal$/);
  if (m) {
    if (m[1] === 'assessments') return assessmentModal(user, query);
    return modalFragment(m[1], user, query);
  }
  if (adminRoutes[path]) return adminRoutes[path](user, query);
  m = path.match(/^\/admin\/(\w+)$/);
  if (m) return listPage(m[1], user, query);
  return { status: 404, body: 'غير موجود' };
}

module.exports = { adminRoute, countsFor, notificationsFor };
