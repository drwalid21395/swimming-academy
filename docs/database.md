# تحليل قاعدة البيانات - نظام إدارة أكاديمية السباحة

## نظرة عامة

قاعدة البيانات من نوع **SQLite** (ملف `data/academy.db`) وتُدار عبر الوحدة المدمجة
`node:sqlite` دون أي اعتماديات خارجية. يعتمد التصميم على **المفاتيح الأجنبية
(Foreign Keys)** والترقيم التلقائي، ويغطي جميع مجالات النظام: التسجيل والاشتراكات
والتقييمات والجدولة والمالية والمراسلات.

## العلاقات الأساسية

```
branches 1───* pools
branches 1───* programs
branches 1───* groups
branches 1───* revenues/expenses

guardians 1───* swimmers
guardians 1───1 users (حساب ولي الأمر)

coaches 1───1 users (حساب الكابتن)
coaches 1───* groups
coaches 1───* sessions
coaches 1───* assessments

programs 1───* subscriptions
programs 1───* groups
programs 1───* swimmers
levels 1───* swimmers (المستوى الحالي)
levels 1───* groups

swimmers 1───* subscriptions
swimmers 1───* payments
swimmers 1───* attendance
swimmers 1───* assessments
swimmers 1───* tests
swimmers 1───* team_members
swimmers 1───* tournament_participations
swimmers 1───* documents
swimmers 1───* level_transitions

groups 1───* sessions
sessions 1───* attendance
teams 1───* team_members
teams 1───* team_times
teams 1───* tournament_participations

users ─── roles (الصلاحيات لكل دور)
```

## الجداول

| الجدول | الوظيفة | أهم الحقول |
|---|---|---|
| `users` | حسابات الدخول لكل الأنواع | username, password_hash, role, is_active |
| `roles` | أدوار النظام والصلاحيات | role, name_ar, permissions (JSON) |
| `branches` | الفروع | name, address, manager_name |
| `pools` | حمامات السباحة | branch_id, name, lanes, capacity |
| `programs` | البرامج والدورات | program_type, sessions_count, session_minutes, price, status |
| `levels` | مستويات السباحة | name, order_index |
| `guardians` | أولياء الأمور | full_name, phone, whatsapp, relation |
| `swimmers` | الملف الإلكتروني للسباح | membership_no, birth_date, health, current_level_id, status |
| `coaches` | الكباتن والمدربون | qualification, contract_type, salary_or_rate, license_expiry |
| `groups` | المجموعات التدريبية | pool_id, coach_id, level_id, schedule (JSON), max_capacity |
| `sessions` | الحصص والجداول | group_id, date, start_time, end_time, session_type, status |
| `attendance` | الحضور والغياب | session_id, swimmer_id, status, reason, deducted_session |
| `assessment_criteria` | معايير التقييم الفني | program_type, name_ar, order_index |
| `assessments` | التقييمات الفنية | swimmer_id, scores (JSON), strengths, ready_to_advance |
| `tests` | نتائج الاختبارات | distance, stroke, time_seconds, result |
| `teams` | فرق السباحة | age_category, coach_id, training_plan |
| `team_members` | لاعبو الفريق | team_id, swimmer_id, role |
| `team_times` | الأزمنة والقياسات | race_type, distance, best_time, previous_time |
| `tournaments` | البطولات | date_from, date_to, location |
| `tournament_participations` | مشاركات البطولات | race_type, distance, result_time, place |
| `subscriptions` | الاشتراكات | sessions_count, price, discount, paid/remaining, status, installments |
| `payments` | المدفوعات والأقساط | amount, method, receipt_no, status |
| `revenues` | الإيرادات | category, amount, payment_method, status |
| `expenses` | المصروفات | category, amount, beneficiary, status |
| `coach_dues` | مستحقات المدربين | month, amount, incentives, deductions, status |
| `incoming_docs` | الوارد | doc_no, sender, subject, due_date, status |
| `outgoing_docs` | الصادر | doc_no, recipient, subject, delivery_status |
| `documents` | الأرشيف الإلكتروني | category, entity_type, file_path, visibility |
| `notifications` | الإشعارات | user_id, type, title, is_read |
| `messages` | الرسائل الداخلية | sender_id, receiver_id, subject |
| `complaints` | الشكاوى والطلبات | guardian_id, subject, status, response |
| `news` | الأخبار والإعلانات | title, body, is_published |
| `gallery` | معرض الصور والفيديو | title, type, url |
| `faqs` | الأسئلة الشائعة | question, answer |
| `contact_messages` | رسائل التواصل | name, phone, subject, is_read |
| `subscription_requests` | طلبات الاشتراك العامة | swimmer_name, guardian_phone, program_id, status |
| `certificates` | شهادات اجتياز البرامج | cert_no, issue_date, status |
| `level_transitions` | سجل الانتقال بين المستويات | from_level, to_level, date |
| `audit_log` | سجل النشاط | user, action, module, details, ip |
| `settings` | إعدادات النظام | key/value |

## ملاحظات التصميم

- **حساب العمر ونسبة الحضور** يتمان برمجيًا (حقول محسوبة) وليسا مخزنين فقط.
- **المستويات والدورات والصلاحيات** كلها قابلة للتخصيص من إعدادات النظام.
- **عدد حصص برنامج تعليم السباحة** افتراضيًا 8 حصص وقابل للتعديل من مدير النظام.
- جميع الحقول المالية تحفظ بالقروش الكاملة (أرقام عشرية) لتجنب أخطاء التقريب.
- البيانات الحساسة (طبية/شخصية) محمية بصلاحيات الأدوار وحدها.
