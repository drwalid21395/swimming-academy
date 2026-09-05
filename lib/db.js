/**
 * مخطط قاعدة البيانات الكامل لنظام إدارة أكاديمية السباحة
 * يعمل محلياً على ملف SQLite وعلى السحابة عبر Turso/libSQL بنفس الكود
 */

const { createClient } = require('@libsql/client');
const path = require('node:path');

/* طبقة عزل متعددة الأكاديميات: تُفعّل فقط داخل withAcademy(...)
   getTenant() تعيد null خارج أي سياق، فلا تُعزل استعلامات المنصة/التشغيل. */
const { getTenant } = require('./tenant-context');
const { scopeSql } = require('./scoped-db');

const DB_URL = process.env.DB_URL || ('file:' + path.join(__dirname, '..', 'data.db'));
const IS_REMOTE = DB_URL.startsWith('libsql:') || DB_URL.startsWith('http');
const client = createClient(IS_REMOTE ? { url: DB_URL, authToken: process.env.DB_TOKEN || '' } : { url: DB_URL });

/* قيمة غير صالحة (NaN/Infinity من Number(req.params.x) مثلاً) تتحول لـ null
   بدلاً من أن ترفضها محرّك libsql وتُسقط العملية — معاملات WHERE سترجع "لا صفوف"
   وسيُعاد التوجيه بشكل آمن بدلاً من تجمّد الموقع كلياً. */
function sanitizeArgs(args) {
  if (!args || !args.length) return args;
  return args.map(a => (typeof a === 'number' && !Number.isFinite(a)) ? null : a);
}

/* واجهة متوافقة مع الواجهة القديمة لكن غير متزامنة */
const db = {
  client,
  /* prepare يبقى متزامناً ويعيد دوال غير متزامنة */
  prepare(sql) {
    const tenant = getTenant();
    if (tenant && tenant.academyId) {
      sql = scopeSql(sql, tenant.academyId);
    }
    const runStmt = (args) => client.execute({ sql, args: sanitizeArgs(args) });
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
    'ALTER TABLE swimmers ADD COLUMN deleted_at TEXT',
    'ALTER TABLE guardians ADD COLUMN deleted_at TEXT',
    'ALTER TABLE coaches ADD COLUMN deleted_at TEXT',
    'ALTER TABLE programs ADD COLUMN deleted_at TEXT',
    'ALTER TABLE groups ADD COLUMN deleted_at TEXT',
    'ALTER TABLE sessions ADD COLUMN deleted_at TEXT',
    "ALTER TABLE programs ADD COLUMN schedule TEXT DEFAULT '[]'",
    'ALTER TABLE tests ADD COLUMN race_type TEXT',
    'ALTER TABLE tests ADD COLUMN level_id INTEGER',
    "ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '{}'",
    /* إضافة academy_id للعزل بين الأكاديميات (غير مدمرة — DFaults للأكاديمية الأساسية 1) */
    "ALTER TABLE users ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE roles ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE swimmers ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE guardians ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE coaches ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE staff ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE programs ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE levels ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE groups ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE swimmer_group ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE sessions ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE attendance ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE subscriptions ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE payments ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE subscription_history ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE assessment_criteria ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE assessments ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE tests ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE level_progress ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE teams ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE team_members ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE competitions ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE competition_results ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE player_measurements ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE revenues ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE expenses ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE coach_payments ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE incoming_docs ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE outgoing_docs ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE documents ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE notifications ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE notification_recipients ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE messages ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE complaints ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE announcements ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE swimmer_transfers ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE branches ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE pools ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE schools ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE file_blobs ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE whatsapp_messages ADD COLUMN academy_id INTEGER DEFAULT 1",
    "ALTER TABLE announcements ADD COLUMN image TEXT",
    "ALTER TABLE staff ADD COLUMN avatar TEXT",
    "ALTER TABLE staff ADD COLUMN job_nature TEXT"
  ];
  for (const m of migrations) {
    try { await client.execute(m); } catch (e) { /* العمود موجود مسبقاً */ }
  }

  /* إصلاح ذاتي: يكشف جدول حضور المدربين التالف (من حالة جزئية سابقة) ويعيد بناءه */
  try {
    const info = await client.execute('PRAGMA table_info(trainer_session_attendance)');
    const cols = info.rows.map(r => r.name);
    if (!cols.includes('coach_id') || !cols.includes('date')) {
      await client.execute('DROP TABLE IF EXISTS trainer_session_attendance');
      await client.execute(`CREATE TABLE IF NOT EXISTS trainer_session_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        academy_id INTEGER DEFAULT 1,
        session_id INTEGER REFERENCES sessions(id),
        group_id INTEGER REFERENCES groups(id),
        branch_id INTEGER REFERENCES branches(id),
        coach_id INTEGER REFERENCES coaches(id),
        substitute_coach_id INTEGER,
        date TEXT,
        start_time TEXT,
        end_time TEXT,
        duration_min INTEGER DEFAULT 0,
        status TEXT DEFAULT 'حاضر',
        session_rate REAL DEFAULT 0,
        base_rate REAL DEFAULT 0,
        late_minutes INTEGER DEFAULT 0,
        cancel_reason TEXT,
        payment_policy TEXT DEFAULT 'بالمعتاد',
        note TEXT,
        created_by INTEGER,
        updated_by INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT,
        UNIQUE(session_id, coach_id)
      )`);
    }
  } catch (e) { /* تجاهل */ }

  /* بنية تعدد الأكاديميات: تهيئة غير مدمرة */
  await seedMultiTenant();

  /* إصلاح ذاتي: صلاحيات الأدوار النظامية (تصلّح أي دور نظامي تالف مثل "مدير الأكاديمية") */
  await repairSystemRoles();

  /* إعدادات افتراضية */
  try {
    const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    await ins.run('program_types', JSON.stringify(['تعليم سباحة', 'تدريب سباحة', 'فرق', 'إنقاذ', 'سلامة في الماء', 'إعداد معلم سباحة', 'معسكر', 'دورة خاصة']));
    await ins.run('test_types', JSON.stringify(['مستوى', 'زمن', 'بطولة', 'عام']));
    await ins.run('home_images', '[]');
    await ins.run('whatsapp_country_code', '20');
    await ins.run('whatsapp_auto_send', '1');
    await ins.run('platform_name', 'منصة إدارة الأكاديميات');
    await ins.run('platform_vodafone_cash', '');
    await ins.run('platform_payment_instructions', '');
    await ins.run('platform_grace_days', '7');
    await ins.run('platform_powered_by', '1');
    await ins.run('platform_default_plan', 'basic');
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

-- =============================== الحضور والمستحقات (المنظومة الجديدة) ===============================
/* قواعد الغياب والتأخير القابلة للتعديل (مفاتيح لكل أكاديمية) */
CREATE TABLE IF NOT EXISTS attendance_policy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academy_id INTEGER DEFAULT 1,
  pkey TEXT NOT NULL,
  pvalue TEXT,
  UNIQUE(academy_id, pkey)
);

/* حضور المدرب حسب الحصة */
CREATE TABLE IF NOT EXISTS trainer_session_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academy_id INTEGER DEFAULT 1,
  session_id INTEGER REFERENCES sessions(id),
  group_id INTEGER REFERENCES groups(id),
  branch_id INTEGER REFERENCES branches(id),
  coach_id INTEGER REFERENCES coaches(id),
  substitute_coach_id INTEGER,               -- المدرب البديل إن وجد
  date TEXT,
  start_time TEXT,
  end_time TEXT,
  duration_min INTEGER DEFAULT 0,
  status TEXT DEFAULT 'حاضر',                -- حاضر | غائب | متأخر | معتذر | ملغاة | بديل
  session_rate REAL DEFAULT 0,               -- قيمة الحصة (قابلة للتعديل لكل حصة)
  base_rate REAL DEFAULT 0,                  -- السعر الأساسي قبل التعديل
  late_minutes INTEGER DEFAULT 0,
  cancel_reason TEXT,                        -- سبب الإلغاء
  payment_policy TEXT DEFAULT 'بالمعتاد',    -- قواعد الحصة الملغاة: كامل | نسبة | غير مستحقة
  note TEXT,
  created_by INTEGER,
  updated_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  UNIQUE(session_id, coach_id)
);

/* أسعار المدرب (افتراضية وقابلة للتخصيص حسب الفرع/النوع) */
CREATE TABLE IF NOT EXISTS trainer_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academy_id INTEGER DEFAULT 1,
  coach_id INTEGER REFERENCES coaches(id),
  default_rate REAL DEFAULT 0,               -- سعر الحصة الافتراضي
  hourly_rate REAL DEFAULT 0,                -- سعر الساعة
  private_rate REAL DEFAULT 0,               -- حصة خاصة
  group_rate REAL DEFAULT 0,                 -- حصة جماعية
  branch_id INTEGER,                         -- إن كان السعر مختلفاً بفرع
  branch_rate REAL DEFAULT 0,
  period TEXT,                               -- فترة سريان (اختياري)
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

/* حضور الموظفين اليومي */
CREATE TABLE IF NOT EXISTS staff_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academy_id INTEGER DEFAULT 1,
  staff_id INTEGER REFERENCES staff(id),
  branch_id INTEGER REFERENCES branches(id),
  date TEXT,
  check_in TEXT,
  check_out TEXT,
  status TEXT DEFAULT 'حاضر',                -- حاضر | غائب | متأخر | معتذر | إجازة | منصرف مبكراً
  shift_count INTEGER DEFAULT 1,
  late_minutes INTEGER DEFAULT 0,
  early_leave INTEGER DEFAULT 0,
  overtime_minutes INTEGER DEFAULT 0,
  note TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(staff_id, date)
);

/* أسعار الموظف (راتب شهري أو بنظام الحصة/الشيفت) */
CREATE TABLE IF NOT EXISTS staff_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academy_id INTEGER DEFAULT 1,
  staff_id INTEGER REFERENCES staff(id),
  pay_system TEXT DEFAULT 'monthly',         -- monthly | shift
  monthly_salary REAL DEFAULT 0,
  work_days_count INTEGER DEFAULT 0,
  work_hours INTEGER DEFAULT 0,
  day_value REAL DEFAULT 0,
  hourly_value REAL DEFAULT 0,
  overtime_hour_value REAL DEFAULT 0,
  shift_value REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

/* الخصومات والإضافات (نوع واحد يغطي الاثنين) */
CREATE TABLE IF NOT EXISTS salary_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academy_id INTEGER DEFAULT 1,
  person_type TEXT,                          -- trainer | staff
  coach_id INTEGER REFERENCES coaches(id),
  staff_id INTEGER REFERENCES staff(id),
  adj_type TEXT DEFAULT 'deduction',         -- deduction | bonus
  adj_category TEXT,                         -- غياب | تأخير | إداري | جزاء | سلفة | bonus | حافز | بدل | عمل إضافي ...
  date TEXT,
  amount REAL DEFAULT 0,
  reason TEXT,
  notes TEXT,
  added_by INTEGER,
  period TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

/* كشف المستحقات لكل شخص وفترة */
CREATE TABLE IF NOT EXISTS payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academy_id INTEGER DEFAULT 1,
  person_type TEXT,                          -- trainer | staff
  coach_id INTEGER REFERENCES coaches(id),
  staff_id INTEGER REFERENCES staff(id),
  period TEXT,                               -- 2026-08 (الشهر)
  gross REAL DEFAULT 0,                      -- إجمالي الحصص/الراتب الأساسي
  extras REAL DEFAULT 0,                     -- الإضافات والحوافز
  deductions REAL DEFAULT 0,                 -- الخصومات
  net REAL DEFAULT 0,                        -- صافي المستحق
  paid_amount REAL DEFAULT 0,
  remaining REAL DEFAULT 0,
  status TEXT DEFAULT 'مستحق',               -- مستحق | مدفوع جزئياً | مسدد
  branch_id INTEGER,
  approved INTEGER DEFAULT 0,                -- اعتماد الكشف
  approved_by INTEGER,
  approved_at TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT,
  UNIQUE(person_type, coach_id, staff_id, period)
);

/* مدفوعات المستحقات */
CREATE TABLE IF NOT EXISTS payroll_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academy_id INTEGER DEFAULT 1,
  payroll_id INTEGER REFERENCES payroll(id),
  amount REAL DEFAULT 0,
  paid_date TEXT,
  method TEXT DEFAULT 'نقدي',                -- نقدي | Vodafone Cash | InstaPay | تحويل بنكي | أخرى
  note TEXT,
  created_by INTEGER,
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

-- ================================================================
--  بنية تعدد الأكاديميات (Multi-Tenant) — لا تُحذف البيانات أبداً
-- ================================================================

-- خطط الاشتراك (Database-Driven)
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,                            -- basic | professional | premium
  name TEXT NOT NULL,
  monthly_price REAL DEFAULT 0,
  max_students INTEGER DEFAULT -1,             -- -1 = غير محدود
  max_teachers INTEGER DEFAULT -1,
  max_employees INTEGER DEFAULT -1,
  max_users INTEGER DEFAULT -1,
  max_branches INTEGER DEFAULT 1,
  storage_limit INTEGER DEFAULT 0,             -- بالميجابايت
  features TEXT DEFAULT '[]',                  -- ["attendance","financial_reports",...]
  status TEXT DEFAULT 'active',                -- active | inactive
  is_system INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- الأكاديميات (المستأجرون)
CREATE TABLE IF NOT EXISTS academies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,                            -- كود مختصر للربط
  name TEXT NOT NULL,
  owner_name TEXT,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  logo TEXT,
  username TEXT,                               -- حساب مدير الأكاديمية (ACADEMY_ADMIN)
  plan_id INTEGER REFERENCES plans(id),
  status TEXT DEFAULT 'active',                -- active | suspended | expired
  premium INTEGER DEFAULT 0,                   -- 1 للأكاديمية الأساسية غير الخاضعة لقيود
  settings TEXT DEFAULT '{}',                  -- JSON: vodafone_cash, payment_instructions ...
  onboarding TEXT DEFAULT '{}',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

-- اشتراكات الأكاديميات (جداول الخطط/الاشتراكات لمنصة الأكاديميات)
CREATE TABLE IF NOT EXISTS academy_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academy_id INTEGER REFERENCES academies(id),
  plan_id INTEGER REFERENCES plans(id),
  price REAL DEFAULT 0,
  start_date TEXT,
  expiry_date TEXT,
  grace_period_end TEXT,
  status TEXT DEFAULT 'ACTIVE',                -- ACTIVE | EXPIRING_SOON | PENDING_PAYMENT | EXPIRED | SUSPENDED
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT
);

-- طلبات الدفع (Vodafone Cash وغيرها)
CREATE TABLE IF NOT EXISTS payment_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academy_id INTEGER REFERENCES academies(id),
  subscription_id INTEGER REFERENCES subscriptions(id),
  plan_id INTEGER REFERENCES plans(id),
  academy_admin_id INTEGER,
  amount REAL DEFAULT 0,
  sender_phone TEXT,
  transaction_reference TEXT,
  transfer_date TEXT,
  payment_method TEXT DEFAULT 'VODAFONE_CASH',
  screenshot TEXT,                              -- اسم/معرف صورة التحويل
  notes TEXT,
  status TEXT DEFAULT 'PENDING',               -- PENDING | APPROVED | REJECTED
  reviewed_by INTEGER,
  reviewed_at TEXT,
  rejection_reason TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- سجل مدفوعات الاشتراكات (دائم لا يُستبدل)
CREATE TABLE IF NOT EXISTS payments_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academy_id INTEGER REFERENCES academies(id),
  academy_name TEXT,
  plan_id INTEGER,
  plan_name TEXT,
  amount REAL DEFAULT 0,
  payment_method TEXT DEFAULT 'VODAFONE_CASH',
  sender_phone TEXT,
  transaction_reference TEXT,
  payment_date TEXT,
  approved_by INTEGER,
  approved_by_name TEXT,
  approved_at TEXT,
  subscription_period TEXT,                    -- "01-01-2026 إلى 01-02-2026"
  status TEXT DEFAULT 'APPROVED',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

-- سجل رسائل الواتساب (تذكير تجديد الاشتراك)
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER REFERENCES subscriptions(id),
  swimmer_id INTEGER,
  swimmer_name TEXT,
  guardian_name TEXT,
  phone TEXT,
  message TEXT,
  mode TEXT DEFAULT 'link',                  -- api | link
  status TEXT DEFAULT 'sent',                -- sent | failed | opened
  trigger TEXT DEFAULT 'manual',             -- manual | auto
  error TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
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

/* ---------- تهيئة بنية تعدد الأكاديميات (غير مدمرة) ---------- */
async function seedMultiTenant() {
  /* الخطط الافتراضية (Database-Driven) */
  try {
    const insP = db.prepare('INSERT OR IGNORE INTO plans (code, name, monthly_price, max_students, max_teachers, max_employees, max_users, max_branches, storage_limit, features, is_system) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const P = {
      basic: ['BASIC', 150, 50, 4, 4, 10, 1, 200, JSON.stringify(['attendance', 'exports']), 0],
      professional: ['PROFESSIONAL', 350, 200, 10, 10, 30, 3, 1000, JSON.stringify(['attendance', 'financial_reports', 'exports', 'whatsapp', 'advanced_permissions']), 0],
      premium: ['PREMIUM', 600, -1, -1, -1, -1, -1, 5000, JSON.stringify(['attendance', 'financial_reports', 'advanced_reports', 'multiple_branches', 'exports', 'custom_branding', 'advanced_permissions', 'whatsapp']), 1]
    };
    await insP.run('basic', ...P.basic);
    await insP.run('professional', ...P.professional);
    await insP.run('premium', ...P.premium);
  } catch (e) { console.error('تهيئة الخطط:', e.message); }

  /* الأكاديمية الأساسية (PRIMARY ACADEMY) — premium بلا قيود */
  try {
    const row = await db.prepare('SELECT * FROM academies WHERE id = 1').get();
    if (!row) {
      const settings = {};
      ((await db.prepare('SELECT key, value FROM settings').all()) || []).forEach(s => { settings[s.key] = s.value; });
      const premiumPlan = (await db.prepare("SELECT id FROM plans WHERE code = 'premium' LIMIT 1").get() || {}).id;
      await db.prepare(
        `INSERT INTO academies (id, code, name, owner_name, phone, whatsapp, email, address, logo, plan_id, status, premium)
         VALUES (1, 'primary', ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1)`)
        .run(settings.site_name || 'الأكاديمية الأساسية', settings.site_slogan || '', settings.phone || '', settings.whatsapp || '', settings.email || '', settings.address || '', '', premiumPlan || null);
    }
  } catch (e) { console.error('تهيئة الأكاديمية الأساسية:', e.message); }

  /* اشتراك أساسي دائم للأكاديمية الأساسية */
  try {
    const has = await db.prepare('SELECT COUNT(*) c FROM academy_subscriptions WHERE academy_id = 1').get();
    if (!has.c) {
      const planId = (await db.prepare("SELECT id FROM plans WHERE code = 'premium' LIMIT 1").get() || {}).id;
      const start = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 365 * 25 * 86400000).toISOString().slice(0, 10);
      await db.prepare(`INSERT INTO academy_subscriptions (academy_id, plan_id, price, start_date, expiry_date, status) VALUES (1, ?, 0, ?, ?, 'ACTIVE')`).run(planId || null, start, end);
    }
  } catch (e) { console.error('اشتراك الأكاديمية الأساسية:', e.message); }

  /* ربط المستخدمين الحاليين بالأكاديمية الأساسية (في حال لم يرتبطوا) */
  try {
    await db.prepare("UPDATE users SET academy_id = 1 WHERE academy_id IS NULL OR academy_id <= 0").run();
  } catch (e) { /* تجاهل */ }
}

/* ---------- إصلاح ذاتي لصلاحيات الأدوار النظامية ----------
   يضمن أن الأدوار الأساسية (is_system) بصلاحياتها المخصصة حتى لو تلفت
   من عمليات تهيئة قديمة. لا يمس الأدوار المخصصة التي أُنشئت يدوياً. */
async function repairSystemRoles() {
  const MODS = ['dashboard','swimmers','guardians','coaches','staff','programs','levels','groups','sessions','attendance','assessments','tests','teams','competitions','subscriptions','payments','revenues','expenses','coachPayments','incoming','outgoing','documents','notifications','complaints','reports','branches','pools','users','settings','auditLog','site','trainerAttendance','staffAttendance','payroll'];
  const all = (v = 1) => { const p = {}; MODS.forEach(m => p[m] = { view: v, add: v, edit: v, del: v, export: v }); return p; };
  const read = () => { const p = {}; MODS.forEach(m => p[m] = { view: 0, add: 0, edit: 0, del: 0, export: 0 }); return p; };
  const none = () => { const p = {}; MODS.forEach(m => p[m] = { view: 0, add: 0, edit: 0, del: 0, export: 0 }); return p; };

  const defs = {
    'مدير النظام': all(),
    'مدير الأكاديمية': Object.assign(all(), {
      users: { view: 0, add: 0, edit: 0, del: 0, export: 0 },
      settings: { view: 1, add: 1, edit: 1, del: 1, export: 0 },
      auditLog: { view: 1, add: 0, edit: 0, del: 0, export: 0 }
    }),
    'موظف الاستقبال': (function(){ const p = all(); ['users','settings','auditLog','revenues','expenses','coachPayments','incoming','outgoing','teams','competitions','payroll'].forEach(m => p[m] = { view:0,add:0,edit:0,del:0,export:0 }); return p; })(),
    'المسؤول المالي': (function(){ const p = all(); ['users','settings','auditLog','sessions','attendance','assessments','tests','teams'].forEach(m => p[m] = { view:0,add:0,edit:0,del:0,export:0 }); p.trainerAttendance = { view:1,add:0,edit:0,del:0,export:1 }; p.staffAttendance = { view:1,add:0,edit:0,del:0,export:1 }; p.payroll = { view:1,add:1,edit:1,del:0,export:1 }; return p; })(),
    'موظف الموارد البشرية': (function(){ const p = read(); ['dashboard','coaches','staff','trainerAttendance','staffAttendance','payroll','notifications','documents'].forEach(m => p[m] = { view:1,add:1,edit:1,del:1,export:1 }); p.sessions = { view:1,add:0,edit:0,del:0,export:0 }; p.payments = { view:1,add:0,edit:0,del:0,export:0 }; return p; })(),
    'الكابتن أو المدرب': (function(){ const p = read(); ['dashboard','sessions','attendance','assessments','tests','teams','swimmers','notifications','documents'].forEach(m => p[m] = { view:1,add:1,edit:1,del:0,export:0 }); p.subscriptions = { view:1,add:0,edit:0,del:0,export:0 }; return p; })(),
    'مسؤول الفرق': (function(){ const p = read(); ['dashboard','teams','competitions','swimmers','sessions','attendance','assessments','tests','notifications'].forEach(m => p[m] = { view:1,add:1,edit:1,del:1,export:0 }); return p; })(),
    'مسؤول الإنقاذ والسلامة': (function(){ const p = read(); ['dashboard','programs','groups','sessions','attendance','swimmers','tests','documents','notifications','assessments'].forEach(m => p[m] = { view:1,add:1,edit:1,del:0,export:0 }); return p; })(),
    'ولي الأمر': none(),
    'السباح أو اللاعب': none()
  };

  try {
    const roles = await db.all('SELECT id, name, is_system FROM roles');
    for (const r of roles) {
      const def = defs[r.name];
      if (def && r.is_system === 1) {
        await db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(JSON.stringify(def), r.id);
      }
    }
  } catch (e) { console.error('إصلاح الأدوار:', e.message); }
}

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

/* بذر البيانات الأساسية لأكاديمية واحدة عند إنشائها:
   مستويات المنهج + معايير كل مستوى، معزولة بـ academy_id حتى لا تشارك
   الأكاديميات الأخرى في نفس الصفوف. */
async function seedAcademyBaseline(academyId) {
  const ai = Number(academyId);
  if (!isFinite(ai) || ai <= 0) return;
  const names = [...CURRICULUM_LEVELS, 'فريق أكاديمية', 'فريق بطولات'];
  try {
    const existing = await db.all('SELECT id, name FROM levels WHERE academy_id = ? ORDER BY order_no', ai);
    if (existing.length) return; // سبق بذر هذه الأكاديمية
    const insL = db.prepare('INSERT INTO levels (name, order_no, academy_id) VALUES (?,?,?)');
    const inserted = [];
    for (let i = 0; i < names.length; i++) {
      const r = await insL.run(names[i], i + 1, ai);
      inserted.push({ id: r.lastInsertRowid, idx: i });
    }
    const insC = db.prepare('INSERT INTO assessment_criteria (name, category, program_type, order_no, level_id, academy_id) VALUES (?,?,?,?,?,?)');
    for (const { id, idx } of inserted) {
      const criteria = CURRICULUM[idx] || [];
      for (let i = 0; i < criteria.length; i++) await insC.run(criteria[i], names[idx], 'all', i + 1, id, ai);
    }
    console.log('تم بذر بيانات الأكاديمية #' + ai + ' (' + names.length + ' مستوى)');
  } catch (e) { console.error('خطأ في بذر بيانات الأكاديمية #' + ai + ':', e.message); }
}

module.exports = { db, client, ready, DB_PATH: DB_URL, seedAcademyBaseline };