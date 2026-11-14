/**
 * بطاقات العضوية:
 * - إنشاء بطاقة من اسم السباح وتاريخ الميلاد والبرنامج (تُنشئ سجل لاعب إن لم يكن موجوداً)
 * - عرض البطاقة وتحميلها PDF أو صورة PNG (الصورة تُولَّد من SVG في المتصفح)
 * - مسح الباركود بالكاميرا لتسجيل الحضور/الغياب مع منع التحضير المكرر
 * - الصلاحيات عبر وحدة membershipCards (view/add/edit/del/export)
 */
const express = require('express');
const router = express.Router();
const { db } = require('../lib/db');
const { audit, canView, canAdd, canEdit, canExport, today } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const { nextMembership, isUniqueViolation } = require('../lib/membership');
const { effectiveSport, activeSport, sportClause, groupClause } = require('../lib/sport-context');
const { ensureGroupSession, findGroupSession, groupRoster, sessionRoster, sessionGroupIds, attendanceStatuses, seedAbsentForSession, syncGroupMembers, groupStartTime } = require('../lib/attendance');
const { cardSvg, cardPdfDoc, cardsPdfDoc, barcodePng, normalizeBarcode, isoDate } = require('../lib/membership-card');
const { buildZip } = require('../lib/zip');
const { buildCardMessage, waLinkFor, logMessage, sendCardImageViaApi } = require('../lib/whatsapp');
const pdfmake = require('../lib/pdf');

function academyName(res) {
  const acad = res && res.locals && res.locals.academy;
  return (acad && acad.name) || (res && res.locals && res.locals.siteName) || 'أكاديمية السباحة';
}

function nowTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

async function allProgramOptions(sid) {
  let rows = await db.prepare('SELECT id, name, sport_id FROM programs WHERE deleted_at IS NULL' + sportClause(sid, 'programs') + ' ORDER BY name').all();
  if (!rows.length) rows = await db.prepare('SELECT id, name, sport_id FROM programs WHERE deleted_at IS NULL ORDER BY name').all();
  return rows.map(p => ({ value: p.id, label: p.name }));
}

const CARD_SELECT = `SELECT s.*, p.name AS program_name, p.sport_id AS program_sport_id,
    g.name AS group_name, c.full_name AS coach_name, l.name AS level_name,
    gu.full_name AS guardian_name,
    COALESCE(NULLIF(TRIM(gu.whatsapp), ''), NULLIF(TRIM(gu.phone), ''), NULLIF(TRIM(s.phone), '')) AS guardian_phone,
    (SELECT sub.end_date FROM subscriptions sub WHERE sub.swimmer_id = s.id
      ORDER BY (sub.status = 'نشط') DESC, sub.id DESC LIMIT 1) AS subscription_end
  FROM swimmers s
  LEFT JOIN programs p ON p.id = s.program_id
  LEFT JOIN groups g ON g.id = s.group_id
  LEFT JOIN coaches c ON c.id = s.coach_id
  LEFT JOIN levels l ON l.id = s.level_id
  LEFT JOIN guardians gu ON gu.id = s.guardian_id`;

async function loadCard(id) {
  return db.prepare(CARD_SELECT + ' WHERE s.id = ? AND s.deleted_at IS NULL').get(Number(id));
}

/* ============================================================== */
/*                        قائمة البطاقات                          */
/* ============================================================== */
router.get('/membership-cards', async function (req, res) {
  if (!canView(req.currentUser, 'membershipCards')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const q = String(req.query.q || '').trim();
  let sql = `SELECT s.id, s.membership_no, s.full_name, s.birth_date, s.avatar, s.status,
      p.name AS program_name, g.name AS group_name,
      COALESCE(NULLIF(TRIM(gu.whatsapp), ''), NULLIF(TRIM(gu.phone), ''), NULLIF(TRIM(s.phone), '')) AS guardian_phone
    FROM swimmers s
    LEFT JOIN programs p ON p.id = s.program_id
    LEFT JOIN groups g ON g.id = s.group_id
    LEFT JOIN guardians gu ON gu.id = s.guardian_id
    WHERE s.deleted_at IS NULL`;
  const params = [];
  if (q) {
    sql += ' AND (s.full_name LIKE ? OR s.membership_no LIKE ?)';
    params.push('%' + q + '%', '%' + q + '%');
  }
  sql += ' ORDER BY s.full_name LIMIT 500';
  const rows = await db.prepare(sql).all(...params);
  const stats = await db.prepare(`SELECT
      SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent
    FROM attendance a JOIN sessions s ON s.id = a.session_id
    WHERE s.date = ? AND s.deleted_at IS NULL`).get(today());
  res.render('membership_cards', {
    title: 'بطاقات العضوية', active: 'membershipCards', rows, q,
    canCreate: canAdd(req.currentUser, 'membershipCards'),
    canDownload: canExport(req.currentUser, 'membershipCards'),
    stats: stats || { present: 0, absent: 0 },
    todayDate: today()
  });
});

/* ============================================================== */
/*                 تحميل جميع البطاقات في ملف PDF                 */
/* ============================================================== */
router.get('/membership-cards/all.pdf', async function (req, res) {
  if (!canExport(req.currentUser, 'membershipCards')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const q = String(req.query.q || '').trim();
  let sql = CARD_SELECT + ' WHERE s.deleted_at IS NULL';
  const params = [];
  if (q) {
    sql += ' AND (s.full_name LIKE ? OR s.membership_no LIKE ?)';
    params.push('%' + q + '%', '%' + q + '%');
  }
  sql += ' ORDER BY s.full_name LIMIT 500';
  const cards = await db.prepare(sql).all(...params);
  const doc = cardsPdfDoc(cards, { academyName: academyName(res) });
  pdfmake.createPdf(doc).getBuffer().then(function (buf) {
    const name = 'membership-cards' + (q ? '-search' : '') + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
    res.send(buf);
  }).catch(function (e) {
    console.error('خطأ في توليد PDF لكل البطاقات:', e.message);
    res.status(500).send('تعذر توليد ملف البطاقات: ' + e.message);
  });
});

/* ============================================================== */
/*            تحميل جميع البطاقات في ملف ZIP (صور SVG)            */
/* ============================================================== */
router.get('/membership-cards/all.zip', async function (req, res) {
  if (!canExport(req.currentUser, 'membershipCards')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const q = String(req.query.q || '').trim();
  let sql = CARD_SELECT + ' WHERE s.deleted_at IS NULL';
  const params = [];
  if (q) {
    sql += ' AND (s.full_name LIKE ? OR s.membership_no LIKE ?)';
    params.push('%' + q + '%', '%' + q + '%');
  }
  sql += ' ORDER BY s.full_name LIMIT 500';
  try {
    const cards = await db.prepare(sql).all(...params);
    const files = cards.map(function (card) {
      const safeNo = String(card.membership_no || card.id).replace(/[^\w\-]/g, '') || ('id-' + card.id);
      return { name: safeNo + '.svg', data: Buffer.from(cardSvg(card, { academyName: academyName(res) })) };
    });
    const zip = buildZip(files);
    const name = 'membership-cards' + (q ? '-search' : '') + '.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
    res.send(zip);
  } catch (e) {
    console.error('خطأ في توليد ZIP لكل البطاقات:', e.message);
    res.status(500).send('تعذر توليد ملف البطاقات المضغوط: ' + e.message);
  }
});

/* ============================================================== */
/*                        إنشاء بطاقة جديدة                       */
/* ============================================================== */
router.get('/membership-cards/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'membershipCards')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  res.render('membership_card_form', {
    title: 'بطاقة عضوية جديدة', active: 'membershipCards', mode: 'new',
    action: '/membership-cards/new', submitLabel: 'إنشاء البطاقة',
    programs: await allProgramOptions(activeSport(req)), values: {}, error: ''
  });
});

router.post('/membership-cards/new', async function (req, res) {
  if (!canAdd(req.currentUser, 'membershipCards')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const b = req.body || {};
  const fullName = String(b.full_name || '').trim();
  const birthDate = isoDate(b.birth_date);
  const programId = Number(b.program_id) || 0;
  const phone = String(b.phone || '').trim();
  const gender = b.gender === 'أنثى' ? 'أنثى' : 'ذكر';
  const values = { full_name: fullName, birth_date: birthDate, program_id: programId || '', phone: phone, gender: gender };
  const programs = await allProgramOptions(activeSport(req));

  const fail = async function (message) {
    return res.status(400).render('membership_card_form', {
      title: 'بطاقة عضوية جديدة', active: 'membershipCards', mode: 'new',
      action: '/membership-cards/new', submitLabel: 'إنشاء البطاقة',
      programs, values, error: message
    });
  };
  if (!fullName) return fail('يرجى إدخال اسم السباح');
  if (!birthDate) return fail('يرجى إدخال تاريخ الميلاد');
  if (!programId) return fail('يرجى اختيار البرنامج');
  const program = await db.prepare('SELECT id, sport_id FROM programs WHERE id = ? AND deleted_at IS NULL').get(programId);
  if (!program) return fail('البرنامج المختار غير موجود');

  /* نفس الاسم وتاريخ الميلاد = نفس السباح: نعرض بطاقته بدلاً من تكرار السجل */
  const existing = await db.prepare('SELECT id FROM swimmers WHERE full_name = ? AND COALESCE(birth_date, \'\') = ? AND deleted_at IS NULL ORDER BY id LIMIT 1')
    .get(fullName, birthDate);
  if (existing) {
    setFlash(res, { type: 'info', message: 'يوجد سباح بهذا الاسم وتاريخ الميلاد بالفعل — تم فتح بطاقته.' });
    return res.redirect('/membership-cards/' + existing.id);
  }

  const sportId = Number(program.sport_id) || effectiveSport(req) || null;
  let created = null;
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const membershipNo = await nextMembership();
    try {
      const info = await db.prepare(`INSERT INTO swimmers
        (membership_no, full_name, birth_date, gender, phone, program_id, sport_id, status, registration_date)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(membershipNo, fullName, birthDate, gender, phone || null, programId, sportId, 'نشط', today());
      created = { id: info.lastInsertRowid, membership_no: membershipNo };
      break;
    } catch (e) {
      lastError = e;
      if (!isUniqueViolation(e)) break;
    }
  }
  if (!created) {
    console.error('تعذر إنشاء بطاقة العضوية:', lastError && lastError.message);
    return fail('تعذر إنشاء البطاقة، يرجى المحاولة مرة أخرى');
  }
  audit(req.currentUser.id, req.currentUser.full_name, 'add', 'membershipCards', created.id, 'إنشاء بطاقة عضوية: ' + fullName + ' (' + created.membership_no + ')', req);
  setFlash(res, { type: 'success', message: 'تم إنشاء بطاقة العضوية بنجاح' });
  return res.redirect('/membership-cards/' + created.id);
});

/* ============================================================== */
/*                        تعديل بيانات البطاقة                    */
/* ============================================================== */
router.get('/membership-cards/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'membershipCards')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const card = await loadCard(req.params.id);
  if (!card) return res.redirect('/membership-cards');
  res.render('membership_card_form', {
    title: 'تعديل بطاقة العضوية', active: 'membershipCards', mode: 'edit', card,
    action: '/membership-cards/' + card.id + '/edit', submitLabel: 'حفظ التعديلات',
    programs: await allProgramOptions(activeSport(req)),
    values: { full_name: card.full_name, birth_date: isoDate(card.birth_date), program_id: card.program_id || '', phone: card.phone || '', gender: card.gender || 'ذكر' },
    error: ''
  });
});

router.post('/membership-cards/:id/edit', async function (req, res) {
  if (!canEdit(req.currentUser, 'membershipCards')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const card = await loadCard(req.params.id);
  if (!card) return res.redirect('/membership-cards');
  const b = req.body || {};
  const fullName = String(b.full_name || '').trim();
  const birthDate = isoDate(b.birth_date);
  const programId = Number(b.program_id) || 0;
  const phone = String(b.phone || '').trim();
  const gender = b.gender === 'أنثى' ? 'أنثى' : 'ذكر';
  const values = { full_name: fullName, birth_date: birthDate, program_id: programId || '', phone: phone, gender: gender };
  const programs = await allProgramOptions(activeSport(req));
  const fail = async function (message) {
    return res.status(400).render('membership_card_form', {
      title: 'تعديل بطاقة العضوية', active: 'membershipCards', mode: 'edit', card,
      action: '/membership-cards/' + card.id + '/edit', submitLabel: 'حفظ التعديلات',
      programs, values, error: message
    });
  };
  if (!fullName) return fail('يرجى إدخال اسم السباح');
  if (!birthDate) return fail('يرجى إدخال تاريخ الميلاد');
  if (!programId) return fail('يرجى اختيار البرنامج');
  const program = await db.prepare('SELECT id, sport_id FROM programs WHERE id = ? AND deleted_at IS NULL').get(programId);
  if (!program) return fail('البرنامج المختار غير موجود');
  const sportId = Number(program.sport_id) || card.sport_id || null;
  await db.prepare('UPDATE swimmers SET full_name=?, birth_date=?, gender=?, phone=?, program_id=?, sport_id=? WHERE id=?')
    .run(fullName, birthDate, gender, phone || null, programId, sportId, card.id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'membershipCards', card.id, 'تعديل بطاقة عضوية: ' + fullName, req);
  setFlash(res, { type: 'success', message: 'تم حفظ التعديلات' });
  res.redirect('/membership-cards/' + card.id);
});

/* ============================================================== */
/*                        عرض البطاقة والتحميل                    */
/* ============================================================== */
router.get('/membership-cards/:id(\\d+)', async function (req, res) {
  if (!canView(req.currentUser, 'membershipCards')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const card = await loadCard(req.params.id);
  if (!card) return res.redirect('/membership-cards');
  const svg = cardSvg(card, { academyName: academyName(res) });
  res.render('membership_card', {
    title: 'بطاقة عضوية — ' + card.full_name, active: 'membershipCards', card, svg,
    canEditCard: canEdit(req.currentUser, 'membershipCards'),
    canDownload: canExport(req.currentUser, 'membershipCards')
  });
});

router.get('/membership-cards/:id/card.svg', async function (req, res) {
  if (!canView(req.currentUser, 'membershipCards')) return res.status(403).send('غير مصرح');
  const card = await loadCard(req.params.id);
  if (!card) return res.status(404).send('البطاقة غير موجودة');
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  if (req.query.dl === '1') {
    res.setHeader('Content-Disposition', 'attachment; filename="membership-' + String(card.membership_no || card.id).replace(/[^\w\-]/g, '') + '.svg"');
  }
  res.send(cardSvg(card, { academyName: academyName(res) }));
});

router.get('/membership-cards/:id/barcode.png', async function (req, res) {
  if (!canView(req.currentUser, 'membershipCards')) return res.status(403).send('غير مصرح');
  const card = await loadCard(req.params.id);
  if (!card) return res.status(404).send('البطاقة غير موجودة');
  const png = barcodePng(card.membership_no, { scale: 4, height: 140, quiet: 10 });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.send(png);
});

async function sendCardPdf(req, res) {
  if (!canExport(req.currentUser, 'membershipCards')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const card = await loadCard(req.params.id);
  if (!card) return res.redirect('/membership-cards');
  const doc = cardPdfDoc(card, { academyName: academyName(res) });
  pdfmake.createPdf(doc).getBuffer().then(function (buf) {
    const safe = String(card.membership_no || card.id).replace(/[^\w\-]/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="membership-' + safe + '.pdf"');
    res.send(buf);
  }).catch(function (e) {
    console.error('خطأ في توليد PDF للبطاقة:', e.message);
    res.status(500).send('تعذر توليد PDF: ' + e.message);
  });
}
router.get('/membership-cards/:id(\\d+).pdf', sendCardPdf);
router.get('/membership-cards/:id(\\d+)/pdf', sendCardPdf);

/* ============================================================== */
/*              إرسال صورة بطاقة العضوية عبر واتساب               */
/* ============================================================== */
async function cardWhatsAppPayload(id, req) {
  const card = await loadCard(id);
  if (!card) return null;
  const phone = String(card.guardian_phone || '').trim();
  const acad = academyName(resLocals(req));
  const text = buildCardMessage({
    academyName: acad, guardianName: card.guardian_name || '', swimmerName: card.full_name,
    membershipNo: card.membership_no, programName: card.program_name || '', groupName: card.group_name || '',
    birthDate: isoDate(card.birth_date) || ''
  });
  const st = await db.prepare('SELECT key, value FROM settings').all();
  const sm = {}; st.forEach(r => { sm[r.key] = r.value; });
  const apiConfigured = !!(String(sm.whatsapp_api_token || '').trim() && String(sm.whatsapp_phone_id || '').trim());
  return { card, phone, text, waUrl: phone ? waLinkFor(phone, text, req.get('user-agent')) : '', apiConfigured, sm };
}

function resLocals(req) {
  return req.res && req.res.locals ? req.res.locals : {};
}

function dataUrlToBuffer(dataUrl) {
  const m = String(dataUrl).match(/^data:image\/png;base64,(.*)$/i);
  return m ? Buffer.from(m[1], 'base64') : null;
}

router.get('/membership-cards/:id(\\d+)/whatsapp', async function (req, res) {
  if (!canView(req.currentUser, 'membershipCards')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const pay = await cardWhatsAppPayload(req.params.id, req);
  if (!pay) return res.redirect('/membership-cards');
  res.render('membership_card_whatsapp', {
    title: 'إرسال بطاقة العضوية — ' + pay.card.full_name, active: 'membershipCards',
    card: pay.card, svg: cardSvg(pay.card, { academyName: academyName(res) }),
    phone: pay.phone, text: pay.text, waUrl: pay.waUrl, from: String(req.query.from || ''),
    apiConfigured: pay.apiConfigured, canDownload: canExport(req.currentUser, 'membershipCards')
  });
});

/* إرسال الصورة تلقائياً عبر WhatsApp Cloud API؛ إذا لم يكن API مفعلاً يُرجع رابط fallback */
router.post('/membership-cards/:id(\\d+)/whatsapp/send', async function (req, res) {
  if (!canView(req.currentUser, 'membershipCards')) return res.status(403).json({ ok: false });
  const pay = await cardWhatsAppPayload(req.params.id, req);
  if (!pay) return res.status(404).json({ ok: false });
  if (!pay.phone) return res.status(400).json({ ok: false, error: 'no_phone', message: 'لا يوجد رقم واتساب مسجل' });
  const token = String(pay.sm.whatsapp_api_token || '').trim();
  const phoneId = String(pay.sm.whatsapp_phone_id || '').trim();
  const countryCode = String(pay.sm.whatsapp_country_code || '').trim() || '20';
  const imageBuf = dataUrlToBuffer(req.body && req.body.image);
  if (!imageBuf) return res.status(400).json({ ok: false, error: 'no_image', message: 'لم يتم إرسال صورة البطاقة' });

  if (!token || !phoneId) {
    return res.json({ ok: false, mode: 'link', waUrl: pay.waUrl, error: 'api_not_configured' });
  }

  const r = await sendCardImageViaApi({ phone: pay.phone, imageBuffer: imageBuf, caption: pay.text, token, phoneId, countryCode });
  if (r.ok) {
    await logMessage({
      swimmer_id: pay.card.id, swimmer_name: pay.card.full_name, guardian_name: pay.card.guardian_name || '',
      phone: pay.phone, message: pay.text, mode: 'api', status: 'sent', trigger: 'membership_card', created_by: req.currentUser.id
    });
    audit(req.currentUser.id, req.currentUser.full_name, 'send', 'membershipCards', pay.card.id, 'إرسال صورة بطاقة العضوية عبر واتساب API: ' + pay.card.full_name, req);
    return res.json({ ok: true, mode: 'api' });
  }

  await logMessage({
    swimmer_id: pay.card.id, swimmer_name: pay.card.full_name, guardian_name: pay.card.guardian_name || '',
    phone: pay.phone, message: pay.text, mode: 'api', status: 'failed', trigger: 'membership_card', error: r.error || '', created_by: req.currentUser.id
  });
  return res.json({ ok: false, mode: 'link', waUrl: pay.waUrl, error: r.error });
});

/* تسجيل/تحديث رقم ولي أمر لاعب مباشرة من شاشة البطاقة */
router.post('/membership-cards/:id(\\d+)/guardian-phone', async function (req, res) {
  const allowed = canEdit(req.currentUser, 'swimmers') || canEdit(req.currentUser, 'membershipCards') ||
    canAdd(req.currentUser, 'membershipCards');
  if (!allowed) return res.status(403).json({ ok: false, message: 'غير مصرح' });
  const card = await loadCard(req.params.id);
  if (!card) return res.status(404).json({ ok: false, message: 'البطاقة غير موجودة' });
  const raw = String((req.body && req.body.phone) || '').trim();
  const phone = raw.replace(/\D/g, '');
  if (!phone || phone.length < 7) return res.status(400).json({ ok: false, message: 'رقم الهاتف غير صالح' });
  try {
    let guardianId = Number(card.guardian_id) || 0;
    if (guardianId) {
      await db.prepare('UPDATE guardians SET phone = ?, whatsapp = ? WHERE id = ?').run(raw, raw, guardianId);
    } else {
      const info = await db.prepare('INSERT INTO guardians (full_name, relation, phone, whatsapp) VALUES (?,?,?,?)')
        .run(card.full_name + ' - ولي الأمر', 'أب', raw, raw);
      guardianId = Number(info.lastInsertRowid);
      await db.prepare('UPDATE swimmers SET guardian_id = ? WHERE id = ?').run(guardianId, card.id);
    }
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'membershipCards', card.id, 'تحديث رقم ولي الأمر: ' + card.full_name + ' (' + raw + ')', req);
    return res.json({ ok: true, phone: raw, guardian_id: guardianId });
  } catch (e) {
    console.error('خطأ في تحديث رقم ولي الأمر:', e.message);
    return res.status(500).json({ ok: false, message: 'تعذر حفظ الرقم' });
  }
});

/* ============================================================== */
/*                    مسح الباركود وتسجيل الحضور                  */
/* ============================================================== */
async function recentScans(date) {
  return db.prepare(`SELECT sc.*, s.full_name, s.program_id, p.name AS program_name
    FROM membership_card_scans sc
    LEFT JOIN swimmers s ON s.id = sc.swimmer_id
    LEFT JOIN programs p ON p.id = s.program_id
    WHERE sc.scan_date = ?
    ORDER BY sc.id DESC LIMIT 12`).all(date);
}

router.get('/attendance/scan', async function (req, res) {
  const canViewAttendance = canView(req.currentUser, 'attendance') || canView(req.currentUser, 'membershipCards');
  if (!canViewAttendance) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const canSave = canEdit(req.currentUser, 'attendance') || canAdd(req.currentUser, 'attendance') ||
    canEdit(req.currentUser, 'membershipCards') || canAdd(req.currentUser, 'membershipCards');
  let d = String(req.query.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = today();
  const sessionId = Number(req.query.session) || 0;
  const groups = [];

  if (sessionId) {
    /* مسح داخل حصة محددة (حصة قديمة/مختارة من الجدول) */
    const session = await db.prepare(`SELECT se.*, c.full_name AS coach_name, p.name AS pool_name
      FROM sessions se LEFT JOIN coaches c ON c.id = se.coach_id LEFT JOIN pools p ON p.id = se.pool_id
      WHERE se.id = ? AND se.deleted_at IS NULL`).get(sessionId);
    if (!session) return res.redirect('/attendance');
    d = String(session.date || d).slice(0, 10);
    const groupIds = await sessionGroupIds(session.id);
    const groupNames = groupIds.length
      ? (await db.prepare(`SELECT name FROM groups WHERE id IN (${groupIds.map(() => '?').join(',')}) ORDER BY name`).all(...groupIds)).map(g => g.name)
      : [];
    const members = await sessionRoster(session.id);
    const attMap = {};
    members.forEach(m => { if (m.att_status) attMap[m.id] = m.att_status; });
    groups.push({
      id: session.group_id || (groupIds[0] || 0),
      name: groupNames.join('، ') || session.title || 'حصة',
      coach_name: session.coach_name,
      pool_name: session.pool_name,
      session: session,
      session_id: session.id,
      members: members,
      attMap: attMap,
      single: true
    });
  } else {
    /* كل المجموعات: أسماء اللاعبين تظهر تلقائياً والحصة تُنشأ تلقائياً لحضور اليوم */
    const groupRows = await db.prepare(`SELECT g.*, c.full_name AS coach_name, p.name AS pool_name FROM groups g
      LEFT JOIN coaches c ON c.id = g.coach_id LEFT JOIN pools p ON p.id = g.pool_id
      WHERE g.deleted_at IS NULL` + groupClause(activeSport(req)) + ` ORDER BY g.name`).all();
    for (const g of groupRows) {
      await syncGroupMembers(g.id);
      let session = await findGroupSession(g.id, d);
      if (!session && d === today() && canSave) session = await ensureGroupSession(g, d, req.currentUser.id);
      const members = await groupRoster(g.id, true);
      const attMap = session ? await attendanceStatuses(session.id) : {};
      groups.push({ ...g, session: session, session_id: session ? session.id : null, members: members, attMap: attMap });
    }
  }

  const stats = await db.prepare(`SELECT
      SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent
    FROM attendance a JOIN sessions s ON s.id = a.session_id
    WHERE s.date = ? AND s.deleted_at IS NULL`).get(d);

  res.render('membership_card_scan', {
    title: sessionId ? 'مسح وتعديل حضور الحصة' : 'مسح الباركود — الحضور والغياب', active: 'attendance',
    canScan: canSave,
    groups: groups,
    sessionId: sessionId || 0,
    attDate: d,
    stats: stats || { present: 0, absent: 0 },
    recent: await recentScans(d), todayDate: d,
    pageScripts: ['/vendor/zxing.min.js']
  });
});

/* الرابط القديم يحوّل تلقائياً إلى الحضور */
router.get('/membership-cards/scan', function (req, res) {
  res.redirect('/attendance/scan');
});

/* بقية مسارات بطاقات العضوية ... */

function attendanceCounts(status) {
  return status === 'present' || status === 'late';
}

/* نسخة من منطق خصم الحصة من الاشتراك المستخدم في شاشة الحضور */
async function syncSubscriptionUsage(swimmerId, groupId, beforeStatus, afterStatus) {
  const before = attendanceCounts(beforeStatus);
  const after = attendanceCounts(afterStatus);
  if (before === after) return;
  const delta = after ? 1 : -1;
  const gid = Number(groupId) || 0;
  const sub = await db.prepare(`SELECT sub.id FROM subscriptions sub
    LEFT JOIN groups g ON g.id = ?
    WHERE sub.swimmer_id = ? AND sub.status = 'نشط'
      AND (sub.group_id = ? OR (sub.group_id IS NULL AND sub.program_id = g.program_id))
    ORDER BY
      CASE WHEN sub.group_id = ? THEN 0 ELSE 1 END,
      CASE WHEN sub.sessions_total > sub.sessions_used THEN 0 ELSE 1 END,
      sub.id DESC
    LIMIT 1`).get(gid, Number(swimmerId), gid, gid);
  if (!sub) return;
  await db.prepare(`UPDATE subscriptions SET sessions_used = MIN(sessions_total, MAX(0, sessions_used + ?)) WHERE id = ?`)
    .run(delta, sub.id);
  await db.prepare(`UPDATE subscriptions SET status = 'منتهي'
    WHERE id = ? AND status = 'نشط' AND sessions_total > 0 AND sessions_used >= sessions_total`).run(sub.id);
  await db.prepare(`UPDATE subscriptions SET status = 'نشط'
    WHERE id = ? AND status = 'منتهي' AND (end_date IS NULL OR date(end_date) >= date(?))
      AND (sessions_total = 0 OR sessions_used < sessions_total)`).run(sub.id, today());
}

async function findSwimmerByCode(code) {
  const clean = normalizeBarcode(code);
  if (!clean) return null;
  let swimmer = await db.prepare(CARD_SELECT + ' WHERE UPPER(s.membership_no) = ? AND s.deleted_at IS NULL').get(clean);
  /* مطابقة احتياطية: الباركود يحذف الرموز غير المدعومة في Code 39،
     فنقارن الأرقام والحروف فقط حتى لو كان رقم العضوية المخزّن يحتوي شرطة/مسافة/رمزاً */
  if (!swimmer) {
    const compact = clean.replace(/[^0-9A-Z]/g, '');
    if (compact) {
      const rows = await db.prepare(CARD_SELECT + ' WHERE s.deleted_at IS NULL').all();
      swimmer = rows.find(function (r) {
        return String(r.membership_no || '').toUpperCase().replace(/[^0-9A-Z]/g, '') === compact;
      }) || null;
    }
  }
  if (!swimmer && /^\d+$/.test(clean)) {
    swimmer = await db.prepare(CARD_SELECT + ' WHERE s.id = ? AND s.deleted_at IS NULL').get(Number(clean));
  }
  return swimmer || null;
}

/* جلسة اليوم الخاصة باللاعب (تُنشأ تلقائياً عند أول مسح) */
async function findOrCreateSession(swimmer, date, req) {
  let groupId = Number(swimmer.group_id) || 0;
  if (!groupId) {
    const row = await db.prepare('SELECT group_id FROM swimmer_group WHERE swimmer_id = ? ORDER BY group_id LIMIT 1').get(swimmer.id);
    if (row) groupId = Number(row.group_id) || 0;
  }
  let session = null;
  if (groupId) {
    session = await db.prepare(`SELECT id FROM sessions
      WHERE date = ? AND deleted_at IS NULL
        AND (group_id = ? OR EXISTS (SELECT 1 FROM session_groups sg WHERE sg.session_id = sessions.id AND sg.group_id = ?))
      ORDER BY start_time LIMIT 1`).get(date, groupId, groupId);
  }
  if (!session) {
    session = await db.prepare(`SELECT s.id FROM sessions s
      JOIN attendance a ON a.session_id = s.id
      WHERE s.date = ? AND s.deleted_at IS NULL AND a.swimmer_id = ?
      ORDER BY s.start_time LIMIT 1`).get(date, swimmer.id);
  }
  if (!session) {
    const start = groupStartTime(groupId ? await db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId) : null) || nowTime();
    const info = await db.prepare(`INSERT INTO sessions
      (group_id, title, date, start_time, end_time, coach_id, pool_id, status, is_compensatory, note, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(groupId || null, 'حضور الباركود - ' + date, date, start, null, swimmer.coach_id || null, null,
        'scheduled', 0, 'أُنشئت تلقائياً من مسح بطاقة العضوية', req.currentUser.id);
    session = { id: info.lastInsertRowid };
    if (groupId) await db.prepare('INSERT OR IGNORE INTO session_groups (session_id, group_id) VALUES (?,?)').run(session.id, groupId);
  }
  return { sessionId: Number(session.id), groupId: groupId };
}

/* المجموعة المناسبة للاعب داخل حصة معيّنة (لخصم الاشتراك) */
async function groupForSwimmerInSession(sessionId, swimmerId) {
  const row = await db.prepare(`SELECT sg.group_id FROM session_groups sg
    JOIN swimmer_group wg ON wg.group_id = sg.group_id
    WHERE sg.session_id = ? AND wg.swimmer_id = ? ORDER BY sg.group_id LIMIT 1`).get(sessionId, swimmerId);
  if (row) return row.group_id;
  const s = await db.prepare('SELECT group_id FROM sessions WHERE id = ?').get(sessionId);
  return s && s.group_id;
}

router.post('/membership-cards/scan', async function (req, res) {
  const allowed = canEdit(req.currentUser, 'attendance') || canAdd(req.currentUser, 'attendance') ||
    canEdit(req.currentUser, 'membershipCards') || canAdd(req.currentUser, 'membershipCards');
  if (!allowed) return res.status(403).json({ ok: false, status: 'forbidden', message: 'غير مصرح بتسجيل الحضور' });
  const mode = req.body && req.body.mode === 'absent' ? 'absent' : 'present';
  const rawCode = req.body && req.body.code;
  const code = normalizeBarcode(rawCode);
  let d = today();
  const time = nowTime();
  if (!code) return res.status(400).json({ ok: false, status: 'invalid', message: 'باركود غير صالح' });

  try {
    const swimmer = await findSwimmerByCode(code);
    if (!swimmer) {
      return res.json({ ok: false, status: 'not_found', message: 'بطاقة غير معروفة — تأكد من الباركود أو رقم العضوية', code: code });
    }
    const base = {
      id: swimmer.id, name: swimmer.full_name, membership_no: swimmer.membership_no,
      program_name: swimmer.program_name || '', birth_date: isoDate(swimmer.birth_date),
      membership_no_display: swimmer.membership_no
    };

    /* حصة محددة (تعديل حصة قديمة) أو حصة اليوم تلقائياً */
    let sessionId = Number(req.body && req.body.session_id) || 0;
    let targetSession = null;
    if (sessionId) {
      targetSession = await db.prepare('SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL').get(sessionId);
      if (!targetSession) return res.status(400).json({ ok: false, status: 'invalid_session', message: 'الحصة غير موجودة' });
      d = String(targetSession.date || d).slice(0, 10);
    }

    let groupId;
    if (targetSession) {
      groupId = await groupForSwimmerInSession(sessionId, swimmer.id);
    } else {
      const found = await findOrCreateSession(swimmer, d, req);
      sessionId = found.sessionId;
      groupId = found.groupId;
      targetSession = await db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    }

    const current = await db.prepare('SELECT status FROM attendance WHERE session_id = ? AND swimmer_id = ?').get(sessionId, swimmer.id);
    const statuses = await attendanceStatuses(sessionId);
    const stat = await db.prepare(`SELECT
        SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent
      FROM attendance a JOIN sessions s ON s.id = a.session_id
      WHERE s.date = ? AND s.deleted_at IS NULL`).get(d);
    const stats = { present: Number(stat && stat.present) || 0, absent: Number(stat && stat.absent) || 0 };

    if (mode === 'present' && current && (current.status === 'present' || current.status === 'late')) {
      await db.prepare(`INSERT INTO membership_card_scans
        (swimmer_id, membership_no, mode, result, scan_date, scan_time, created_by)
        VALUES (?,?,?,?,?,?,?)`)
        .run(swimmer.id, swimmer.membership_no, 'present', 'duplicate', d, time, req.currentUser.id);
      return res.json({
        ok: false, status: 'duplicate', message: 'مسجّل حاضر بالفعل في هذه الحصة',
        swimmer: base, time: time, session_id: sessionId, statuses: statuses, stats: stats
      });
    }
    if (mode === 'absent' && current && current.status === 'absent') {
      await db.prepare(`INSERT INTO membership_card_scans
        (swimmer_id, membership_no, mode, result, scan_date, scan_time, created_by)
        VALUES (?,?,?,?,?,?,?)`)
        .run(swimmer.id, swimmer.membership_no, 'absent', 'duplicate', d, time, req.currentUser.id);
      return res.json({
        ok: false, status: 'duplicate', message: 'مسجّل غائب بالفعل في هذه الحصة',
        swimmer: base, time: time, session_id: sessionId, statuses: statuses, stats: stats
      });
    }

    /* عند المسح: تسجيل باقي اللاعبين غياباً تلقائياً (لا يغيّر أي حالة محفوظة مسبقاً) */
    await seedAbsentForSession(sessionId, swimmer.id);

    const previous = await db.prepare('SELECT status FROM attendance WHERE session_id = ? AND swimmer_id = ?').get(sessionId, swimmer.id);
    const nextStatus = mode === 'absent' ? 'absent' : 'present';
    await db.prepare(`INSERT INTO attendance (session_id, swimmer_id, status, reason, coach_note) VALUES (?,?,?,?,?)
      ON CONFLICT(session_id, swimmer_id) DO UPDATE SET status=excluded.status, reason=excluded.reason, coach_note=excluded.coach_note`)
      .run(sessionId, swimmer.id, nextStatus, '', 'تسجيل عبر مسح بطاقة العضوية');
    try { await syncSubscriptionUsage(swimmer.id, groupId, previous && previous.status, nextStatus); } catch (e) { /* لا نُفشل المسح بسبب الاشتراك */ }
    await db.prepare(`INSERT INTO membership_card_scans
      (swimmer_id, membership_no, mode, result, scan_date, scan_time, created_by)
      VALUES (?,?,?,?,?,?,?)`)
      .run(swimmer.id, swimmer.membership_no, mode, nextStatus, d, time, req.currentUser.id);
    audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'membershipCards', swimmer.id,
      (mode === 'absent' ? 'تسجيل غياب' : 'تسجيل حضور') + ' بمسح الباركود: ' + swimmer.full_name, req);

    const finalStatuses = await attendanceStatuses(sessionId);
    const stat2 = await db.prepare(`SELECT
        SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent
      FROM attendance a JOIN sessions s ON s.id = a.session_id
      WHERE s.date = ? AND s.deleted_at IS NULL`).get(d);

    return res.json({
      ok: true, status: nextStatus, message: mode === 'absent' ? 'تم تسجيل الغياب' : 'تم تسجيل الحضور',
      swimmer: base, time: time, session_id: sessionId, statuses: finalStatuses,
      stats: { present: Number(stat2 && stat2.present) || 0, absent: Number(stat2 && stat2.absent) || 0 }
    });
  } catch (e) {
    console.error('خطأ في مسح بطاقة العضوية:', e.message);
    return res.status(500).json({ ok: false, status: 'error', message: 'تعذر تسجيل العملية، حاول مرة أخرى' });
  }
});

module.exports = router;
