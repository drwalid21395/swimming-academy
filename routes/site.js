/** الموقع التعريفي العام — لكل أكاديمية موقع خاص بلونها وبياناتها */
const express = require('express');
const { db } = require('../lib/db');
const { fmtDate, money, dayAr, today, calcAge } = require('../lib/helpers');
const { withAcademy } = require('../lib/tenant-context');
const router = express.Router();

const DEFAULT_COLOR = '#0284c7';

/* عزل الأكاديمية: نمرر كل استعلام في هذا السياق ليتقيد بـ academy_id */
async function resolveAcademy(code) {
  const c = (code && String(code).trim()) || 'primary';
  let acad = await db.prepare('SELECT * FROM academies WHERE code = ? LIMIT 1').get(c);
  if (!acad && c !== 'primary') {
    acad = await db.prepare("SELECT * FROM academies WHERE code = 'primary' LIMIT 1").get();
  }
  return acad;
}

async function siteData(acad, base) {
  const global = {};
  try { (await db.prepare('SELECT * FROM settings').all()).forEach(r => { global[r.key] = r.value; }); } catch (e) { }
  let homeImages = [];
  try { homeImages = JSON.parse(global.home_images || '[]'); } catch (e) { homeImages = []; }
  const acadSet = {};
  try { Object.assign(acadSet, JSON.parse(acad.settings || '{}')); } catch (e) { }
  return {
    base,
    siteName: acadSet.site_name || acad.name || global.site_name || 'أكاديمية السباحة',
    slogan: acadSet.site_slogan || global.site_slogan || 'التعليم الأفضل لرياضة السباحة',
    logo: acad.logo || global.site_logo || '',
    homeImages,
    phone: acad.phone || global.phone || '',
    whatsapp: acad.whatsapp || global.whatsapp || '',
    email: acad.email || global.email || '',
    address: acad.address || global.address || '',
    work_hours: acadSet.work_hours || global.work_hours || '',
    about: acadSet.about || global.about || '',
    facebook: acadSet.facebook || global.facebook || '',
    instagram: acadSet.instagram || global.instagram || '',
    tiktok: acadSet.tiktok || global.tiktok || '',
    map_url: acadSet.map_url || global.map_url || '',
    safety_notes: acadSet.safety_notes || global.safety_notes || '',
    primaryColor: acadSet.primary_color || global.platform_primary_color || DEFAULT_COLOR
  };
}

/* المواعيد (الحصص) القادمة — تعكس التعديلات تلقائياً لأنها تُقرأ من قاعدة البيانات (معزولة) */
async function upcomingSchedule(limit) {
  limit = limit || 6;
  return db.prepare(`
    SELECT s.id, s.title, s.date, s.start_time, s.end_time,
           g.name AS group_name, c.full_name AS coach_name, p.name AS pool_name, p.branch_name
    FROM sessions s
    LEFT JOIN groups g ON g.id = s.group_id
    LEFT JOIN coaches c ON c.id = s.coach_id
    LEFT JOIN (SELECT po.id, po.name, b.name AS branch_name FROM pools po LEFT JOIN branches b ON b.id=po.branch_id) p ON p.id = s.pool_id
    WHERE s.status = 'scheduled' AND s.deleted_at IS NULL AND s.date >= ?
    ORDER BY s.date, s.start_time LIMIT ${Number(limit) || 6}
  `).all(today());
}

async function newsFeed(limit) {
  limit = limit || 50;
  return db.prepare('SELECT * FROM announcements WHERE is_public = 1 ORDER BY id DESC LIMIT ' + (Number(limit) || 50)).all();
}

/* رندر صفحة كاملة داخل سياق الأكاديمية */
async function renderPage(req, res, acad, base, page, params) {
  params = params || {};
  await withAcademy(acad.id, async () => {
    const data = await siteData(acad, base);
    if (page === 'home') {
      const programs = await db.prepare("SELECT * FROM programs WHERE deleted_at IS NULL AND status NOT IN ('متوقف','منتهي') ORDER BY id LIMIT 6").all();
      const announcements = await newsFeed(3);
      const coaches = await db.prepare("SELECT * FROM coaches WHERE deleted_at IS NULL AND status='active' ORDER BY id LIMIT 4").all();
      const pools = await db.prepare('SELECT p.*, b.name AS branch_name FROM pools p LEFT JOIN branches b ON b.id = p.branch_id').all();
      const upcoming = await upcomingSchedule(6);
      return res.render('site/index', { data, programs, announcements, coaches, pools, upcoming, money, fmtDate, layout: false });
    }
    if (page === 'news') {
      const news = await newsFeed(100);
      const upcoming = await upcomingSchedule(50);
      return res.render('site/news', { data, news, upcoming, homeImages: data.homeImages, fmtDate, layout: false });
    }
    if (page === 'programs') {
      const programs = await db.prepare("SELECT * FROM programs WHERE deleted_at IS NULL AND status NOT IN ('متوقف','منتهي') ORDER BY id").all();
      return res.render('site/programs', { data, programs, money, layout: false });
    }
    if (page === 'program') {
      const p = await db.prepare('SELECT * FROM programs WHERE id = ?').get(Number(params.id));
      if (!p) return res.redirect((base || '/site') + '/programs');
      return res.render('site/program', { data, p, money, layout: false });
    }
    if (page === 'coaches') {
      const coaches = await db.prepare("SELECT * FROM coaches WHERE deleted_at IS NULL AND status='active' ORDER BY id").all();
      return res.render('site/coaches', { data, coaches, fmtDate, layout: false });
    }
    if (page === 'announcements') {
      const announcements = await db.prepare('SELECT * FROM announcements WHERE is_public = 1 ORDER BY id DESC').all();
      return res.render('site/announcements', { data, announcements, fmtDate, layout: false });
    }
    if (page === 'contact') {
      return res.render('site/contact', { data, message: params.message || '', layout: false });
    }
    if (page === 'reserve') {
      const programs = await db.prepare("SELECT * FROM programs WHERE deleted_at IS NULL AND status NOT IN ('متوقف','منتهي') ORDER BY id").all();
      const levels = await db.prepare('SELECT * FROM levels ORDER BY order_no, id').all();
      return res.render('site/reserve', { data, programs, levels, money, message: params.message || '', values: params.values || {}, layout: false });
    }
    return res.redirect(base);
  });
}

/* ===== الموقع الأساسي (الدخول الافتراضي للمنصة) ===== */
router.get('/', async function (req, res) {
  const acad = await resolveAcademy('primary');
  const base = '/site';
  if (!acad) return res.redirect('/login');
  return renderPage(req, res, acad, base, 'home');
});
router.get('/reserve', async function (req, res) {
  const acad = await resolveAcademy('primary');
  const base = '/site';
  if (!acad) return res.redirect('/login');
  return renderPage(req, res, acad, base, 'reserve');
});
router.get('/news', async function (req, res) {
  const acad = await resolveAcademy('primary');
  return renderPage(req, res, acad, '/site', 'news');
});
router.get('/programs', async function (req, res) {
  const acad = await resolveAcademy('primary');
  return renderPage(req, res, acad, '/site', 'programs');
});
router.get('/programs/:id', async function (req, res) {
  const acad = await resolveAcademy('primary');
  return renderPage(req, res, acad, '/site', 'program', { id: req.params.id });
});
router.get('/coaches', async function (req, res) {
  const acad = await resolveAcademy('primary');
  return renderPage(req, res, acad, '/site', 'coaches');
});
router.get('/announcements', async function (req, res) {
  const acad = await resolveAcademy('primary');
  return renderPage(req, res, acad, '/site', 'announcements');
});
router.get('/contact', async function (req, res) {
  const acad = await resolveAcademy('primary');
  return renderPage(req, res, acad, '/site', 'contact');
});
router.post('/contact', async function (req, res) {
  const acad = await resolveAcademy('primary');
  const b = req.body;
  await withAcademy(acad.id, async () => {
    if (b.name && b.message) {
      await db.prepare('INSERT INTO messages (from_user_id, to_user_id, subject, body) VALUES (?,?,?,?)').run(null, 1, 'رسالة من الموقع: ' + (b.name || ''), (b.phone || '') + ' | ' + (b.email || '') + ' | ' + b.message);
    }
  });
  return renderPage(req, res, acad, '/site', 'contact', { message: 'تم إرسال رسالتك بنجاح، سنتواصل معك قريباً.' });
});

/* ===== حجز مكان بالأكاديمية (نموذج عام لكل أكاديمية) ===== */
async function submitReserve(req, res, acad, base) {
  const b = req.body;
  const values = {
    program_id: b.program_id || '', swimmer_name: String(b.swimmer_name || '').trim(),
    birth_date: b.birth_date || '', gender: b.gender || 'ذكر',
    phone: String(b.phone || '').trim(), whatsapp: String(b.whatsapp || '').trim(),
    initial_level: String(b.initial_level || '').trim(), guardian_phone: String(b.guardian_phone || '').trim(),
    swimmer_number: String(b.swimmer_number || '').trim(), notes: String(b.notes || '').trim()
  };
  if (!values.swimmer_name) {
    return renderPage(req, res, acad, base, 'reserve', { message: 'يرجى إدخال اسم السباح لحجز مكانه', values });
  }
  await withAcademy(acad.id, async () => {
    const prog = await db.prepare('SELECT name FROM programs WHERE id = ? AND deleted_at IS NULL').get(Number(b.program_id) || 0);
    const programName = (prog && prog.name) || (b.program_name ? String(b.program_name).trim() : '');
    const age = calcAge(values.birth_date);
    const info = await db.prepare(`INSERT INTO reservations
      (program_id, program_name, swimmer_name, birth_date, age, gender, phone, whatsapp, initial_level, guardian_phone, swimmer_number, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(Number(b.program_id) || null, programName, values.swimmer_name, values.birth_date || null, age,
        values.gender, values.phone || null, values.whatsapp || null, values.initial_level || null,
        values.guardian_phone || null, values.swimmer_number || null, values.notes || null);

    const detail = [
      'البرنامج: ' + (programName || '—'),
      'الاسم: ' + values.swimmer_name,
      values.birth_date ? 'تاريخ الميلاد: ' + values.birth_date : '',
      age !== null ? 'السن: ' + age : '',
      'الهاتف: ' + (values.phone || '—'),
      'واتساب: ' + (values.whatsapp || '—'),
      'المستوى المبدئي: ' + (values.initial_level || '—'),
      'رقم ولي الأمر: ' + (values.guardian_phone || '—'),
      'رقم السباح: ' + (values.swimmer_number || '—'),
      values.notes ? 'ملاحظات: ' + values.notes : ''
    ].filter(Boolean).join(' | ');

    const notif = await db.prepare(`INSERT INTO notifications (title, message, type, link, is_broadcast, created_by)
      VALUES (?,?,?,?,?,?)`)
      .run('حجز مكان جديد في ' + acad.name, detail, 'حجوزات', '/reservations', 1, 0);

    try {
      const recipients = await db.prepare("SELECT id FROM users WHERE status='active'").all();
      const insR = db.prepare('INSERT INTO notification_recipients (notification_id, user_id) VALUES (?,?)');
      for (const u of recipients) await insR.run(notif.lastInsertRowid, u.id);
    } catch (e) { /* الإشعار يعرض حتى لو تعذر إسناد مستلمين */ }
  });
  return renderPage(req, res, acad, base, 'reserve', { message: 'تم استلام حجز ' + values.swimmer_name + ' بنجاح، سنتواصل معكم قريباً لتأكيد المقعد.' });
}

router.post('/reserve', async function (req, res) {
  const acad = await resolveAcademy('primary');
  const base = '/site';
  if (!acad) return res.redirect('/login');
  return submitReserve(req, res, acad, base);
});

/* ===== موقع أكاديمية محددة بالنمط /site/:code/... ===== */
router.get('/:code', async function (req, res) {
  const acad = await resolveAcademy(req.params.code);
  if (!acad) return res.redirect('/site');
  const base = '/site/' + acad.code;
  return renderPage(req, res, acad, base, 'home');
});
router.get('/:code/reserve', async function (req, res) {
  const acad = await resolveAcademy(req.params.code);
  if (!acad) return res.redirect('/site');
  return renderPage(req, res, acad, '/site/' + acad.code, 'reserve');
});
router.get('/:code/news', async function (req, res) {
  const acad = await resolveAcademy(req.params.code);
  if (!acad) return res.redirect('/site');
  return renderPage(req, res, acad, '/site/' + acad.code, 'news');
});
router.get('/:code/programs', async function (req, res) {
  const acad = await resolveAcademy(req.params.code);
  if (!acad) return res.redirect('/site');
  return renderPage(req, res, acad, '/site/' + acad.code, 'programs');
});
router.get('/:code/programs/:id', async function (req, res) {
  const acad = await resolveAcademy(req.params.code);
  if (!acad) return res.redirect('/site');
  return renderPage(req, res, acad, '/site/' + acad.code, 'program', { id: req.params.id });
});
router.get('/:code/coaches', async function (req, res) {
  const acad = await resolveAcademy(req.params.code);
  if (!acad) return res.redirect('/site');
  return renderPage(req, res, acad, '/site/' + acad.code, 'coaches');
});
router.get('/:code/announcements', async function (req, res) {
  const acad = await resolveAcademy(req.params.code);
  if (!acad) return res.redirect('/site');
  return renderPage(req, res, acad, '/site/' + acad.code, 'announcements');
});
router.get('/:code/contact', async function (req, res) {
  const acad = await resolveAcademy(req.params.code);
  if (!acad) return res.redirect('/site');
  return renderPage(req, res, acad, '/site/' + acad.code, 'contact');
});
router.post('/:code/contact', async function (req, res) {
  const acad = await resolveAcademy(req.params.code);
  if (!acad) return res.redirect('/site');
  const b = req.body;
  await withAcademy(acad.id, async () => {
    if (b.name && b.message) {
      await db.prepare('INSERT INTO messages (from_user_id, to_user_id, subject, body) VALUES (?,?,?,?)').run(null, 1, 'رسالة من الموقع: ' + (b.name || ''), (b.phone || '') + ' | ' + (b.email || '') + ' | ' + b.message);
    }
  });
  return renderPage(req, res, acad, '/site/' + acad.code, 'contact', { message: 'تم إرسال رسالتك بنجاح، سنتواصل معك قريباً.' });
});
router.post('/:code/reserve', async function (req, res) {
  const acad = await resolveAcademy(req.params.code);
  if (!acad) return res.redirect('/site');
  return submitReserve(req, res, acad, '/site/' + acad.code);
});

module.exports = router;
