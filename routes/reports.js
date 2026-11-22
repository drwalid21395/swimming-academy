/** التقارير */
const express = require('express');
const { db } = require('../lib/db');
const { audit, money, fmtDate, today, daysAgo, pct, canView, canExport, dayAr } = require('../lib/helpers');
const { activeSport, swimmerClause, sessionClause, groupClause } = require('../lib/sport-context');
const router = express.Router();

function subscriptionSportClause(sid, alias) {
  const id = Number(sid) || 0;
  if (!id) return '';
  const a = alias || 'subscriptions';
  return ` AND (${a}.sport_id = ${id} OR (${a}.sport_id IS NULL AND ${a}.program_id IN (SELECT id FROM programs WHERE deleted_at IS NULL AND sport_id = ${id})))`;
}

router.get('/reports', async function (req, res) {
  if (!canView(req.currentUser, 'reports')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const sid = activeSport(req);
  const wc = swimmerClause(sid);
  /* قراءات مستقلة؛ إرسالها معاً يوفّر رحلات قاعدة البيانات بنفس النتيجة. */
  const [swimmersC, activeC, subsActiveC, subsDueC, sessionsC, upcomingCompsC] = await Promise.all([
    db.prepare('SELECT COUNT(*) c FROM swimmers WHERE deleted_at IS NULL' + wc).get(),
    db.prepare("SELECT COUNT(*) c FROM swimmers WHERE deleted_at IS NULL AND status='نشط'" + wc).get(),
    db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE status='نشط'" + subscriptionSportClause(sid, 'subscriptions')).get(),
    db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE remaining > 0" + subscriptionSportClause(sid, 'subscriptions')).get(),
    db.prepare('SELECT COUNT(*) c FROM sessions WHERE deleted_at IS NULL' + sessionClause(sid)).get(),
    db.prepare("SELECT COUNT(*) c FROM competitions WHERE status IN ('قادمة','جارية')").get()
  ]);
  const counts = {
    swimmers: swimmersC.c,
    active: activeC.c,
    subsActive: subsActiveC.c,
    subsDue: subsDueC.c,
    sessions: sessionsC.c,
    upcomingComps: upcomingCompsC.c
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
    FROM swimmers s WHERE s.deleted_at IS NULL AND s.status = 'نشط'` + swimmerClause(activeSport(req)) + ` ORDER BY s.full_name`).all(from, to, from, to, from, to, from, to);
  res.render('report_attendance', { title: 'تقرير الحضور والغياب', active: 'reports', from, to, rows, pct, fmtDate });
});

/* ============================================================== */
/*              تقرير الحضور اليومي (طباعة / PDF)                 */
/* ============================================================== */
router.get('/reports/attendance/daily', async function (req, res) {
  if (!canView(req.currentUser, 'reports')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  if (!canExport(req.currentUser, 'reports')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const date = req.query.date || today();
  const groupRows = await db.prepare(`SELECT g.*, c.full_name AS coach_name FROM groups g
    LEFT JOIN coaches c ON c.id = g.coach_id WHERE g.deleted_at IS NULL` + groupClause(activeSport(req)) + ` ORDER BY g.name`).all();
  const gScope = sessionClause(activeSport(req), 's');
  const gIds = groupRows.map(function (g) { return g.id; });
  const gSet = new Set(gIds.map(Number));
  const gph = gIds.map(function () { return '?'; }).join(',');

  /* جلسة كل مجموعة + أعضاء المجموعات + إجماليات اليوم: قراءات مستقلة وتجميعية. */
  const [sessionRows, memberRows, dailyRow] = await Promise.all([
    gIds.length ? db.prepare(`SELECT se.*, sg.group_id AS linked_group_id FROM sessions se
      LEFT JOIN session_groups sg ON sg.session_id = se.id
      WHERE se.date = ? AND se.deleted_at IS NULL
        AND (se.group_id IN (` + gph + `) OR sg.group_id IN (` + gph + `))
      ORDER BY se.start_time, se.id, linked_group_id`).all(date, ...gIds, ...gIds) : Promise.resolve([]),
    gIds.length ? db.prepare(`SELECT sg.group_id, s.id AS swimmer_id, s.full_name, s.membership_no, l.name AS level_name
      FROM swimmer_group sg JOIN swimmers s ON s.id = sg.swimmer_id LEFT JOIN levels l ON l.id = s.level_id
      WHERE sg.group_id IN (` + gph + `) ORDER BY sg.group_id, s.full_name, s.id`).all(...gIds) : Promise.resolve([]),
    db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END),0) present,
        COALESCE(SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END),0) absent,
        COALESCE(SUM(CASE WHEN a.status='excused' THEN 1 ELSE 0 END),0) excused,
        COALESCE(SUM(CASE WHEN a.status='late' THEN 1 ELSE 0 END),0) late
      FROM attendance a JOIN sessions s ON s.id=a.session_id
      WHERE s.deleted_at IS NULL AND s.date=?` + gScope).get(date)
  ]);

  const sessionByGroup = {};
  sessionRows.forEach(function (r) {
    const session = Object.assign({}, r);
    delete session.linked_group_id;
    const ids = new Set();
    if (r.group_id !== null && r.group_id !== undefined && gSet.has(Number(r.group_id))) ids.add(Number(r.group_id));
    if (r.linked_group_id !== null && r.linked_group_id !== undefined && gSet.has(Number(r.linked_group_id))) ids.add(Number(r.linked_group_id));
    ids.forEach(function (gid) {
      const k = String(gid);
      const list = sessionByGroup[k] = sessionByGroup[k] || [];
      if (!list.some(function (x) { return x.id === session.id; })) list.push(session);
    });
  });
  const membersByGroup = {};
  memberRows.forEach(function (m) {
    const k = String(m.group_id);
    (membersByGroup[k] = membersByGroup[k] || []).push(m);
  });

  const chosenSessions = [];
  Object.keys(sessionByGroup).forEach(function (k) { if (sessionByGroup[k][0]) chosenSessions.push(sessionByGroup[k][0]); });
  const uniqueSessions = [];
  const seenSession = new Set();
  chosenSessions.forEach(function (s) { if (!seenSession.has(s.id)) { seenSession.add(s.id); uniqueSessions.push(s); } });
  const attMap = {};
  if (uniqueSessions.length) {
    const sph = uniqueSessions.map(function () { return '?'; }).join(',');
    const attRows = await db.prepare('SELECT session_id, swimmer_id, status, reason FROM attendance WHERE session_id IN (' + sph + ')').all(...uniqueSessions.map(function (s) { return s.id; }));
    attRows.forEach(function (a) { attMap[String(a.session_id) + ':' + String(a.swimmer_id)] = a; });
  }

  const groups = groupRows.map(function (g) {
    const session = (sessionByGroup[String(g.id)] || [])[0] || null;
    let members = [];
    if (session) {
      members = (membersByGroup[String(g.id)] || []).map(function (m) {
        const a = attMap[String(session.id) + ':' + String(m.swimmer_id)];
        return {
          full_name: m.full_name, membership_no: m.membership_no, level_name: m.level_name,
          status: a ? a.status : undefined, reason: a ? a.reason : undefined
        };
      });
    }
    return Object.assign({}, g, { session: session, members: members });
  });
  const daily = {
    present: dailyRow.present, absent: dailyRow.absent, excused: dailyRow.excused, late: dailyRow.late
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
    LEFT JOIN swimmers s ON s.id = sub.swimmer_id LEFT JOIN programs p ON p.id = sub.program_id LEFT JOIN groups g ON g.id = sub.group_id WHERE 1=1` + subscriptionSportClause(activeSport(req), 'sub') + ` ORDER BY sub.status, sub.created_at DESC`).all();
  const activeCount = rows.filter(r => r.status === 'نشط').length;
  const dueCount = rows.filter(r => r.remaining > 0).length;
  const dueTotal = rows.reduce((t, r) => t + Number(r.remaining || 0), 0);
  const revenueTotal = rows.reduce((t, r) => t + Number(r.paid_amount || 0), 0);
  res.render('report_subscriptions', { title: 'تقرير الاشتراكات', active: 'reports', rows, money, fmtDate, activeCount, dueCount, dueTotal, revenueTotal });
});

/* ============================================================== */
/*                  تقرير تقدم اللاعبين                            */
/* ============================================================== */
router.get('/reports/progress', async function (req, res) {
  if (!canView(req.currentUser, 'reports')) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
  const rows = await db.prepare(`SELECT s.full_name, s.membership_no, l.name AS level_name,
    (SELECT COUNT(*) FROM assessments a WHERE a.swimmer_id = s.id) AS assessments_count,
    (SELECT overall_percent FROM assessments a WHERE a.swimmer_id = s.id ORDER BY a.date DESC LIMIT 1) AS last_percent,
    (SELECT COUNT(*) FROM tests t WHERE t.swimmer_id = s.id AND t.passed = 1) AS passed_tests
    FROM swimmers s LEFT JOIN levels l ON l.id = s.level_id WHERE s.deleted_at IS NULL` + swimmerClause(activeSport(req)) + ` ORDER BY s.full_name`).all();
  res.render('report_progress', { title: 'تقرير تقدم اللاعبين', active: 'reports', rows, pct, fmtDate });
});

module.exports = router;
