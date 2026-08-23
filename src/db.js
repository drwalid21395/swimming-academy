'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'academy.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT, phone TEXT, email TEXT,
  manager_name TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS pools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER REFERENCES branches(id),
  name TEXT NOT NULL, lanes INTEGER, length_m REAL, capacity INTEGER, notes TEXT
);
CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER REFERENCES branches(id),
  name TEXT NOT NULL,
  program_type TEXT NOT NULL,
  description TEXT,
  age_from INTEGER, age_to INTEGER,
  level_required_id INTEGER REFERENCES levels(id),
  sessions_count INTEGER DEFAULT 8,
  session_minutes INTEGER DEFAULT 60,
  weeks INTEGER,
  price REAL DEFAULT 0,
  max_swimmers INTEGER,
  schedule_notes TEXT,
  coach_id INTEGER REFERENCES coaches(id),
  pool_id INTEGER REFERENCES pools(id),
  required_tests TEXT, success_conditions TEXT, certificate TEXT,
  status TEXT DEFAULT 'available',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER REFERENCES branches(id),
  name TEXT NOT NULL, order_index INTEGER DEFAULT 0,
  description TEXT, min_age INTEGER, is_team_level INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS guardians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL, phone TEXT, whatsapp TEXT, email TEXT,
  address TEXT, relation TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS coaches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  full_name TEXT NOT NULL, photo TEXT, phone TEXT, email TEXT, address TEXT,
  qualification TEXT, specialty TEXT, experience_years INTEGER,
  certificates TEXT, hire_date TEXT, contract_type TEXT,
  salary_or_rate REAL DEFAULT 0,
  work_days TEXT, work_hours TEXT,
  programs_eligible TEXT, groups_managed TEXT,
  performance_rating REAL DEFAULT 0,
  license_expiry TEXT, docs TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS swimmers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  membership_no TEXT UNIQUE,
  full_name TEXT NOT NULL, photo TEXT, birth_date TEXT, gender TEXT,
  phone TEXT, address TEXT, school TEXT,
  guardian_id INTEGER REFERENCES guardians(id),
  guardian_relation TEXT, guardian_phone TEXT, guardian_alt_phone TEXT,
  email TEXT,
  emergency_name TEXT, emergency_phone TEXT, emergency_relation TEXT,
  health_status TEXT, allergies TEXT, medical_notes TEXT,
  current_level_id INTEGER REFERENCES levels(id),
  register_date TEXT,
  program_id INTEGER REFERENCES programs(id),
  group_id INTEGER REFERENCES groups(id),
  coach_id INTEGER REFERENCES coaches(id),
  training_days TEXT, training_time TEXT,
  subscription_value REAL DEFAULT 0, payment_status TEXT DEFAULT 'unpaid',
  total_sessions INTEGER DEFAULT 0, done_sessions INTEGER DEFAULT 0,
  remaining_sessions INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER REFERENCES branches(id),
  pool_id INTEGER REFERENCES pools(id),
  coach_id INTEGER REFERENCES coaches(id),
  program_id INTEGER REFERENCES programs(id),
  level_id INTEGER REFERENCES levels(id),
  name TEXT NOT NULL,
  schedule TEXT,
  max_capacity INTEGER DEFAULT 10,
  group_type TEXT DEFAULT 'group',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER REFERENCES groups(id),
  branch_id INTEGER REFERENCES branches(id),
  pool_id INTEGER REFERENCES pools(id),
  coach_id INTEGER REFERENCES coaches(id),
  date TEXT NOT NULL, start_time TEXT, end_time TEXT,
  title TEXT,
  session_type TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'scheduled',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES sessions(id),
  swimmer_id INTEGER REFERENCES swimmers(id),
  status TEXT DEFAULT 'absent',
  reason TEXT, note TEXT,
  deducted_session INTEGER DEFAULT 1,
  recorded_by INTEGER REFERENCES users(id),
  recorded_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS assessment_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_type TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  order_index INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swimmer_id INTEGER REFERENCES swimmers(id),
  coach_id INTEGER REFERENCES coaches(id),
  program_id INTEGER REFERENCES programs(id),
  level_id INTEGER REFERENCES levels(id),
  date TEXT DEFAULT (date('now','localtime')),
  scores TEXT,
  strengths TEXT, weaknesses TEXT, recommendations TEXT,
  ready_to_advance INTEGER DEFAULT 0,
  next_assessment_date TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swimmer_id INTEGER REFERENCES swimmers(id),
  coach_id INTEGER REFERENCES coaches(id),
  name TEXT, date TEXT DEFAULT (date('now','localtime')),
  distance INTEGER, stroke TEXT, time_seconds REAL,
  result TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id),
  age_category TEXT,
  coach_id INTEGER REFERENCES coaches(id),
  training_plan TEXT, schedule_notes TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER REFERENCES teams(id),
  swimmer_id INTEGER REFERENCES swimmers(id),
  join_date TEXT DEFAULT (date('now','localtime')),
  role TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS team_times (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER REFERENCES teams(id),
  swimmer_id INTEGER REFERENCES swimmers(id),
  race_type TEXT, distance INTEGER,
  best_time REAL, previous_time REAL,
  improvement_pct REAL,
  record_date TEXT DEFAULT (date('now','localtime')),
  notes TEXT
);
CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date_from TEXT, date_to TEXT, location TEXT,
  description TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS tournament_participations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER REFERENCES tournaments(id),
  swimmer_id INTEGER REFERENCES swimmers(id),
  team_id INTEGER REFERENCES teams(id),
  race_type TEXT, distance INTEGER,
  result_time REAL, place INTEGER,
  qualifying_time REAL, notes TEXT
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swimmer_id INTEGER REFERENCES swimmers(id),
  program_id INTEGER REFERENCES programs(id),
  group_id INTEGER REFERENCES groups(id),
  start_date TEXT, end_date TEXT,
  sessions_count INTEGER DEFAULT 8,
  price REAL DEFAULT 0, discount REAL DEFAULT 0, tax REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0, remaining_amount REAL DEFAULT 0,
  payment_method TEXT, receipt_no TEXT, pay_date TEXT,
  collected_by INTEGER REFERENCES users(id),
  installments TEXT,
  status TEXT DEFAULT 'active',
  transferred_sessions INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER REFERENCES subscriptions(id),
  swimmer_id INTEGER REFERENCES swimmers(id),
  amount REAL DEFAULT 0, method TEXT, receipt_no TEXT,
  pay_date TEXT DEFAULT (date('now','localtime')),
  collected_by INTEGER REFERENCES users(id),
  status TEXT DEFAULT 'approved', notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS revenues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trans_no TEXT, date TEXT DEFAULT (date('now','localtime')),
  category TEXT, description TEXT,
  amount REAL DEFAULT 0, payment_method TEXT,
  payer TEXT, employee TEXT,
  attachment TEXT, notes TEXT,
  status TEXT DEFAULT 'approved',
  branch_id INTEGER REFERENCES branches(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trans_no TEXT, date TEXT DEFAULT (date('now','localtime')),
  category TEXT, description TEXT,
  amount REAL DEFAULT 0, payment_method TEXT,
  beneficiary TEXT, employee TEXT,
  attachment TEXT, notes TEXT,
  status TEXT DEFAULT 'approved',
  branch_id INTEGER REFERENCES branches(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS coach_dues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coach_id INTEGER REFERENCES coaches(id),
  month TEXT, amount REAL DEFAULT 0,
  incentives REAL DEFAULT 0, deductions REAL DEFAULT 0,
  net_amount REAL DEFAULT 0, paid_amount REAL DEFAULT 0,
  status TEXT DEFAULT 'pending', notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS incoming_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT, receive_date TEXT DEFAULT (date('now','localtime')),
  sender TEXT, subject TEXT, doc_type TEXT,
  receiver TEXT, required_action TEXT,
  followup_by TEXT, due_date TEXT,
  status TEXT DEFAULT 'open',
  attachments TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS outgoing_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no TEXT, send_date TEXT DEFAULT (date('now','localtime')),
  recipient TEXT, subject TEXT, doc_type TEXT,
  responsible TEXT, send_method TEXT,
  delivery_status TEXT DEFAULT 'sent',
  attachments TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT, title TEXT,
  entity_type TEXT, entity_id INTEGER,
  file_name TEXT, file_path TEXT,
  visibility TEXT DEFAULT 'private',
  uploaded_by INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  swimmer_id INTEGER,
  type TEXT, title TEXT, body TEXT,
  is_read INTEGER DEFAULT 0, link TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER REFERENCES users(id),
  receiver_id INTEGER REFERENCES users(id),
  subject TEXT, body TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guardian_id INTEGER REFERENCES guardians(id),
  swimmer_id INTEGER REFERENCES swimmers(id),
  subject TEXT, description TEXT,
  status TEXT DEFAULT 'open',
  response TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, body TEXT,
  date TEXT DEFAULT (date('now','localtime')),
  is_published INTEGER DEFAULT 1, image TEXT
);
CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT, type TEXT DEFAULT 'image', url TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT, answer TEXT, order_index INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, phone TEXT, email TEXT,
  subject TEXT, message TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS subscription_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swimmer_name TEXT, age INTEGER,
  guardian_name TEXT, guardian_phone TEXT,
  program_id INTEGER REFERENCES programs(id),
  message TEXT, status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swimmer_id INTEGER REFERENCES swimmers(id),
  program_id INTEGER REFERENCES programs(id),
  cert_no TEXT, issue_date TEXT DEFAULT (date('now','localtime')),
  status TEXT DEFAULT 'issued', notes TEXT
);
CREATE TABLE IF NOT EXISTS level_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swimmer_id INTEGER REFERENCES swimmers(id),
  from_level_id INTEGER REFERENCES levels(id),
  to_level_id INTEGER REFERENCES levels(id),
  date TEXT DEFAULT (date('now','localtime')),
  reason TEXT, by_user INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  phone TEXT, email TEXT, avatar TEXT,
  branch_id INTEGER REFERENCES branches(id),
  linked_type TEXT, linked_id INTEGER,
  is_active INTEGER DEFAULT 1,
  last_login TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS roles (
  role TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  is_system INTEGER DEFAULT 1,
  permissions TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, username TEXT,
  action TEXT, module TEXT, details TEXT, ip TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

db.exec(SCHEMA);

module.exports = db;
