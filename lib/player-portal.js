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

  /* آخر تقييم مع الدرجات الكاملة */
  const assessmentRow = await db.prepare(`SELECT a.*, c.full_name AS coach_name, l.name AS level_name
    FROM assessments a
    LEFT JOIN coaches c ON c.id = a.coach_id
    LEFT JOIN levels l ON l.id = a.level_id
    WHERE a.swimmer_id = ? ORDER BY a.date DESC, a.id DESC LIMIT 1`).get(swimmerId);

  let assessment = assessmentRow;
  if (assessment) {
    let scores = {};
    try { scores = JSON.parse(assessment.scores || '{}'); } catch (e) { scores = {}; }
    const criteria = await db.prepare(`SELECT * FROM assessment_criteria
      WHERE level_id = ? OR level_id IS NULL
      ORDER BY level_id IS NULL, order_no, id`).all(assessment.level_id || 0);
    const criteriaScores = [];
    let levelTotal = 0, levelCount = 0;
    criteria.forEach(function (c) {
      const val = scores[c.id];
      if (val !== undefined && val !== null && val !== '') {
        criteriaScores.push({ name: c.name, score: Number(val) || 0 });
        levelTotal += Number(val) || 0;
        levelCount++;
      }
    });
    assessment.criteriaScores = criteriaScores;
    assessment.levelTotal = levelTotal;
    assessment.levelCount = levelCount;
    assessment.levelPercent = levelCount ? Math.round(levelTotal / levelCount) : 0;
  }

  /* آخر اختبار مع الكابتن والمستوى */
  const test = await db.prepare(`SELECT t.*, c.full_name AS coach_name, l.name AS level_name
    FROM tests t
    LEFT JOIN coaches c ON c.id = t.coach_id
    LEFT JOIN levels l ON l.id = t.level_id
    WHERE t.swimmer_id = ? ORDER BY t.date DESC, t.id DESC LIMIT 1`).get(swimmerId);

  return { subscription, payments, stats, totalSessions, recentAttendance, assessment, test };
}

function pdfReportDoc(swimmer, report, opts) {
  opts = opts || {};
  const academy = opts.academyName || 'الأكاديمية';
  const nowStr = fmtDate(new Date().toISOString().slice(0, 10)) + ' ' + new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  function va(t) {
    const s = String(t == null ? '' : t);
    return /[\u0600-\u06FF]/.test(s) ? visualArabic(s) : s;
  }
  function labelCell(t) { return { text: va(t), bold: true, color: '#1e293b', fillColor: '#f1f5f9', alignment: 'right', fontSize: 11 }; }
  function valueCell(t, opts2) {
    opts2 = opts2 || {};
    return { text: va(t), color: opts2.color || '#0f172a', alignment: 'right', fontSize: 11, bold: !!opts2.bold };
  }
  function sectionHeader(t, icon) {
    return {
      table: {
        widths: ['*'],
        body: [[{ text: va((icon ? icon + ' ' : '') + t), bold: true, color: '#ffffff', fillColor: '#0284c7', alignment: 'right', fontSize: 13, margin: [8, 6, 8, 6] }]]
      },
      layout: { hLineWidth: function () { return 0; }, vLineWidth: function () { return 0; } },
      margin: [0, 14, 0, 8]
    };
  }
  function infoTable(pairs, widths) {
    return {
      table: {
        widths: widths || ['38%', '*'],
        body: pairs.map(function (p) { return [labelCell(p[0]), valueCell(p[1], p[2])]; })
      },
      layout: {
        hLineWidth: function () { return 0.5; },
        vLineWidth: function () { return 0.5; },
        hLineColor: function () { return '#cbd5e1'; },
        vLineColor: function () { return '#cbd5e1'; },
        fillColor: function (i) { return i % 2 === 0 ? '#f8fafc' : null; }
      },
      margin: [0, 0, 0, 10]
    };
  }
  function dataTable(headers, rows, widths) {
    return {
      table: {
        widths: widths,
        headerRows: 1,
        body: [headers.map(function (h) { return { text: va(h), bold: true, color: '#ffffff', fillColor: '#0f172a', alignment: 'right', fontSize: 11 }; })].concat(rows)
      },
      layout: {
        hLineWidth: function () { return 0.5; },
        vLineWidth: function () { return 0.5; },
        hLineColor: function () { return '#cbd5e1'; },
        vLineColor: function () { return '#cbd5e1'; },
        fillColor: function (rowIndex) { return rowIndex === 0 ? null : (rowIndex % 2 === 0 ? '#f8fafc' : null); }
      },
      margin: [0, 0, 0, 10]
    };
  }
  function statBox(label, value, color) {
    return {
      stack: [
        { text: va(value), bold: true, fontSize: 18, color: color || '#0284c7', alignment: 'center' },
        { text: va(label), fontSize: 10, color: '#64748b', alignment: 'center', margin: [0, 4, 0, 0] }
      ],
      margin: [0, 0, 0, 0],
      padding: [8, 10]
    };
  }

  const content = [];

  /* رأس التقرير */
  content.push({
    table: {
      widths: ['*'],
      body: [[
        {
          stack: [
            { text: va('تقرير بطاقة العضوية'), bold: true, fontSize: 22, color: '#ffffff', alignment: 'center' },
            { text: va(academy), fontSize: 13, color: '#e0f2fe', alignment: 'center', margin: [0, 4, 0, 0] }
          ],
          margin: [0, 14, 0, 14]
        }
      ]]
    },
    layout: { hLineWidth: function () { return 0; }, vLineWidth: function () { return 0; }, fillColor: function () { return '#0284c7'; } },
    margin: [0, 0, 0, 14]
  });

  /* البيانات الشخصية */
  content.push(sectionHeader('البيانات الشخصية', '🏊'));
  const personal = [
    ['الاسم', swimmer.full_name],
    ['رقم العضوية', swimmer.membership_no || '—'],
    ['تاريخ الميلاد', fmtDate(swimmer.birth_date) || '—'],
    ['النوع', swimmer.gender || '—'],
    ['البرنامج', swimmer.program_name || '—'],
    ['المجموعة', swimmer.group_name || '—'],
    ['الكابتن', swimmer.coach_name || '—'],
    ['المستوى', swimmer.level_name || '—'],
    ['حالة اللاعب', swimmer.status || '—']
  ];
  if (swimmer.guardian_name) {
    personal.push(['ولي الأمر', swimmer.guardian_name + (swimmer.guardian_relation ? ' (' + swimmer.guardian_relation + ')' : '')]);
  }
  content.push(infoTable(personal));

  /* الاشتراك */
  if (report.subscription) {
    const sub = report.subscription;
    content.push(sectionHeader('الاشتراك الحالي', '📅'));
    content.push(infoTable([
      ['حالة الاشتراك', sub.status || '—'],
      ['تاريخ البداية', fmtDate(sub.start_date) || '—'],
      ['تاريخ النهاية', fmtDate(sub.end_date) || '—'],
      ['الحصص الكلية', String(sub.sessions_total || 0)],
      ['الحصص المستخدمة', String(sub.sessions_used || 0)],
      ['الحصص المتبقية', String((sub.sessions_total || 0) - (sub.sessions_used || 0))],
      ['سعر الاشتراك', money(sub.total || 0)],
      ['المسدد', money(sub.paid_amount || 0)],
      ['المتبقي', money(sub.remaining || 0)]
    ]));
  }

  /* الحضور والغياب */
  content.push(sectionHeader('الحضور والغياب', '✅'));
  content.push({
    table: {
      widths: ['*', '*', '*', '*'],
      body: [[
        statBox('حاضر', String(report.stats.present), '#10b981'),
        statBox('غائب', String(report.stats.absent), '#ef4444'),
        statBox('معتذر', String(report.stats.excused), '#f59e0b'),
        statBox('متأخر', String(report.stats.late), '#3b82f6')
      ]]
    },
    layout: { hLineWidth: function () { return 0.5; }, vLineWidth: function () { return 0.5; }, hLineColor: function () { return '#e2e8f0'; }, vLineColor: function () { return '#e2e8f0'; } },
    margin: [0, 0, 0, 10]
  });
  content.push(infoTable([['إجمالي الحصص المسجلة', String(report.totalSessions)]]));

  if (report.recentAttendance.length) {
    content.push({ text: va('آخر سجلات الحضور'), bold: true, fontSize: 12, color: '#0369a1', margin: [0, 8, 0, 6] });
    const recentRows = report.recentAttendance.map(function (a) {
      const statusLabel = { present: 'حاضر', absent: 'غائب', excused: 'معتذر', late: 'متأخر' }[a.status] || a.status;
      return [
        { text: fmtDate(a.date) || '—', alignment: 'right', fontSize: 11 },
        { text: va(a.title || '—'), alignment: 'right', fontSize: 11 },
        { text: va(statusLabel), alignment: 'right', fontSize: 11, bold: true, color: a.status === 'present' ? '#10b981' : a.status === 'absent' ? '#ef4444' : a.status === 'excused' ? '#f59e0b' : '#3b82f6' }
      ];
    });
    content.push(dataTable(['التاريخ', 'الحصة', 'الحالة'], recentRows, ['25%', '*', '22%']));
  }

  /* المدفوعات */
  if (report.payments.length) {
    content.push(sectionHeader('المدفوعات', '💰'));
    const payRows = report.payments.map(function (p) {
      return [
        { text: fmtDate(p.paid_date) || '—', alignment: 'right', fontSize: 11 },
        { text: money(p.amount || 0), alignment: 'right', fontSize: 11, bold: true },
        { text: va(p.method || '—'), alignment: 'right', fontSize: 11 },
        { text: p.receipt_no || '—', alignment: 'right', fontSize: 11 }
      ];
    });
    content.push(dataTable(['التاريخ', 'المبلغ', 'الطريقة', 'رقم الإيصال'], payRows, ['22%', '20%', '28%', '*']));
  }

  /* التقييم الفني */
  if (report.assessment) {
    const a = report.assessment;
    content.push(sectionHeader('التقرير الفني', '📋'));
    content.push(infoTable([
      ['التاريخ', fmtDate(a.date) || '—'],
      ['المستوى', a.level_name || '—'],
      ['الكابتن المقيّم', a.coach_name || '—'],
      ['النسبة النهائية', String(a.overall_percent || 0) + '%', { color: a.overall_percent >= 80 ? '#10b981' : a.overall_percent >= 60 ? '#f59e0b' : '#ef4444', bold: true }],
      ['متوسط الدرجات', String(a.levelPercent || 0) + '%'],
      ['مجموع الدرجات', String(a.levelTotal || 0) + ' / ' + String((a.levelCount || 0) * 100)],
      ['جاهز للترقية', a.ready_to_advance ? 'نعم' : 'لا'],
      ['نقاط القوة', a.strengths || '—'],
      ['نقاط الضعف', a.weaknesses || '—'],
      ['التوصيات', a.recommendations || '—'],
      ['ملاحظات عامة', a.notes || '—']
    ]));

    if (a.criteriaScores && a.criteriaScores.length) {
      content.push({ text: va('درجات المهارات والمعايير'), bold: true, fontSize: 12, color: '#0369a1', margin: [0, 8, 0, 6] });
      const critRows = a.criteriaScores.map(function (c) {
        return [
          { text: va(c.name), alignment: 'right', fontSize: 11 },
          { text: String(c.score || 0), alignment: 'center', fontSize: 11, bold: true, color: '#0284c7' }
        ];
      });
      content.push(dataTable(['المعيار / المهارة', 'الدرجة'], critRows, ['*', '22%']));
    }
  }

  /* الاختبار */
  if (report.test) {
    const t = report.test;
    content.push(sectionHeader('آخر اختبار', '⏱️'));
    content.push(infoTable([
      ['التاريخ', fmtDate(t.date) || '—'],
      ['نوع الاختبار', t.type || '—'],
      ['نوع السباق', t.race_type || '—'],
      ['المستوى', t.level_name || '—'],
      ['المسافة', (t.distance_m || 0) + ' م'],
      ['الزمن', t.time_seconds ? (t.time_seconds + ' ث') : '—'],
      ['المركز', t.position ? String(t.position) : '—'],
      ['النتيجة', t.passed ? 'ناجح' : 'غير ناجح'],
      ['الكابتن', t.coach_name || '—'],
      ['النتيجة / الملاحظة', t.result_note || '—']
    ]));
  }

  /* ذيل الصفحة */
  content.push({
    text: va('تم إنشاء هذا التقرير من مسح باركود بطاقة العضوية في ' + nowStr),
    alignment: 'center',
    fontSize: 9,
    color: '#64748b',
    margin: [0, 20, 0, 0]
  });

  return {
    pageSize: 'A4',
    pageMargins: [36, 48, 36, 48],
    defaultStyle: { font: 'Amiri', alignment: 'right', color: '#0f172a' },
    content: content,
    footer: function (currentPage, pageCount) {
      return {
        columns: [
          { text: va(academy), alignment: 'right', color: '#94a3b8', fontSize: 9, margin: [0, 0, 20, 0] },
          { text: currentPage + ' / ' + pageCount, alignment: 'left', color: '#94a3b8', fontSize: 9, margin: [20, 0, 0, 0] }
        ],
        margin: [36, 0, 36, 0]
      };
    }
  };
}

module.exports = { findSwimmerByCode, loadPlayerReport, pdfReportDoc };
