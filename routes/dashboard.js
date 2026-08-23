/** لوحة التحكم + بوابة ولي الأمر والسباح */
const express = require('express');
const { db } = require('../lib/db');
const { money, fmtDate, dayAr, calcAge, pct, daysAhead, daysAgo, today } = require('../lib/helpers');
const router = express.Router();

function swimmerSummary() {
  const total = db.prepare('SELECT COUNT(*) c FROM swimmers').get().c;
  const active = db.prepare("SELECT COUNT(*) c FROM swimmers WHERE status = 'نشط'").get().c;
  const stopped = db.prepare("SELECT COUNT(*) c FROM swimmers WHERE status IN ('متوقف مؤقتاً','مجمد','منسحب')").get().c;
  const expired = db.prepare("SELECT COUNT(*) c FROM swimmers WHERE status IN ('منتهي','خريج')").get().c;
  return { total, active, stopped, expired };
}

router.get('/', function (req, res) {
  const user = req.currentUser;
  if (user.user_type === 'guardian' || user.user_type === 'swimmer') return res.redirect('/my-portal');

  const S = swimmerSummary();
  const now = today();

  const subs = {
    active: db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE status = 'نشط'").get().c,
    expired: db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE status IN ('منتهي','مكتمل','ملغي')").get().c,
    expiringSoon: db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE status = 'نشط' AND end_date IS NOT NULL AND date(end_date) BETWEEN date(?) AND date(?, '+7 day')").get(now, now).c,
    frozen: db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE status = 'مجمد'").get().c
  };

  const sessions = {
    executed: db.prepare("SELECT COUNT(*) c FROM sessions WHERE status = 'completed'").get().c,
    scheduledToday: db.prepare("SELECT COUNT(*) c FROM sessions WHERE status = 'scheduled' AND date = ?").get(now).c,
    upcoming: db.prepare("SELECT COUNT(*) c FROM sessions WHERE status = 'scheduled' AND date >= ?").get(now).c,
    cancelled: db.prepare("SELECT COUNT(*) c FROM sessions WHERE status = 'cancelled'").get().c
  };

  const attendanceToday = {
    present: db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id = a.session_id WHERE s.date = ? AND a.status = 'present'`).get(now).c,
    absent: db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id = a.session_id WHERE s.date = ? AND a.status = 'absent'`).get(now).c,
    excused: db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id = a.session_id WHERE s.date = ? AND a.status = 'excused'`).get(now).c
  };

  const coachesCount = db.prepare("SELECT COUNT(*) c FROM coaches WHERE status = 'active'").get().c;
  const teamsCount = db.prepare('SELECT COUNT(*) c FROM teams').get().c;
  const groupsCount = db.prepare('SELECT COUNT(*) c FROM groups').get().c;
  const branchesCount = db.prepare('SELECT COUNT(*) c FROM branches').get().c;

  const finance = {
    revenues: db.prepare('SELECT COALESCE(SUM(amount),0) s FROM revenues').get().s,
    expenses: db.prepare('SELECT COALESCE(SUM(amount),0) s FROM expenses').get().s,
    due: db.prepare("SELECT COALESCE(SUM(remaining),0) s FROM subscriptions WHERE status = 'نشط'").get().s,
    unpaidCount: db.prepare("SELECT COUNT(*) c FROM subscriptions WHERE remaining > 0 AND status = 'نشط'").get().c
  };

  /* إيرادات ومصروفات آخر 12 أسبوع */
  const weeklyRevenue = [];
  const weeklyExpense = [];
  const weekLabels = [];
  for (let w = 11; w >= 0; w--) {
    const from = daysAgo(w * 7 + 6);
    const to = daysAgo(w * 7);
    weekLabels.push(shortDate(from));
    weeklyRevenue.push(db.prepare('SELECT COALESCE(SUM(amount),0) s FROM revenues WHERE date BETWEEN ? AND ?').get(from, to).s);
    weeklyExpense.push(db.prepare('SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE date BETWEEN ? AND ?').get(from, to).s);
  }

  /* الحضور آخر 14 يوم */
  const attLabels = [], attPresent = [], attAbsent = [];
  for (let d = 13; d >= 0; d--) {
    const day = daysAgo(d);
    attLabels.push(shortDate(day));
    attPresent.push(db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.date=? AND a.status='present'`).get(day).c);
    attAbsent.push(db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE s.date=? AND a.status IN ('absent','excused')`).get(day).c);
  }

  /* السباحون حسب البرنامج */
  const byProgram = db.prepare(`SELECT p.name, COUNT(s.id) c FROM programs p LEFT JOIN swimmers s ON s.program_id = p.id GROUP BY p.id ORDER BY c DESC LIMIT 8`).all();

  /* تنبيهات */
  const alerts = [];
  const expiring = db.prepare(`SELECT s.full_name, sub.end_date, sub.id FROM subscriptions sub JOIN swimmers s ON s.id = sub.swimmer_id WHERE sub.status = 'نشط' AND sub.end_date IS NOT NULL AND date(sub.end_date) BETWEEN date(?) AND date(?, '+7 day')`).all(now, now);
  expiring.forEach(function (x) {
    alerts.push({ type: 'warn', icon: 'fa-clock', title: 'اشتراك على وشك الانتهاء: ' + x.full_name, sub: 'ينتهي في ' + fmtDate(x.end_date), link: '/subscriptions/' + x.id });
  });
  const overdue = db.prepare(`SELECT s.full_name, sub.remaining, sub.id FROM subscriptions sub JOIN swimmers s ON s.id = sub.swimmer_id WHERE sub.status = 'نشط' AND sub.remaining > 0`).all();
  overdue.forEach(function (x) {
    alerts.push({ type: 'danger', icon: 'fa-money-bill-wave', title: 'مبلغ مستحق: ' + x.full_name, sub: 'باقي ' + money(x.remaining), link: '/subscriptions/' + x.id });
  });
  const missingDocs = db.prepare(`SELECT s.full_name, s.id FROM swimmers s WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.owner_type='swimmer' AND d.owner_id=s.id AND d.doc_type='إقرار صحي') AND s.status = 'نشط' LIMIT 4`).all();
  missingDocs.forEach(function (x) {
    alerts.push({ type: 'info', icon: 'fa-folder-minus', title: 'مستند ناقص: ' + x.full_name, sub: 'الإقرار الصحي غير موجود', link: '/documents' });
  });
  const upcomingComp = db.prepare("SELECT * FROM competitions WHERE status = 'قادمة' ORDER BY date LIMIT 2").all();
  upcomingComp.forEach(function (x) {
    alerts.push({ type: 'info', icon: 'fa-trophy', title: 'بطولة قادمة: ' + x.name, sub: fmtDate(x.date) + ' — ' + x.place, link: '/competitions' });
  });

  /* حصص اليوم */
  const todaySessions = db.prepare(`SELECT s.*, g.name AS group_name, c.full_name AS coach_name, p.name AS pool_name FROM sessions s
    JOIN groups g ON g.id = s.group_id LEFT JOIN coaches c ON c.id = s.coach_id LEFT JOIN pools p ON p.id = s.pool_id
    WHERE s.date = ? ORDER BY s.start_time`).all(now);

  /* أحدث التقييمات */
  const latestAssess = db.prepare(`SELECT a.*, s.full_name AS swimmer_name, c.full_name AS coach_name, l.name AS level_name FROM assessments a
    JOIN swimmers s ON s.id = a.swimmer_id LEFT JOIN coaches c ON c.id = a.coach_id LEFT JOIN levels l ON l.id = a.level_id
    ORDER BY a.date DESC LIMIT 6`).all();

  res.render('dashboard', {
    title: 'لوحة التحكم',
    active: 'dashboard',
    stats: { S, subs, sessions, attendanceToday, coachesCount, teamsCount, groupsCount, branchesCount, finance },
    weekly: { labels: weekLabels, revenue: weeklyRevenue, expense: weeklyExpense },
    attendance: { labels: attLabels, present: attPresent, absent: attAbsent },
    byProgram,
    alerts,
    todaySessions,
    latestAssess,
    today: now,
    inlineScript: renderCharts('chartRevenue', 'chartAttendance', 'chartPrograms', JSON.stringify(weeklyRevenue), JSON.stringify(weeklyExpense), JSON.stringify(weekLabels), JSON.stringify(attPresent), JSON.stringify(attAbsent), JSON.stringify(attLabels), JSON.stringify(byProgram))
  });
});

function shortDate(d) { return new Date(d + 'T00:00:00').toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' }); }

function renderCharts(revEl, attEl, progEl, rev, exp, wk, pres, abs, attl, prog) {
  return `
var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
var grid = isDark ? 'rgba(255,255,255,.06)' : 'rgba(15,23,42,.08)';
var tick = isDark ? '#94a3b8' : '#64748b';
Chart.defaults.color = tick;
Chart.defaults.font.family = 'Cairo, sans-serif';
Chart.defaults.font.size = 11;
function mk(id, d) { var el = document.getElementById(id); if (el) new Chart(el, d); }
mk('${revEl}', { type: 'bar', data: { labels: ${wk}, datasets: [
  { label: 'الإيرادات', data: ${rev}, backgroundColor: 'rgba(16,185,129,.72)', borderRadius: 6, categoryPercentage: .6 },
  { label: 'المصروفات', data: ${exp}, backgroundColor: 'rgba(239,68,68,.62)', borderRadius: 6, categoryPercentage: .6 }
]}, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false } }, y: { grid: { color: grid } } } } });
mk('${attEl}', { type: 'line', data: { labels: ${attl}, datasets: [
  { label: 'حاضر', data: ${pres}, borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,.12)', fill: true, tension: .35 },
  { label: 'غائب / معتذر', data: ${abs}, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,.1)', fill: true, tension: .35 }
]}, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false } }, y: { grid: { color: grid }, beginAtZero: true } } } });
var pd = ${prog};
mk('${progEl}', { type: 'doughnut', data: { labels: pd.map(function (p) { return p.name; }), datasets: [{ data: pd.map(function (p) { return p.c; }), backgroundColor: ['#0ea5e9','#8b5cf6','#f59e0b','#10b981','#ef4444','#3b82f6','#14b8a6','#ec4899'], borderWidth: 0 }]}, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
`;
}

/* ---------- بوابة ولي الأمر / السباح ---------- */
router.get('/my-portal', function (req, res) {
  const user = req.currentUser;
  let kidIds = [];
  if (user.user_type === 'guardian') {
    const g = db.prepare('SELECT * FROM guardians WHERE id = ?').get(user.linked_id);
    if (g) kidIds = db.prepare('SELECT id FROM swimmers WHERE guardian_id = ?').all(g.id).map(r => r.id);
  } else if (user.user_type === 'swimmer') {
    kidIds = [user.linked_id];
  }
  if (!kidIds.length) return res.render('portal/empty', { title: 'بوابتي', active: '' });

  const kids = kidIds.map(function (kidId) {
    const s = db.prepare(`SELECT s.*, l.name AS level_name, g.name AS group_name, c.full_name AS coach_name, p.name AS program_name FROM swimmers s
      LEFT JOIN levels l ON l.id = s.level_id LEFT JOIN groups g ON g.id = s.group_id
      LEFT JOIN coaches c ON c.id = s.coach_id LEFT JOIN programs p ON p.id = s.program_id WHERE s.id = ?`).get(kidId);
    const sub = db.prepare("SELECT * FROM subscriptions WHERE swimmer_id = ? ORDER BY id DESC LIMIT 1").get(kidId);
    const totalAtt = db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE a.swimmer_id = ?`).get(kidId).c;
    const presentAtt = db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE a.swimmer_id = ? AND a.status='present'`).get(kidId).c;
    const assessments = db.prepare(`SELECT a.*, c.full_name AS coach_name, l.name AS level_name FROM assessments a LEFT JOIN coaches c ON c.id=a.coach_id LEFT JOIN levels l ON l.id=a.level_id WHERE a.swimmer_id=? ORDER BY a.date DESC LIMIT 4`).all(kidId);
    const tests = db.prepare('SELECT * FROM tests WHERE swimmer_id = ? ORDER BY date DESC LIMIT 5').all(kidId);
    const nextSessions = db.prepare(`SELECT se.*, g.name AS group_name FROM sessions se JOIN groups g ON g.id = se.group_id WHERE g.id = ? AND se.date >= ? AND se.status='scheduled' ORDER BY se.date, se.start_time LIMIT 6`).all(s.group_id, today());
    const coachNotes = db.prepare(`SELECT a.coach_note, s.date FROM attendance a JOIN sessions s ON s.id=a.session_id WHERE a.swimmer_id=? AND a.coach_note != '' ORDER BY s.date DESC LIMIT 5`).all(kidId);
    const levelProgress = db.prepare(`SELECT lp.*, l.name AS to_level FROM level_progress lp LEFT JOIN levels l ON l.id=lp.to_level_id WHERE lp.swimmer_id=? ORDER BY lp.date`).all(kidId);
    return {
      s,
      sub,
      attendance: { total: totalAtt, present: presentAtt, pct: pct(presentAtt, totalAtt) },
      remaining: sub ? Math.max(0, sub.sessions_total - sub.sessions_used) : 0,
      assessments, tests, nextSessions, coachNotes, levelProgress
    };
  });

  const messages = db.prepare('SELECT * FROM messages WHERE to_user_id = ? ORDER BY id DESC LIMIT 10').all(user.id);
  const myNotifications = db.prepare(`SELECT n.* FROM notifications n JOIN notification_recipients r ON r.notification_id = n.id WHERE r.user_id = ? ORDER BY n.id DESC LIMIT 10`).all(user.id);
  const announcements = db.prepare('SELECT * FROM announcements WHERE is_public = 1 ORDER BY id DESC LIMIT 5').all();

  res.render('portal/index', {
    title: 'بوابتي الشخصية',
    active: '',
    user,
    kids,
    messages,
    myNotifications,
    announcements,
    today: today(),
    calcAge
  });
});

module.exports = router;
