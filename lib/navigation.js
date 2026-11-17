/** ترتيب صفحات القائمة الجانبية — مصدر واحد للقائمة ولتوجيه الصفحة الرئيسية
    لأول صفحة يملك المستخدم صلاحية عرضها. */
const NAV_ITEMS = [
  { sec: 'الرئيسية' },
  { url: '/', label: 'لوحة التحكم', icon: 'fa-gauge-high', module: 'dashboard' },
  { sec: 'الأعضاء والتسجيل' },
  { url: '/swimmers', label: 'اللاعبون', icon: 'fa-person-swimming', module: 'swimmers' },
  { url: '/guardians', label: 'أولياء الأمور', icon: 'fa-people-roof', module: 'guardians' },
  { url: '/coaches', label: 'الكباتن والمدربون', icon: 'fa-user-tie', module: 'coaches' },
  { url: '/staff', label: 'الموظفون', icon: 'fa-user-gear', module: 'staff' },
  { sec: 'البرامج التدريبية' },
  { url: '/programs', label: 'البرامج والدورات', icon: 'fa-list-check', module: 'programs' },
  { url: '/levels', label: 'المستويات', icon: 'fa-layer-group', module: 'levels' },
  { url: '/groups', label: 'المجموعات التدريبية', icon: 'fa-people-group', module: 'groups' },
  { sec: 'الأنشطة والموقع' },
  { url: '/sports', label: 'الألعاب الرياضية', icon: 'fa-medal', module: 'sports' },
  { sec: 'الجداول والحضور' },
  { url: '/sessions', label: 'الحصص والحضور', icon: 'fa-calendar-check', module: 'sessions', modules: ['sessions', 'attendance'] },
  { url: '/trainer-attendance', label: 'حضور المدربين', icon: 'fa-user-check', module: 'trainerAttendance' },
  { url: '/staff-attendance', label: 'حضور الموظفين', icon: 'fa-user-clock', module: 'staffAttendance' },
  { url: '/membership-cards', label: 'بطاقات العضوية', icon: 'fa-id-card', module: 'membershipCards' },
  { sec: 'التدريب الخاص' },
  { url: '/private-training', label: 'التدريب الخاص', icon: 'fa-dumbbell', module: 'privateTraining' },
  { url: '/water-rentals', label: 'حجز إيجار الميه', icon: 'fa-water', module: 'waterRentals' },
  { sec: 'الجوانب الفنية' },
  { url: '/assessments', label: 'التقييمات الفنية', icon: 'fa-clipboard-check', module: 'assessments' },
  { url: '/tests', label: 'الاختبارات', icon: 'fa-vial-circle-check', module: 'tests' },
  { url: '/teams', label: 'فرق السباحة', icon: 'fa-flag-checkered', module: 'teams' },
  { url: '/competitions', label: 'البطولات', icon: 'fa-trophy', module: 'competitions' },
  { sec: 'المالية' },
  { url: '/subscriptions', label: 'الاشتراكات', icon: 'fa-file-contract', module: 'subscriptions' },
  { url: '/payments', label: 'المدفوعات', icon: 'fa-money-bill-wave', module: 'payments' },
  { url: '/revenues', label: 'الإيرادات', icon: 'fa-arrow-up-right-dots', module: 'revenues' },
  { url: '/expenses', label: 'المصروفات', icon: 'fa-arrow-down-right-dots', module: 'expenses' },
  { url: '/deductions', label: 'الخصومات والإضافات', icon: 'fa-scale-balanced', module: 'payroll' },
  { url: '/payroll', label: 'مستحقات ورواتب', icon: 'fa-sack-dollar', module: 'payroll' },
  { sec: 'الإدارة والمراسلات' },
  { url: '/incoming', label: 'الوارد', icon: 'fa-inbox', module: 'incoming' },
  { url: '/outgoing', label: 'الصادر', icon: 'fa-paper-plane', module: 'outgoing' },
  { url: '/documents', label: 'المستندات', icon: 'fa-folder-open', module: 'documents' },
  { url: '/notifications', label: 'الإشعارات', icon: 'fa-bell', module: 'notifications' },
  { url: '/reservations', label: 'حجوزات الموقع', icon: 'fa-calendar-check', module: 'reservations' },
  { url: '/complaints', label: 'الشكاوى والطلبات', icon: 'fa-headset', module: 'complaints' },
  { url: '/ai-replies', label: 'الردود الذكية', icon: 'fa-robot', module: 'settings' },
  { sec: 'التقارير والإعدادات' },
  { url: '/reports', label: 'التقارير', icon: 'fa-chart-column', module: 'reports' },
  { url: '/branches', label: 'الفروع وحمامات السباحة', icon: 'fa-building', module: 'branches' },
  { url: '/pools', label: 'حمامات السباحة', icon: 'fa-person-swimming', module: 'pools' },
  { url: '/schools', label: 'المدارس والجهات الدراسية', icon: 'fa-school', module: 'schools' },
  { url: '/users', label: 'المستخدمون والصلاحيات', icon: 'fa-user-shield', module: 'users' },
  { url: '/settings', label: 'إعدادات النظام', icon: 'fa-gears', module: 'settings' },
  { url: '/settings/types', label: 'أنواع البرامج والاختبارات', icon: 'fa-layer-group', module: 'settings' },
  { url: '/settings/images', label: 'صور الواجهة الرئيسية', icon: 'fa-images', module: 'settings' },
  { url: '/settings/news', label: 'الأخبار والأحداث', icon: 'fa-newspaper', module: 'settings' },
  { url: '/audit-log', label: 'سجل النشاط', icon: 'fa-clock-rotate-left', module: 'auditLog' }
];

/** أول صفحة يمكن للمستخدم فتحها حسب صلاحيات العرض (بترتيب القائمة الجانبية). */
function firstAllowedUrl(user, canView) {
  const item = NAV_ITEMS.find(function (it) {
    if (!it.url || it.url === '/') return false;
    return it.modules
      ? it.modules.some(function (m) { return canView(user, m); })
      : canView(user, it.module);
  });
  /* الصفحة الشخصية متاحة دائماً لأي مستخدم مسجّل دخول كملجأ أخير. */
  return item ? item.url : '/profile';
}

module.exports = { NAV_ITEMS, firstAllowedUrl };
