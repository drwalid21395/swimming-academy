'use strict';

const MODULES = [
  'dashboard','swimmers','guardians','coaches','staff','programs','levels','groups',
  'sessions','attendance','assessments','tests','teams','tournaments','subscriptions',
  'payments','revenues','expenses','coach_dues','incoming','outgoing','documents',
  'notifications','complaints','reports','branches','pools','users','settings','audit'
];

const ROLES = {
  admin:          { name_ar: 'مدير النظام',       desc: 'صلاحيات كاملة على النظام' },
  academy_manager:{ name_ar: 'مدير الأكاديمية',   desc: 'إدارة كل الأقسام دون إدارة المستخدمين والإعدادات الحساسة' },
  reception:      { name_ar: 'موظف الاستقبال',    desc: 'تسجيل السباحين والاشتراكات والحضور' },
  finance:        { name_ar: 'المسؤول المالي',    desc: 'إدارة الإيرادات والمصروفات والمدفوعات والتقارير المالية' },
  coach:          { name_ar: 'الكابتن / المدرب',  desc: 'إدارة الحصص والحضور والتقييمات والملاحظات' },
  team_manager:   { name_ar: 'مسؤول الفرق',       desc: 'إدارة الفرق واللاعبين والبطولات' },
  rescue_manager: { name_ar: 'مسؤول الإنقاذ والسلامة', desc: 'برامج الإنقاذ والسلامة والاختبارات' },
  guardian:       { name_ar: 'ولي الأمر',         desc: 'بوابة ولي الأمر فقط' },
  swimmer:        { name_ar: 'السباح / اللاعب',   desc: 'بوابة السباح فقط' }
};

const ALL = { view: 1, add: 1, edit: 1, del: 1, approve: 1 };
const RO =  { view: 1, add: 0, edit: 0, del: 0, approve: 0 };
const RW =  { view: 1, add: 1, edit: 1, del: 1, approve: 0 };
const NONE ={ view: 0, add: 0, edit: 0, del: 0, approve: 0 };

function perm(view, add, edit, del, approve) {
  return { view: view || 0, add: add || 0, edit: edit || 0, del: del || 0, approve: approve || 0 };
}

function buildRoleMatrix() {
  const matrix = {};
  matrix.admin = {};
  MODULES.forEach(m => matrix.admin[m] = { ...ALL });

  matrix.academy_manager = {};
  MODULES.forEach(m => matrix.academy_manager[m] = { ...RW });
  matrix.academy_manager.users = RO;
  matrix.academy_manager.settings = RO;
  matrix.academy_manager.audit = RO;

  matrix.reception = {};
  MODULES.forEach(m => matrix.reception[m] = NONE);
  ['dashboard','swimmers','guardians','programs','levels','groups','sessions',
   'attendance','subscriptions','payments','notifications','documents','reports'].forEach(m => {
    matrix.reception[m] = m === 'dashboard' || m === 'reports' ? RO : RW;
  });
  matrix.reception.assessments = perm(1,1,0,0,0);
  matrix.reception.tests = perm(1,1,0,0,0);

  matrix.finance = {};
  MODULES.forEach(m => matrix.finance[m] = NONE);
  ['dashboard','swimmers','subscriptions','payments','revenues','expenses',
   'coach_dues','reports','notifications','documents'].forEach(m => {
    matrix.finance[m] = m === 'dashboard' || m === 'reports' ? RO : RW;
  });
  matrix.finance.swimmers = RO;
  matrix.finance.coach_dues.approve = 1;

  matrix.coach = {};
  MODULES.forEach(m => matrix.coach[m] = NONE);
  ['dashboard','swimmers','sessions','attendance','assessments','tests',
   'groups','programs','levels','notifications','documents','messages'].forEach(m => {
    matrix.coach[m] = m === 'dashboard' || m === 'programs' || m === 'levels' || m === 'groups' ? RO : RW;
  });
  matrix.coach.swimmers = RO;
  matrix.coach.sessions.add = 1;
  matrix.coach.documents = perm(1,1,0,1,0);

  matrix.team_manager = {};
  MODULES.forEach(m => matrix.team_manager[m] = NONE);
  ['dashboard','teams','tournaments','swimmers','coaches','sessions','attendance',
   'tests','notifications','documents','reports'].forEach(m => {
    matrix.team_manager[m] = m === 'dashboard' || m === 'reports' ? RO : RW;
  });
  matrix.team_manager.swimmers = RO;

  matrix.rescue_manager = {};
  MODULES.forEach(m => matrix.rescue_manager[m] = NONE);
  ['dashboard','programs','swimmers','tests','assessments','groups','sessions',
   'attendance','notifications','documents','reports'].forEach(m => {
    matrix.rescue_manager[m] = m === 'dashboard' || m === 'reports' ? RO : RW;
  });

  matrix.guardian = {};
  MODULES.forEach(m => matrix.guardian[m] = NONE);
  matrix.guardian.dashboard = RO;
  matrix.guardian.swimmers = RO;
  matrix.guardian.notifications = RO;
  matrix.guardian.complaints = perm(1,1,0,0,0);
  matrix.guardian.documents = RO;

  matrix.swimmer = {};
  MODULES.forEach(m => matrix.swimmer[m] = NONE);
  matrix.swimmer.dashboard = RO;
  matrix.swimmer.swimmers = RO;
  matrix.swimmer.notifications = RO;
  matrix.swimmer.tests = RO;
  matrix.swimmer.assessments = RO;

  return matrix;
}

module.exports = { MODULES, ROLES, buildRoleMatrix, ALL, RO, RW, NONE };
