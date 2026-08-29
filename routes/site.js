/** الموقع التعريفي العام */
const express = require('express');
const { db } = require('../lib/db');
const { fmtDate, money, dayAr } = require('../lib/helpers');
const router = express.Router();

async function siteData() {
  const s = {};
  try { (await db.prepare('SELECT * FROM settings').all()).forEach(r => { s[r.key] = r.value; }); } catch (e) { }
  return {
    siteName: s.site_name || 'أكاديمية السباحة',
    slogan: s.site_slogan || 'التعليم الأفضل لرياضة السباحة',
    logo: s.site_logo || '',
    phone: s.phone || '', whatsapp: s.whatsapp || '', email: s.email || '', address: s.address || '',
    work_hours: s.work_hours || '', about: s.about || '', facebook: s.facebook || '', instagram: s.instagram || '',
    tiktok: s.tiktok || '', map_url: s.map_url || '', safety_notes: s.safety_notes || ''
  };
}

router.get('/', async function (req, res) {
  const data = await siteData();
  const programs = await db.prepare("SELECT * FROM programs WHERE status IN ('متاح','مكتمل العدد') ORDER BY id LIMIT 6").all();
  const announcements = await db.prepare('SELECT * FROM announcements WHERE is_public = 1 ORDER BY id DESC LIMIT 4').all();
  const coaches = await db.prepare("SELECT * FROM coaches WHERE status='active' ORDER BY id LIMIT 4").all();
  const pools = await db.prepare('SELECT p.*, b.name AS branch_name FROM pools p LEFT JOIN branches b ON b.id = p.branch_id').all();
  res.render('site/index', { data, programs, announcements, coaches, pools, money, fmtDate, layout: false });
});

router.get('/programs', async function (req, res) {
  const data = await siteData();
  const programs = await db.prepare("SELECT * FROM programs WHERE status IN ('متاح','مكتمل العدد') ORDER BY id").all();
  res.render('site/programs', { data, programs, money, layout: false });
});

router.get('/programs/:id', async function (req, res) {
  const data = await siteData();
  const p = await db.prepare('SELECT * FROM programs WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.redirect('/site/programs');
  res.render('site/program', { data, p, money, layout: false });
});

router.get('/coaches', async function (req, res) {
  const data = await siteData();
  const coaches = await db.prepare("SELECT * FROM coaches WHERE status='active' ORDER BY id").all();
  res.render('site/coaches', { data, coaches, fmtDate, layout: false });
});

router.get('/announcements', async function (req, res) {
  const data = await siteData();
  const announcements = await db.prepare('SELECT * FROM announcements WHERE is_public = 1 ORDER BY id DESC').all();
  res.render('site/announcements', { data, announcements, fmtDate, layout: false });
});

router.get('/contact', async function (req, res) {
  const data = await siteData();
  res.render('site/contact', { data, message: '', layout: false });
});
router.post('/contact', async function (req, res) {
  const data = await siteData();
  const b = req.body;
  if (b.name && b.message) {
    await db.prepare('INSERT INTO messages (from_user_id, to_user_id, subject, body) VALUES (?,?,?,?)').run(null, 1, 'رسالة من الموقع: ' + (b.name || ''), (b.phone || '') + ' | ' + (b.email || '') + ' | ' + b.message);
  }
  res.render('site/contact', { data, message: 'تم إرسال رسالتك بنجاح، سنتواصل معك قريباً.', layout: false });
});

module.exports = router;
