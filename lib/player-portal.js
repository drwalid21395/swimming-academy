/* بوابة اللاعب/ولي الأمر: البحث بالباركود وإنشاء تقرير PDF بالبيانات المسجلة */
const { db } = require('./db');
const { normalizeBarcode, visualArabic } = require('./membership-card');
const { money, fmtDate } = require('./helpers');

const SWIMMER_SELECT = `SELECT s.id, s.full_name, s.membership_no, s.birth_date, s.gender, s.status,
    s.avatar, s.registration_date, s.phone,
    p.name AS program_name, g.name AS group_name, c.full_name AS coach_name, l.name AS level_name,
    gu.full_name AS guardian_name, gu.relation AS guardian_relation
  FROM swimmers s
  LEFT JOIN programs p ON p.id = s.program_id
  LEFT JOIN groups g ON g.id = s.group_id
  LEFT JOIN coaches c ON c.id = s.coach_id
  LEFT JOIN levels l ON l.id = s.level_id
  LEFT JOIN guardians gu ON gu.id = s.guardian_id`;

async function findSwimmerByCode(code) {
  const clean = normalizeBarcode(code);
  if (!clean) return null;
  let swimmer = await db.prepare(SWIMMER_SELECT + ' WHERE UPPER(s.membership_no) = ? AND s.deleted_at IS NULL').get(clean);
  if (!swimmer && /^\d+$/.test(clean)) {
    swimmer = await db.prepare(SWIMMER_SELECT + ' WHERE s.id = ? AND s.deleted_at IS NULL').get(Number(clean));
  }
  return swimmer || null;
}

async function loadPlayerReport(swimmerId) {
  /* آخر اشتراك (نشط أولاً ثم الأحدث) */
  const subscription = await db.prepare(`SELECT * FROM subscriptions
    WHERE swimmer_id = ?
    ORDER BY (status = 'نشط') DESC, id DESC LIMIT 1`).get(swimmerId);

  /* المدفوعات */
  const payments = await db.prepare(`SELECT amount, method, receipt_no, paid_date
    FROM payments WHERE swimmer_id = ? ORDER BY paid_date DESC, id DESC LIMIT 20`).all(swimmerId);

  /* إجمالي الحضور والغياب */
  const attendanceStats = await db.prepare(`SELECT a.status, COUNT(*) AS c
    FROM attendance a JOIN sessions se ON se.id = a.session_id
    WHERE a.swimmer_id = ? AND se.deleted_at IS NULL
    GROUP BY a.status`).all(swimmerId);
  const stats = { present: 0, absent: 0, excused: 0, late: 0 };
  attendanceStats.forEach(function (r) { stats[r.status] = Number(r.c) || 0; });
  const totalSessions = stats.present + stats.absent + stats.excused + stats.late;

  /* آخر سجلات حضور */
  const recentAttendance = await db.prepare(`SELECT se.date, se.title, a.status
    FROM attendance a JOIN sessions se ON se.id = a.session_id
    WHERE a.swimmer_id = ? AND se.deleted_at IS NULL
    ORDER BY se.date DESC, se.start_time DESC LIMIT 10`).all(swimmerId);

  /* آخر تقييم */
  const assessment = await db.prepare(`SELECT a.*, c.full_name AS coach_name, l.name AS level_name
    FROM assessments a
    LEFT JOIN coaches c ON c.id = a.coach_id
    LEFT JOIN levels l ON l.id = a.level_id
    WHERE a.swimmer_id = ? ORDER BY a.date DESC, a.id DESC LIMIT 1`).get(swimmerId);

  /* آخر اختبار */
  const test = await db.prepare(`SELECT * FROM tests WHERE swimmer_id = ? ORDER BY date DESC, id DESC LIMIT 1`).get(swimmerId);

  return { subscription, payments, stats, totalSessions, recentAttendance, assessment, test };
}

function pdfReportDoc(swimmer, report, opts) {
  opts = opts || {};
  const academy = opts.academyName || 'الأكاديمية';

  const rows = [];
  rows.push([visualArabic('الاسم'), visualArabic(swimmer.full_name)]);
  rows.push([visualArabic('رقم العضوية'), swimmer.membership_no || '—']);
  rows.push([visualArabic('تاريخ الميلاد'), fmtDate(swimmer.birth_date) || '—']);
  rows.push([visualArabic('النوع'), swimmer.gender || '—']);
  rows.push([visualArabic('البرنامج'), visualArabic(swimmer.program_name) || '—']);
  rows.push([visualArabic('المجموعة'), visualArabic(swimmer.group_name) || '—']);
  rows.push([visualArabic('الكابتن'), visualArabic(swimmer.coach_name) || '—']);
  rows.push([visualArabic('المستوى'), visualArabic(swimmer.level_name) || '—']);
  rows.push([visualArabic('حالة اللاعب'), swimmer.status || '—']);
  if (swimmer.guardian_name) {
    rows.push([visualArabic('ولي الأمر'), visualArabic(swimmer.guardian_name + (swimmer.guardian_relation ? ' (' + swimmer.guardian_relation + ')' : ''))]);
  }

  const subRows = [];
  if (report.subscription) {
    const sub = report.subscription;
    subRows.push([visualArabic('حالة الاشتراك'), sub.status || '—']);
    subRows.push([visualArabic('تاريخ البداية'), fmtDate(sub.start_date) || '—']);
    subRows.push([visualArabic('تاريخ النهاية'), fmtDate(sub.end_date) || '—']);
    subRows.push([visualArabic('الحصص الكلية'), String(sub.sessions_total || 0)]);
    subRows.push([visualArabic('الحصص المستخدمة'), String(sub.sessions_used || 0)]);
    subRows.push([visualArabic('الحصص المتبقية'), String((sub.sessions_total || 0) - (sub.sessions_used || 0))]);
    subRows.push([visualArabic('سعر الاشتراك'), money(sub.total || 0)]);
    subRows.push([visualArabic('المسدد'), money(sub.paid_amount || 0)]);
    subRows.push([visualArabic('المتبقي'), money(sub.remaining || 0)]);
  }

  const payRows = report.payments.map(function (p) {
    return [fmtDate(p.paid_date) || '—', money(p.amount || 0), p.method || '—', p.receipt_no || '—'];
  });

  const attRows = [
    [visualArabic('حاضر'), String(report.stats.present)],
    [visualArabic('غائب'), String(report.stats.absent)],
    [visualArabic('معتذر'), String(report.stats.excused)],
    [visualArabic('متأخر'), String(report.stats.late)],
    [visualArabic('إجمالي الحصص'), String(report.totalSessions)]
  ];

  const recentRows = report.recentAttendance.map(function (a) {
    const statusLabel = { present: 'حاضر', absent: 'غائب', excused: 'معتذر', late: 'متأخر' }[a.status] || a.status;
    return [fmtDate(a.date) || '—', a.title || '—', visualArabic(statusLabel)];
  });

  const content = [
    { text: visualArabic('تقرير بطاقة العضوية'), alignment: 'center', fontSize: 18, bold: true, color: '#0369a1', margin: [0, 0, 0, 6] },
    { text: visualArabic(academy), alignment: 'center', fontSize: 12, color: '#64748b', margin: [0, 0, 0, 16] },
    {
      table: {
        widths: ['35%', '*'],
        body: rows.map(function (r) { return [{ text: visualArabic(r[0]), bold: true, color: '#0f172a', fillColor: '#f1f5f9' }, { text: visualArabic(r[1]), color: '#0f172a' }]; })
      },
      layout: { hLineWidth: function () { return 0.5; }, vLineWidth: function () { return 0.5; }, hLineColor: function () { return '#e2e8f0'; }, vLineColor: function () { return '#e2e8f0'; } },
      margin: [0, 0, 0, 14]
    }
  ];

  if (subRows.length) {
    content.push(
      { text: visualArabic('الاشتراك الحالي'), fontSize: 13, bold: true, color: '#0369a1', margin: [0, 10, 0, 6] },
      {
        table: {
          widths: ['40%', '*'],
          body: subRows.map(function (r) { return [{ text: visualArabic(r[0]), bold: true, fillColor: '#f1f5f9' }, { text: visualArabic(r[1]) }]; })
        },
        layout: { hLineWidth: function () { return 0.5; }, vLineWidth: function () { return 0.5; }, hLineColor: function () { return '#e2e8f0'; }, vLineColor: function () { return '#e2e8f0'; } },
        margin: [0, 0, 0, 14]
      }
    );
  }

  content.push(
    { text: visualArabic('الحضور والغياب'), fontSize: 13, bold: true, color: '#0369a1', margin: [0, 10, 0, 6] },
    {
      table: {
        widths: ['40%', '*'],
        body: attRows.map(function (r) { return [{ text: visualArabic(r[0]), bold: true, fillColor: '#f1f5f9' }, { text: visualArabic(r[1]) }]; })
      },
      layout: { hLineWidth: function () { return 0.5; }, vLineWidth: function () { return 0.5; }, hLineColor: function () { return '#e2e8f0'; }, vLineColor: function () { return '#e2e8f0'; } },
      margin: [0, 0, 0, 14]
    }
  );

  if (recentRows.length) {
    content.push(
      { text: visualArabic('آخر سجلات الحضور'), fontSize: 12, bold: true, color: '#0369a1', margin: [0, 10, 0, 6] },
      {
        table: {
          widths: ['25%', '*', '20%'],
          headerRows: 1,
          body: [[visualArabic('التاريخ'), visualArabic('الحصة'), visualArabic('الحالة')]].concat(recentRows)
        },
        layout: { hLineWidth: function () { return 0.5; }, vLineWidth: function () { return 0.5; }, hLineColor: function () { return '#e2e8f0'; }, vLineColor: function () { return '#e2e8f0'; }, fillHeaderRow: true },
        margin: [0, 0, 0, 14]
      }
    );
  }

  if (payRows.length) {
    content.push(
      { text: visualArabic('المدفوعات'), fontSize: 12, bold: true, color: '#0369a1', margin: [0, 10, 0, 6] },
      {
        table: {
          widths: ['22%', '20%', '28%', '*'],
          headerRows: 1,
          body: [[visualArabic('التاريخ'), visualArabic('المبلغ'), visualArabic('الطريقة'), visualArabic('رقم الإيصال')]].concat(payRows)
        },
        layout: { hLineWidth: function () { return 0.5; }, vLineWidth: function () { return 0.5; }, hLineColor: function () { return '#e2e8f0'; }, vLineColor: function () { return '#e2e8f0'; }, fillHeaderRow: true },
        margin: [0, 0, 0, 14]
      }
    );
  }

  if (report.assessment) {
    const a = report.assessment;
    content.push(
      { text: visualArabic('آخر تقييم'), fontSize: 12, bold: true, color: '#0369a1', margin: [0, 10, 0, 6] },
      {
        table: {
          widths: ['35%', '*'],
          body: [
            [visualArabic('التاريخ'), fmtDate(a.date) || '—'],
            [visualArabic('المستوى'), visualArabic(a.level_name) || '—'],
            [visualArabic('النسبة'), String(a.overall_percent || 0) + '%'],
            [visualArabic('نقاط القوة'), visualArabic(a.strengths) || '—'],
            [visualArabic('نقاط ضعف'), visualArabic(a.weaknesses) || '—'],
            [visualArabic('التوصيات'), visualArabic(a.recommendations) || '—']
          ]
        },
        layout: { hLineWidth: function () { return 0.5; }, vLineWidth: function () { return 0.5; }, hLineColor: function () { return '#e2e8f0'; }, vLineColor: function () { return '#e2e8f0'; } },
        margin: [0, 0, 0, 14]
      }
    );
  }

  if (report.test) {
    const t = report.test;
    content.push(
      { text: visualArabic('آخر اختبار'), fontSize: 12, bold: true, color: '#0369a1', margin: [0, 10, 0, 6] },
      {
        table: {
          widths: ['35%', '*'],
          body: [
            [visualArabic('التاريخ'), fmtDate(t.date) || '—'],
            [visualArabic('النوع'), visualArabic(t.type) || '—'],
            [visualArabic('المسافة'), (t.distance_m || 0) + ' م'],
            [visualArabic('الزمن'), t.time_seconds ? (t.time_seconds + ' ث') : '—'],
            [visualArabic('النتيجة'), visualArabic(t.result_note) || '—']
          ]
        },
        layout: { hLineWidth: function () { return 0.5; }, vLineWidth: function () { return 0.5; }, hLineColor: function () { return '#e2e8f0'; }, vLineColor: function () { return '#e2e8f0'; } },
        margin: [0, 0, 0, 14]
      }
    );
  }

  content.push({ text: visualArabic('تم إنشاء هذا التقرير من مسح باركود بطاقة العضوية.'), alignment: 'center', fontSize: 8, color: '#94a3b8', margin: [20, 20, 20, 0] });

  return {
    pageSize: 'A4',
    pageMargins: [36, 36, 36, 36],
    defaultStyle: { font: 'Amiri', alignment: 'right', color: '#0f172a' },
    content: content
  };
}

module.exports = { findSwimmerByCode, loadPlayerReport, pdfReportDoc };
