'use strict';
/* تعريفات الكيانات العامة لوحدات الإدارة */

const SWIMMER_STATUS = { active: ['نشط', 'green'], paused: ['متوقف مؤقتًا', 'amber'], withdrawn: ['منسحب', 'red'], frozen: ['مجمد', 'purple'], graduated: ['خريج برنامج', 'cyan'] };
const SUB_STATUS = { active: ['سارٍ', 'green'], expiring: ['أوشك على الانتهاء', 'amber'], expired: ['منتهٍ', 'red'], frozen: ['مجمد', 'purple'], cancelled: ['ملغى', 'red'] };
const PAY_STATUS = { approved: ['معتمد', 'green'], pending: ['قيد الاعتماد', 'amber'] };
const SESS_STATUS = { scheduled: ['مجدولة', 'blue'], done: ['منفذة', 'green'], cancelled: ['ملغاة', 'red'] };
const ATT_STATUS = { present: ['حاضر', 'green'], absent: ['غائب', 'red'], apology: ['معتذر', 'amber'], justified: ['غياب بعذر', 'blue'] };
const PROG_STATUS = { available: ['متاح', 'green'], full: ['مكتمل العدد', 'amber'], stopped: ['متوقف', 'red'], ended: ['منتهٍ', 'gray'], upcoming: ['قادم', 'blue'] };
const PROG_TYPE = { learn: ['تعليم سباحة', 'blue'], training: ['تدريب وتطوير', 'green'], team: ['فرق', 'purple'], rescue: ['إنقاذ وسلامة', 'amber'], instructor: ['إعداد معلم', 'cyan'], camp: ['معسكر', 'red'], course: ['دورة خاصة', 'gray'] };
const PAY_METHOD = { cash: 'نقدي', bank: 'تحويل بنكي', card: 'بطاقة', wallet: 'محفظة إلكترونية' };
const DOC_STATUS = { open: ['مفتوح', 'amber'], done: ['تم التنفيذ', 'green'], overdue: ['متأخر', 'red'] };
const DELIVERY_STATUS = { delivered: ['تم التسليم', 'green'], pending: ['قيد الإرسال', 'amber'], failed: ['لم يُسلم', 'red'] };
const COMPLAINT_STATUS = { open: ['مفتوحة', 'amber'], in_progress: ['قيد المعالجة', 'blue'], resolved: ['تم الحل', 'green'] };
const REQ_STATUS = { new: ['جديد', 'blue'], contacted: ['تم التواصل', 'amber'], closed: ['مغلق', 'gray'] };
const PAY_METHODS = ['cash', 'bank', 'card', 'wallet'];

const WEEKDAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

const ENTITIES = {
  swimmers: {
    table: 'swimmers', title: 'السباحون', module: 'swimmers',
    search: 'full_name,membership_no,phone,guardian_phone',
    orderBy: 's.id DESC',
    listQuery: `SELECT s.*, g.full_name AS guardian_name, l.name AS level_name, p.name AS program_name, gr.name AS group_name, c.full_name AS coach_name
      FROM swimmers s
      LEFT JOIN guardians g ON g.id=s.guardian_id
      LEFT JOIN levels l ON l.id=s.current_level_id
      LEFT JOIN programs p ON p.id=s.program_id
      LEFT JOIN groups gr ON gr.id=s.group_id
      LEFT JOIN coaches c ON c.id=s.coach_id`,
    filterBy: 's.status, s.current_level_id, s.program_id, s.group_id, s.payment_status',
    columns: [
      { k: 'full_name', label: 'السباح', type: 'avatar' },
      { k: 'membership_no', label: 'رقم العضوية', type: 'code' },
      { k: 'gender', label: 'النوع' },
      { k: 'level_name', label: 'المستوى' },
      { k: 'program_name', label: 'البرنامج' },
      { k: 'group_name', label: 'المجموعة' },
      { k: 'done_sessions', label: 'الحصص المنفذة/الكلية', type: 'sessions' },
      { k: 'payment_status', label: 'حالة السداد', type: 'status', map: { paid: ['مدفوع', 'green'], partial: ['جزئي', 'amber'], unpaid: ['غير مسدد', 'red'] } },
      { k: 'status', label: 'الحالة', type: 'status', map: SWIMMER_STATUS }
    ],
    fields: [
      { name: 'full_name', label: 'الاسم بالكامل', type: 'text', required: true },
      { name: 'birth_date', label: 'تاريخ الميلاد', type: 'date' },
      { name: 'gender', label: 'النوع', type: 'select', options: [['ذكر', 'ذكر'], ['أنثى', 'أنثى']] },
      { name: 'phone', label: 'رقم الهاتف', type: 'phone' },
      { name: 'email', label: 'البريد الإلكتروني', type: 'email' },
      { name: 'address', label: 'العنوان', type: 'text' },
      { name: 'school', label: 'المدرسة / جهة الدراسة', type: 'text' },
      { name: 'guardian_id', label: 'ولي الأمر', type: 'fk', table: 'guardians', text: 'full_name' },
      { name: 'guardian_relation', label: 'صلة القرابة', type: 'select', options: [['والد', 'والد'], ['والدة', 'والدة'], ['جد', 'جد'], ['وصي', 'وصي'], ['آخر', 'آخر']] },
      { name: 'guardian_phone', label: 'هاتف ولي الأمر', type: 'phone' },
      { name: 'guardian_alt_phone', label: 'هاتف بديل لولي الأمر', type: 'phone' },
      { name: 'emergency_name', label: 'اسم للطوارئ', type: 'text' },
      { name: 'emergency_phone', label: 'هاتف الطوارئ', type: 'phone' },
      { name: 'emergency_relation', label: 'صلة الطوارئ', type: 'text' },
      { name: 'health_status', label: 'الحالة الصحية', type: 'select', options: [['جيد', 'جيد'], ['متوسط', 'متوسط'], ['يحتاج رعاية خاصة', 'يحتاج رعاية خاصة']] },
      { name: 'allergies', label: 'الحساسية / الأمراض المزمنة', type: 'text' },
      { name: 'medical_notes', label: 'ملاحظات طبية', type: 'textarea' },
      { name: 'current_level_id', label: 'المستوى الحالي', type: 'fk', table: 'levels', text: 'name' },
      { name: 'program_id', label: 'البرنامج', type: 'fk', table: 'programs', text: 'name' },
      { name: 'group_id', label: 'المجموعة التدريبية', type: 'fk', table: 'groups', text: 'name' },
      { name: 'coach_id', label: 'الكابتن المسؤول', type: 'fk', table: 'coaches', text: 'full_name' },
      { name: 'training_days', label: 'أيام التدريب', type: 'text' },
      { name: 'training_time', label: 'موعد التدريب', type: 'text' },
      { name: 'subscription_value', label: 'قيمة الاشتراك', type: 'number' },
      { name: 'payment_status', label: 'حالة السداد', type: 'select', options: [['paid', 'مدفوع'], ['partial', 'جزئي'], ['unpaid', 'غير مسدد']] },
      { name: 'total_sessions', label: 'عدد الحصص الكلي', type: 'number' },
      { name: 'done_sessions', label: 'عدد الحصص المنفذة', type: 'number' },
      { name: 'status', label: 'حالة اللاعب', type: 'select', options: Object.keys(SWIMMER_STATUS).map(k => [k, SWIMMER_STATUS[k][0]]) },
      { name: 'notes', label: 'ملاحظات عامة', type: 'textarea' },
      { name: 'register_date', label: 'تاريخ التسجيل', type: 'date' }
    ]
  },

  guardians: {
    table: 'guardians', title: 'أولياء الأمور', module: 'guardians',
    search: 'full_name,phone,whatsapp,email',
    orderBy: 'id DESC',
    listQuery: `SELECT g.*, (SELECT COUNT(*) FROM swimmers s WHERE s.guardian_id=g.id) AS children_count FROM guardians g`,
    columns: [
      { k: 'full_name', label: 'الاسم', type: 'text' },
      { k: 'phone', label: 'الهاتف', type: 'text' },
      { k: 'whatsapp', label: 'واتساب', type: 'text' },
      { k: 'email', label: 'البريد', type: 'text' },
      { k: 'relation', label: 'صلة القرابة', type: 'text' },
      { k: 'children_count', label: 'الأبناء', type: 'num' }
    ],
    fields: [
      { name: 'full_name', label: 'الاسم', type: 'text', required: true },
      { name: 'phone', label: 'رقم الهاتف', type: 'phone' },
      { name: 'whatsapp', label: 'رقم واتساب', type: 'phone' },
      { name: 'email', label: 'البريد الإلكتروني', type: 'email' },
      { name: 'address', label: 'العنوان', type: 'text' },
      { name: 'relation', label: 'صلة القرابة', type: 'select', options: [['والد', 'والد'], ['والدة', 'والدة'], ['وصي', 'وصي'], ['آخر', 'آخر']] },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  coaches: {
    table: 'coaches', title: 'الكباتن والمدربون', module: 'coaches',
    search: 'full_name,phone,email,specialty',
    orderBy: 'id DESC',
    listQuery: `SELECT c.*, (SELECT COUNT(*) FROM swimmers s WHERE s.coach_id=c.id) AS swimmer_count FROM coaches c`,
    columns: [
      { k: 'full_name', label: 'الكابتن', type: 'avatar' },
      { k: 'specialty', label: 'التخصص', type: 'text' },
      { k: 'experience_years', label: 'الخبرة (سنوات)', type: 'num' },
      { k: 'contract_type', label: 'التعاقد', type: 'status', map: { full: ['راتب شهري', 'blue'], per_session: ['بالحصص', 'green'], ratio: ['نسبة', 'purple'] } },
      { k: 'swimmer_count', label: 'عدد السباحين', type: 'num' },
      { k: 'performance_rating', label: 'التقييم', type: 'rating' },
      { k: 'license_expiry', label: 'انتهاء الترخيص', type: 'date', warnDays: 90 }
    ],
    fields: [
      { name: 'full_name', label: 'الاسم', type: 'text', required: true },
      { name: 'phone', label: 'رقم الهاتف', type: 'phone' },
      { name: 'email', label: 'البريد الإلكتروني', type: 'email' },
      { name: 'address', label: 'العنوان', type: 'text' },
      { name: 'qualification', label: 'المؤهل الدراسي', type: 'text' },
      { name: 'specialty', label: 'التخصص', type: 'text' },
      { name: 'experience_years', label: 'سنوات الخبرة', type: 'number' },
      { name: 'certificates', label: 'الشهادات والدورات', type: 'textarea' },
      { name: 'hire_date', label: 'تاريخ التعيين', type: 'date' },
      { name: 'contract_type', label: 'نوع التعاقد', type: 'select', options: [['full', 'راتب شهري'], ['per_session', 'قيمة الحصة'], ['ratio', 'نسبة']] },
      { name: 'salary_or_rate', label: 'الراتب / قيمة الحصة', type: 'number' },
      { name: 'work_days', label: 'أيام العمل', type: 'text' },
      { name: 'work_hours', label: 'ساعات العمل', type: 'text' },
      { name: 'programs_eligible', label: 'البرامج المؤهل لها', type: 'text' },
      { name: 'license_expiry', label: 'تاريخ انتهاء التراخيص', type: 'date' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  users: {
    table: 'users', title: 'المستخدمون والموظفون', module: 'users',
    search: 'full_name,username,phone,email',
    orderBy: 'id DESC',
    listQuery: `SELECT u.*, b.name AS branch_name, r.name_ar AS role_name FROM users u LEFT JOIN branches b ON b.id=u.branch_id LEFT JOIN roles r ON r.role=u.role`,
    columns: [
      { k: 'full_name', label: 'الاسم', type: 'avatar' },
      { k: 'username', label: 'اسم المستخدم', type: 'code' },
      { k: 'role_name', label: 'الدور', type: 'text' },
      { k: 'branch_name', label: 'الفرع', type: 'text' },
      { k: 'is_active', label: 'الحالة', type: 'status', map: { 1: ['مفعل', 'green'], 0: ['معطل', 'red'] } },
      { k: 'last_login', label: 'آخر دخول', type: 'datetime' }
    ],
    fields: [
      { name: 'full_name', label: 'الاسم بالكامل', type: 'text', required: true },
      { name: 'username', label: 'اسم المستخدم', type: 'text', required: true },
      { name: 'password', label: 'كلمة المرور (اتركها فارغة لعدم التغيير)', type: 'password' },
      { name: 'role', label: 'الدور', type: 'fk', table: 'roles', text: 'name_ar', value: 'role' },
      { name: 'phone', label: 'الهاتف', type: 'phone' },
      { name: 'email', label: 'البريد الإلكتروني', type: 'email' },
      { name: 'branch_id', label: 'الفرع', type: 'fk', table: 'branches', text: 'name' },
      { name: 'is_active', label: 'الحساب مفعل', type: 'switch', on: 1, off: 0 }
    ]
  },

  programs: {
    table: 'programs', title: 'البرامج والدورات', module: 'programs',
    search: 'name,program_type',
    orderBy: 'id DESC',
    listQuery: `SELECT p.*, l.name AS level_name, c.full_name AS coach_name, po.name AS pool_name FROM programs p LEFT JOIN levels l ON l.id=p.level_required_id LEFT JOIN coaches c ON c.id=p.coach_id LEFT JOIN pools po ON po.id=p.pool_id`,
    columns: [
      { k: 'name', label: 'البرنامج', type: 'text' },
      { k: 'program_type', label: 'النوع', type: 'status', map: PROG_TYPE },
      { k: 'sessions_count', label: 'عدد الحصص', type: 'num' },
      { k: 'session_minutes', label: 'مدة الحصة', type: 'num', suffix: ' د' },
      { k: 'price', label: 'السعر', type: 'money' },
      { k: 'coach_name', label: 'المدرب', type: 'text' },
      { k: 'status', label: 'الحالة', type: 'status', map: PROG_STATUS }
    ],
    fields: [
      { name: 'name', label: 'اسم البرنامج', type: 'text', required: true },
      { name: 'program_type', label: 'نوع البرنامج', type: 'select', options: Object.keys(PROG_TYPE).map(k => [k, PROG_TYPE[k][0]]) },
      { name: 'description', label: 'وصف البرنامج', type: 'textarea' },
      { name: 'age_from', label: 'العمر من', type: 'number' },
      { name: 'age_to', label: 'العمر إلى', type: 'number' },
      { name: 'level_required_id', label: 'المستوى المطلوب', type: 'fk', table: 'levels', text: 'name' },
      { name: 'sessions_count', label: 'عدد الحصص', type: 'number' },
      { name: 'session_minutes', label: 'مدة الحصة (دقائق)', type: 'number' },
      { name: 'weeks', label: 'عدد الأسابيع', type: 'number' },
      { name: 'price', label: 'سعر البرنامج', type: 'number' },
      { name: 'max_swimmers', label: 'الحد الأقصى للمشتركين', type: 'number' },
      { name: 'coach_id', label: 'المدرب المسؤول', type: 'fk', table: 'coaches', text: 'full_name' },
      { name: 'pool_id', label: 'حمام السباحة', type: 'fk', table: 'pools', text: 'name' },
      { name: 'schedule_notes', label: 'مواعيد البرنامج', type: 'text' },
      { name: 'required_tests', label: 'الاختبارات المطلوبة', type: 'text' },
      { name: 'success_conditions', label: 'شروط النجاح/الانتقال', type: 'text' },
      { name: 'certificate', label: 'الشهادة', type: 'text' },
      { name: 'status', label: 'الحالة', type: 'select', options: Object.keys(PROG_STATUS).map(k => [k, PROG_STATUS[k][0]]) }
    ]
  },

  levels: {
    table: 'levels', title: 'المستويات', module: 'levels',
    search: 'name',
    orderBy: 'order_index ASC',
    listQuery: `SELECT l.* FROM levels l`,
    columns: [
      { k: 'name', label: 'اسم المستوى', type: 'text' },
      { k: 'order_index', label: 'الترتيب', type: 'num' },
      { k: 'min_age', label: 'الحد الأدنى للعمر', type: 'num' },
      { k: 'is_team_level', label: 'مستوى فرق', type: 'status', map: { 1: ['نعم', 'purple'], 0: ['لا', 'gray'] } }
    ],
    fields: [
      { name: 'name', label: 'اسم المستوى', type: 'text', required: true },
      { name: 'order_index', label: 'الترتيب', type: 'number' },
      { name: 'min_age', label: 'الحد الأدنى للعمر', type: 'number' },
      { name: 'is_team_level', label: 'مستوى فرق', type: 'switch', on: 1, off: 0 },
      { name: 'description', label: 'الوصف', type: 'textarea' }
    ]
  },

  groups: {
    table: 'groups', title: 'المجموعات التدريبية', module: 'groups',
    search: 'name',
    orderBy: 'id DESC',
    listQuery: `SELECT gr.*, c.full_name AS coach_name, po.name AS pool_name, pr.name AS program_name, l.name AS level_name, (SELECT COUNT(*) FROM swimmers s WHERE s.group_id=gr.id) AS swimmers_count FROM groups gr LEFT JOIN coaches c ON c.id=gr.coach_id LEFT JOIN pools po ON po.id=gr.pool_id LEFT JOIN programs pr ON pr.id=gr.program_id LEFT JOIN levels l ON l.id=gr.level_id`,
    columns: [
      { k: 'name', label: 'المجموعة', type: 'text' },
      { k: 'coach_name', label: 'الكابتن', type: 'text' },
      { k: 'program_name', label: 'البرنامج', type: 'text' },
      { k: 'level_name', label: 'المستوى', type: 'text' },
      { k: 'swimmers_count', label: 'العدد / السعة', type: 'cap' },
      { k: 'group_type', label: 'النوع', type: 'status', map: { group: ['جماعية', 'blue'], individual: ['فردية', 'green'], team: ['فريق', 'purple'] } }
    ],
    fields: [
      { name: 'name', label: 'اسم المجموعة', type: 'text', required: true },
      { name: 'branch_id', label: 'الفرع', type: 'fk', table: 'branches', text: 'name' },
      { name: 'pool_id', label: 'حمام السباحة', type: 'fk', table: 'pools', text: 'name' },
      { name: 'coach_id', label: 'الكابتن', type: 'fk', table: 'coaches', text: 'full_name' },
      { name: 'program_id', label: 'البرنامج', type: 'fk', table: 'programs', text: 'name' },
      { name: 'level_id', label: 'المستوى', type: 'fk', table: 'levels', text: 'name' },
      { name: 'schedule', label: 'جدول الحصص (JSON) - مثال: [{"day":"السبت","start":"09:00","end":"10:00"}]', type: 'textarea' },
      { name: 'max_capacity', label: 'السعة القصوى', type: 'number' },
      { name: 'group_type', label: 'النوع', type: 'select', options: [['group', 'جماعية'], ['individual', 'فردية'], ['team', 'فريق']] },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  sessions: {
    table: 'sessions', title: 'الحصص والجداول', module: 'sessions',
    search: 'title',
    orderBy: 'se.date DESC, se.start_time DESC',
    listQuery: `SELECT se.*, gr.name AS group_name, c.full_name AS coach_name, po.name AS pool_name, b.name AS branch_name, (SELECT COUNT(*) FROM attendance a WHERE a.session_id=se.id AND a.status='present') AS present_count FROM sessions se LEFT JOIN groups gr ON gr.id=se.group_id LEFT JOIN coaches c ON c.id=se.coach_id LEFT JOIN pools po ON po.id=se.pool_id LEFT JOIN branches b ON b.id=se.branch_id`,
    columns: [
      { k: 'title', label: 'الحصة', type: 'text' },
      { k: 'date', label: 'التاريخ', type: 'date' },
      { k: 'start_time', label: 'الموعد', type: 'text' },
      { k: 'group_name', label: 'المجموعة', type: 'text' },
      { k: 'coach_name', label: 'الكابتن', type: 'text' },
      { k: 'pool_name', label: 'الحمام', type: 'text' },
      { k: 'status', label: 'الحالة', type: 'status', map: SESS_STATUS }
    ],
    fields: [
      { name: 'title', label: 'عنوان الحصة', type: 'text' },
      { name: 'group_id', label: 'المجموعة', type: 'fk', table: 'groups', text: 'name' },
      { name: 'coach_id', label: 'الكابتن', type: 'fk', table: 'coaches', text: 'full_name' },
      { name: 'pool_id', label: 'حمام السباحة', type: 'fk', table: 'pools', text: 'name' },
      { name: 'branch_id', label: 'الفرع', type: 'fk', table: 'branches', text: 'name' },
      { name: 'date', label: 'التاريخ', type: 'date', required: true },
      { name: 'start_time', label: 'البداية', type: 'time' },
      { name: 'end_time', label: 'النهاية', type: 'time' },
      { name: 'session_type', label: 'النوع', type: 'select', options: [['normal', 'عادية'], ['compensatory', 'تعويضية'], ['private', 'فردية'], ['test', 'اختبار']] },
      { name: 'status', label: 'الحالة', type: 'select', options: [['scheduled', 'مجدولة'], ['done', 'منفذة'], ['cancelled', 'ملغاة']] },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  subscriptions: {
    table: 'subscriptions', title: 'الاشتراكات', module: 'subscriptions',
    search: 'receipt_no',
    orderBy: 'id DESC',
    listQuery: `SELECT su.*, sw.full_name AS swimmer_name, sw.membership_no, pr.name AS program_name, gr.name AS group_name FROM subscriptions su LEFT JOIN swimmers sw ON sw.id=su.swimmer_id LEFT JOIN programs pr ON pr.id=su.program_id LEFT JOIN groups gr ON gr.id=su.group_id`,
    columns: [
      { k: 'swimmer_name', label: 'السباح', type: 'text' },
      { k: 'program_name', label: 'البرنامج', type: 'text' },
      { k: 'start_date', label: 'البداية', type: 'date' },
      { k: 'end_date', label: 'النهاية', type: 'date', warnDays: 10 },
      { k: 'sessions_count', label: 'الحصص', type: 'num' },
      { k: 'price', label: 'المبلغ', type: 'money' },
      { k: 'paid_amount', label: 'المدفوع', type: 'money' },
      { k: 'remaining_amount', label: 'المتبقي', type: 'money', dangerIf: 0 },
      { k: 'status', label: 'الحالة', type: 'status', map: SUB_STATUS }
    ],
    fields: [
      { name: 'swimmer_id', label: 'السباح', type: 'fk', table: 'swimmers', text: 'full_name', required: true },
      { name: 'program_id', label: 'البرنامج', type: 'fk', table: 'programs', text: 'name' },
      { name: 'group_id', label: 'المجموعة', type: 'fk', table: 'groups', text: 'name' },
      { name: 'start_date', label: 'تاريخ البداية', type: 'date' },
      { name: 'end_date', label: 'تاريخ النهاية', type: 'date' },
      { name: 'sessions_count', label: 'عدد الحصص', type: 'number' },
      { name: 'price', label: 'سعر الاشتراك', type: 'number' },
      { name: 'discount', label: 'الخصم', type: 'number' },
      { name: 'tax', label: 'الضريبة', type: 'number' },
      { name: 'paid_amount', label: 'المبلغ المدفوع', type: 'number' },
      { name: 'payment_method', label: 'طريقة الدفع', type: 'select', options: PAY_METHODS.map(k => [k, PAY_METHOD[k]]) },
      { name: 'receipt_no', label: 'رقم الإيصال', type: 'text' },
      { name: 'pay_date', label: 'تاريخ الدفع', type: 'date' },
      { name: 'status', label: 'الحالة', type: 'select', options: Object.keys(SUB_STATUS).map(k => [k, SUB_STATUS[k][0]]) },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  payments: {
    table: 'payments', title: 'المدفوعات', module: 'payments',
    search: 'receipt_no',
    orderBy: 'id DESC',
    listQuery: `SELECT p.*, sw.full_name AS swimmer_name, sw.membership_no FROM payments p LEFT JOIN swimmers sw ON sw.id=p.swimmer_id`,
    columns: [
      { k: 'swimmer_name', label: 'السباح', type: 'text' },
      { k: 'amount', label: 'المبلغ', type: 'money' },
      { k: 'method', label: 'الطريقة', type: 'status', map: PAY_METHOD },
      { k: 'receipt_no', label: 'الإيصال', type: 'code' },
      { k: 'pay_date', label: 'التاريخ', type: 'date' },
      { k: 'status', label: 'الحالة', type: 'status', map: PAY_STATUS }
    ],
    fields: [
      { name: 'swimmer_id', label: 'السباح', type: 'fk', table: 'swimmers', text: 'full_name', required: true },
      { name: 'subscription_id', label: 'الاشتراك', type: 'fk', table: 'subscriptions', text: 'receipt_no' },
      { name: 'amount', label: 'المبلغ', type: 'number', required: true },
      { name: 'method', label: 'طريقة الدفع', type: 'select', options: PAY_METHODS.map(k => [k, PAY_METHOD[k]]) },
      { name: 'receipt_no', label: 'رقم الإيصال', type: 'text' },
      { name: 'pay_date', label: 'تاريخ الدفع', type: 'date' },
      { name: 'status', label: 'الحالة', type: 'select', options: [['approved', 'معتمد'], ['pending', 'قيد الاعتماد']] },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  revenues: {
    table: 'revenues', title: 'الإيرادات', module: 'revenues',
    search: 'trans_no,description,category',
    orderBy: 'id DESC',
    listQuery: `SELECT r.*, b.name AS branch_name FROM revenues r LEFT JOIN branches b ON b.id=r.branch_id`,
    columns: [
      { k: 'trans_no', label: 'رقم العملية', type: 'code' },
      { k: 'date', label: 'التاريخ', type: 'date' },
      { k: 'category', label: 'التصنيف', type: 'text' },
      { k: 'description', label: 'البيان', type: 'text' },
      { k: 'amount', label: 'المبلغ', type: 'money' },
      { k: 'payment_method', label: 'الطريقة', type: 'status', map: PAY_METHOD },
      { k: 'status', label: 'الاعتماد', type: 'status', map: PAY_STATUS }
    ],
    fields: [
      { name: 'trans_no', label: 'رقم العملية', type: 'text' },
      { name: 'date', label: 'التاريخ', type: 'date' },
      { name: 'category', label: 'التصنيف', type: 'select', options: [['اشتراكات السباحين', 'اشتراكات السباحين'], ['رسوم الاختبارات', 'رسوم الاختبارات'], ['رسوم البطولات', 'رسوم البطولات'], ['رسوم المعسكرات', 'رسوم المعسكرات'], ['بيع الأدوات', 'بيع الأدوات'], ['رسوم الشهادات', 'رسوم الشهادات'], ['إيرادات أخرى', 'إيرادات أخرى']] },
      { name: 'description', label: 'البيان', type: 'text' },
      { name: 'amount', label: 'المبلغ', type: 'number', required: true },
      { name: 'payment_method', label: 'طريقة الدفع', type: 'select', options: PAY_METHODS.map(k => [k, PAY_METHOD[k]]) },
      { name: 'payer', label: 'الدافع', type: 'text' },
      { name: 'employee', label: 'الموظف المسؤول', type: 'text' },
      { name: 'branch_id', label: 'الفرع', type: 'fk', table: 'branches', text: 'name' },
      { name: 'status', label: 'حالة الاعتماد', type: 'select', options: [['approved', 'معتمد'], ['pending', 'قيد الاعتماد']] },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  expenses: {
    table: 'expenses', title: 'المصروفات', module: 'expenses',
    search: 'trans_no,description,category',
    orderBy: 'id DESC',
    listQuery: `SELECT e.*, b.name AS branch_name FROM expenses e LEFT JOIN branches b ON b.id=e.branch_id`,
    columns: [
      { k: 'trans_no', label: 'رقم العملية', type: 'code' },
      { k: 'date', label: 'التاريخ', type: 'date' },
      { k: 'category', label: 'التصنيف', type: 'text' },
      { k: 'description', label: 'البيان', type: 'text' },
      { k: 'amount', label: 'المبلغ', type: 'money' },
      { k: 'beneficiary', label: 'المستفيد', type: 'text' },
      { k: 'status', label: 'الاعتماد', type: 'status', map: PAY_STATUS }
    ],
    fields: [
      { name: 'trans_no', label: 'رقم العملية', type: 'text' },
      { name: 'date', label: 'التاريخ', type: 'date' },
      { name: 'category', label: 'التصنيف', type: 'select', options: [['رواتب المدربين', 'رواتب المدربين'], ['إيجار حمام السباحة', 'إيجار حمام السباحة'], ['شراء الأدوات', 'شراء الأدوات'], ['الصيانة', 'الصيانة'], ['التسويق', 'التسويق'], ['الانتقالات', 'الانتقالات'], ['البطولات', 'البطولات'], ['مصروفات إدارية', 'مصروفات إدارية'], ['مصروفات أخرى', 'مصروفات أخرى']] },
      { name: 'description', label: 'البيان', type: 'text' },
      { name: 'amount', label: 'المبلغ', type: 'number', required: true },
      { name: 'payment_method', label: 'طريقة الدفع', type: 'select', options: PAY_METHODS.map(k => [k, PAY_METHOD[k]]) },
      { name: 'beneficiary', label: 'المستفيد', type: 'text' },
      { name: 'employee', label: 'الموظف المسؤول', type: 'text' },
      { name: 'branch_id', label: 'الفرع', type: 'fk', table: 'branches', text: 'name' },
      { name: 'status', label: 'حالة الاعتماد', type: 'select', options: [['approved', 'معتمد'], ['pending', 'قيد الاعتماد']] },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  coach_dues: {
    table: 'coach_dues', title: 'مستحقات المدربين', module: 'coach_dues',
    search: 'month',
    orderBy: 'id DESC',
    listQuery: `SELECT cd.*, c.full_name AS coach_name FROM coach_dues cd LEFT JOIN coaches c ON c.id=cd.coach_id`,
    columns: [
      { k: 'coach_name', label: 'الكابتن', type: 'text' },
      { k: 'month', label: 'الشهر', type: 'text' },
      { k: 'amount', label: 'المستحق', type: 'money' },
      { k: 'incentives', label: 'حوافز', type: 'money' },
      { k: 'deductions', label: 'خصومات', type: 'money' },
      { k: 'net_amount', label: 'الصافي', type: 'money' },
      { k: 'paid_amount', label: 'المدفوع', type: 'money' },
      { k: 'status', label: 'الحالة', type: 'status', map: { paid: ['مدفوع', 'green'], pending: ['معلق', 'amber'], partial: ['جزئي', 'blue'] } }
    ],
    fields: [
      { name: 'coach_id', label: 'الكابتن', type: 'fk', table: 'coaches', text: 'full_name', required: true },
      { name: 'month', label: 'الشهر (YYYY-MM)', type: 'month' },
      { name: 'amount', label: 'المستحق', type: 'number' },
      { name: 'incentives', label: 'حوافز', type: 'number' },
      { name: 'deductions', label: 'خصومات', type: 'number' },
      { name: 'paid_amount', label: 'المدفوع', type: 'number' },
      { name: 'status', label: 'الحالة', type: 'select', options: [['pending', 'معلق'], ['paid', 'مدفوع'], ['partial', 'جزئي']] },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  teams: {
    table: 'teams', title: 'الفرق', module: 'teams',
    search: 'name',
    orderBy: 'id DESC',
    listQuery: `SELECT t.*, c.full_name AS coach_name, (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id=t.id) AS players_count FROM teams t LEFT JOIN coaches c ON c.id=t.coach_id`,
    columns: [
      { k: 'name', label: 'الفريق', type: 'text' },
      { k: 'age_category', label: 'الفئة العمرية', type: 'text' },
      { k: 'coach_name', label: 'المدرب', type: 'text' },
      { k: 'players_count', label: 'اللاعبون', type: 'num' }
    ],
    fields: [
      { name: 'name', label: 'اسم الفريق', type: 'text', required: true },
      { name: 'branch_id', label: 'الفرع', type: 'fk', table: 'branches', text: 'name' },
      { name: 'age_category', label: 'الفئة العمرية', type: 'text' },
      { name: 'coach_id', label: 'المدرب المسؤول', type: 'fk', table: 'coaches', text: 'full_name' },
      { name: 'training_plan', label: 'خطة التدريب', type: 'textarea' },
      { name: 'schedule_notes', label: 'مواعيد التدريبات', type: 'text' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  tournaments: {
    table: 'tournaments', title: 'البطولات', module: 'tournaments',
    search: 'name,location',
    orderBy: 'date_from DESC',
    listQuery: `SELECT t.* FROM tournaments t`,
    columns: [
      { k: 'name', label: 'البطولة', type: 'text' },
      { k: 'date_from', label: 'البداية', type: 'date' },
      { k: 'date_to', label: 'النهاية', type: 'date' },
      { k: 'location', label: 'المكان', type: 'text' }
    ],
    fields: [
      { name: 'name', label: 'اسم البطولة', type: 'text', required: true },
      { name: 'date_from', label: 'تاريخ البداية', type: 'date' },
      { name: 'date_to', label: 'تاريخ النهاية', type: 'date' },
      { name: 'location', label: 'المكان', type: 'text' },
      { name: 'description', label: 'الوصف', type: 'textarea' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  incoming: {
    table: 'incoming_docs', title: 'الوارد', module: 'incoming',
    search: 'doc_no,sender,subject',
    orderBy: 'id DESC',
    listQuery: `SELECT * FROM incoming_docs`,
    columns: [
      { k: 'doc_no', label: 'رقم الوارد', type: 'code' },
      { k: 'receive_date', label: 'تاريخ الاستلام', type: 'date' },
      { k: 'sender', label: 'الجهة المرسلة', type: 'text' },
      { k: 'subject', label: 'الموضوع', type: 'text' },
      { k: 'doc_type', label: 'النوع', type: 'text' },
      { k: 'due_date', label: 'الاستحقاق', type: 'date', warnDays: 5 },
      { k: 'status', label: 'الحالة', type: 'status', map: DOC_STATUS }
    ],
    fields: [
      { name: 'doc_no', label: 'رقم الوارد', type: 'text' },
      { name: 'receive_date', label: 'تاريخ الاستلام', type: 'date' },
      { name: 'sender', label: 'الجهة المرسلة', type: 'text' },
      { name: 'subject', label: 'موضوع الخطاب', type: 'text', required: true },
      { name: 'doc_type', label: 'نوع المستند', type: 'text' },
      { name: 'receiver', label: 'الشخص المستلم', type: 'text' },
      { name: 'required_action', label: 'الإجراء المطلوب', type: 'text' },
      { name: 'followup_by', label: 'المسؤول عن المتابعة', type: 'text' },
      { name: 'due_date', label: 'تاريخ الاستحقاق', type: 'date' },
      { name: 'status', label: 'حالة المعاملة', type: 'select', options: [['open', 'مفتوح'], ['done', 'تم التنفيذ'], ['overdue', 'متأخر']] },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  outgoing: {
    table: 'outgoing_docs', title: 'الصادر', module: 'outgoing',
    search: 'doc_no,recipient,subject',
    orderBy: 'id DESC',
    listQuery: `SELECT * FROM outgoing_docs`,
    columns: [
      { k: 'doc_no', label: 'رقم الصادر', type: 'code' },
      { k: 'send_date', label: 'تاريخ الإرسال', type: 'date' },
      { k: 'recipient', label: 'الجهة المرسل إليها', type: 'text' },
      { k: 'subject', label: 'الموضوع', type: 'text' },
      { k: 'doc_type', label: 'النوع', type: 'text' },
      { k: 'send_method', label: 'الوسيلة', type: 'text' },
      { k: 'delivery_status', label: 'حالة التسليم', type: 'status', map: DELIVERY_STATUS }
    ],
    fields: [
      { name: 'doc_no', label: 'رقم الصادر', type: 'text' },
      { name: 'send_date', label: 'تاريخ الإرسال', type: 'date' },
      { name: 'recipient', label: 'الجهة المرسل إليها', type: 'text' },
      { name: 'subject', label: 'موضوع الخطاب', type: 'text', required: true },
      { name: 'doc_type', label: 'نوع الخطاب', type: 'text' },
      { name: 'responsible', label: 'الشخص المسؤول', type: 'text' },
      { name: 'send_method', label: 'وسيلة الإرسال', type: 'text' },
      { name: 'delivery_status', label: 'حالة التسليم', type: 'select', options: [['delivered', 'تم التسليم'], ['pending', 'قيد الإرسال'], ['failed', 'لم يُسلم']] },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  documents: {
    table: 'documents', title: 'المستندات والأوراق', module: 'documents',
    search: 'title,category',
    orderBy: 'id DESC',
    listQuery: `SELECT d.*, u.full_name AS uploader FROM documents d LEFT JOIN users u ON u.id=d.uploaded_by`,
    columns: [
      { k: 'category', label: 'التصنيف', type: 'text' },
      { k: 'title', label: 'العنوان', type: 'text' },
      { k: 'entity_type', label: 'المرتبط بـ', type: 'status', map: { swimmer: ['سباح', 'blue'], coach: ['مدرب', 'green'], guardian: ['ولي أمر', 'purple'], other: ['عام', 'gray'] } },
      { k: 'visibility', label: 'الصلاحية', type: 'status', map: { private: ['خاص', 'amber'], public: ['عام', 'green'] } },
      { k: 'created_at', label: 'التاريخ', type: 'datetime' }
    ],
    fields: [
      { name: 'category', label: 'التصنيف', type: 'select', options: [['شهادة ميلاد', 'شهادة ميلاد'], ['بطاقة ولي الأمر', 'بطاقة ولي الأمر'], ['تقرير طبي', 'تقرير طبي'], ['إقرار حالة صحية', 'إقرار حالة صحية'], ['موافقة اشتراك', 'موافقة اشتراك'], ['إقرار مسؤولية', 'إقرار مسؤولية'], ['صورة لاعب', 'صورة لاعب'], ['شهادة مدرب', 'شهادة مدرب'], ['عقد', 'عقد'], ['إيصال', 'إيصال'], ['خطاب وارد/صادر', 'خطاب وارد/صادر'], ['نتيجة اختبار', 'نتيجة اختبار'], ['شهادة اجتياز', 'شهادة اجتياز'], ['أخرى', 'أخرى']] },
      { name: 'title', label: 'العنوان', type: 'text', required: true },
      { name: 'entity_type', label: 'المرتبط بـ', type: 'select', options: [['swimmer', 'سباح'], ['coach', 'مدرب'], ['guardian', 'ولي أمر'], ['other', 'عام']] },
      { name: 'entity_id', label: 'معرف العنصر المرتبط', type: 'number' },
      { name: 'visibility', label: 'صلاحية الاطلاع', type: 'select', options: [['private', 'خاص'], ['public', 'عام']] },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  complaints: {
    table: 'complaints', title: 'الشكاوى والطلبات', module: 'complaints',
    search: 'subject,description',
    orderBy: 'id DESC',
    listQuery: `SELECT c.*, g.full_name AS guardian_name, sw.full_name AS swimmer_name FROM complaints c LEFT JOIN guardians g ON g.id=c.guardian_id LEFT JOIN swimmers sw ON sw.id=c.swimmer_id`,
    columns: [
      { k: 'guardian_name', label: 'ولي الأمر', type: 'text' },
      { k: 'swimmer_name', label: 'السباح', type: 'text' },
      { k: 'subject', label: 'الموضوع', type: 'text' },
      { k: 'status', label: 'الحالة', type: 'status', map: COMPLAINT_STATUS },
      { k: 'created_at', label: 'التاريخ', type: 'datetime' }
    ],
    fields: [
      { name: 'guardian_id', label: 'ولي الأمر', type: 'fk', table: 'guardians', text: 'full_name' },
      { name: 'swimmer_id', label: 'السباح', type: 'fk', table: 'swimmers', text: 'full_name' },
      { name: 'subject', label: 'الموضوع', type: 'text', required: true },
      { name: 'description', label: 'التفاصيل', type: 'textarea' },
      { name: 'status', label: 'الحالة', type: 'select', options: [['open', 'مفتوحة'], ['in_progress', 'قيد المعالجة'], ['resolved', 'تم الحل']] },
      { name: 'response', label: 'الرد', type: 'textarea' }
    ]
  },

  news: {
    table: 'news', title: 'الأخبار والإعلانات', module: 'settings',
    search: 'title',
    orderBy: 'id DESC',
    listQuery: `SELECT * FROM news`,
    columns: [
      { k: 'title', label: 'العنوان', type: 'text' },
      { k: 'date', label: 'التاريخ', type: 'date' },
      { k: 'is_published', label: 'النشر', type: 'status', map: { 1: ['منشور', 'green'], 0: ['مسودة', 'gray'] } }
    ],
    fields: [
      { name: 'title', label: 'العنوان', type: 'text', required: true },
      { name: 'body', label: 'المحتوى', type: 'textarea' },
      { name: 'date', label: 'التاريخ', type: 'date' },
      { name: 'is_published', label: 'منشور', type: 'switch', on: 1, off: 0 }
    ]
  },

  branches: {
    table: 'branches', title: 'الفروع', module: 'branches',
    search: 'name,address',
    orderBy: 'id ASC',
    listQuery: `SELECT b.*, (SELECT COUNT(*) FROM swimmers s JOIN groups g ON g.id=s.group_id WHERE g.branch_id=b.id) AS swimmers_count, (SELECT COUNT(*) FROM pools p WHERE p.branch_id=b.id) AS pools_count FROM branches b`,
    columns: [
      { k: 'name', label: 'الفرع', type: 'text' },
      { k: 'address', label: 'العنوان', type: 'text' },
      { k: 'phone', label: 'الهاتف', type: 'text' },
      { k: 'manager_name', label: 'مدير الفرع', type: 'text' },
      { k: 'pools_count', label: 'حمامات', type: 'num' }
    ],
    fields: [
      { name: 'name', label: 'اسم الفرع', type: 'text', required: true },
      { name: 'address', label: 'العنوان', type: 'text' },
      { name: 'phone', label: 'الهاتف', type: 'phone' },
      { name: 'email', label: 'البريد الإلكتروني', type: 'email' },
      { name: 'manager_name', label: 'مدير الفرع', type: 'text' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  pools: {
    table: 'pools', title: 'حمامات السباحة', module: 'pools',
    search: 'name',
    orderBy: 'id ASC',
    listQuery: `SELECT p.*, b.name AS branch_name FROM pools p LEFT JOIN branches b ON b.id=p.branch_id`,
    columns: [
      { k: 'name', label: 'الحمام', type: 'text' },
      { k: 'branch_name', label: 'الفرع', type: 'text' },
      { k: 'lanes', label: 'الممرات', type: 'num' },
      { k: 'length_m', label: 'الطول (م)', type: 'num' },
      { k: 'capacity', label: 'السعة', type: 'num' }
    ],
    fields: [
      { name: 'branch_id', label: 'الفرع', type: 'fk', table: 'branches', text: 'name' },
      { name: 'name', label: 'اسم الحمام', type: 'text', required: true },
      { name: 'lanes', label: 'عدد الممرات', type: 'number' },
      { name: 'length_m', label: 'الطول (متر)', type: 'number' },
      { name: 'capacity', label: 'السعة القصوى', type: 'number' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  subscription_requests: {
    table: 'subscription_requests', title: 'طلبات الاشتراك', module: 'reception',
    search: 'swimmer_name,guardian_name,guardian_phone',
    orderBy: 'id DESC',
    listQuery: `SELECT sr.*, pr.name AS program_name FROM subscription_requests sr LEFT JOIN programs pr ON pr.id=sr.program_id`,
    columns: [
      { k: 'swimmer_name', label: 'السباح', type: 'text' },
      { k: 'age', label: 'العمر', type: 'num' },
      { k: 'guardian_name', label: 'ولي الأمر', type: 'text' },
      { k: 'guardian_phone', label: 'الهاتف', type: 'text' },
      { k: 'program_name', label: 'البرنامج', type: 'text' },
      { k: 'status', label: 'الحالة', type: 'status', map: REQ_STATUS }
    ],
    fields: [
      { name: 'swimmer_name', label: 'اسم السباح', type: 'text', required: true },
      { name: 'age', label: 'العمر', type: 'number' },
      { name: 'guardian_name', label: 'اسم ولي الأمر', type: 'text' },
      { name: 'guardian_phone', label: 'هاتف ولي الأمر', type: 'phone' },
      { name: 'program_id', label: 'البرنامج المطلوب', type: 'fk', table: 'programs', text: 'name' },
      { name: 'message', label: 'الطلب', type: 'textarea' },
      { name: 'status', label: 'الحالة', type: 'select', options: [['new', 'جديد'], ['contacted', 'تم التواصل'], ['closed', 'مغلق']] }
    ]
  },

  contact_messages: {
    table: 'contact_messages', title: 'رسائل التواصل', module: 'settings',
    search: 'name,subject,phone',
    orderBy: 'id DESC',
    listQuery: `SELECT * FROM contact_messages`,
    columns: [
      { k: 'name', label: 'الاسم', type: 'text' },
      { k: 'phone', label: 'الهاتف', type: 'text' },
      { k: 'subject', label: 'الموضوع', type: 'text' },
      { k: 'is_read', label: 'الحالة', type: 'status', map: { 1: ['مقروءة', 'green'], 0: ['جديدة', 'amber'] } }
    ],
    fields: [
      { name: 'name', label: 'الاسم', type: 'text', required: true },
      { name: 'phone', label: 'الهاتف', type: 'phone' },
      { name: 'email', label: 'البريد', type: 'email' },
      { name: 'subject', label: 'الموضوع', type: 'text' },
      { name: 'message', label: 'الرسالة', type: 'textarea' }
    ]
  },

  gallery: {
    table: 'gallery', title: 'معرض الصور والفيديو', module: 'settings',
    search: 'title',
    orderBy: 'id DESC',
    listQuery: `SELECT * FROM gallery`,
    columns: [
      { k: 'title', label: 'العنوان', type: 'text' },
      { k: 'type', label: 'النوع', type: 'status', map: { image: ['صورة', 'blue'], video: ['فيديو', 'purple'] } }
    ],
    fields: [
      { name: 'title', label: 'العنوان', type: 'text', required: true },
      { name: 'type', label: 'النوع', type: 'select', options: [['image', 'صورة'], ['video', 'فيديو']] },
      { name: 'url', label: 'رابط الملف', type: 'text' }
    ]
  },

  faqs: {
    table: 'faqs', title: 'الأسئلة الشائعة', module: 'settings',
    search: 'question',
    orderBy: 'order_index ASC',
    listQuery: `SELECT * FROM faqs`,
    columns: [
      { k: 'order_index', label: '#', type: 'num' },
      { k: 'question', label: 'السؤال', type: 'text' }
    ],
    fields: [
      { name: 'question', label: 'السؤال', type: 'text', required: true },
      { name: 'answer', label: 'الإجابة', type: 'textarea' },
      { name: 'order_index', label: 'الترتيب', type: 'number' }
    ]
  },

  certificates: {
    table: 'certificates', title: 'الشهادات', module: 'subscriptions',
    search: 'cert_no',
    orderBy: 'id DESC',
    listQuery: `SELECT c.*, sw.full_name AS swimmer_name, pr.name AS program_name FROM certificates c LEFT JOIN swimmers sw ON sw.id=c.swimmer_id LEFT JOIN programs pr ON pr.id=c.program_id`,
    columns: [
      { k: 'swimmer_name', label: 'السباح', type: 'text' },
      { k: 'program_name', label: 'البرنامج', type: 'text' },
      { k: 'cert_no', label: 'رقم الشهادة', type: 'code' },
      { k: 'issue_date', label: 'تاريخ الإصدار', type: 'date' },
      { k: 'status', label: 'الحالة', type: 'status', map: { issued: ['صادرة', 'green'], pending: ['قيد الإصدار', 'amber'] } }
    ],
    fields: [
      { name: 'swimmer_id', label: 'السباح', type: 'fk', table: 'swimmers', text: 'full_name', required: true },
      { name: 'program_id', label: 'البرنامج', type: 'fk', table: 'programs', text: 'name' },
      { name: 'cert_no', label: 'رقم الشهادة', type: 'text' },
      { name: 'issue_date', label: 'تاريخ الإصدار', type: 'date' },
      { name: 'status', label: 'الحالة', type: 'select', options: [['issued', 'صادرة'], ['pending', 'قيد الإصدار']] },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  assessments: {
    table: 'assessments', title: 'التقييمات الفنية', module: 'assessments', custom: true,
    orderBy: 'id DESC',
    listQuery: `SELECT a.*, sw.full_name AS swimmer_name, sw.membership_no, c.full_name AS coach_name, pr.name AS program_name, l.name AS level_name FROM assessments a LEFT JOIN swimmers sw ON sw.id=a.swimmer_id LEFT JOIN coaches c ON c.id=a.coach_id LEFT JOIN programs pr ON pr.id=a.program_id LEFT JOIN levels l ON l.id=a.level_id`,
    columns: [
      { k: 'swimmer_name', label: 'السباح', type: 'text' },
      { k: 'coach_name', label: 'المقيم', type: 'text' },
      { k: 'date', label: 'التاريخ', type: 'date' },
      { k: 'level_name', label: 'المستوى', type: 'text' },
      { k: 'avg', label: 'المتوسط', type: 'rating' },
      { k: 'ready_to_advance', label: 'جاهز للانتقال', type: 'status', map: { 1: ['نعم', 'green'], 0: ['لا', 'amber'] } }
    ],
    fields: [
      { name: 'swimmer_id', label: 'السباح', type: 'fk', table: 'swimmers', text: 'full_name', required: true },
      { name: 'coach_id', label: 'الكابتن المقيم', type: 'fk', table: 'coaches', text: 'full_name' },
      { name: 'program_id', label: 'البرنامج', type: 'fk', table: 'programs', text: 'name' },
      { name: 'date', label: 'تاريخ التقييم', type: 'date' },
      { name: 'strengths', label: 'نقاط القوة', type: 'textarea' },
      { name: 'weaknesses', label: 'نقاط الضعف', type: 'textarea' },
      { name: 'recommendations', label: 'التوصيات', type: 'textarea' },
      { name: 'ready_to_advance', label: 'جاهز للانتقال للمستوى التالي', type: 'switch', on: 1, off: 0 },
      { name: 'next_assessment_date', label: 'تاريخ التقييم القادم', type: 'date' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  tests: {
    table: 'tests', title: 'الاختبارات', module: 'tests',
    search: 'name,stroke,result',
    orderBy: 'id DESC',
    listQuery: `SELECT t.*, sw.full_name AS swimmer_name, sw.membership_no, c.full_name AS coach_name FROM tests t LEFT JOIN swimmers sw ON sw.id=t.swimmer_id LEFT JOIN coaches c ON c.id=t.coach_id`,
    columns: [
      { k: 'swimmer_name', label: 'السباح', type: 'text' },
      { k: 'name', label: 'الاختبار', type: 'text' },
      { k: 'distance', label: 'المسافة', type: 'num', suffix: ' م' },
      { k: 'stroke', label: 'النوع', type: 'text' },
      { k: 'time_seconds', label: 'الزمن', type: 'time' },
      { k: 'result', label: 'النتيجة', type: 'text' }
    ],
    fields: [
      { name: 'swimmer_id', label: 'السباح', type: 'fk', table: 'swimmers', text: 'full_name', required: true },
      { name: 'coach_id', label: 'الكابتن', type: 'fk', table: 'coaches', text: 'full_name' },
      { name: 'name', label: 'اسم الاختبار', type: 'text' },
      { name: 'date', label: 'التاريخ', type: 'date' },
      { name: 'distance', label: 'المسافة (متر)', type: 'number' },
      { name: 'stroke', label: 'نوع السباق', type: 'select', options: [['حرة', 'حرة'], ['ظهر', 'ظهر'], ['صدر', 'صدر'], ['فراشة', 'فراشة'], ['فردي متنوع', 'فردي متنوع'], ['إنقاذ', 'إنقاذ']] },
      { name: 'time_seconds', label: 'الزمن (ثانية)', type: 'number' },
      { name: 'result', label: 'النتيجة', type: 'text' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  notifications: {
    table: 'notifications', title: 'الإشعارات', module: 'notifications',
    orderBy: 'id DESC',
    listQuery: `SELECT * FROM notifications`,
    columns: [
      { k: 'type', label: 'النوع', type: 'text' },
      { k: 'title', label: 'العنوان', type: 'text' },
      { k: 'body', label: 'المحتوى', type: 'text' },
      { k: 'is_read', label: 'الحالة', type: 'status', map: { 1: ['مقروء', 'green'], 0: ['جديد', 'amber'] } }
    ],
    fields: [
      { name: 'user_id', label: 'المستخدم (اختياري)', type: 'fk', table: 'users', text: 'full_name' },
      { name: 'type', label: 'النوع', type: 'text' },
      { name: 'title', label: 'العنوان', type: 'text', required: true },
      { name: 'body', label: 'المحتوى', type: 'textarea' }
    ]
  },

  team_members: {
    table: 'team_members', title: 'لاعبو الفرق', module: 'teams',
    orderBy: 'id DESC',
    listQuery: `SELECT tm.*, t.name AS team_name, sw.full_name AS swimmer_name FROM team_members tm LEFT JOIN teams t ON t.id=tm.team_id LEFT JOIN swimmers sw ON sw.id=tm.swimmer_id`,
    columns: [
      { k: 'team_name', label: 'الفريق', type: 'text' },
      { k: 'swimmer_name', label: 'اللاعب', type: 'text' },
      { k: 'role', label: 'الدور', type: 'text' },
      { k: 'join_date', label: 'تاريخ الانضمام', type: 'date' }
    ],
    fields: [
      { name: 'team_id', label: 'الفريق', type: 'fk', table: 'teams', text: 'name', required: true },
      { name: 'swimmer_id', label: 'اللاعب', type: 'fk', table: 'swimmers', text: 'full_name', required: true },
      { name: 'role', label: 'الدور', type: 'text' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  team_times: {
    table: 'team_times', title: 'الأزمنة والقياسات', module: 'teams',
    orderBy: 'record_date DESC',
    listQuery: `SELECT tt.*, t.name AS team_name, sw.full_name AS swimmer_name FROM team_times tt LEFT JOIN teams t ON t.id=tt.team_id LEFT JOIN swimmers sw ON sw.id=tt.swimmer_id`,
    columns: [
      { k: 'swimmer_name', label: 'اللاعب', type: 'text' },
      { k: 'race_type', label: 'السباق', type: 'text' },
      { k: 'distance', label: 'المسافة', type: 'num', suffix: ' م' },
      { k: 'best_time', label: 'أفضل زمن', type: 'time' },
      { k: 'previous_time', label: 'الزمن السابق', type: 'time' },
      { k: 'improvement_pct', label: 'التطور %', type: 'pct' }
    ],
    fields: [
      { name: 'team_id', label: 'الفريق', type: 'fk', table: 'teams', text: 'name' },
      { name: 'swimmer_id', label: 'اللاعب', type: 'fk', table: 'swimmers', text: 'full_name', required: true },
      { name: 'race_type', label: 'نوع السباق', type: 'select', options: [['حرة', 'حرة'], ['ظهر', 'ظهر'], ['صدر', 'صدر'], ['فراشة', 'فراشة'], ['فردي متنوع', 'فردي متنوع']] },
      { name: 'distance', label: 'المسافة (متر)', type: 'number' },
      { name: 'best_time', label: 'أفضل زمن (ثانية)', type: 'number' },
      { name: 'previous_time', label: 'الزمن السابق (ثانية)', type: 'number' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  tournaments_participations: {
    table: 'tournament_participations', title: 'مشاركات البطولات', module: 'tournaments',
    orderBy: 'id DESC',
    listQuery: `SELECT tp.*, t.name AS tournament_name, sw.full_name AS swimmer_name FROM tournament_participations tp LEFT JOIN tournaments t ON t.id=tp.tournament_id LEFT JOIN swimmers sw ON sw.id=tp.swimmer_id`,
    columns: [
      { k: 'tournament_name', label: 'البطولة', type: 'text' },
      { k: 'swimmer_name', label: 'اللاعب', type: 'text' },
      { k: 'race_type', label: 'السباق', type: 'text' },
      { k: 'distance', label: 'المسافة', type: 'num', suffix: ' م' },
      { k: 'result_time', label: 'الزمن', type: 'time' },
      { k: 'place', label: 'المركز', type: 'rank' }
    ],
    fields: [
      { name: 'tournament_id', label: 'البطولة', type: 'fk', table: 'tournaments', text: 'name', required: true },
      { name: 'swimmer_id', label: 'اللاعب', type: 'fk', table: 'swimmers', text: 'full_name', required: true },
      { name: 'race_type', label: 'نوع السباق', type: 'select', options: [['حرة', 'حرة'], ['ظهر', 'ظهر'], ['صدر', 'صدر'], ['فراشة', 'فراشة'], ['فردي متنوع', 'فردي متنوع'], ['تتابع', 'تتابع']] },
      { name: 'distance', label: 'المسافة (متر)', type: 'number' },
      { name: 'result_time', label: 'زمن النتيجة (ثانية)', type: 'number' },
      { name: 'place', label: 'المركز', type: 'number' },
      { name: 'qualifying_time', label: 'الرقم التأهيلي (ثانية)', type: 'number' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' }
    ]
  },

  messages: {
    table: 'messages', title: 'الرسائل الداخلية', module: 'notifications',
    orderBy: 'id DESC',
    listQuery: `SELECT m.*, su.full_name AS sender_name, ru.full_name AS receiver_name FROM messages m LEFT JOIN users su ON su.id=m.sender_id LEFT JOIN users ru ON ru.id=m.receiver_id`,
    columns: [
      { k: 'sender_name', label: 'المرسل', type: 'text' },
      { k: 'receiver_name', label: 'المستلم', type: 'text' },
      { k: 'subject', label: 'الموضوع', type: 'text' },
      { k: 'is_read', label: 'الحالة', type: 'status', map: { 1: ['مقروءة', 'green'], 0: ['جديدة', 'amber'] } }
    ],
    fields: [
      { name: 'receiver_id', label: 'المستلم', type: 'fk', table: 'users', text: 'full_name', required: true },
      { name: 'subject', label: 'الموضوع', type: 'text', required: true },
      { name: 'body', label: 'المحتوى', type: 'textarea', required: true }
    ]
  },

  audit: {
    table: 'audit_log', title: 'سجل النشاط', module: 'audit', readOnly: true,
    search: 'username,action,module,details',
    orderBy: 'id DESC',
    listQuery: `SELECT * FROM audit_log`,
    columns: [
      { k: 'created_at', label: 'الوقت', type: 'datetime' },
      { k: 'username', label: 'المستخدم', type: 'text' },
      { k: 'action', label: 'الإجراء', type: 'text' },
      { k: 'module', label: 'الوحدة', type: 'text' },
      { k: 'details', label: 'التفاصيل', type: 'text' }
    ],
    fields: []
  }
};

module.exports = { ENTITIES, SWIMMER_STATUS, SUB_STATUS, PAY_STATUS, SESS_STATUS, ATT_STATUS, PROG_STATUS, PROG_TYPE, PAY_METHOD, DOC_STATUS, DELIVERY_STATUS, COMPLAINT_STATUS, REQ_STATUS, PAY_METHODS, WEEKDAYS };
