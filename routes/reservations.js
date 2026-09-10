/** حجوزات الموقع: متابعة طلبات حجز الأماكن القادمة من الموقع التعريفي */
const express = require('express');
const { db } = require('../lib/db');
const { audit, fmtDateTime, today, canView, canDel, canEdit, canExport } = require('../lib/helpers');
const { setFlash } = require('../lib/auth-cookie');
const { nextMembership, isUniqueViolation } = require('../lib/membership');
const { activeSport, progClause } = require('../lib/sport-context');
const router = express.Router();

const RESERVE_STATUS = ['جديدة', 'تم التواصل', 'تم الحجز', 'تم التحويل للاعب', 'ملغي'];

function statusBadge(st) {
  const map = {
    'جديدة': ['badge-primary', 'fa-circle'],
    'تم التواصل': ['badge-info', 'fa-phone'],
    'تم الحجز': ['badge-success', 'fa-check'],
    'تم التحويل للاعب': ['badge-purple', 'fa-person-swimming'],
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

  let where = 'WHERE 1=1' + progClause(activeSport(req), 'r');
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

/* تحويل الحجز إلى لاعب: إنشاء ولي أمر + لاعب وربطهم، ثم تسكين المجموعة من صفحة اللاعب
   يُنفَّذ في معاملة واحدة: أي فشل يلغي كل شيء ولا يترك حجزاً «تم تحويله» بدون لاعب. */
async function convertReservation(req, res, r) {
  if (r.swimmer_id) { setFlash(res, { type: 'error', message: 'تم تحويل الحجز إلى لاعب مسبقاً' }); return res.redirect('/reservations'); }

  /* المستوى المبدئي من الحجز */
  let levelId = r.level_id || null;

  let lastErr;
  for (let attempt = 0; attempt <= 5; attempt++) {
    const membership_no = await nextMembership();
    let tx;
    try {
      tx = await db.transaction();
      if (!levelId && r.initial_level) {
        const lvl = await tx.get('SELECT id FROM levels WHERE name = ?', r.initial_level);
        if (lvl) levelId = lvl.id;
      }

      /* إنشاء ولي الأمر */
      let guardianId = null;
      const gPhone = String(r.guardian_phone || r.phone || '').trim();
      if (gPhone) {
        const g = await tx.run(`INSERT INTO guardians (full_name, phone, whatsapp, relation, notes)
          VALUES (?,?,?,?,?)`,
          String(r.swimmer_name || '') + ' - ولي الأمر', gPhone, String(r.whatsapp || '').trim() || null, 'ولي أمر',
          'حول من حجز رقم ' + r.id + (r.notes ? ': ' + r.notes : ''));
        guardianId = g.lastInsertRowid;
      }

      /* إنشاء اللاعب */
      const sw = await tx.run(`INSERT INTO swimmers (membership_no, full_name, birth_date, gender, phone, guardian_id, level_id, program_id, registration_date, status, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        membership_no, r.swimmer_name, r.birth_date || null, r.gender || 'ذكر', String(r.phone || '').trim() || null,
        guardianId, levelId, r.program_id || null, today(), 'نشط',
        'حول من حجز رقم ' + r.id + (r.notes ? ': ' + r.notes : ''));
      const swimmerId = sw.lastInsertRowid;

      /* ربط الحجز باللاعب وولي الأمر */
      await tx.run(`UPDATE reservations SET status = 'تم التحويل للاعب', swimmer_id = ?, guardian_id = ?, converted_at = datetime('now','localtime') WHERE id = ?`,
        swimmerId, guardianId, r.id);

      await tx.commit();

      audit(req.currentUser.id, req.currentUser.full_name, 'edit', 'reservations', r.id,
        'تحويل الحجز إلى لاعب (' + membership_no + ') وانتظار تسكين المجموعة', req);

      /* إشعار للمسؤولين لاستكمال تسكين المجموعة */
      try {
        const n = await db.prepare('INSERT INTO notifications (title, message, type, link, is_broadcast, created_by) VALUES (?,?,?,?,?,?)')
          .run('تحويل حجز للاعب: ' + r.swimmer_name, 'رقم العضوية: ' + membership_no + ' | البرنامج: ' + (r.program_name || '—'), 'حجوزات', '/swimmers/' + swimmerId, 1, req.currentUser.id);
        const rcpts = await db.prepare("SELECT id FROM users WHERE status='active'").all();
        const insR = db.prepare('INSERT INTO notification_recipients (notification_id, user_id) VALUES (?,?)');
        for (const rc of rcpts) await insR.run(n.lastInsertRowid, rc.id);
      } catch (e) { /* تجاهل أخطاء الإشعار */ }

      setFlash(res, {
        type: 'success',
        message: 'تم تحويل الحجز إلى اللاعب ' + r.swimmer_name + ' (' + membership_no + ') وولي الأمر — بقي فقط تسكين المجموعة من صفحة اللاعب'
      });
      return res.redirect('/swimmers/' + swimmerId);
    } catch (e) {
      if (tx && tx.rollback) await tx.rollback().catch(() => {});
      lastErr = e;
      if (isUniqueViolation(e) && attempt < 5) continue;
      break;
    }
  }
  console.error('فشل تحويل الحجز ' + r.id + ' إلى لاعب:', (lastErr && lastErr.message) || lastErr);
  setFlash(res, { type: 'error', message: 'تعذّر تحويل الحجز إلى لاعب: ' + ((lastErr && lastErr.message) || 'خطأ غير متوقع') });
  return res.redirect('/reservations');
}

router.post('/reservations/:id/status', async function (req, res) {
  if (!canView(req.currentUser, 'reservations')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const st = String(req.body.status || '');
  if (!RESERVE_STATUS.includes(st)) { setFlash(res, { type: 'error', message: 'حالة غير صالحة' }); return res.redirect('/reservations'); }
  const r = await db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!r) { setFlash(res, { type: 'error', message: 'الحجز غير موجود' }); return res.redirect('/reservations'); }

  /* اختيار «تم التحويل للاعب» ينفذ التحويل الكامل تلقائياً */
  if (st === 'تم التحويل للاعب' && !r.swimmer_id) {
    return convertReservation(req, res, r);
  }

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
        <th>م</th><th>اسم اللاعب</th><th>البرنامج</th><th>تاريخ الميلاد</th><th>السن</th><th>النوع</th>
        <th>الهاتف</th><th>الواتساب</th><th>المستوى المبدئي</th><th>رقم ولي الأمر</th><th>رقم اللاعب</th>
        <th>الملاحظات</th><th>تاريخ الحجز</th><th>وقت الحجز</th><th>الحالة</th>
      </tr></thead><tbody>${body}</tbody></table></body></html>`;
  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', "attachment; filename=\"reservations.xls\"; filename*=UTF-8''" + encodeURIComponent('حجوزات-الموقع.xls'));
  res.send(html);
});

/* ===== تحويل الحجز إلى لاعب (زر مستقل) ===== */
router.post('/reservations/:id/convert', async function (req, res) {
  if (!canEdit(req.currentUser, 'reservations')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const id = Number(req.params.id);
  const r = await db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!r) { setFlash(res, { type: 'error', message: 'الحجز غير موجود' }); return res.redirect('/reservations'); }
  return convertReservation(req, res, r);
});

module.exports = router;