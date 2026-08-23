'use strict';
const { esc, money, fmtDate, fmtDateShort, nl2br } = require('./util');
const { can } = require('./auth');
const db = require('./db');
const { ENTITIES, PAY_METHOD } = require('./config');

// ===== الأيقونات =====
const ICONS = {
  dashboard: '<path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>',
  swimmers: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2"/><path d="M17 13h4l1 4-3 3-2-2"/>',
  guardians: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  coaches: '<circle cx="12" cy="7" r="4"/><path d="M9 12h6l3 9-3-2-3 2-3-2-3 2z"/><path d="M12 3v2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6 6 0 0 1 4 6"/>',
  programs: '<path d="M4 4h16v16H4z"/><path d="M4 9h16M9 4v16"/>',
  levels: '<path d="M3 18l4-4 4 4 4-4 6 6"/><path d="M3 6l4-4 4 4 4-4 6 6"/>',
  groups: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7 6h10M5 8.5L12 15.5 19 8.5"/>',
  sessions: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M7 15h4M7 18h6"/>',
  attendance: '<path d="M9 11l3 3 8-8"/><circle cx="12" cy="12" r="10"/>',
  assessments: '<path d="M12 2l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 15.7 6.8 18.1l1-5.8L3.5 8.2l5.9-.9z"/>',
  tests: '<path d="M9 3h6v4l-3 3-3-3z"/><path d="M9 10v11M15 10v11M7 21h10"/>',
  teams: '<path d="M8 3h8l4 18-4-3-4 3-4-3-4 3z"/>',
  tournaments: '<path d="M12 2v20M8 4H4v3a5 5 0 0 0 4 4M16 4h4v3a5 5 0 0 1-4 4M12 8c2-1 4 0 4 2s-2 2-4 2-4-1-4-3 2-2 4-1z"/>',
  subscriptions: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M9 5v3M15 5v3"/>',
  payments: '<rect x="2" y="6" width="20" height="14" rx="2"/><circle cx="12" cy="13" r="3"/><path d="M5 10h2"/>',
  revenues: '<path d="M12 2v20M17 6H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H7"/>',
  expenses: '<path d="M12 2v20M17 6H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H7"/>',
  coach_dues: '<path d="M12 2l7 3v6c0 5-3 9-7 11-4-2-7-6-7-11V5z"/><path d="M9 12l2 2 4-4"/>',
  incoming: '<path d="M3 13a9 9 0 0 1 18 0"/><path d="M12 13l4 4m-4-4l-4 4m4-4v8"/>',
  outgoing: '<path d="M3 13a9 9 0 0 1 18 0"/><path d="M12 21l4-4m-4 4l-4-4m4 4v-8"/>',
  documents: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h7"/>',
  complaints: '<path d="M12 21a9 9 0 1 0-9-9c0 3 2 5 4 6l-1 4 4-2c1 .3 2 .3 3 0"/><path d="M9 9h.01M15 9h.01M9 13h6"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  branches: '<path d="M3 21h18M5 21V8l7-5 7 5v13"/><path d="M9 21v-5h6v5"/>',
  pools: '<path d="M2 17c3 0 3 2 5 2s2-2 5-2 2 2 5 2 2-2 5-2v3c-3 0-3 2-5 2s-2-2-5-2-2 2-5 2-2-2-5-2zM2 12c3 0 3 2 5 2s2-2 5-2 2 2 5 2 2-2 5-2v-3c-3 0-3 2-5 2s-2-2-5-2-2 2-5 2-2-2-5-2z"/>',
  notifications: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  messages: '<path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"/>',
  audit: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h5M8 16h8"/>',
  gallery: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5-11 11"/>',
  faqs: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4M12 17h.01"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  key: '<path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15 7.5l3 3"/>',
  wave: '<path d="M2 12c3 0 3-2 5-2s2 2 5 2 2-2 5-2 2 2 5 2M2 17c3 0 3-2 5-2s2 2 5 2 2-2 5-2 2 2 5 2M2 7c3 0 3-2 5-2s2 2 5 2 2-2 5-2 2 2 5 2"/>',
  medal: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14L7 22l5-3 5 3-1.5-8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'
};
function icon(name, cls) {
  const p = ICONS[name] || ICONS.settings;
  return `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

// ===== الإعدادات العامة =====
let settingsCache = null;
function getSettings() {
  if (settingsCache) return settingsCache;
  settingsCache = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => settingsCache[r.key] = r.value);
  return settingsCache;
}

// ===== شارات =====
function badge(status, map) {
  if (map && map[status]) return `<span class="badge badge-${map[status][1]}"><span class="badge-dot"></span>${esc(map[status][0])}</span>`;
  if (map && map[status] !== undefined && typeof map[status] === 'string') return `<span class="badge badge-blue">${esc(map[status])}</span>`;
  return `<span class="badge badge-gray">${esc(status || '—')}</span>`;
}

// ===== تصيير خلية جدول =====
function renderCell(row, col) {
  const v = row[col.k];
  const map = col.map;
  switch (col.type) {
    case 'avatar': {
      const name = v || row.full_name || '';
      const sub = row.membership_no || row.email || row.phone || row.specialty || '';
      const initial = (name[0] || '؟');
      return `<div class="cell-user"><div class="avatar-sm">${esc(initial)}</div><div><div class="n">${esc(name)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ''}</div></div>`;
    }
    case 'money':
      return `<span style="font-weight:800">${money(v)}</span>`;
    case 'date': {
      if (!v) return '—';
      const d = new Date(v); const today = new Date(); today.setHours(0,0,0,0);
      const diff = Math.round((d - today) / 86400000);
      const warn = col.warnDays || 10;
      if (diff >= 0 && diff <= warn) return `${fmtDateShort(v)} ${badge('أوشك', { 'أوشك': ['قريب', 'amber'] })}`;
      if (diff < 0) return `${fmtDateShort(v)} ${badge('م', { m: ['مضى', 'red'] })}`;
      return fmtDateShort(v);
    }
    case 'datetime': return fmtDate(v, true);
    case 'time': {
      if (!v && v !== 0) return '—';
      const sec = Number(v);
      if (sec === 0) return '—';
      const m = Math.floor(sec / 60), s = Math.round(sec % 60);
      return `<span style="font-weight:800">${m}:${String(s).padStart(2, '0')}</span>`;
    }
    case 'status': return badge(v, map);
    case 'code': return `<code style="background:var(--surface-2);padding:2px 8px;border-radius:6px;font-size:12px;">${esc(v || '—')}</code>`;
    case 'sessions': {
      const total = Number(row.total_sessions) || 0, done = Number(row.done_sessions) || 0;
      const pct = total > 0 ? Math.round(done / total * 100) : 0;
      const cls = pct >= 70 ? 'green' : pct >= 40 ? '' : 'amber';
      return `<div style="display:flex;align-items:center;gap:8px;"><div class="progress ${cls}" style="width:80px"><span style="width:${pct}%"></span></div><small style="font-weight:700;white-space:nowrap">${done}/${total}</small></div>`;
    }
    case 'rating': {
      const r = Number(v) || 0;
      return `<span class="badge badge-blue">★ ${r.toFixed(1)}</span>`;
    }
    case 'cap': {
      const cap = Number(row.max_capacity) || 0;
      const n = Number(v) || 0;
      const full = n >= cap && cap > 0;
      return `<span class="badge ${full ? 'badge-red' : 'badge-blue'}">${n} / ${cap}</span>`;
    }
    case 'pct': {
      const p = Number(v) || 0;
      const pos = p > 0;
      return `<span class="badge ${pos ? 'badge-green' : 'badge-red'}">${pos ? '↑' : '↓'} ${Math.abs(p)}%</span>`;
    }
    case 'rank': {
      if (!v && v !== 0) return '—';
      const cls = v === 1 ? 'gold' : v === 2 ? 'silver' : v === 3 ? 'bronze' : '';
      return `<span class="rank ${cls}">${v}</span>`;
    }
    case 'num':
      return Number(v || 0).toLocaleString('ar-EG');
    default: {
      const txt = (v === null || v === undefined) ? '—' : v;
      return esc(txt);
    }
  }
}

// ===== قائمة الجداول =====
function renderTable(entity, rows, user, opts) {
  opts = opts || {};
  const conf = ENTITIES[entity];
  if (!conf) return '';
  if (!rows.length) {
    return `<div class="empty-state">${icon('wave')}<div>لا توجد بيانات لعرضها</div></div>`;
  }
  const canEdit = can(user, conf.module, 'edit');
  const canDel = can(user, conf.module, 'del');
  let head = '';
  conf.columns.forEach(c => { head += `<th>${esc(c.label)}</th>`; });
  head += '<th style="width:120px">إجراءات</th>';
  let body = '';
  rows.forEach(r => {
    let tds = '';
    conf.columns.forEach(c => { tds += `<td>${renderCell(r, c)}</td>`; });
    const actions = [];
    if (opts.viewLink && !conf.readOnly) actions.push(`<a class="btn btn-ghost btn-sm" href="${opts.viewLink(r)}">${icon('eye')}عرض</a>`);
    else if (opts.viewLink) actions.push(`<a class="btn btn-ghost btn-sm" href="${opts.viewLink(r)}">${icon('eye')}عرض</a>`);
    if (canEdit && !conf.readOnly) actions.push(`<button class="btn btn-ghost btn-sm" data-load-modal="/admin/${entity}/modal?mode=edit&id=${r.id}">${icon('edit')}تعديل</button>`);
    if (canDel && !conf.readOnly) actions.push(`<a class="btn btn-danger-outline btn-sm" href="/api/${entity}/${r.id}" data-delete data-confirm="حذف هذا السجل؟">${icon('trash')}حذف</a>`);
    tds += `<td><div class="actions">${actions.join('')}</div></td>`;
    body += `<tr>${tds}</tr>`;
  });
  return `<div class="table-wrap"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ===== حقول النموذج =====
function fkOptions(table, text, value) {
  const col = value || 'id';
  return db.prepare(`SELECT ${col} AS val, ${text} AS label FROM ${table} ORDER BY ${text}`).all();
}
function renderField(f, val) {
  const v = val !== undefined && val !== null ? val : '';
  const req = f.required ? `<span class="req">*</span>` : '';
  let inner = '';
  const attrs = `name="${f.name}"`;
  switch (f.type) {
    case 'textarea':
      inner = `<textarea ${attrs} ${f.required ? 'required' : ''}>${esc(v)}</textarea>`;
      break;
    case 'select': {
      let opts = '';
      (f.options || []).forEach(o => { opts += `<option value="${esc(o[0])}" ${String(v) === String(o[0]) ? 'selected' : ''}>${esc(o[1])}</option>`; });
      inner = `<select ${attrs} ${f.required ? 'required' : ''}>${opts}</select>`;
      break;
    }
    case 'fk': {
      let opts = `<option value="">— اختر —</option>`;
      fkOptions(f.table, f.text, f.value).forEach(o => {
        const selected = String(v) === String(o.val) ? 'selected' : '';
        opts += `<option value="${esc(o.val)}" ${selected}>${esc(o.label)}</option>`;
      });
      inner = `<select ${attrs} ${f.required ? 'required' : ''}>${opts}</select>`;
      break;
    }
    case 'switch': {
      const checked = Number(v) === Number(f.on) ? 'checked' : '';
      inner = `<label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer;">
        <input type="checkbox" ${attrs} data-bool value="${f.on}" ${checked} style="width:18px;height:18px;">
        <span style="color:var(--text-2);font-size:13px;">تفعيل</span></label>`;
      break;
    }
    case 'password':
      inner = `<input type="password" ${attrs} autocomplete="new-password">`;
      break;
    default:
      inner = `<input type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'time' ? 'time' : f.type === 'month' ? 'month' : 'text'}" ${attrs} value="${esc(v)}" ${f.required ? 'required' : ''}>`;
  }
  return `<div class="field ${f.full ? 'full' : ''}"><label>${esc(f.label)} ${req}</label>${inner}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
}

function renderFormFields(entity, row) {
  const conf = ENTITIES[entity];
  if (!conf || !conf.fields) return '<div class="field full"><label>لا توجد حقول</label></div>';
  return conf.fields.map(f => renderField(f, row ? row[f.name] : '')).join('');
}

// ===== مودال إضافة/تعديل =====
function renderModal(entity, row, mode) {
  const conf = ENTITIES[entity];
  const title = mode === 'edit' ? `تعديل: ${row ? (row.full_name || row.name || row.title || row.subject || row.id) : ''}` : `إضافة جديد - ${conf.title}`;
  return `<div class="modal" style="max-width:${conf.wide ? 900 : 720}px;">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close-modal>${icon('x')}</button></div>
    <form data-post="/api/${entity}" data-method="${mode === 'edit' ? 'PUT' : 'POST'}" ${mode === 'edit' ? `data-id="${row.id}"` : ''}>
      <div class="modal-body"><div class="form-grid">${renderFormFields(entity, row)}</div></div>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" data-close-modal>إلغاء</button>
        <button type="submit" class="btn btn-primary">${icon('check')} حفظ</button>
      </div>
    </form>
  </div>`;
}

// ===== الشريط الجانبي =====
const NAV = [
  { group: 'عام', items: [['لوحة التحكم', '/admin', 'dashboard', 'dashboard']] },
  {
    group: 'الأعضاء', items: [
      ['السباحون', '/admin/swimmers', 'swimmers', 'swimmers'],
      ['أولياء الأمور', '/admin/guardians', 'guardians', 'guardians'],
      ['الكباتن والمدربون', '/admin/coaches', 'coaches', 'coaches'],
      ['المستخدمون والموظفون', '/admin/users', 'users', 'users']
    ]
  },
  {
    group: 'التدريب', items: [
      ['البرامج والدورات', '/admin/programs', 'programs', 'programs'],
      ['المستويات', '/admin/levels', 'levels', 'levels'],
      ['المجموعات التدريبية', '/admin/groups', 'groups', 'groups'],
      ['الحصص والجداول', '/admin/sessions', 'sessions', 'sessions'],
      ['الحضور والغياب', '/admin/attendance', 'attendance', 'attendance']
    ]
  },
  {
    group: 'الفني والفرق', items: [
      ['التقييمات الفنية', '/admin/assessments', 'assessments', 'assessments'],
      ['الاختبارات', '/admin/tests', 'tests', 'tests'],
      ['الفرق', '/admin/teams', 'teams', 'teams'],
      ['لاعبو الفرق', '/admin/team_members', 'teams', 'team_members'],
      ['الأزمنة والقياسات', '/admin/team_times', 'teams', 'team_times'],
      ['البطولات', '/admin/tournaments', 'tournaments', 'tournaments'],
      ['مشاركات البطولات', '/admin/tournaments_participations', 'tournaments', 'tournaments_participations']
    ]
  },
  {
    group: 'الاشتراكات والمالية', items: [
      ['الاشتراكات', '/admin/subscriptions', 'subscriptions', 'subscriptions'],
      ['المدفوعات', '/admin/payments', 'payments', 'payments'],
      ['الشهادات', '/admin/certificates', 'subscriptions', 'certificates'],
      ['الإيرادات', '/admin/revenues', 'revenues', 'revenues'],
      ['المصروفات', '/admin/expenses', 'expenses', 'expenses'],
      ['مستحقات المدربين', '/admin/coach_dues', 'coach_dues', 'coach_dues']
    ]
  },
  {
    group: 'الإدارة', items: [
      ['الوارد', '/admin/incoming', 'incoming', 'incoming'],
      ['الصادر', '/admin/outgoing', 'outgoing', 'outgoing'],
      ['المستندات والأوراق', '/admin/documents', 'documents', 'documents'],
      ['الشكاوى والطلبات', '/admin/complaints', 'complaints', 'complaints'],
      ['طلبات الاشتراك', '/admin/subscription_requests', 'reception', 'subscription_requests'],
      ['التقارير', '/admin/reports', 'reports', 'reports'],
      ['الفروع', '/admin/branches', 'branches', 'branches'],
      ['حمامات السباحة', '/admin/pools', 'pools', 'pools']
    ]
  },
  {
    group: 'النظام', items: [
      ['الإشعارات', '/admin/notifications', 'notifications', 'notifications'],
      ['الرسائل الداخلية', '/admin/messages', 'notifications', 'messages'],
      ['الصحافة والإعلانات', '/admin/news', 'settings', 'news'],
      ['المعرض', '/admin/gallery', 'settings', 'gallery'],
      ['الأسئلة الشائعة', '/admin/faqs', 'settings', 'faqs'],
      ['الأدوار والصلاحيات', '/admin/roles', 'users', 'roles'],
      ['إعدادات النظام', '/admin/settings', 'settings', 'settings'],
      ['سجل النشاط', '/admin/audit', 'audit', 'audit']
    ]
  }
];

function sidebar(user, activePath, counts) {
  let out = '';
  NAV.forEach(g => {
    const items = g.items.filter(([name, href, module]) => can(user, module, 'view'));
    if (!items.length) return;
    out += `<div class="nav-group"><div class="nav-group-title">${esc(g.group)}</div>`;
    items.forEach(([name, href, module, key]) => {
      const active = activePath === key || (activePath && href.startsWith('/admin/') && key !== 'dashboard' && href.includes(activePath)) ? 'active' : '';
      const cnt = counts && counts[key];
      out += `<a href="${href}" class="${active}">${icon(name === 'لوحة التحكم' ? 'dashboard' : ICONS[key] ? key : module)}<span>${esc(name)}</span>${cnt ? `<span class="count">${cnt}</span>` : ''}</a>`;
    });
    out += '</div>';
  });
  return out;
}

// ===== أعلى الشريط =====
function topbar(user, unreadNotifs) {
  const notifList = (unreadNotifs || []).slice(0, 6).map(n =>
    `<a href="${esc(n.link || '/admin/notifications')}" style="display:block;padding:8px 10px;border-radius:8px;color:var(--text);font-size:12.5px;" onclick="fetch('/api/notifications/${n.id}/read').then(()=>window.location.href='${esc(n.link || '/admin/notifications')}')"><b>${esc(n.title)}</b><div style="color:var(--text-2);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px;">${esc(n.body)}</div></a>`).join('');
  return `
  <header class="topbar">
    <button class="icon-btn burger" data-sidebar-toggle>${icon('menu')}</button>
    <form class="search" action="/admin/search" method="get">
      <input type="text" name="q" placeholder="بحث سريع..." aria-label="بحث">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
    </form>
    <div class="spacer"></div>
    <button class="icon-btn" data-theme-toggle title="الوضع الليلي">${icon('moon')}</button>
    <div style="position:relative">
      <button class="icon-btn" data-dropdown="notifDrop" title="الإشعارات">${icon('bell')}${unreadNotifs && unreadNotifs.length ? '<span class="dot"></span>' : ''}</button>
      <div id="notifDrop" class="dropdown" style="display:none;position:absolute;top:44px;inset-inline-start:0;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-lg);width:290px;z-index:90;">
        <div style="padding:12px 14px;font-weight:800;border-bottom:1px solid var(--border);font-size:13px;">الإشعارات</div>
        <div style="padding:6px;max-height:280px;overflow-y:auto;">${notifList || '<div style="padding:14px;color:var(--text-2);font-size:12.5px;text-align:center;">لا توجد إشعارات جديدة</div>'}</div>
        <a href="/admin/notifications" style="display:block;text-align:center;padding:9px;border-top:1px solid var(--border);font-size:12.5px;font-weight:700;">عرض الكل</a>
      </div>
    </div>
    <a href="/portal" class="user-chip" title="بوابتي">
      <div class="avatar-sm" style="width:38px;height:38px;">${esc((user.full_name || '?')[0])}</div>
      <div>
        <div class="u-name">${esc(user.full_name)}</div>
        <div class="u-role">${esc(user.role_name || user.role)}</div>
      </div>
    </a>
    <a class="icon-btn" href="/api/logout" title="تسجيل الخروج">${icon('logout')}</a>
  </header>`;
}

// ===== هيكل لوحة الإدارة =====
function adminShell(user, opts) {
  opts = opts || {};
  const settings = getSettings();
  const activePath = opts.active || '';
  const counts = opts.counts || {};
  const unreadNotifs = opts.notifications || [];
  const content = opts.content || '';
  const title = opts.title ? `${opts.title} - ${settings.academy_name || 'الأكاديمية'}` : settings.academy_name || 'الإدارة';
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/css/style.css">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<script src="/js/app.js" defer></script>
<script src="/js/charts.js" defer></script>
</head>
<body>
<div class="layout">
  <div id="sidebarOverlay" class="overlay-side"></div>
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <div class="logo">${icon('wave')}</div>
      <div><b>${esc(settings.academy_name || 'الأكاديمية')}</b><small>${esc(settings.academy_slogan || '')}</small></div>
    </div>
    <nav class="side-nav">${sidebar(user, activePath, counts)}</nav>
    <div class="side-foot">نظام إدارة أكاديمية السباحة<br>الإصدار 1.0</div>
  </aside>
  <div class="main">
    ${topbar(user, unreadNotifs)}
    <main class="content">${content}</main>
  </div>
</div>
<div class="modal-overlay" id="globalModal"></div>
<div class="toast-wrap"></div>
<script>
document.addEventListener('click', function(e){
  const t = e.target.closest('[data-dropdown]');
  document.querySelectorAll('.dropdown').forEach(d => { if(!t || d.id !== t.dataset.dropdown) d.style.display='none'; });
  if (t){ const d = document.getElementById(t.dataset.dropdown); if(d) d.style.display = d.style.display==='none'?'block':'none'; }
  const lm = e.target.closest('[data-load-modal]');
  if (lm){
    e.preventDefault();
    const ov = document.getElementById('globalModal');
    ov.classList.add('open');
    ov.innerHTML = '<div class="modal" style="max-width:720px;margin:auto;"><div class="modal-body" style="text-align:center;color:var(--text-2);padding:40px;">جارٍ التحميل...</div></div>';
    fetch(lm.getAttribute('data-load-modal')).then(r=>r.text()).then(h=>{ ov.innerHTML = h; }).catch(()=>{ ov.innerHTML='<div class="modal" style="max-width:480px;margin:auto;"><div class="modal-body"><p style="text-align:center;font-weight:800;">تعذر تحميل النموذج</p></div><div class="modal-foot"><button class="btn" data-close-modal>إغلاق</button></div></div>'; });
  }
});
</script>
</body>
</html>`;
}

// ===== صندوق إحصائيات =====
function statCard(val, label, color, ic, link) {
  const wrap = link ? `<a class="stat ${color}" href="${link}">` : `<div class="stat ${color}">`;
  const close = link ? '</a>' : '</div>';
  return `${wrap}<div class="icon">${icon(ic)}</div><div><div class="val">${val}</div><div class="lbl">${esc(label)}</div></div>${close}`;
}

// ===== بطاقة ملخصة =====
function statCards(list) {
  return `<div class="stat-grid">${list.map(s => statCard(s.val, s.label, s.color || 'blue', s.icon, s.link)).join('')}</div>`;
}

function pageHead(title, sub, actions) {
  return `<div class="page-head"><div><h1>${icon('wave')}${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${actions ? `<div class="toolbar">${actions}</div>` : ''}</div>`;
}

function toolbarSearch(q, placeholder) {
  return `<form class="search" method="get"><input type="text" name="q" value="${esc(q || '')}" placeholder="${esc(placeholder || 'بحث...')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg></form>`;
}

function card(title, body, opts) {
  opts = opts || {};
  return `<div class="card ${opts.class || ''}"><div class="card-head"><div><div class="card-title">${opts.icon ? icon(opts.icon) : ''}${esc(title)}</div>${opts.sub ? `<div class="card-sub">${opts.sub}</div>` : ''}</div>${opts.actions || ''}</div><div class="card-body">${body}</div></div>`;
}

// ===== هيكل الموقع العام =====
function pubShell(opts) {
  opts = opts || {};
  const settings = getSettings();
  const content = opts.content || '';
  const title = opts.title ? `${opts.title} - ${settings.academy_name || 'الأكاديمية'}` : settings.academy_name || 'الأكاديمية';
  const links = [
    ['الرئيسية', '/', 'home'],
    ['عن الأكاديمية', '/about', 'about'],
    ['البرامج', '/programs', 'programs'],
    ['المدربون', '/coaches', 'coaches'],
    ['الفرق والبطولات', '/teams', 'teams'],
    ['الأخبار', '/news', 'news'],
    ['الأسئلة الشائعة', '/faq', 'faq'],
    ['تواصل معنا', '/contact', 'contact']
  ];
  const nav = links.map(([name, href, key]) => `<a href="${href}" class="${opts.active === key ? 'active' : ''}">${name}</a>`).join('');
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/css/style.css">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<script src="/js/app.js" defer></script>
</head>
<body>
<div class="pub">
  <div class="pub-top">
    <nav class="pub-nav">
      <div class="brand"><div class="logo">${icon('wave')}</div><span>${esc(settings.academy_name || 'الأكاديمية')}</span></div>
      <div class="links">
        ${nav}
        <button class="icon-btn" data-theme-toggle>${icon('moon')}</button>
        <a class="btn btn-primary" href="/login">${icon('key')}<span class="link-text">دخول</span></a>
      </div>
    </nav>
  </div>
  ${content}
  <footer class="pub-footer">
    <div class="inner">
      <div>
        <h4>${esc(settings.academy_name || '')}</h4>
        <p style="font-size:13px;color:#bcd6ee;">${esc(settings.academy_slogan || '')}</p>
      </div>
      <div>
        <h4>روابط سريعة</h4>
        <a href="/">الرئيسية</a>
        <a href="/about">عن الأكاديمية</a>
        <a href="/programs">البرامج</a>
        <a href="/contact">تواصل معنا</a>
      </div>
      <div>
        <h4>التواصل</h4>
        <a>${esc(settings.phone || '')}</a>
        <a>${esc(settings.whatsapp || '')}</a>
        <a>${esc(settings.email || '')}</a>
        <a>${esc(settings.address || '')}</a>
      </div>
      <div>
        <h4>تابعنا</h4>
        <a href="${esc(settings.social_facebook || '#')}">فيسبوك</a>
        <a href="${esc(settings.social_instagram || '#')}">إنستغرام</a>
        <a href="${esc(settings.social_twitter || '#')}">تويتر</a>
        <a href="${esc(settings.social_youtube || '#')}">يوتيوب</a>
      </div>
    </div>
    <div class="bottom">© ${new Date().getFullYear()} ${esc(settings.academy_name || '')} - جميع الحقوق محفوظة</div>
  </footer>
</div>
<div class="modal-overlay" id="globalModal"></div>
<div class="toast-wrap"></div>
<script>
document.addEventListener('click', function(e){
  const lm = e.target.closest('[data-load-modal]');
  if (lm){ e.preventDefault(); const ov=document.getElementById('globalModal'); ov.classList.add('open');
    ov.innerHTML='<div class="modal" style="max-width:720px;margin:auto;"><div class="modal-body" style="text-align:center;color:var(--text-2);padding:40px;">جارٍ التحميل...</div></div>';
    fetch(lm.getAttribute('data-load-modal')).then(r=>r.text()).then(h=>{ov.innerHTML=h;}).catch(()=>{ov.innerHTML='<div class="modal" style="max-width:480px;margin:auto;"><div class="modal-body"><p style="text-align:center;font-weight:800;">تعذر تحميل النموذج</p></div><div class="modal-foot"><button class="btn" data-close-modal>إغلاق</button></div></div>';}); }
});
</script>
</body>
</html>`;
}

// ===== صفحة تسجيل الدخول =====
function loginPage(msg) {
  const settings = getSettings();
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>تسجيل الدخول - ${esc(settings.academy_name || '')}</title>
<link rel="stylesheet" href="/css/style.css">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<script src="/js/app.js" defer></script>
</head>
<body>
<div class="login-page">
  <div class="login-card">
    <div class="login-hero">
      <div class="logo">${icon('wave')}</div>
      <h2>${esc(settings.academy_name || 'أكاديمية السباحة')}</h2>
      <p>${esc(settings.academy_slogan || '')}</p>
    </div>
    <div class="login-body">
      ${msg ? `<div class="toast error" style="margin-bottom:14px;border-inline-start:4px solid var(--red);">${esc(msg)}</div>` : ''}
      <form data-post="/api/login">
        <div class="field" style="margin-bottom:12px;">
          <label>اسم المستخدم</label>
          <input type="text" name="username" required autofocus placeholder="أدخل اسم المستخدم">
        </div>
        <div class="field" style="margin-bottom:18px;">
          <label>كلمة المرور</label>
          <input type="password" name="password" required placeholder="أدخل كلمة المرور">
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px;">${icon('key')} تسجيل الدخول</button>
      </form>
      <div class="demo-accounts">
        <div class="d-title">حسابات تجريبية (كلمة المرور: 123456)</div>
        <code data-fill="admin">admin</code>
        <code data-fill="manager">manager</code>
        <code data-fill="reception">reception</code>
        <code data-fill="finance">finance</code>
        <code data-fill="coach1">coach1</code>
        <code data-fill="guardian1">guardian1</code>
      </div>
    </div>
  </div>
</div>
<script>
document.querySelectorAll('[data-fill]').forEach(c => {
  c.addEventListener('click', () => {
    const inputs = document.querySelectorAll('.login-body input');
    inputs[0].value = c.dataset.fill;
    inputs[1].value = '123456';
  });
});
</script>
</body>
</html>`;
}

module.exports = { ICONS, icon, badge, getSettings, renderTable, renderModal, renderFormFields, renderField, adminShell, pubShell, loginPage, statCard, statCards, pageHead, toolbarSearch, card, NAV, badge };
