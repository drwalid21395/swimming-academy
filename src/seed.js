'use strict';
const db = require('./db');
const { hashPassword, today, addDays, genRef, parseJSON } = require('./util');
const { ROLES, buildRoleMatrix, MODULES } = require('./permissions');

function wipe() {
  const tables = [
    'audit_log','settings','roles','users','certificates','level_transitions',
    'subscription_requests','contact_messages','faqs','gallery','news','complaints',
    'messages','notifications','documents','outgoing_docs','incoming_docs','coach_dues',
    'expenses','revenues','payments','subscriptions','tournament_participations',
    'tournaments','team_times','team_members','teams','tests','assessments',
    'assessment_criteria','attendance','sessions','groups','swimmers','coaches',
    'guardians','levels','programs','pools','branches'
  ];
  tables.forEach(t => { try { db.exec(`DELETE FROM ${t}; DELETE FROM sqlite_sequence WHERE name='${t}';`); } catch (e) {} });
}

function ins(table, row) {
  const keys = Object.keys(row);
  const stmt = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(k => '?').join(',')})`);
  return stmt.run(...keys.map(k => row[k])).lastInsertRowid;
}

function seed() {
  wipe();

  // ===== الإعدادات =====
  const settings = {
    academy_name: 'أكاديمية الموج للسباحة',
    academy_slogan: 'نصنع أبطال الماء',
    phone: '01012345678', whatsapp: '01109876543', email: 'info@almoj-academy.com',
    address: '٥ شارع النيل، مدينة نصر، القاهرة',
    learn_sessions: '8', currency: 'ج.م', welcome_msg: 'أهلاً بك في أكاديمية الموج للسباحة',
    notification_email: 'noreply@almoj-academy.com',
    policies: 'خصم الحصة في حالة الحضور فقط. الاعتذار قبل الحصة بـ ٤ ساعات على الأقل يعفى من الخصم.',
    social_facebook: '#', social_instagram: '#', social_twitter: '#', social_youtube: '#'
  };
  Object.entries(settings).forEach(([k, v]) => ins('settings', { key: k, value: String(v) }));

  // ===== الأدوار والصلاحيات =====
  const matrix = buildRoleMatrix();
  Object.entries(ROLES).forEach(([role, info]) => {
    ins('roles', { role, name_ar: info.name_ar, is_system: 1, permissions: JSON.stringify(matrix[role]) });
  });

  // ===== الفروع وحمامات السباحة =====
  const b1 = ins('branches', { name: 'الفرع الرئيسي - مدينة نصر', address: '٥ شارع النيل، مدينة نصر، القاهرة', phone: '01012345678', email: 'branch1@almoj-academy.com', manager_name: 'أ. هاني عبد العزيز' });
  const b2 = ins('branches', { name: 'فرع المعادي', address: 'شارع ٩٧، المعادي، القاهرة', phone: '01087654321', email: 'branch2@almoj-academy.com', manager_name: 'أ. رامي فتحي' });
  const p1 = ins('pools', { branch_id: b1, name: 'حمام السباحة الأولمبي', lanes: 8, length_m: 25, capacity: 40 });
  const p2 = ins('pools', { branch_id: b1, name: 'حمام التعلم', lanes: 4, length_m: 12.5, capacity: 15 });
  const p3 = ins('pools', { branch_id: b2, name: 'حمام المعادي الرئيسي', lanes: 6, length_m: 25, capacity: 30 });

  // ===== المستويات =====
  const levels = [];
  const lvlNames = ['مبتدئ', 'تمهيدي', 'مستوى أول', 'مستوى ثانٍ', 'مستوى ثالث', 'متقدم', 'إعداد فرق', 'فريق أكاديمية', 'فريق بطولات'];
  lvlNames.forEach((n, i) => { levels.push(ins('levels', { branch_id: b1, name: n, order_index: i, min_age: i < 2 ? 6 : i < 5 ? 8 : 10, is_team_level: i >= 6 ? 1 : 0 })); });

  // ===== المدربون =====
  const coachData = [
    { full_name: 'الكابتن أحمد سمير', phone: '01011112222', email: 'ahmed@almoj.com', qual: 'بكالوريوس تربية رياضية', spec: 'سباحة حرة وظهر', exp: 12, certs: 'مدرب معتمد - اتحاد السباحة المصري', hire: '2020-01-10', contract: 'full', salary: 9000, days: 'السبت، الأحد، الاثنين، الثلاثاء', hours: '9ص - 3م', lic: '2027-12-31', rating: 4.8, groups: 'مجموعة المبتدئين أ', user: { u: 'coach1', n: 'الكابتن أحمد سمير' } },
    { full_name: 'الكابتنة منى عبد الرحمن', phone: '01022223333', email: 'mona@almoj.com', qual: 'ماجستير تربية بدنية', spec: 'تعليم الأطفال', exp: 9, certs: 'معلمة سباحة معتمدة', hire: '2021-03-01', contract: 'full', salary: 8000, days: 'السبت، الأحد، الاثنين، الأربعاء', hours: '10ص - 2م', lic: '2026-09-30', rating: 4.6, groups: 'مجموعة التمهيدي', user: { u: 'coach2', n: 'الكابتنة منى عبد الرحمن' } },
    { full_name: 'الكابتن خالد إبراهيم', phone: '01033334444', email: 'khaled@almoj.com', qual: 'بكالوريوس تربية رياضية', spec: 'صدر وفراشة', exp: 7, certs: 'مدرب فرق الشباب', hire: '2022-02-15', contract: 'per_session', salary: 150, days: 'السبت، الاثنين، الثلاثاء، الأربعاء', hours: '2م - 6م', lic: '2028-06-30', rating: 4.5, groups: 'مجموعة التطوير الفني', user: { u: 'coach3', n: 'الكابتن خالد إبراهيم' } },
    { full_name: 'الكابتنة سارة محمد', phone: '01044445555', email: 'sara@almoj.com', qual: 'دبلوم تربية رياضية', spec: 'إعداد فرق وناشئين', exp: 10, certs: 'مدربة فرق أندية', hire: '2019-09-01', contract: 'full', salary: 10000, days: 'كل الأيام عدا الجمعة', hours: '3م - 8م', lic: '2027-03-31', rating: 4.9, groups: 'فريق الأكاديمية', user: { u: 'coach4', n: 'الكابتنة سارة محمد' } },
    { full_name: 'الكابتن عمر فتحي', phone: '01055556666', email: 'omar@almoj.com', qual: 'بكالوريوس علوم رياضية', spec: 'الإنقاذ والسلامة', exp: 8, certs: 'مدرب إنقاذ - غواصة معتمد', hire: '2021-06-01', contract: 'full', salary: 7500, days: 'السبت، الأحد، الثلاثاء، الخميس', hours: '9ص - 2م', lic: '2026-12-31', rating: 4.7, groups: 'مجموعة الإنقاذ', user: { u: 'coach5', n: 'الكابتن عمر فتحي' } },
    { full_name: 'الكابتنة ليلى حسن', phone: '01066667777', email: 'laila@almoj.com', qual: 'ماجستير مناهج وطرق تدريس', spec: 'إعداد المعلمين', exp: 11, certs: 'محاضرة معتمدة لمعلمي السباحة', hire: '2020-01-10', contract: 'full', salary: 8500, days: 'الأحد، الاثنين، الأربعاء، الخميس', hours: '10ص - 4م', lic: '2028-01-31', rating: 4.8, groups: 'مجموعة إعداد المعلمين', user: { u: 'coach6', n: 'الكابتنة ليلى حسن' } }
  ];
  const coachIds = coachData.map(c => ins('coaches', {
    full_name: c.full_name, photo: '', phone: c.phone, email: c.email, qualification: c.qual,
    specialty: c.spec, experience_years: c.exp, certificates: c.certs, hire_date: c.hire,
    contract_type: c.contract, salary_or_rate: c.salary, work_days: c.days, work_hours: c.hours,
    programs_eligible: 'learn,training,team,rescue,instructor,camp,course', groups_managed: c.groups,
    performance_rating: c.rating, license_expiry: c.lic, docs: ''
  }));

  // ===== أولياء الأمور =====
  const guardianData = [
    { n: 'أ. محمد عبد الله', ph: '01010001000', wa: '01010001000', em: 'mohamed.ab@mail.com', rel: 'والد' },
    { n: 'أ. سامي محمود', ph: '01020002000', wa: '01020002000', em: 'samy.mahmoud@mail.com', rel: 'والد' },
    { n: 'أ. عادل رشاد', ph: '01030003000', wa: '01030003000', em: 'adel.rashad@mail.com', rel: 'والد' },
    { n: 'د. هالة يوسف', ph: '01040004000', wa: '01040004000', em: 'hala.youssef@mail.com', rel: 'والدة' },
    { n: 'أ. خالد محمود', ph: '01050005000', wa: '01050005000', em: 'khaled.mahmoud@mail.com', rel: 'والد' },
    { n: 'أ. وليد كامل', ph: '01060006000', wa: '01060006000', em: 'waleed.kamel@mail.com', rel: 'والد' },
    { n: 'أ. طارق فؤاد', ph: '01070007000', wa: '01070007000', em: 'tarek.fouad@mail.com', rel: 'والد' },
    { n: 'أ. هاني سعد', ph: '01080008000', wa: '01080008000', em: 'hany.saad@mail.com', rel: 'والد' },
    { n: 'أ. إسلام حمدي', ph: '01090009000', wa: '01090009000', em: 'eslam.hamdy@mail.com', rel: 'والد' },
    { n: 'أ. رضا فؤاد', ph: '01100010000', wa: '01100010000', em: 'reda.fouad@mail.com', rel: 'والد' },
    { n: 'أ. أحمد عبد المنعم', ph: '01110011000', wa: '01110011000', em: 'ahmed.abdelmonem@mail.com', rel: 'والد' }
  ];
  const guardianIds = guardianData.map(g => ins('guardians', { full_name: g.n, phone: g.ph, whatsapp: g.wa, email: g.em, relation: g.rel }));

  // ===== البرامج =====
  const learn = ins('programs', { branch_id: b1, name: 'تعليم السباحة للمبتدئين', program_type: 'learn', description: 'برنامج أساسي لتعليم السباحة من الصفر، مكون من ٨ حصص تدريبية معتمدة على اكتساب الثقة في الماء والمهارات الأساسية.', age_from: 5, age_to: 15, level_required_id: levels[0], sessions_count: 8, session_minutes: 60, weeks: 4, price: 1200, max_swimmers: 10, coach_id: coachIds[0], pool_id: p2, required_tests: 'اختبار الطفو والتنفس', success_conditions: 'اجتياز الاختبار النهائي بدرجة ٧٠٪ على الأقل', certificate: 'شهادة إتمام البرنامج التأسيسي', status: 'available' });
  const training = ins('programs', { branch_id: b1, name: 'تدريب وتطوير المستوى الفني', program_type: 'training', description: 'برنامج تدريبي متقدم يهدف لتطوير الأداء الفني على جميع السباحات الأربع، ويتنوع عدد الحصص والمدة حسب الخطة التدريبية.', age_from: 9, age_to: 18, level_required_id: levels[2], sessions_count: 16, session_minutes: 90, weeks: 8, price: 2500, max_swimmers: 12, coach_id: coachIds[2], pool_id: p1, required_tests: 'اختبار ١٠٠م حرة', success_conditions: 'تحسين الزمن بنسبة ٥٪ خلال البرنامج', certificate: 'تقرير تطور المستوى الفني', status: 'available' });
  const teamProg = ins('programs', { branch_id: b1, name: 'فريق الأكاديمية', program_type: 'team', description: 'برنامج إعداد لاعبي فرق السباحة للمنافسات والبطولات المحلية.', age_from: 10, age_to: 20, level_required_id: levels[5], sessions_count: 24, session_minutes: 120, weeks: 12, price: 3000, max_swimmers: 20, coach_id: coachIds[3], pool_id: p1, required_tests: 'اختبارات الأزمنة الشهرية', success_conditions: 'تحقيق الرقم التأهيلي للبطولة', certificate: 'خطاب ترشيح للمشاركة بالبطولات', status: 'available' });
  const rescue = ins('programs', { branch_id: b1, name: 'برنامج الإنقاذ والسلامة في الماء', program_type: 'rescue', description: 'برنامج إعداد منقذين وتأهيل على السلامة في الماء ومهارات الإنقاذ والتعامل مع حالات الطوارئ، وعدد الحصص حسب البرنامج والمستوى.', age_from: 14, age_to: 60, level_required_id: levels[5], sessions_count: 12, session_minutes: 90, weeks: 6, price: 1800, max_swimmers: 8, coach_id: coachIds[4], pool_id: p1, required_tests: 'اختبار إنقاذ عملي', success_conditions: 'اجتياز الاختبار العملي والنظري', certificate: 'شهادة منقذ معتمدة', status: 'available' });
  const instructor = ins('programs', { branch_id: b1, name: 'إعداد معلم سباحة', program_type: 'instructor', description: 'برنامج تأهيل معلمي سباحة يغطي مهارات الشرح والتدريس وإدارة الحصص، وتختلف مدته وعدد حصصه حسب الخطة المعتمدة.', age_from: 18, age_to: 60, level_required_id: levels[5], sessions_count: 20, session_minutes: 120, weeks: 10, price: 4000, max_swimmers: 6, coach_id: coachIds[5], pool_id: p1, required_tests: 'اختبار تدريس عملي أمام لجنة', success_conditions: 'اجتياز التدريب العملي والمحاضرات النظرية', certificate: 'شهادة معلم سباحة معتمدة', status: 'available' });
  const camp = ins('programs', { branch_id: b1, name: 'معسكر صيفي متقدم', program_type: 'camp', description: 'معسكر مكثف على البحر الأحمر بالغردقة يشمل تدريبات صباحية ومسائية وجلسات جافة وتحليل فيديو.', age_from: 12, age_to: 25, level_required_id: levels[4], sessions_count: 10, session_minutes: 180, weeks: 1, price: 3500, max_swimmers: 15, coach_id: coachIds[3], pool_id: null, schedule_notes: 'أسبوع مكثف بمدينة الغردقة', certificate: 'شهادة مشاركة', status: 'upcoming' });
  const course = ins('programs', { branch_id: b2, name: 'دورة تقوية السباحة الحرة', program_type: 'course', description: 'دورة متخصصة قصيرة لتقوية الأداء على سباحة الزحف على البطن وتصحيح الأخطاء الفنية.', age_from: 9, age_to: 20, level_required_id: levels[3], sessions_count: 6, session_minutes: 60, weeks: 2, price: 900, max_swimmers: 8, coach_id: coachIds[2], pool_id: p3, certificate: 'شهادة إتمام الدورة', status: 'available' });

  // ===== المجموعات =====
  const groupIds = [
    ins('groups', { branch_id: b1, pool_id: p2, coach_id: coachIds[0], program_id: learn, level_id: levels[0], name: 'مجموعة المبتدئين أ', schedule: JSON.stringify([{ day: 'السبت', start: '09:00', end: '10:00' }, { day: 'الثلاثاء', start: '09:00', end: '10:00' }]), max_capacity: 8, group_type: 'group' }),
    ins('groups', { branch_id: b1, pool_id: p2, coach_id: coachIds[0], program_id: learn, level_id: levels[0], name: 'مجموعة المبتدئين ب', schedule: JSON.stringify([{ day: 'الأحد', start: '10:00', end: '11:00' }, { day: 'الأربعاء', start: '10:00', end: '11:00' }]), max_capacity: 8, group_type: 'group' }),
    ins('groups', { branch_id: b1, pool_id: p2, coach_id: coachIds[1], program_id: learn, level_id: levels[1], name: 'مجموعة التمهيدي', schedule: JSON.stringify([{ day: 'السبت', start: '11:00', end: '12:00' }, { day: 'الثلاثاء', start: '11:00', end: '12:00' }]), max_capacity: 8, group_type: 'group' }),
    ins('groups', { branch_id: b1, pool_id: p1, coach_id: coachIds[2], program_id: training, level_id: levels[4], name: 'مجموعة المستوى الثالث', schedule: JSON.stringify([{ day: 'الأحد', start: '15:00', end: '16:30' }, { day: 'الخميس', start: '15:00', end: '16:30' }]), max_capacity: 10, group_type: 'group' }),
    ins('groups', { branch_id: b1, pool_id: p1, coach_id: coachIds[2], program_id: training, level_id: levels[2], name: 'مجموعة التطوير الفني', schedule: JSON.stringify([{ day: 'الاثنين', start: '16:00', end: '17:30' }, { day: 'الأربعاء', start: '16:00', end: '17:30' }]), max_capacity: 12, group_type: 'group' }),
    ins('groups', { branch_id: b1, pool_id: p1, coach_id: coachIds[3], program_id: teamProg, level_id: levels[7], name: 'فريق الأكاديمية', schedule: JSON.stringify([{ day: 'السبت', start: '17:00', end: '19:00' }, { day: 'الأربعاء', start: '17:00', end: '19:00' }]), max_capacity: 20, group_type: 'team' }),
    ins('groups', { branch_id: b1, pool_id: p1, coach_id: coachIds[4], program_id: rescue, level_id: levels[5], name: 'مجموعة الإنقاذ والسلامة', schedule: JSON.stringify([{ day: 'الأحد', start: '09:00', end: '10:30' }, { day: 'الخميس', start: '09:00', end: '10:30' }]), max_capacity: 8, group_type: 'group' }),
    ins('groups', { branch_id: b1, pool_id: p1, coach_id: coachIds[5], program_id: instructor, level_id: levels[5], name: 'مجموعة إعداد معلم السباحة', schedule: JSON.stringify([{ day: 'الأحد', start: '10:00', end: '12:00' }, { day: 'الخميس', start: '10:00', end: '12:00' }]), max_capacity: 6, group_type: 'group' })
  ];

  // ===== السباحون =====
  const swimmerData = [
    { n: 'يوسف محمد عبد الله', bd: '2016-05-12', gen: 'ذكر', ph: '01010001001', gd: 1, rel: 'والد', gph: '01010001000', lvl: 1, prog: learn, grp: 1, coach: 1, total: 8, done: 5, price: 1200, subPaid: 1200, status: 'active', school: 'مدرسة النيل الابتدائية' },
    { n: 'ليان محمد عبد الله', bd: '2018-02-03', gen: 'أنثى', ph: '01010001002', gd: 1, rel: 'والد', gph: '01010001000', lvl: 1, prog: learn, grp: 2, coach: 1, total: 8, done: 2, price: 1200, subPaid: 1200, status: 'active', school: 'مدرسة النيل الابتدائية' },
    { n: 'سلمى سامي محمود', bd: '2015-09-20', gen: 'أنثى', ph: '01020002001', gd: 2, rel: 'والد', gph: '01020002000', lvl: 2, prog: learn, grp: 3, coach: 2, total: 8, done: 7, price: 1200, subPaid: 1200, status: 'active', school: 'مدرسة الشروق الخاصة' },
    { n: 'ندى سامي محمود', bd: '2013-07-11', gen: 'أنثى', ph: '01020002002', gd: 2, rel: 'والد', gph: '01020002000', lvl: 3, prog: training, grp: 5, coach: 3, total: 16, done: 9, price: 2500, subPaid: 1250, status: 'active', school: 'مدرسة الإعدادية النموذجية' },
    { n: 'عمر سامي محمود', bd: '2012-01-25', gen: 'ذكر', ph: '01020002003', gd: 2, rel: 'والد', gph: '01020002000', lvl: 4, prog: training, grp: 5, coach: 3, total: 16, done: 12, price: 2500, subPaid: 1000, status: 'active', school: 'مدرسة الثانوية التجريبية' },
    { n: 'آدم محمد يوسف', bd: '2014-11-02', gen: 'ذكر', ph: '01040004001', gd: 4, rel: 'والدة', gph: '01040004000', lvl: 1, prog: learn, grp: 2, coach: 1, total: 8, done: 1, price: 1200, subPaid: 0, status: 'active', school: 'مدرسة السلام الابتدائية' },
    { n: 'كريم عادل رشاد', bd: '2010-08-15', gen: 'ذكر', ph: '01030003001', gd: 3, rel: 'والد', gph: '01030003000', lvl: 8, prog: teamProg, grp: 6, coach: 4, total: 24, done: 20, price: 3000, subPaid: 3000, status: 'active', school: 'مدرسة المنصورية الثانوية' },
    { n: 'مريم عادل رشاد', bd: '2013-03-19', gen: 'أنثى', ph: '01030003002', gd: 3, rel: 'والد', gph: '01030003000', lvl: 5, prog: training, grp: 4, coach: 3, total: 16, done: 10, price: 2500, subPaid: 1500, status: 'active', school: 'مدرسة المستقبل الخاصة' },
    { n: 'جنى عادل رشاد', bd: '2017-12-08', gen: 'أنثى', ph: '01030003003', gd: 3, rel: 'والد', gph: '01030003000', lvl: 1, prog: learn, grp: 1, coach: 1, total: 8, done: 4, price: 1200, subPaid: 1200, status: 'active', school: 'مدرسة الروضة النموذجية' },
    { n: 'زياد خالد محمود', bd: '2015-06-30', gen: 'ذكر', ph: '01050005001', gd: 5, rel: 'والد', gph: '01050005000', lvl: 2, prog: learn, grp: 3, coach: 2, total: 8, done: 6, price: 1200, subPaid: 1200, status: 'active', school: 'مدرسة عمر بن الخطاب' },
    { n: 'حبيبة أحمد عبد المنعم', bd: '2016-04-17', gen: 'أنثى', ph: '01110011001', gd: 11, rel: 'والد', gph: '01110011000', lvl: 1, prog: learn, grp: 1, coach: 1, total: 8, done: 3, price: 1200, subPaid: 600, status: 'paused', school: 'مدرسة الفراعنة الابتدائية' },
    { n: 'فارس وليد كامل', bd: '2009-10-05', gen: 'ذكر', ph: '01060006001', gd: 6, rel: 'والد', gph: '01060006000', lvl: 9, prog: teamProg, grp: 6, coach: 4, total: 24, done: 22, price: 3000, subPaid: 3000, status: 'active', school: 'مدرسة الأورمان الثانوية' },
    { n: 'ريم وليد كامل', bd: '2014-05-28', gen: 'أنثى', ph: '01060006002', gd: 6, rel: 'والد', gph: '01060006000', lvl: 4, prog: training, grp: 5, coach: 3, total: 16, done: 5, price: 2500, subPaid: 1250, status: 'active', school: 'مدرسة المستقبل الخاصة' },
    { n: 'عاصم طارق فؤاد', bd: '2011-09-14', gen: 'ذكر', ph: '01070007001', gd: 7, rel: 'والد', gph: '01070007000', lvl: 6, prog: training, grp: 4, coach: 3, total: 16, done: 14, price: 2500, subPaid: 0, status: 'active', school: 'مدرسة السلام الثانوية' },
    { n: 'ملك هاني سعد', bd: '2015-01-22', gen: 'أنثى', ph: '01080008001', gd: 8, rel: 'والد', gph: '01080008000', lvl: 2, prog: learn, grp: 3, coach: 2, total: 8, done: 5, price: 1200, subPaid: 1200, status: 'active', school: 'مدرسة الفراشة الابتدائية' },
    { n: 'ياسين هاني سعد', bd: '2008-12-01', gen: 'ذكر', ph: '01080008002', gd: 8, rel: 'والد', gph: '01080008000', lvl: 8, prog: teamProg, grp: 6, coach: 4, total: 24, done: 18, price: 3000, subPaid: 2000, status: 'active', school: 'مدرسة الأورمان الثانوية' },
    { n: 'ليلى إسلام حمدي', bd: '2016-10-09', gen: 'أنثى', ph: '01090009001', gd: 9, rel: 'والد', gph: '01090009000', lvl: 1, prog: rescue, grp: 7, coach: 5, total: 12, done: 4, price: 1800, subPaid: 1800, status: 'active', school: 'مدرسة النور الابتدائية' },
    { n: 'كرم رضا فؤاد', bd: '2005-04-02', gen: 'ذكر', ph: '01100010001', gd: 10, rel: 'والد', gph: '01100010000', lvl: 6, prog: instructor, grp: 8, coach: 6, total: 20, done: 6, price: 4000, subPaid: 2000, status: 'active', school: 'جامعة القاهرة - كلية التربية الرياضية' }
  ];
  const swimmerIds = swimmerData.map((s, i) => {
    const remaining = s.total - s.done;
    const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
    return ins('swimmers', {
      membership_no: `SW-2026-${String(i + 1).padStart(4, '0')}`, full_name: s.n, photo: '', birth_date: s.bd, gender: s.gen,
      phone: s.ph, address: '', school: s.school, guardian_id: s.gd, guardian_relation: s.rel,
      guardian_phone: s.gph, email: '', emergency_name: s.n, emergency_phone: s.gph, emergency_relation: s.rel,
      health_status: 'جيد', allergies: i % 4 === 0 ? 'حساسية من الكلور' : '', medical_notes: '',
      current_level_id: s.lvl, register_date: addDays(today(), -(90 - i * 3)),
      program_id: s.prog, group_id: s.grp, coach_id: s.coach,
      training_days: ['السبت، الثلاثاء', 'الأحد، الأربعاء', 'السبت، الاثنين', 'الثلاثاء، الخميس'][i % 4],
      training_time: ['10:00', '11:00', '16:00', '17:00'][i % 4],
      subscription_value: s.price, payment_status: s.subPaid >= s.price ? 'paid' : s.subPaid > 0 ? 'partial' : 'unpaid',
      total_sessions: s.total, done_sessions: s.done, remaining_sessions: remaining,
      status: s.status
    });
  });

  // ===== الحصص والجداول =====
  const weekdayToDay = { 0: 'الأحد', 1: 'الاثنين', 2: 'الثلاثاء', 3: 'الأربعاء', 4: 'الخميس', 5: 'الجمعة', 6: 'السبت' };
  const groupDays = { 1: [1, 4], 2: [2, 5], 3: [1, 4], 4: [2, 6], 5: [3, 5], 6: [1, 4], 7: [2, 6], 8: [2, 6] };
  const groupPool = [2, 2, 2, 1, 1, 1, 1, 1];
  const groupCoach = [1, 1, 2, 3, 3, 4, 5, 6];
  const sessionsByGroup = {};
  for (let g = 1; g <= 8; g++) {
    sessionsByGroup[g] = [];
    for (let offset = -14; offset <= 7; offset++) {
      const d = new Date(today());
      d.setDate(d.getDate() + offset);
      if (d.getDay() === 5 || !groupDays[g].includes(d.getDay())) continue;
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const sid = ins('sessions', {
        group_id: g, branch_id: b1, pool_id: groupPool[g - 1], coach_id: groupCoach[g - 1],
        date: iso, start_time: '09:00', end_time: '10:30',
        title: `حصة ${weekdayToDay[d.getDay()]} - المجموعة ${g}`,
        session_type: 'normal', status: offset < 0 ? 'done' : 'scheduled'
      });
      sessionsByGroup[g].push(sid);
    }
  }

  // ===== الحضور =====
  const groupSwimmers = { 1: [1, 9, 11], 2: [2, 6], 3: [3, 10, 15], 4: [8, 14], 5: [4, 5, 13], 6: [7, 12, 16], 7: [17], 8: [18] };
  let attSeed = 0;
  for (let g = 1; g <= 8; g++) {
    (sessionsByGroup[g] || []).forEach((sid) => {
      const sess = db.prepare('SELECT date FROM sessions WHERE id=?').get(sid);
      const past = sess.date < today();
      groupSwimmers[g].forEach((sw) => {
        attSeed++;
        let st = 'present';
        if (past) {
          if (attSeed % 7 === 0) st = 'absent';
          else if (attSeed % 7 === 3) st = 'apology';
        }
        ins('attendance', {
          session_id: sid, swimmer_id: sw, status: st,
          reason: st === 'absent' ? 'غياب بدون عذر' : st === 'apology' ? 'اعتذار مسبق' : '',
          deducted_session: st === 'absent' ? 1 : 0,
          recorded_by: null, recorded_at: past ? `${sess.date} 12:00` : null
        });
      });
    });
  }

  // ===== معايير التقييم =====
  const critSets = {
    learn: ['الثقة في الماء', 'التنفس', 'الطفو', 'الانزلاق', 'ضربات الرجلين', 'حركة الذراعين', 'التوافق الحركي', 'سباحة الحرة', 'سباحة الظهر', 'السلامة في الماء', 'الانضباط', 'الالتزام'],
    training: ['سباحة الحرة', 'سباحة الظهر', 'سباحة الصدر', 'سباحة الفراشة', 'البدء والدوران', 'التحمل', 'السرعة', 'الاستجابة للتعليمات', 'الانضباط', 'الالتزام'],
    team: ['سباحة الحرة', 'سباحة الظهر', 'سباحة الصدر', 'سباحة الفراشة', 'البدء والدوران', 'التحمل', 'السرعة', 'الانضباط', 'الالتزام'],
    rescue: ['السلامة في الماء', 'مهارات الإنقاذ', 'التعامل مع حالات الطوارئ', 'الثقة في الماء', 'التحمل'],
    instructor: ['مهارات الشرح والتدريس', 'مهارات التواصل', 'إدارة الحصص', 'التقييم والتغذية الراجعة', 'السلامة في الماء'],
    course: ['سباحة الحرة', 'التوافق الحركي', 'التحمل', 'السرعة']
  };
  Object.entries(critSets).forEach(([pt, arr]) => {
    arr.forEach((name, i) => ins('assessment_criteria', { program_type: pt, name_ar: name, order_index: i }));
  });

  // ===== التقييمات =====
  const criteriaByType = (t) => db.prepare('SELECT * FROM assessment_criteria WHERE program_type=? ORDER BY order_index').all(t);
  function makeScores(crits, min, max) {
    const s = {};
    crits.forEach(c => { s[c.id] = Math.round((min + Math.random() * (max - min)) * 10) / 10; });
    return JSON.stringify(s);
  }
  ins('assessments', { swimmer_id: 1, coach_id: 1, program_id: learn, level_id: 1, date: addDays(today(), -12), scores: makeScores(criteriaByType('learn'), 5, 9), strengths: 'شجاع وواثق في الماء، يستجيب سريعاً للتعليمات', weaknesses: 'يحتاج تحسين التنسيق بين الذراعين والتنفس', recommendations: 'التدريب على التنفس الجانبي مرتين أسبوعياً في المنزل', ready_to_advance: 0, next_assessment_date: addDays(today(), 20) });
  ins('assessments', { swimmer_id: 3, coach_id: 2, program_id: learn, level_id: 2, date: addDays(today(), -6), scores: makeScores(criteriaByType('learn'), 6, 10), strengths: 'طفو وانزلاق ممتاز، ضربات رجلين قوية', weaknesses: 'التنفس المتناوب يحتاج ضبطاً', recommendations: 'جاهزة للانتقال لمستوى أول', ready_to_advance: 1, next_assessment_date: addDays(today(), 14) });
  ins('assessments', { swimmer_id: 4, coach_id: 3, program_id: training, level_id: 3, date: addDays(today(), -10), scores: makeScores(criteriaByType('training'), 6, 10), strengths: 'سباحة حرة متناسقة، سرعة جيدة', weaknesses: 'سباحة الفراشة تحتاج قوة جذع', recommendations: 'إضافة تمارين الجذع الجافة', ready_to_advance: 1, next_assessment_date: addDays(today(), 30) });
  ins('assessments', { swimmer_id: 7, coach_id: 4, program_id: teamProg, level_id: 8, date: addDays(today(), -3), scores: makeScores(criteriaByType('team'), 7, 10), strengths: 'أزمنة ممتازة على ٥٠م و١٠٠م حرة', weaknesses: 'الدوران المفتوح يحتاج سرعة', recommendations: 'التأكيد على الدوران الانقلابي في التدريب', ready_to_advance: 1, next_assessment_date: addDays(today(), 21) });
  ins('assessments', { swimmer_id: 12, coach_id: 4, program_id: teamProg, level_id: 9, date: addDays(today(), -5), scores: makeScores(criteriaByType('team'), 7, 10), strengths: 'تحمل عالي على ٢٠٠م', weaknesses: 'بداية ضعيفة من منصة الانطلاق', recommendations: 'تمرينات انطلاق يومية', ready_to_advance: 1, next_assessment_date: addDays(today(), 25) });
  ins('assessments', { swimmer_id: 17, coach_id: 5, program_id: rescue, level_id: 6, date: addDays(today(), -8), scores: makeScores(criteriaByType('rescue'), 6, 10), strengths: 'مهارات إنقاذ سريعة الاستجابة', weaknesses: 'تحتاج تقوية السباحة الطويلة', recommendations: 'الاشتراك في برنامج تدريبي مكمل', ready_to_advance: 1, next_assessment_date: addDays(today(), 18) });

  // ===== الاختبارات =====
  const tests = [
    [1, 1, 'اختبار مستوى أساسي', 25, 'حرة', 45.2, 'اجتاز', 'ممتاز', -5],
    [3, 2, 'اختبار مستوى تمهيدي', 25, 'ظهر', 38.7, 'اجتاز', 'جيد جداً', -4],
    [4, 3, 'اختبار ٥٠م حرة', 50, 'حرة', 41.3, 'اجتاز', 'تحسن واضح', -7],
    [5, 3, 'اختبار ١٠٠م حرة', 100, 'حرة', 89.5, 'اجتاز', 'جيد', -9],
    [7, 4, 'اختبار شهر أغسطس - ١٠٠م حرة', 100, 'حرة', 68.4, 'اجتاز', 'مؤهل للبطولة', -3],
    [12, 4, 'اختبار شهر أغسطس - ٢٠٠م حرة', 200, 'حرة', 148.2, 'اجتاز', 'رقم شخصي جديد', -4],
    [16, 4, 'اختبار ٥٠م فراشة', 50, 'فراشة', 35.1, 'اجتاز', 'ممتاز', -6],
    [17, 5, 'اختبار إنقاذ عملي', 0, 'إنقاذ', 0, 'اجتاز', 'مهارات إنقاذ ممتازة', -2]
  ];
  tests.forEach(t => ins('tests', { swimmer_id: t[0], coach_id: t[1], name: t[2], date: addDays(today(), t[8]), distance: t[3], stroke: t[4], time_seconds: t[5], result: t[6], notes: t[7] }));

  // ===== الفرق =====
  const team1 = ins('teams', { name: 'فريق الأكاديمية (ناشئين)', branch_id: b1, age_category: '١٠ - ١٤ سنة', coach_id: coachIds[3], training_plan: 'خطة إعداد بدني وفني على مدى ١٢ أسبوعاً تشمل التدريب الصباحي الجاف والمسائي المائي.', schedule_notes: 'السبت والأربعاء من ٥م إلى ٧م' });
  const team2 = ins('teams', { name: 'فريق البطولة', branch_id: b1, age_category: '١٤ - ١٧ سنة', coach_id: coachIds[3], training_plan: 'خطة إعداد مكثفة للبطولات تتضمن معسكرات شهرية وقياسات أزمنة أسبوعية.', schedule_notes: 'يومي عدا الجمعة من ٥م إلى ٨م' });
  [7, 12, 16].forEach((sw, i) => ins('team_members', { team_id: team1, swimmer_id: sw, join_date: addDays(today(), -80), role: i === 0 ? 'كابتن الفريق' : 'لاعب' }));
  [12, 7, 16].forEach((sw, i) => ins('team_members', { team_id: team2, swimmer_id: sw, join_date: addDays(today(), -60), role: 'لاعب' }));

  // ===== أزمنة الفريق =====
  [
    [team1, 7, 'حرة', 100, 68.4, 72.1],
    [team1, 12, 'حرة', 200, 148.2, 155.4],
    [team1, 16, 'فراشة', 50, 35.1, 36.8],
    [team2, 7, 'حرة', 50, 31.2, 32.6],
    [team2, 12, 'حرة', 400, 322.5, 335.1]
  ].forEach(t => {
    const imp = ((1 - t[5] / t[6]) * 100).toFixed(1);
    ins('team_times', { team_id: t[0], swimmer_id: t[1], race_type: t[2], distance: t[3], best_time: t[4], previous_time: t[5], improvement_pct: Number(imp), record_date: addDays(today(), -4) });
  });

  // ===== البطولات =====
  const tour1 = ins('tournaments', { name: 'بطولة الجمهورية للناشئين', date_from: addDays(today(), 21), date_to: addDays(today(), 24), location: 'القاهرة - مجمع حمامات النادي الأهلي', description: 'المنافسة الرسمية السنوية لفئتي الناشئين والشباب.' });
  const tour2 = ins('tournaments', { name: 'بطولة الأندية للسباحة', date_from: addDays(today(), -30), date_to: addDays(today(), -28), location: 'الإسكندرية', description: 'بطولة الأندية لمسابقات الحرة والظهر والفراشة.' });
  ins('tournament_participations', { tournament_id: tour2, swimmer_id: 7, team_id: team1, race_type: 'حرة', distance: 100, result_time: 69.2, place: 3, qualifying_time: 70.0, notes: 'ميدالية برونزية' });
  ins('tournament_participations', { tournament_id: tour2, swimmer_id: 12, team_id: team1, race_type: 'حرة', distance: 200, result_time: 150.7, place: 4, qualifying_time: 152.0, notes: 'رقم شخصي جديد' });
  ins('tournament_participations', { tournament_id: tour1, swimmer_id: 16, team_id: team2, race_type: 'فراشة', distance: 50, result_time: null, place: null, qualifying_time: 34.5, notes: 'مؤهل للنهائي' });

  // ===== الاشتراكات =====
  const subStatusBySw = { 1: 'active', 2: 'active', 3: 'expiring', 4: 'active', 5: 'expiring', 6: 'expired', 7: 'active', 8: 'active', 9: 'active', 10: 'expiring', 11: 'frozen', 12: 'active', 13: 'active', 14: 'expired', 15: 'active', 16: 'active', 17: 'active', 18: 'active' };
  swimmerData.forEach((s, i) => {
    const idx = i + 1;
    const status = subStatusBySw[idx];
    const start = addDays(today(), status === 'expired' ? -45 : status === 'expiring' ? -30 : -15);
    const end = status === 'expired' ? addDays(today(), -3) : status === 'expiring' ? addDays(today(), 4) : addDays(today(), 35);
    const remaining = s.subPaid >= s.price ? 0 : s.price - s.subPaid;
    const method = idx % 3 === 0 ? 'bank' : idx % 3 === 1 ? 'cash' : 'wallet';
    const subId = ins('subscriptions', {
      swimmer_id: idx, program_id: s.prog, group_id: s.grp,
      start_date: start, end_date: end, sessions_count: s.total,
      price: s.price, discount: 0, tax: 0, paid_amount: s.subPaid, remaining_amount: remaining,
      payment_method: method, receipt_no: `RCP-2026-${String(idx * 37).padStart(4, '0')}`,
      pay_date: start, collected_by: null,
      installments: JSON.stringify([]), status, notes: ''
    });
    if (s.subPaid > 0) {
      ins('payments', { subscription_id: subId, swimmer_id: idx, amount: s.subPaid, method, receipt_no: `RCP-2026-${String(idx * 37).padStart(4, '0')}`, pay_date: start, collected_by: null, status: 'approved', notes: 'دفعة أولى' });
    }
  });

  // ===== الإيرادات والمصروفات =====
  const revData = [
    ['REV-2026-0001', 'اشتراكات السباحين', 'اشتراكات شهر أغسطس', 18500, 'نقدي', 'اشتراكات متنوعة'],
    ['REV-2026-0002', 'رسوم الاختبارات', 'اختبارات نهاية البرنامج', 1500, 'محفظة إلكترونية', ''],
    ['REV-2026-0003', 'بيع الأدوات', 'مبيعات قبعات ونظارات', 2200, 'نقدي', ''],
    ['REV-2026-0004', 'رسوم المعسكرات', 'دفعات معسكر الغردقة', 10500, 'تحويل بنكي', ''],
    ['REV-2026-0005', 'اشتراكات السباحين', 'تجديدات منتصف الشهر', 7400, 'نقدي', '']
  ];
  revData.forEach((r, i) => ins('revenues', { trans_no: r[0], date: addDays(today(), -(40 - i * 8)), category: r[1], description: r[2], amount: r[3], payment_method: r[4], payer: r[5], employee: 'أ. مها سليم', status: 'approved', branch_id: b1 }));
  const expData = [
    ['EXP-2026-0001', 'رواتب المدربين', 'رواتب شهر أغسطس', 15000, 'تحويل بنكي', 'الكباتن'],
    ['EXP-2026-0002', 'إيجار حمام السباحة', 'إيجار حمام الفرع الرئيسي', 6000, 'تحويل بنكي', 'شركة النيل للمرافق'],
    ['EXP-2026-0003', 'شراء الأدوات', 'شراء ألواح وعوامات تعليم', 1800, 'نقدي', 'مورد الأدوات الرياضية'],
    ['EXP-2026-0004', 'الصيانة', 'صيانة فلاتر حمام التعلم', 950, 'نقدي', ''],
    ['EXP-2026-0005', 'التسويق', 'حملة إعلانية محلية', 2500, 'بطاقة', 'منصة إعلانية'],
    ['EXP-2026-0006', 'البطولات', 'مصاريف سفر وإقامة بطولة الأندية', 4200, 'نقدي', 'فريق البطولة']
  ];
  expData.forEach((r, i) => ins('expenses', { trans_no: r[0], date: addDays(today(), -(38 - i * 6)), category: r[1], description: r[2], amount: r[3], payment_method: r[4], beneficiary: r[5], employee: 'أ. مها سليم', status: 'approved', branch_id: b1 }));

  // ===== مستحقات المدربين =====
  ins('coach_dues', { coach_id: 1, month: today().slice(0, 7), amount: 9000, incentives: 500, deductions: 0, net_amount: 9500, paid_amount: 9500, status: 'paid', notes: 'راتب أغسطس' });
  ins('coach_dues', { coach_id: 2, month: today().slice(0, 7), amount: 8000, incentives: 300, deductions: 200, net_amount: 8100, paid_amount: 0, status: 'pending', notes: 'راتب أغسطس' });
  ins('coach_dues', { coach_id: 3, month: today().slice(0, 7), amount: 4500, incentives: 0, deductions: 0, net_amount: 4500, paid_amount: 0, status: 'pending', notes: 'مستحقات الحصص' });
  ins('coach_dues', { coach_id: 4, month: today().slice(0, 7), amount: 10000, incentives: 1000, deductions: 0, net_amount: 11000, paid_amount: 0, status: 'pending', notes: 'راتب أغسطس + حافز البطولة' });

  // ===== الوارد والصادر =====
  ins('incoming_docs', { doc_no: 'WARID-2026-001', receive_date: addDays(today(), -5), sender: 'الاتحاد المصري للسباحة', subject: 'خطاب دعوة لبطولة الجمهورية للناشئين', doc_type: 'خطاب رسمي', receiver: 'مدير الأكاديمية', required_action: 'تجهيز فريق المشاركة', followup_by: 'مسؤول الفرق', due_date: addDays(today(), 15), status: 'open', notes: 'يتطلب تسليم قائمة اللاعبين خلال أسبوع' });
  ins('incoming_docs', { doc_no: 'WARID-2026-002', receive_date: addDays(today(), -12), sender: 'شركة النيل للمرافق', subject: 'إخطار صيانة دورية لحمام السباحة', doc_type: 'إخطار', receiver: 'مدير الفرع', required_action: 'تنسيق موعد الصيانة', followup_by: 'إدارة الفرع', due_date: addDays(today(), -2), status: 'done', notes: '' });
  ins('outgoing_docs', { doc_no: 'SADIR-2026-001', send_date: addDays(today(), -8), recipient: 'الاتحاد المصري للسباحة', subject: 'طلب الاشتراك في بطولة الجمهورية', doc_type: 'خطاب رسمي', responsible: 'مسؤول الفرق', send_method: 'بريد إلكتروني رسمي', delivery_status: 'delivered', notes: '' });
  ins('outgoing_docs', { doc_no: 'SADIR-2026-002', send_date: addDays(today(), -3), recipient: 'أولياء الأمور', subject: 'إعلان معسكر الغردقة الصيفي', doc_type: 'تعميم', responsible: 'الإدارة', send_method: 'واتساب + إعلان داخلي', delivery_status: 'delivered', notes: '' });

  // ===== المستندات =====
  ins('documents', { category: 'شهادة ميلاد', title: 'شهادة ميلاد يوسف', entity_type: 'swimmer', entity_id: 1, file_name: '', file_path: '', visibility: 'private', uploaded_by: null, notes: 'نسخة إلكترونية' });
  ins('documents', { category: 'إقرار حالة صحية', title: 'إقرار الحالة الصحية - يوسف', entity_type: 'swimmer', entity_id: 1, file_name: '', file_path: '', visibility: 'private', uploaded_by: null });
  ins('documents', { category: 'شهادة معلم سباحة', title: 'شهادة الكابتنة ليلى', entity_type: 'coach', entity_id: 6, file_name: '', file_path: '', visibility: 'private', uploaded_by: null });

  // ===== الإشعارات =====
  [
    [1, 'subscription', 'قرب انتهاء الاشتراك', 'يتبقى ٤ أيام على انتهاء اشتراك سلمى سامي محمود', 0, '/admin/subscriptions'],
    [4, 'payment', 'مبلغ مستحق', 'متبقي ١٢٥٠ ج.م على اشتراك ندى سامي محمود', 0, '/admin/subscriptions'],
    [1, 'session', 'تغيير موعد الحصة', 'تم نقل حصة فريق الأكاديمية ليوم الخميس ٥م', 0, '/admin/sessions'],
    [2, 'assessment', 'تقييم جديد', 'أضافت الكابتنة سارة تقييم جديد لكريم عادل رشاد', 0, '/admin/assessments'],
    [1, 'tournament', 'موعد بطولة', 'بطولة الجمهورية للناشئين تبدأ خلال ٣ أسابيع', 0, '/admin/tournaments']
  ].forEach(n => ins('notifications', { user_id: null, type: n[1], title: n[2], body: n[3], is_read: n[4], link: n[5] }));

  // ===== الأخبار والأسئلة والمعرض =====
  ins('news', { title: 'فريق الأكاديمية يفوز بثلاث ميداليات في بطولة الأندية', body: 'حقق فريق الأكاديمية ثلاث ميداليات (ذهبية وفضية وبرونزية) في بطولة الأندية للسباحة بالإسكندرية، وسط أداء مميز للاعبي فريق البطولة.', date: addDays(today(), -25), is_published: 1 });
  ins('news', { title: 'فتح باب الاشتراك في المعسكر الصيفي المتقدم بالغردقة', body: 'يبدأ التسجيل في معسكر الغردقة المكثف، وعدد الأماكن محدود. للتسجيل يرجى التواصل مع الاستقبال أو ملء نموذج طلب الاشتراك بالموقع.', date: addDays(today(), -6), is_published: 1 });
  ins('news', { title: 'جدول اختبارات نهاية البرنامج التأسيسي لشهر أغسطس', body: 'ستُعقد اختبارات نهاية البرنامج للأسبوع الأخير من الشهر الجاري، وسيتم إخطار أولياء الأمور بالمواعيد.', date: addDays(today(), -2), is_published: 1 });
  ins('gallery', { title: 'حصة فريق الأكاديمية', type: 'image', url: '' });
  ins('gallery', { title: 'معسكر البحر الأحمر', type: 'image', url: '' });
  ins('gallery', { title: 'تدريبات الإنقاذ', type: 'image', url: '' });
  ins('faqs', { question: 'من أي عمر يمكن تسجيل الطفل في البرنامج التأسيسي؟', answer: 'يمكن تسجيل الأطفال من عمر ٥ سنوات، ويتم تقسيمهم حسب الفئة العمرية والمستوى.', order_index: 1 });
  ins('faqs', { question: 'كم عدد حصص البرنامج التأسيسي؟', answer: 'البرنامج الأساسي مكون من ٨ حصص، ويمكن التعديل حسب رغبة ولي الأمر بعد استشارة الإدارة.', order_index: 2 });
  ins('faqs', { question: 'هل يتم خصم الحصة عند الاعتذار؟', answer: 'الاعتذار قبل الحصة بـ ٤ ساعات على الأقل يعفى من الخصم، أما الغياب بدون عذر فيخصم من الحصص.', order_index: 3 });
  ins('faqs', { question: 'ما المستندات المطلوبة للتسجيل؟', answer: 'صورة شهادة ميلاد السباح، صورة بطاقة ولي الأمر، إقرار حالة صحية موقّع.', order_index: 4 });

  // ===== الشكاوى وطلبات الاشتراك =====
  ins('complaints', { guardian_id: 3, swimmer_id: 8, subject: 'تغيير موعد مجموعة المستوى الثالث', description: 'أرجو مراعاة تغيير موعد حصص مجموعة مريم ليتناسب مع مواعيد المدرسة.', status: 'resolved', response: 'تمت المراجعة ونقل المجموعة إلى يومي الاثنين والأربعاء.', resolved_at: today() });
  ins('subscription_requests', { swimmer_name: 'جود هشام', age: 8, guardian_name: 'أ. هشام رمزي', guardian_phone: '01234567890', program_id: learn, message: 'نرغب في تسجيل ابنتنا في البرنامج التأسيسي', status: 'new' });
  ins('subscription_requests', { swimmer_name: 'زياد نبيل', age: 15, guardian_name: 'أ. نبيل شكري', guardian_phone: '01298765432', program_id: training, message: 'طلب حصة تقييم لمستوى متقدم', status: 'contacted' });

  // ===== المستخدمون =====
  const staffUsers = [
    { u: 'admin', n: 'م. طارق الحسيني', r: 'admin', ph: '01000000001', em: 'admin@almoj.com' },
    { u: 'manager', n: 'أ. هاني عبد العزيز', r: 'academy_manager', ph: '01000000002', em: 'manager@almoj.com' },
    { u: 'reception', n: 'أ. مها سليم', r: 'reception', ph: '01000000003', em: 'reception@almoj.com' },
    { u: 'finance', n: 'أ. شريف العبد', r: 'finance', ph: '01000000004', em: 'finance@almoj.com' },
    { u: 'team', n: 'أ. رامي فتحي', r: 'team_manager', ph: '01000000005', em: 'team@almoj.com' },
    { u: 'rescue', n: 'أ. مصطفى كمال', r: 'rescue_manager', ph: '01000000006', em: 'rescue@almoj.com' }
  ];
  staffUsers.forEach(u => ins('users', { username: u.u, password_hash: hashPassword('123456'), full_name: u.n, role: u.r, phone: u.ph, email: u.em, is_active: 1 }));
  coachData.forEach((c, i) => ins('users', { username: c.user.u, password_hash: hashPassword('123456'), full_name: c.user.n, role: 'coach', phone: c.phone, email: c.email, linked_type: 'coach', linked_id: coachIds[i], is_active: 1 }));
  const guardianUserMap = [[1, 'ولي أمر يوسف وليان'], [2, 'ولي أمر سلمى وندى وعمر'], [3, 'ولي أمر كريم ومريم وجنى'], [5, 'ولي أمر زياد'], [6, 'ولي أمر فارس وريم'], [8, 'ولي أمر ملك وياسين'], [11, 'ولي أمر حبيبة']];
  guardianUserMap.forEach(([gid]) => {
    const g = db.prepare('SELECT full_name,phone,email FROM guardians WHERE id=?').get(gid);
    ins('users', { username: `guardian${gid}`, password_hash: hashPassword('123456'), full_name: g.full_name, role: 'guardian', phone: g.phone, email: g.email, linked_type: 'guardian', linked_id: gid, is_active: 1 });
  });
  [1, 3, 7, 12].forEach(sw => {
    const s = db.prepare('SELECT full_name,guardian_phone FROM swimmers WHERE id=?').get(sw);
    ins('users', { username: `swimmer${sw}`, password_hash: hashPassword('123456'), full_name: s.full_name, role: 'swimmer', phone: s.guardian_phone, linked_type: 'swimmer', linked_id: sw, is_active: 1 });
  });

  // ===== سجل نشاط =====
  ins('audit_log', { user_id: 1, username: 'admin', action: 'seed', module: 'system', details: 'إنشاء بيانات تجريبية للنظام', ip: '127.0.0.1' });

  console.log('تم إنشاء قاعدة البيانات والبيانات التجريبية بنجاح.');
  console.log('حسابات للدخول بكلمة مرور 123456 :');
  console.log('  مدير النظام admin | مدير الأكاديمية manager | استقبال reception | مالي finance');
  console.log('  فرق team | إنقاذ rescue | مدربون coach1..coach6 | أولياء أمور guardian1..guardian11');
}

module.exports = { seed };

if (require.main === module) {
  seed();
}
