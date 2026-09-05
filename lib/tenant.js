/** أدوات تعدد الأكاديميات: الوصول للأكاديمية، حالة الاشتراك، المزايا، حدود الخطط */
const { db } = require('./db');

/* ------------------------------------------------------------------ */
/*  مصفوفة الصلاحيات/المزايا لكل خطة                                    */
/*  في L2:  كل وحدة لها 5 إجراءات (فحص/إضافة/تعديل/حذف/تصدير)           */
/*  كل ميزة تُحفظ بصيغة  module__action  (مثال: swimmers__view)         */
/* ------------------------------------------------------------------ */

/* الإجراءات الموحدة المتاحة لكل وحدة */
const ACTIONS = ['view', 'add', 'edit', 'del', 'export'];

/* أسماء الإجراءات بالعربية للعرض */
const ACTION_LABELS = {
  view: 'الفحص', add: 'الإضافة', edit: 'التعديل', del: 'الحذف', export: 'التصدير'
};

/* وحدات النظام (تتطابق مع وحدات MODULES في صلاحيات المستخدمين) مقسمة لمجموعات للعرض */
const FEATURE_GROUPS = [
  {
    group: 'الأعضاء والتسجيل',
    modules: [
      { key: 'swimmers', label: 'السباحون' },
      { key: 'guardians', label: 'أولياء الأمور' },
      { key: 'coaches', label: 'الكباتن والمدربون' },
      { key: 'staff', label: 'الموظفون' }
    ]
  },
  {
    group: 'البرامج التدريبية',
    modules: [
      { key: 'programs', label: 'البرامج والدورات' },
      { key: 'levels', label: 'المستويات' },
      { key: 'groups', label: 'المجموعات التدريبية' },
      { key: 'sessions', label: 'الحصص والجداول' },
      { key: 'attendance', label: 'الحضور والغياب' }
    ]
  },
  {
    group: 'الجوانب الفنية',
    modules: [
      { key: 'assessments', label: 'التقييمات الفنية' },
      { key: 'tests', label: 'الاختبارات' },
      { key: 'teams', label: 'فرق السباحة' },
      { key: 'competitions', label: 'البطولات' }
    ]
  },
  {
    group: 'المالية',
    modules: [
      { key: 'subscriptions', label: 'الاشتراكات' },
      { key: 'payments', label: 'المدفوعات' },
      { key: 'revenues', label: 'الإيرادات' },
      { key: 'expenses', label: 'المصروفات' },
      { key: 'coachPayments', label: 'مستحقات المدربين' }
    ]
  },
  {
    group: 'الحضور والمستحقات',
    modules: [
      { key: 'trainerAttendance', label: 'حضور المدربين' },
      { key: 'staffAttendance', label: 'حضور الموظفين' },
      { key: 'payroll', label: 'المستحقات والرواتب' }
    ]
  },
  {
    group: 'الإدارة والمراسلات',
    modules: [
      { key: 'incoming', label: 'الوارد' },
      { key: 'outgoing', label: 'الصادر' },
      { key: 'documents', label: 'المستندات' },
      { key: 'notifications', label: 'الإشعارات' },
      { key: 'complaints', label: 'الشكاوى والطلبات' }
    ]
  },
  {
    group: 'التقارير والإعدادات',
    modules: [
      { key: 'reports', label: 'التقارير' },
      { key: 'branches', label: 'الفروع وحمامات السباحة' },
      { key: 'pools', label: 'حمامات السباحة' },
      { key: 'schools', label: 'المدارس والجهات الدراسية' },
      { key: 'users', label: 'المستخدمون والصلاحيات' },
      { key: 'settings', label: 'إعدادات النظام' },
      { key: 'auditLog', label: 'سجل النشاط' },
      { key: 'site', label: 'الموقع التعريفي' }
    ]
  }
];

/* المزايا المنفردة (خصائص إضافية غير مرتبطة بإجراءات وحدة) */
const EXTRA_FEATURES = [
  { key: 'multiple_branches', label: 'فروع متعددة (أكثر من فرع)' },
  { key: 'whatsapp', label: 'روابط واتساب' },
  { key: 'custom_branding', label: 'تخصيص هوية الأكاديمية' },
  { key: 'academy_logo', label: 'رفع صورة وشعار الأكاديمية' },
  { key: 'advanced_permissions', label: 'الصلاحيات المتقدمة للمستخدمين' },
  { key: 'advanced_reports', label: 'التقارير المتقدمة' },
  { key: 'financial_reports', label: 'التقارير المالية المتخصصة' },
  { key: 'exports', label: 'التصدير والنسخ الاحتياطي' },
  { key: 'storage_unlimited', label: 'تخزين غير محدود' }
];

/* قائمة المزايا الكاملة المعروضة في خطة (للواجهات) */
const FEATURES = buildFeaturesList();

function buildFeaturesList() {
  const list = [];
  FEATURE_GROUPS.forEach(g => g.modules.forEach(m => {
    ACTIONS.forEach(a => list.push({
      key: m.key + '__' + a,
      label: ACTION_LABELS[a] + ' - ' + m.label,
      module: m.key, moduleLabel: m.label, action: a, group: g.group
    }));
  }));
  EXTRA_FEATURES.forEach(f => list.push({ key: f.key, label: f.label, extra: true }));
  return list;
}

/* تعليق/قابل للقراءة: هل ميزة (module__action) مفعّلة في مصفوفة مفاتيح؟ */
function featureSetFromKeys(keys) {
  const set = {};
  (keys || []).forEach(k => { set[k] = true; });
  return set;
}

/* تحويل مصفوفة مفاتيح مزايا الخطة إلى كائن الفعالية الكامل */
function planFeatureSet(plan) {
  let keys = [];
  try { keys = JSON.parse(plan && plan.features || '[]'); } catch (e) { keys = []; }
  // للتوافق مع المفاتيح القديمة المسطحة: تفعيل وحدة كاملة عند وجود مفتاح قديم مطابق
  const legacyMap = {
    attendance: 'attendance', financial_reports: '', advanced_reports: '',
    multiple_branches: 'multiple_branches', exports: 'exports', custom_branding: 'custom_branding',
    advanced_permissions: 'advanced_permissions', whatsapp: 'whatsapp'
  };
  const set = featureSetFromKeys(keys);
  Object.entries(legacyMap).forEach(([oldKey, mappedRaw]) => {
    if (keys.indexOf(oldKey) > -1) {
      if (mappedRaw) set[mappedRaw] = true;               // ميزة منفردة قديمة
      const mod = oldKey === 'attendance' ? 'attendance' : '';
      if (mod) ACTIONS.forEach(a => set[mod + '__' + a] = true);
    }
  });
  return set;
}

/* هيئة "صلاحيات كل وحدة وإجراء" فعّالة من مصفوفة مفاتيح الخطة */
function permsFromPlanSet(set) {
  const perms = {};
  Object.keys(set || {}).forEach(k => {
    const parts = k.split('__');
    if (parts.length === 2 && ACTIONS.indexOf(parts[1]) > -1) {
      perms[parts[0]] = perms[parts[0]] || {};
      perms[parts[0]][parts[1]] = 1;
    }
  });
  return perms;
}

/* هل تُفعّل ميزة وحدة/إجراء معينة لخطة؟ (feature بصيغة module__action أو module فقط) */
function featureEnabledForPlan(plan, feature) {
  if (!plan) return false;
  const set = planFeatureSet(plan);
  // ميزة منفردة (بدون وحدة/إجراء) مثل academy_logo
  if (set[feature]) return true;
  // طلب وحدة كاملة: تفعيل إذا كان أي إجراء مفعلاً (أو كلها)
  if (feature.indexOf('__') === -1) {
    return ACTIONS.some(a => set[feature + '__' + a]);
  }
  return !!set[feature];
}

/* حالة اشتراك ديناميكية من بيانات الاشتراك */
function subscriptionStatus(sub) {
  if (!sub) return { status: 'EXPIRED', label: 'منتهي', expiringSoon: false, expired: true };
  const now = new Date();
  const parse = (d) => { const x = new Date(String(d).replace(' ', 'T')); return isNaN(x) ? null : x; };
  const expiry = parse(sub.expiry_date);
  const grace = parse(sub.grace_period_end);
  const expired = expiry ? now.getTime() > expiry.getTime() : false;
  const graceActive = expired && grace && now.getTime() <= grace.getTime();
  const graceEnded = expired && grace && now.getTime() > grace.getTime();
  const expiringSoon = !expired && expiry && (expiry.getTime() - now.getTime()) <= 7 * 86400000;
  const daysLeft = expiry ? Math.max(0, Math.ceil((expiry.getTime() - now.getTime()) / 86400000)) : null;

  let status = sub.status || 'PENDING_PAYMENT';
  if (expired) {
    if (graceEnded) status = 'EXPIRED';
    else status = 'PENDING_PAYMENT';
  } else if (expiringSoon) {
    status = 'EXPIRING_SOON';
  } else {
    status = 'ACTIVE';
  }

  return {
    status,
    label: {
      ACTIVE: 'نشط', EXPIRING_SOON: 'قارب الانتهاء', PENDING_PAYMENT: 'بانتظار الدفع',
      EXPIRED: 'منتهي', SUSPENDED: 'موقوف'
    }[status] || status,
    expiringSoon, expired, graceActive, graceEnded,
    daysLeft: expired ? 0 : daysLeft,
    expiry_date: sub.expiry_date,
    grace_period_end: sub.grace_period_end
  };
}

/* هل الأكاديمية مقيّدة (لا يوجد اشتراك صالح)؟
   الأكاديمية الأساسية (premium) لا تخضع للقيود أبداً. */
function academyRestricted(academy, subInfo) {
  if (!academy) return true;
  if (+academy.premium === 1) return false;
  if (academy.status !== 'active') return true;
  if (!subInfo) return true;
  if (subInfo.status === 'ACTIVE' || subInfo.status === 'EXPIRING_SOON') return false;
  if (subInfo.status === 'PENDING_PAYMENT' && subInfo.graceActive) return false;
  return true;
}

async function getAcademy(academyId) {
  try { return await db.prepare('SELECT * FROM academies WHERE id = ?').get(Number(academyId)); } catch (e) { return null; }
}

async function getActiveSubscription(academyId) {
  try {
    const rows = await db.prepare('SELECT * FROM academy_subscriptions WHERE academy_id = ? ORDER BY id DESC LIMIT 1').all(Number(academyId));
    return rows[0];
  } catch (e) { return null; }
}

/* صلاحيات الأكاديمية الفعّالة (كل وحدة + إجراء) من خطة الأكاديمية.
   الأكاديمية الأساسية premium تعود بكل الصلاحيات. */
async function academyPlanPerms(academyId) {
  const academy = academyId == null ? null : await getAcademy(academyId);
  if (!academy) return null;
  if (+academy.premium === 1) return null; // لا قيود
  let plan = null;
  try {
    if (academy.plan_id) plan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(academy.plan_id);
  } catch (e) { plan = null; }
  if (!plan) return null; // بدون خطة: لا قيود خاصة بالمزايا
  const set = planFeatureSet(plan);
  const perms = permsFromPlanSet(set);
  return perms;
}

/* هل تُفعَّل ميزة لخطة أكاديمية؟ (backward-compatible)
   - featureEnabled(academyId, module)          → وحدة كاملة (أي إجراء)
   - featureEnabled(academyId, module, action)  → إجراء محدد */
async function featureEnabled(academyId, feature, action) {
  const academy = academyId == null ? null : await getAcademy(academyId);
  if (academy && +academy.premium === 1) return true;
  let plan = null;
  try {
    if (academy && academy.plan_id) plan = await db.prepare('SELECT * FROM plans WHERE id = ?').get(academy.plan_id);
  } catch (e) { plan = null; }
  if (!plan) return action ? true : false;
  if (action) return featureEnabledForPlan(plan, feature + '__' + action);
  return featureEnabledForPlan(plan, feature);
}

/* حدود الخطة (قيم -1 = غير محدود) */
async function planLimits(academyId) {
  const academy = await getAcademy(academyId);
  if (!academy) return { unlimited: true, plan: null };
  if (+academy.premium === 1) return { unlimited: true, plan: null };
  const plan = academy.plan_id ? await db.prepare('SELECT * FROM plans WHERE id = ?').get(academy.plan_id) : null;
  return {
    unlimited: false, plan,
    max_students: plan ? plan.max_students : -1,
    max_teachers: plan ? plan.max_teachers : -1,
    max_employees: plan ? plan.max_employees : -1,
    max_users: plan ? plan.max_users : -1,
    max_branches: plan ? plan.max_branches : -1
  };
}

/* فحص حد معين: type='students'|'teachers'|'employees'|'users'|'branches' */
async function atPlanLimit(academyId, type, currentCount) {
  const L = await planLimits(academyId);
  if (L.unlimited) return false;
  const max = L['max_' + type] == null ? -1 : L['max_' + type];
  if (max < 0) return false;
  return Number(currentCount) >= Number(max);
}

/* إشعار تلقائي داخل النظام عند اقتراب/انتهاء مدة اشتراك الأكاديمية.
   يُرسل مرة واحدة لكل حالة (قرب الانتهاء / بداية فترة السماح / انتهاء المدة)
   لجميع مستخدمي الأكاديمية. لا يُكرَّر لنفس الحالة حتى التجديد. */
function fmtD(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : s;
}

async function maybeNotifyAcademySubscription(academyId) {
  const ai = Number(academyId);
  if (!isFinite(ai) || ai <= 0) return;
  try {
    const academy = await db.prepare('SELECT * FROM academies WHERE id = ?').get(ai);
    if (!academy || +academy.premium === 1) return; // الأساسية بلا قيود ولا إشعارات
    const sub = await getActiveSubscription(ai);
    const st = subscriptionStatus(sub);
    let kind = null, title, message, link = '/settings';
    if (st.status === 'EXPIRING_SOON') {
      kind = 'SUB_EXPIRING';
      title = 'اشتراك الأكاديمية يقترب من الانتهاء';
      message = 'تنتهي مدة اشتراكك خلال ' + st.daysLeft + ' يوم. يرجى تجديد اشتراكك لتجنب إيقاف الخدمة.';
    } else if (st.status === 'PENDING_PAYMENT' && st.graceActive) {
      kind = 'SUB_GRACE';
      title = 'بدأت فترة السماح لاشتراكك';
      message = 'انتهت مدة اشتراكك وبدأت فترة السماح، وتنتهي في ' + fmtD(st.grace_period_end) + '. يرجى تجديد الاشتراك قبل إيقاف الخدمة.';
    } else if (st.status === 'EXPIRED') {
      kind = 'SUB_EXPIRED';
      title = 'انتهت مدة اشتراك الأكاديمية';
      message = 'تم إيقاف اشتراكك. قم بتجديد الاشتراك لاستعادة الخدمة.';
    }
    if (!kind) return;
    const ex = await db.prepare('SELECT id FROM notifications WHERE academy_id = ? AND message LIKE ? LIMIT 1').get(ai, '%' + kind + '%');
    if (ex) return; // سبق إرساله لهذه الحالة
    const ins = await db.prepare('INSERT INTO notifications (title, message, type, link, is_broadcast, created_by, academy_id) VALUES (?,?,?,?,0,0,?)')
      .run(title, message + ' [' + kind + ']', 'تنبيه', link, ai);
    const users = await db.prepare("SELECT id FROM users WHERE academy_id = ? AND status = 'active'").all(ai);
    const stmt = db.prepare('INSERT INTO notification_recipients (notification_id, user_id) VALUES (?,?)');
    for (const u of users) await stmt.run(ins.lastInsertRowid, u.id);
  } catch (e) { console.error('خطأ في إشعار اشتراك الأكاديمية:', e.message); }
}

module.exports = {
  FEATURES, FEATURE_GROUPS, EXTRA_FEATURES, ACTIONS, ACTION_LABELS,
  featureSetFromKeys, planFeatureSet, permsFromPlanSet, featureEnabledForPlan,
  academyPlanPerms,
  subscriptionStatus, academyRestricted, getAcademy,
  getActiveSubscription, featureEnabled, planLimits, atPlanLimit,
  maybeNotifyAcademySubscription
};
