/* بوابة اللاعب/ولي الأمر: مسح باركود البطاقة لمعرفة البيانات وتنزيلها PDF */
const express = require('express');
const router = express.Router();
const { db } = require('../lib/db');
const { findSwimmerByCode, loadPlayerReport, pdfReportDoc } = require('../lib/player-portal');
const pdfmake = require('../lib/pdf');

function academyName(res) {
  return (res && res.locals && res.locals.academy && res.locals.academy.name) ||
    (res && res.locals && res.locals.siteName) || 'أكاديمية السباحة';
}

router.get('/my-card', async function (req, res) {
  res.render('my_card', {
    title: 'بطاقتي',
    siteName: res.locals.siteName || 'النظام',
    appName: res.locals.appName || 'النظام',
    academyName: academyName(res)
  });
});

router.post('/my-card/lookup', async function (req, res) {
  const code = req.body && req.body.code;
  try {
    const swimmer = await findSwimmerByCode(code);
    if (!swimmer) return res.status(404).json({ ok: false, error: 'not_found', message: 'لا توجد بطاقة بهذا الرقم' });
    const report = await loadPlayerReport(swimmer.id);
    return res.json({ ok: true, swimmer, report });
  } catch (e) {
    console.error('خطأ في بحث البطاقة:', e.message);
    return res.status(500).json({ ok: false, error: 'server', message: 'تعذر قراءة البيانات' });
  }
});

router.get('/my-card/:id/pdf', async function (req, res) {
  try {
    const swimmerId = Number(req.params.id);
    const swimmer = await findSwimmerByCode(swimmerId);
    if (!swimmer) return res.status(404).send('البطاقة غير موجودة');
    const report = await loadPlayerReport(swimmer.id);
    const doc = pdfReportDoc(swimmer, report, { academyName: academyName(res) });
    const buf = await pdfmake.createPdf(doc).getBuffer();
    const safe = String(swimmer.membership_no || swimmer.id).replace(/[^\w\-]/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="report-' + safe + '.pdf"');
    res.send(buf);
  } catch (e) {
    console.error('خطأ في توليد تقرير PDF:', e.message);
    res.status(500).send('تعذر توليد التقرير');
  }
});

module.exports = router;
