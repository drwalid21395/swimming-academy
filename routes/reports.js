/** التقارير */
const express = require('express');
const { db } = require('../lib/db');
const { audit, money, fmtDate, today, daysAgo, pct, canView, dayAr } = require('../lib/helpers');
const router = express.Router();

router.get('/reports', async function (req, res) {
  if (!canView(req.currentUser, 'reports')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const counts = {
    swimmers: (await db.prepare('SELECT COUNT(*) c FROM swimmers').get()).c,
    active: (await db.prepare("SELECT COUNT(*) c FROM swimmers WHERE status='نشط'").get()).c,
    subsActive: (await db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE status='نشط'").get()).c,
    subsDue: (await db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE remaining > 0").get()).c,
    sessions: (await db.prepare('SELECT COUNT(*) c FROM sessions').get()).c,
    upcomingComps: (await db.prepare("SELECT COUNT(*) c FROM competitions WHERE status IN ('قادمة','جارية')").get()).c
  };
  res.render('reports', { title: 'التقارير', active: 'reports', counts, today: today(), daysAgo });
});

/* ============================================================== */
/*                      تقرير مالي شامل                           */
/* ============================================================== */
router.get('/reports/financial', async function (req, res) {
  if (!canView(req.currentUser, 'reports')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const from = req.query.from || daysAgo(30);
  const to = req.query.to || today();
  const revRows = await db.prepare('SELECT category, SUM(amount) total FROM revenues WHERE date BETWEEN ? AND ? GROUP BY category').all(from, to);
  const expRows = await db.prepare('SELECT category, SUM(amount) total FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category').all(from, to);
  const revTotal = revRows.reduce((t, r) => t + Number(r.total || 0), 0);
  const expTotal = expRows.reduce((t, r) => t + Number(r.total || 0), 0);
  res.render('report_financial', {
    title: 'التقرير المالي', active: 'reports', from, to,
    revRows, expRows, revTotal, expTotal, net: revTotal - expTotal, money, fmtDate
  });
});

/* ============================================================== */
/*                   تقرير الحضور والغياب                          */
/* ============================================================== */
router.get('/reports/attendance', async function (req, res) {
  if (!canView(req.currentUser, 'reports')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const from = req.query.from || daysAgo(30);
  const to = req.query.to || today();
  const rows = await db.prepare(`SELECT s.full_name, s.membership_no,
    (SELECT COUNT(*) FROM attendance a JOIN sessions ss ON ss.id=a.session_id WHERE a.swimmer_id = s.id AND ss.date BETWEEN ? AND ?) AS total,
    (SELECT COUNT(*) FROM attendance a JOIN sessions ss ON ss.id=a.session_id WHERE a.swimmer_id = s.id AND ss.date BETWEEN ? AND ? AND a.status='present') AS present,
    (SELECT COUNT(*) FROM attendance a JOIN sessions ss ON ss.id=a.session_id WHERE a.swimmer_id = s.id AND ss.date BETWEEN ? AND ? AND a.status='absent') AS absent,
    (SELECT COUNT(*) FROM attendance a JOIN sessions ss ON ss.id=a.session_id WHERE a.swimmer_id = s.id AND ss.date BETWEEN ? AND ? AND a.status='excused') AS excused
    FROM swimmers s WHERE s.status = 'نشط' ORDER BY s.full_name`).all(from, to, from, to, from, to, from, to);
  res.render('report_attendance', { title: 'تقرير الحضور والغياب', active: 'reports', from, to, rows, pct, fmtDate });
});

/* ============================================================== */
/*              تقرير الحضور اليومي (طباعة / PDF)                 */
/* ============================================================== */
router.get('/reports/attendance/daily', async function (req, res) {
  if (!canView(req.currentUser, 'reports')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const date = req.query.date || today();
  const groupRows = await db.prepare(`SELECT g.*, c.full_name AS coach_name FROM groups g
    LEFT JOIN coaches c ON c.id = g.coach_id ORDER BY g.name`).all();
  const groups = [];
  for (const g of groupRows) {
    const session = await db.prepare(`SELECT * FROM sessions WHERE group_id = ? AND date = ? ORDER BY start_time LIMIT 1`).get(g.id, date);
    let members = [];
    if (session) {
      members = await db.prepare(`SELECT s.full_name, s.membership_no, l.name AS level_name, a.status, a.reason
        FROM swimmer_group sg JOIN swimmers s ON s.id = sg.swimmer_id LEFT JOIN levels l ON l.id = s.level_id
        LEFT JOIN attendance a ON a.session_id = ? AND a.swimmer_id = s.id
        WHERE sg.group_id = ? ORDER BY s.full_name`).all(session.id, g.id);
    }
    groups.push({ ...g, session, members });
  }
  const daily = {
    present: (await db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.date=? AND a.status='present'`).get(date)).c,
    absent: (await db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.date=? AND a.status='absent'`).get(date)).c,
    excused: (await db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.date=? AND a.status='excused'`).get(date)).c,
    late: (await db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.date=? AND a.status='late'`).get(date)).c
  };
  res.render('report_attendance_daily', {
    title: 'تقرير الحضور اليومي', active: 'reports', date, groups, daily, today: today(), fmtDate, dayAr
  });
});

/* ============================================================== */
/*                     تقرير الاشتراكات                           */
/* ============================================================== */
router.get('/reports/subscriptions', async function (req, res) {
  if (!canView(req.currentUser, 'reports')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT sub.*, s.full_name AS swimmer_name, s.membership_no, p.name AS program_name, g.name AS group_name FROM subscriptions sub
    LEFT JOIN swimmers s ON s.id = sub.swimmer_id LEFT JOIN programs p ON p.id = sub.program_id LEFT JOIN groups g ON g.id = sub.group_id
    ORDER BY sub.status, sub.created_at DESC`).all();
  const activeCount = rows.filter(r => r.status === 'نشط').length;
  const dueCount = rows.filter(r => r.remaining > 0).length;
  const dueTotal = rows.reduce((t, r) => t + Number(r.remaining || 0), 0);
  const revenueTotal = rows.reduce((t, r) => t + Number(r.paid_amount || 0), 0);
  res.render('report_subscriptions', { title: 'تقرير الاشتراكات', active: 'reports', rows, money, fmtDate, activeCount, dueCount, dueTotal, revenueTotal });
});

/* ============================================================== */
/*                  تقرير تقدم السباحين                            */
/* ============================================================== */
router.get('/reports/progress', async function (req, res) {
  if (!canView(req.currentUser, 'reports')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT s.full_name, s.membership_no, l.name AS level_name,
    (SELECT COUNT(*) FROM assessments a WHERE a.swimmer_id = s.id) AS assessments_count,
    (SELECT overall_percent FROM assessments a WHERE a.swimmer_id = s.id ORDER BY a.date DESC LIMIT 1) AS last_percent,
    (SELECT COUNT(*) FROM tests t WHERE t.swimmer_id = s.id AND t.passed = 1) AS passed_tests
    FROM swimmers s LEFT JOIN levels l ON l.id = s.level_id ORDER BY s.full_name`).all();
  res.render('report_progress', { title: 'تقرير تقدم السباحين', active: 'reports', rows, pct, fmtDate });
});

module.exports = router;
