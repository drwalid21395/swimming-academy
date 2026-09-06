/** حجوزات الموقع: متابعة طلبات حجز الأماكن القادمة من الموقع التعريفي */
const express = require('express');
const { db } = require('../lib/db');
const { audit, fmtDateTime, canView, canDel, canExport } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const router = express.Router();

const RESERVE_STATUS = ['جديدة', 'تم التواصل', 'تم الحجز', 'تم التحويل لسباح', 'ملغي'];

function statusBadge(st) {
  const map = {
    'جديدة': ['badge-primary', 'fa-circle'],
    'تم التواصل': ['badge-info', 'fa-phone'],
    'تم الحجز': ['badge-success', 'fa-check'],
    'تم التحويل لسباح': ['badge-purple', 'fa-person-swimming'],
    'ملغي': ['badge-danger', 'fa-ban']
  };
  const m = map[st] || ['badge-gray', 'fa-circle'];
  return `<span class="badge ${m[0]}"><i class="fas ${m[1]}"></i> ${st}</span>`;
}

router.get('/reservations', async function (req, res) {
  if (!canView(req.currentUser, 'reservations')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const status = String(req.query.status || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  let where = 'WHERE 1=1';
  const args = [];
  if (status) { where += ' AND r.status = ?'; args.push(status); }
  if (from) { where += ' AND date(r.created_at) >= ?'; args.push(from); }
  if (to) { where += ' AND date(r.created_at) <= ?'; args.push(to); }

  const rows = await db.prepare(`SELECT r.* FROM reservations r ${where} ORDER BY r.created_at DESC, r.id DESC`).all(...args);

  const page = {
    title: 'حجوزات الموقع',
    subtitle: 'طلبات حجز الأماكن القادمة من الموقع — تُظهر تفاصيل كل طلب بالكامل',
    icon: 'fa-calendar-check', module: 'reservations', active: 'reservations',
    rows, status, from, to, statuses: RESERVE_STATUS, today: new Date().toISOString().slice(0, 10)
  };
  res.render('reservations', { page, fmtDateTime });
});

router.post('/reservations/:id/status', async function (req, res) {
  if (!canView(req.currentUser, 'reservations')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const st = String(req.body.status || '');
  if (!RESERVE_STATUS.includes(st)) { setFlash(res, { type: 'error', message: 'حالة غير صالحة' }); return res.redirect('/reservations'); }
  await db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(st, id);
  audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'reservations', id, 'تحديث حالة الحجز إلى: ' + st, req);
  setFlash(res, { type: 'success', message: 'تم تحديث حالة الحجز إلى: ' + st });
  res.redirect('/reservations');
});

router.post('/reservations/:id/delete', async function (req, res) {
  if (!canDel(req.currentUser, 'reservations')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  await db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
  audit(req.currentUser.id, req.currentUser.full_name, 'delete', 'reservations', id, 'حذف حجز', req);
  setFlash(res, { type: 'success', message: 'تم حذف الحجز' });
  res.redirect('/reservations');
});

/* ===== تصدير إكسيل: أسماء الحاجزين بالتاريخ وتوقيت الحجز وجميع البيانات ===== */
router.get('/reports/reservations.xls', async function (req, res) {
  if (!canExport(req.currentUser, 'reservations')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const status = String(req.query.status || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  let where = 'WHERE 1=1';
  const args = [];
  if (status) { where += ' AND r.status = ?'; args.push(status); }
  if (from) { where += ' AND date(r.created_at) >= ?'; args.push(from); }
  if (to) { where += ' AND date(r.created_at) <= ?'; args.push(to); }
  const rows = await db.prepare(`SELECT r.* FROM reservations r ${where} ORDER BY r.created_at DESC, r.id DESC`).all(...args);

  const cell = (v) => {
    if (v === null || v === undefined || v === '') return '—';
    return String(v).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, ' ');
  };
  const body = rows.map((r, i) => {
    const dt = r.created_at || '';
    const d = dt.slice(0, 10);
    const t = dt.slice(11, 16);
    return '<tr>'
      + '<td>' + (i + 1) + '</td>'
      + '<td class="b">' + cell(r.swimmer_name) + '</td>'
      + '<td>' + cell(r.program_name) + '</td>'
      + '<td>' + cell(r.birth_date) + '</td>'
      + '<td>' + (r.age !== null && r.age !== undefined ? r.age : '—') + '</td>'
      + '<td>' + cell(r.gender) + '</td>'
      + '<td>' + cell(r.phone) + '</td>'
      + '<td>' + cell(r.whatsapp) + '</td>'
      + '<td>' + cell(r.initial_level) + '</td>'
      + '<td>' + cell(r.guardian_phone) + '</td>'
      + '<td>' + cell(r.swimmer_number) + '</td>'
      + '<td class="big">' + cell(r.notes) + '</td>'
      + '<td>' + (d || '—') + '</td>'
      + '<td>' + (t || '—') + '</td>'
      + '<td>' + cell(r.status) + '</td>'
      + '</tr>';
  }).join('');

  const html = `\uFEFF<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">
    <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>الحجوزات</x:Name><x:WorksheetOptions><x:DisplayRightToLeft/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
    <style>
      table { border-collapse: collapse; table-layout: fixed; }
      td, th { border: 1px solid #999; padding: 4px 7px; font-size: 12px; vertical-align: top; font-family: Tahoma, Arial, sans-serif; }
      th { background: #e8eef7; font-weight: 700; }
      td.b { font-weight: 700; }
      td.big { white-space: normal; word-wrap: break-word; }
    </style></head><body dir="rtl"><table dir="rtl" style="width:1100px">
      <thead><tr>
        <th>م</th><th>اسم السباح</th><th>البرنامج</th><th>تاريخ الميلاد</th><th>السن</th><th>النوع</th>
        <th>الهاتف</th><th>الواتساب</th><th>المستوى المبدئي</th><th>رقم ولي الأمر</th><th>رقم السباح</th>
        <th>الملاحظات</th><th>تاريخ الحجز</th><th>وقت الحجز</th><th>الحالة</th>
      </tr></thead><tbody>${body}</tbody></table></body></html>`;
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', "attachment; filename=\"reservations.xls\"; filename*=UTF-8''" + encodeURIComponent('حجوزات-الموقع.xls'));
  res.send(html);
});

module.exports = router;