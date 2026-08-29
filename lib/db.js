/**
 * مخطط قاعدة البيانات الكامل لنظام إدارة أكاديمية السباحة
 * يعمل محلياً على ملف SQLite وعلى السحابة عبر Turso/libSQL بنفس الكود
 */

const { createClient } = require('@libsql/client');
const path = require('node:path');

const DB_URL = process.env.DB_URL || ('file:' + path.join(__dirname, '..', 'data.db'));
const IS_REMOTE = DB_URL.startsWith('libsql:') || DB_URL.startsWith('http');
const client = createClient(IS_REMOTE ? { url: DB_URL, authToken: process.env.DB_TOKEN || '' } : { url: DB_URL });

/* واجهة متوافقة مع الواجهة القديمة لكن غير متزامنة */
const db = {
  client,
  /* prepare يبقى متزامناً ويعيد دوال غير متزامنة */
  prepare(sql) {
    const runStmt = (args) => client.execute({ sql, args });
    return {
      get: (...args) => runStmt(args).then(rs => rs.rows.length ? rs.rows[0] : undefined),
      all: (...args) => runStmt(args).then(rs => Array.from(rs.rows)),
      run: (...args) => runStmt(args).then(rs => ({
        changes: Number(rs.rowsAffected || 0),
        lastInsertRowid: rs.lastInsertRowid !== undefined && rs.lastInsertRowid !== null ? Number(rs.lastInsertRowid) : undefined
      }))
    };
  },
  async get(sql, ...args) { return this.prepare(sql).get(...args); },
  async all(sql, ...args) { return this.prepare(sql).all(...args); },
  async run(sql, ...args) { return this.prepare(sql).run(...args); },
  async exec(sql) { await client.execute(sql); },
  async execMultiple(sql) { await client.executeMultiple(sql); },
  batch(stmts) {
    return client.batch(stmts.map(s => typeof s === 'string' ? { sql: s, args: [] } : s), 'write');
  }
};

/* تهيئة أولية (تعمل مرة واحدة عند بدء التشغيل) */
let _readyPromise = null;
function ready() {
  if (!_readyPromise) _readyPromise = initDatabase().catch(e => { console.error('خطأ تهيئة قاعدة البيانات:', e.message); throw e; });
  return _readyPromise;
}

async function initDatabase() {
  await client.executeMultiple(SCHEMA);

  /* مزامنة تلقائية لأعضاء المجموعات عبر محفزات */
  try {
    await client.execute(`CREATE TRIGGER IF NOT EXISTS sync_swimmer_group_after_insert AFTER INSERT ON swimmers
      BEGIN
        INSERT OR IGNORE INTO swimmer_group (swimmer_id, group_id)
          SELECT NEW.id, NEW.group_id WHERE NEW.group_id IS NOT NULL;
      END;`);
    await client.execute(`CREATE TRIGGER IF NOT EXISTS sync_swimmer_group_after_update AFTER UPDATE OF group_id ON swimmers
      BEGIN
        DELETE FROM swimmer_group WHERE swimmer_id = NEW.id;
        INSERT OR IGNORE INTO swimmer_group (swimmer_id, group_id)
          SELECT NEW.id, NEW.group_id WHERE NEW.group_id IS NOT NULL;
      END;`);
  } catch (e) { console.error('خطأ في إنشاء المحفزات:', e.message); }

  /* جدول تخزين المرفقات داخل قاعدة البيانات (للتشغيل على Vercel) */
  try {
    await client.executeMultiple(`CREATE TABLE IF NOT EXISTS file_blobs (
      name TEXT PRIMARY KEY,
      mime TEXT,
      size INTEGER,
      data BLOB,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );`);
  } catch (e) { console.error('file_blobs:', e.message); }

  /* ترحيلات للأعمدة الجديدة (تُتجاهل إذا كانت موجودة) */
  const migrations = [
    'ALTER TABLE assessment_criteria ADD COLUMN level_id INTEGER',
    'ALTER TABLE coaches ADD COLUMN cv TEXT',
    'ALTER TABLE staff ADD COLUMN cv TEXT',
    "ALTER TABLE programs ADD COLUMN schedule TEXT DEFAULT '[]'",
    'ALTER TABLE tests ADD COLUMN race_type TEXT',
    'ALTER TABLE tests ADD COLUMN level_id INTEGER',
    "ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '{}'"
  ];
  for (const m of migrations) {
    try { await client.execute(m); } catch (e) { /* العمود موجود مسبقاً */ }
  }

  /* إعدادات افتراضية */
  try {
    const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    await ins.run('program_types', JSON.stringify(['تعليم سباحة', 'تدريب سباحة', 'فرق', 'إنقاذ', 'سلامة في الماء', 'إعداد معلم سباحة', 'معسكر', 'دورة خاصة']));
    await ins.run('test_types', JSON.stringify(['مستوى', 'زمن', 'بطولة', 'عام']));
    await ins.run('home_images', '[]');
  } catch (e) { console.error('خطأ في بيانات الإعدادات:', e.message); }

  await seedCurriculum();
  await seedGeneralCriteria();
}

/* ---------- المنهج التعليمي: المستويات السبع ومعايير كل مستوى ---------- */
const CURRICULUM_LEVELS = ['المستوى الأول', 'المستوى الثاني', 'المستوى الثالث', 'المستوى الرابع', 'المستوى الخامس', 'المستوى السادس', 'المستوى السابع'];

const SCHEMA = `
-- =============================== المستخدمون والصلاحيات ===============================
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  is_system INTEGER DEFAULT 0,
  permissions TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  avatar TEXT,
  role_id INTEGER REFERENCES roles(id),
  user_type TEXT DEFAULT 'staff',           -- staff | guardian | coach | swimmer
  linked_id INTEGER DEFAULT 0,              -- id في الجدول المرتبط
  permissions TEXT DEFAULT '{}',            -- الصلاحيات الفردية (تتجاوز صلاحيات الدور)
  status TEXT DEFAULT 'active',             -- active | disabled
  theme TEXT DEFAULT 'light',
  last_login TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT,
  action TEXT,                              -- add | edit | delete | login | ...
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- =============================== الفروع وحمامات السباحة ===============================
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  manager_name TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS pools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id),
  lanes_count INTEGER DEFAULT 6,
  length_m INTEGER DEFAULT 25,
  depth_m REAL DEFAULT 1.5,
  notes TEXT
);

-- =============================== الأشخاص ===============================
CREATE TABLE IF NOT EXISTS guardians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  national_id TEXT,
  relation TEXT DEFAULT 'أب',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS coaches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  avatar TEXT,
  gender TEXT DEFAULT 'ذكر',
  phone TEXT,
  email TEXT,
  address TEXT,
  qualification TEXT,
  specialization TEXT,
  experience_years INTEGER DEFAULT 0,
  certificates TEXT,
  hire_date TEXT,
  contract_type TEXT DEFAULT 'ثابت',        -- ثابت | نسبة | بالحصة
  salary_type TEXT DEFAULT 'monthly',       -- monthly | per_session | percent
  salary_amount REAL DEFAULT 0,
  work_days TEXT DEFAULT '[]',              -- ["sunday","tuesday"]
  license_expiry TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  full_name TEXT NOT NULL,
  job_title TEXT,
  phone TEXT,
  email TEXT,
  branch_id INTEGER REFERENCES branches(id),
  hire_date TEXT,
  salary REAL DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS swimmers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  membership_no TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  avatar TEXT,
  birth_date TEXT,
  gender TEXT DEFAULT 'ذكر',
  phone TEXT,
  address TEXT,
  school TEXT,
  guardian_id INTEGER REFERENCES guardians(id),
  blood_type TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  health_notes TEXT,
  allergies TEXT,
  chronic_diseases TEXT,
  medical_note TEXT,
  level_id INTEGER REFERENCES levels(id),
  group_id INTEGER REFERENCES groups(id),
  coach_id INTEGER REFERENCES coaches(id),
  program_id INTEGER REFERENCES programs(id),
  registration_date TEXT DEFAULT (date('now')),
  status TEXT DEFAULT 'نشط',                -- نشط | متوقف مؤقتاً | منسحب | مجمد | خريج
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- =============================== البرامج والمستويات والمجموعات ===============================
CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'تعليم سباحة',          -- تعليم سباحة | تدريب سباحة | فرق | إنقاذ | سلامة في الماء | إعداد معلم سباحة | معسكر | دورة خاصة
  description TEXT,
  age_from INTEGER DEFAULT 4,
  age_to INTEGER DEFAULT 18,
  level_required TEXT,
  sessions_count INTEGER DEFAULT 8,
  session_duration_min INTEGER DEFAULT 45,
  weeks_count INTEGER DEFAULT 4,
  price REAL DEFAULT 0,
  max_subscribers INTEGER DEFAULT 20,
  schedule_note TEXT,
  coach_id INTEGER REFERENCES coaches(id),
  pool_id INTEGER REFERENCES pools(id),
  branch_id INTEGER REFERENCES branches(id),
  tests_required TEXT,
  success_conditions TEXT,
  certificate_name TEXT,
  status TEXT DEFAULT 'متاح',               -- متاح | مكتمل العدد | متوقف | منتهي
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  order_no INTEGER DEFAULT 1,
  description TEXT,
  color TEXT DEFAULT '#0284c7',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  program_id INTEGER REFERENCES programs(id),
  coach_id INTEGER REFERENCES coaches(id),
  pool_id INTEGER REFERENCES pools(id),
  branch_id INTEGER REFERENCES branches(id),
  capacity INTEGER DEFAULT 12,
  schedule TEXT DEFAULT '[]',               -- [{day:"sunday", start:"04:00", end:"05:00"}]
  sessions_count INTEGER DEFAULT 8,
  status TEXT DEFAULT 'نشطة',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS swimmer_group (
  swimmer_id INTEGER REFERENCES swimmers(id),
  group_id INTEGER REFERENCES groups(id),
  joined_at TEXT DEFAULT (date('now')),
  PRIMARY KEY (swimmer_id, group_id)
);

-- =============================== الحصص والحضور ===============================
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER REFERENCES groups(id),
  title TEXT,
  date TEXT,
  start_time TEXT,
  end_time TEXT,
  coach_id INTEGER REFERENCES coaches(id),
  pool_id INTEGER REFERENCES pools(id),
  status TEXT DEFAULT 'scheduled',          -- scheduled | completed | cancelled | rescheduled
  is_compensatory INTEGER DEFAULT 0,
  original_date TEXT,
  note TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES sessions(id),
  swimmer_id INTEGER REFERENCES swimmers(id),
  status TEXT DEFAULT 'present',            -- present | absent | excused | late
  reason TEXT,
  coach_note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(session_id, swimmer_id)
);

-- =============================== الاشتراكات والمدفوعات ===============================
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swimmer_id INTEGER REFERENCES swimmers(id),
  program_id INTEGER REFERENCES programs(id),
  group_id INTEGER REFERENCES groups(id),
  start_date TEXT,
  end_date TEXT,
  sessions_total INTEGER DEFAULT 8,
  sessions_used INTEGER DEFAULT 0,
  price REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  total REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  remaining REAL DEFAULT 0,
  payment_method TEXT DEFAULT 'نقدي',
  receipt_no TEXT,
  paid_date TEXT,
  is_installment INTEGER DEFAULT 0,
  installments TEXT DEFAULT '[]',
  status TEXT DEFAULT 'نشط',                -- نشط | مجمد | ملغي | منتهي | مكتمل
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER REFERENCES subscriptions(id),
  swimmer_id INTEGER REFERENCES swimmers(id),
  amount REAL DEFAULT 0,
  method TEXT DEFAULT 'نقدي',
  receipt_no TEXT,
  paid_date TEXT DEFAULT (date('now')),
  staff_id INTEGER,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS subscription_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER REFERENCES subscriptions(id),
  swimmer_id INTEGER,
  action TEXT,                              -- إنشاء | تجديد | تجميد | إلغاء | دفع | ترحيل
  details TEXT,
  user_name TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- =============================== التقييمات والاختبارات ===============================
CREATE TABLE IF NOT EXISTS assessment_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'مهارات أساسية',
  program_type TEXT DEFAULT 'all',
  order_no INTEGER DEFAULT 1,
  level_id INTEGER REFERENCES levels(id)
);

CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swimmer_id INTEGER REFERENCES swimmers(id),
  coach_id INTEGER REFERENCES coaches(id),
  program_id INTEGER REFERENCES programs(id),
  level_id INTEGER REFERENCES levels(id),
  date TEXT DEFAULT (date('now')),
  scores TEXT DEFAULT '{}',
  strengths TEXT,
  weaknesses TEXT,
  recommendations TEXT,
  ready_to_advance INTEGER DEFAULT 0,
  next_assessment_date TEXT,
  overall_percent REAL DEFAULT 0,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swimmer_id INTEGER REFERENCES swimmers(id),
  coach_id INTEGER REFERENCES coaches(id),
  type TEXT DEFAULT 'مستوى',                -- مستوى | زمن | بطولة | عام
  race_type TEXT,                            -- نوع السباق المكتوب يدوياً: حرة | ظهر | صدر | فراشة | متنوع ...
  level_id INTEGER REFERENCES levels(id),    -- المستوى المختار عند نوع الاختبار "مستوى"
  date TEXT DEFAULT (date('now')),
  distance_m INTEGER DEFAULT 0,
  time_seconds REAL,
  position INTEGER,
  passed INTEGER DEFAULT 0,
  result_note TEXT,
  status TEXT DEFAULT 'اجتاز',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS level_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swimmer_id INTEGER REFERENCES swimmers(id),
  from_level_id INTEGER,
  to_level_id INTEGER REFERENCES levels(id),
  date TEXT DEFAULT (date('now')),
  assessment_id INTEGER,
  reason TEXT
);

-- =============================== الفرق والبطولات ===============================
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  age_group TEXT,
  coach_id INTEGER REFERENCES coaches(id),
  branch_id INTEGER REFERENCES branches(id),
  description TEXT,
  training_plan TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER REFERENCES teams(id),
  swimmer_id INTEGER REFERENCES swimmers(id),
  joined_date TEXT DEFAULT (date('now')),
  role TEXT DEFAULT 'لاعب'
);

CREATE TABLE IF NOT EXISTS competitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'محلية',
  date TEXT,
  end_date TEXT,
  place TEXT,
  branch_id INTEGER REFERENCES branches(id),
  status TEXT DEFAULT 'قادمة',              -- قادمة | جارية | منتهية
  note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS competition_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER REFERENCES competitions(id),
  swimmer_id INTEGER REFERENCES swimmers(id),
  race_type TEXT DEFAULT 'حرة',             -- حرة | ظهر | صدر | فراشة | متنوع
  distance_m INTEGER DEFAULT 50,
  time_seconds REAL,
  previous_time_seconds REAL,
  position INTEGER,
  qualified INTEGER DEFAULT 0,
  pb INTEGER DEFAULT 0,
  note TEXT
);

CREATE TABLE IF NOT EXISTS player_measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swimmer_id INTEGER REFERENCES swimmers(id),
  race_type TEXT DEFAULT 'حرة',
  distance_m INTEGER DEFAULT 50,
  time_seconds REAL,
  date TEXT DEFAULT (date('now')),
  note TEXT
);

-- =============================== المالية ===============================
CREATE TABLE IF NOT EXISTS revenues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_no TEXT,
  category TEXT,                            -- اشتراكات | رسوم اختبارات | بطولات | معسكرات | مبيعات | شهادات | أخرى
  date TEXT DEFAULT (date('now')),
  description TEXT,
  amount REAL DEFAULT 0,
  payment_method TEXT DEFAULT 'نقدي',
  payer TEXT,
  staff_id INTEGER,
  branch_id INTEGER REFERENCES branches(id),
  attachment TEXT,
  notes TEXT,
  status TEXT DEFAULT 'معتمد',              -- معلق | معتمد
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_no TEXT,
  category TEXT,                            -- رواتب مدربين | إيجار | أدوات | صيانة | تسويق | انتقالات | بطولات | إدارية | أخرى
  date TEXT DEFAULT (date('now')),
  description TEXT,
  amount REAL DEFAULT 0,
  payment_method TEXT DEFAULT 'نقدي',
  beneficiary TEXT,
  staff_id INTEGER,
  branch_id INTEGER REFERENCES branches(id),
  attachment TEXT,
  notes TEXT,
  status TEXT DEFAULT 'معتمد',
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS coach_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_id INTEGER REFERENCES coaches(id),
  period TEXT,                              -- 2025-01
  amount_due REAL DEFAULT 0,
  bonus REAL DEFAULT 0,
  deduction REAL DEFAULT 0,
  total REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  remaining REAL DEFAULT 0,
  status TEXT DEFAULT 'مستحق',
  paid_date TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- =============================== الوارد والصادر ===============================
CREATE TABLE IF NOT EXISTS incoming_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT,
  received_date TEXT DEFAULT (date('now')),
  sender TEXT,
  subject TEXT,
  doc_type TEXT,
  receiver TEXT,
  required_action TEXT,
  owner_id INTEGER,
  due_date TEXT,
  status TEXT DEFAULT 'جديد',               -- جديد | قيد المتابعة | منجز | مؤجل
  attachment TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS outgoing_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT,
  sent_date TEXT DEFAULT (date('now')),
  recipient TEXT,
  subject TEXT,
  doc_type TEXT,
  sender TEXT,
  send_method TEXT DEFAULT 'بريد',
  attachment TEXT,
  delivery_status TEXT DEFAULT 'مرسل',      -- مرسل | تم الاستلام
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- =============================== المستندات ===============================
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT,                          -- swimmer | coach | guardian | general
  owner_id INTEGER,
  doc_type TEXT,
  title TEXT,
  file_path TEXT,
  file_name TEXT,
  mime TEXT,
  size INTEGER DEFAULT 0,
  visibility TEXT DEFAULT 'staff',          -- staff | coach | guardian
  notes TEXT,
  uploaded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- =============================== الإشعارات والتواصل ===============================
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  message TEXT,
  type TEXT DEFAULT 'عام',
  link TEXT,
  is_broadcast INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notification_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER REFERENCES notifications(id),
  user_id INTEGER REFERENCES users(id),
  is_read INTEGER DEFAULT 0,
  read_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER REFERENCES users(id),
  to_user_id INTEGER REFERENCES users(id),
  subject TEXT,
  body TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guardian_id INTEGER REFERENCES guardians(id),
  swimmer_id INTEGER REFERENCES swimmers(id),
  category TEXT DEFAULT 'عام',
  title TEXT,
  description TEXT,
  status TEXT DEFAULT 'جديدة',              -- جديدة | قيد المعالجة | تمت المعالجة | مغلقة
  response TEXT,
  responded_by INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

-- =============================== الإعدادات ===============================
CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'مدرسة',               -- مدرسة | أكاديمية | مركز | معهد | جامعة | أخرى
  city TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  body TEXT,
  is_public INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- سجل نقل السباحين بين المجموعات/المدرّبين
CREATE TABLE IF NOT EXISTS swimmer_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swimmer_id INTEGER REFERENCES swimmers(id),
  from_group_id INTEGER,
  from_coach_id INTEGER,
  to_group_id INTEGER,
  to_coach_id INTEGER,
  note TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`;

const CURRICULUM = [
  [
    'خروج النفس من الماء (بابلز) 10 تكرارات',
    'وضع البدء من الحائط لمهارة الطفو على البطن',
    'وضع البدء من الحائط لمهارة الطفو على الظهر',
    'الطفو على البطن ثم الدوران لوضع الطفو على الظهر والعكس'
  ],
  [
    'وضع البدء من الحائط ومهارة الجسم المستقيم (stream line) الثبات ثلاث عدات ثم عمل ضربات رجلين على البطن',
    'وضع البدء ومهارة الجسم المستقيم (stream line) الثبات ثلاث عدات ثم عمل ضربات رجلين على الظهر',
    'وسط دولفن',
    'استارت حرة + 4 ضربات دولفن و6 حرة'
  ],
  [
    'body roll يمين وشمال بدون نفس حرة',
    'body roll يمين وشمال نفس حرة',
    'body roll يمين وشمال باك',
    'وقوف في الماء لمدة 2 ثانية',
    'زراعين حرة'
  ],
  [
    'سباحة الحرة (freestyle) كل 3 شدات نفس من الجانب مسافة 25 متر',
    'سباحة الزحف على الظهر مع الحركة التبادلية للذراعين مسافة 25 متر',
    'استارت باك + 4 ضربات دولفن باك',
    'باك كامل'
  ],
  [
    'دوران حرة',
    'دوران باك',
    'رجلين بريست باستخدام البورد مسافة 12.5م',
    'استارت + الشدة الطويلة',
    'زراعين برست'
  ],
  [
    'سباحة الحرة (freestyle) كل 3 شدات نفس من الجانب مسافة 25 متر',
    'سباحة الزحف على الظهر مع الحركة التبادلية للذراعين مسافة 25 متر',
    'سباحة البريست مسافة 12.5 مع البداية والشدة الطويلة تحت الماء',
    'سباحة الفراشة مسافة 12.5 مع البداية 3 وسط دولفين'
  ],
  [
    'مهارة star الخاصة بـ (star 1)',
    'star 2',
    'star 3',
    'star 4'
  ]
];

async function seedCurriculum() {
  try {
    const ver = (await db.prepare("SELECT value FROM settings WHERE key = 'curriculum_version'").get() || {}).value;
    if (ver === 'v2') return;

    let levels = await db.all('SELECT * FROM levels ORDER BY order_no');
    if (!levels.length) {
      const insL = db.prepare('INSERT INTO levels (name, order_no) VALUES (?,?)');
      for (let i = 0; i < [...CURRICULUM_LEVELS, 'فريق أكاديمية', 'فريق بطولات'].length; i++) {
        await insL.run([...CURRICULUM_LEVELS, 'فريق أكاديمية', 'فريق بطولات'][i], i + 1);
      }
      levels = await db.all('SELECT * FROM levels ORDER BY order_no');
    }

    const updL = db.prepare('UPDATE levels SET name = ? WHERE id = ?');
    for (let i = 0; i < Math.min(levels.length, 7); i++) await updL.run(CURRICULUM_LEVELS[i], levels[i].id);

    await db.run('DELETE FROM assessment_criteria');
    const insC = db.prepare('INSERT INTO assessment_criteria (name, category, program_type, order_no, level_id) VALUES (?,?,?,?,?)');
    for (let idx = 0; idx < CURRICULUM.length; idx++) {
      const levelId = levels[idx].id;
      for (let i = 0; i < CURRICULUM[idx].length; i++) await insC.run(CURRICULUM[idx][i], CURRICULUM_LEVELS[idx], 'all', i + 1, levelId);
    }
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('curriculum_version','v2')");
    console.log('تم تطبيق المنهج التعليمي (المستويات السبع)');
  } catch (e) { console.error('خطأ في تطبيق المنهج:', e.message); }
}

/* ---------- المعايير العامة المشتركة ---------- */
async function seedGeneralCriteria() {
  try {
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'general_criteria_v1'").get();
    if ((row || {}).value === '1') return;
    const sharedNames = ['السرعة', 'الالتزام', 'الانضباط'];
    for (const n of sharedNames) {
      await db.run('DELETE FROM assessment_criteria WHERE level_id IS NOT NULL AND name = ?', n);
    }
    const existing = (await db.all('SELECT name FROM assessment_criteria WHERE level_id IS NULL')).map(r => r.name);
    const maxRow = await db.prepare('SELECT COALESCE(MAX(order_no),0)+1 n FROM assessment_criteria WHERE level_id IS NULL').get();
    let order = maxRow.n;
    for (const n of sharedNames) {
      if (existing.indexOf(n) < 0) {
        await db.run('INSERT INTO assessment_criteria (name, category, program_type, order_no, level_id) VALUES (?,?,?,?,NULL)', n, 'معايير عامة', 'all', order++);
      }
    }
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('general_criteria_v1','1')");
    console.log('تم تجهيز المعايير العامة (السرعة، الالتزام، الانضباط)');
  } catch (e) { console.error('خطأ في تجهيز المعايير العامة:', e.message); }
}

module.exports = { db, client, ready, DB_PATH: DB_URL };
