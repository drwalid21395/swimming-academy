/** المدارس والجهات الدراسية: يحددها الأدمن وتستخدم في ملفات السباحين */
const express = require('express');
const { db } = require('../lib/db');
const crud = require('../lib/crud');
const router = express.Router();

const SCHOOL_TYPES = ['مدرسة', 'أكاديمية', 'مركز', 'معهد', 'جامعة', 'حضانة', 'أخرى'];

crud(router, '/schools', {
  table: 'schools', module: 'schools', entity: 'schools',
  title: 'المدارس والجهات الدراسية', singular: 'مدرسة / جهة دراسية', plural: 'المدارس', icon: 'fa-school',
  orderBy: 'name',
  beforeRender: async function (rows) {
    const counts = await db.prepare('SELECT school, COUNT(*) AS n FROM swimmers WHERE school IS NOT NULL AND school != \'\' GROUP BY school').all();
    const m = {};
    counts.forEach(c => { m[c.school] = c.n; });
    return rows.map(r => ({ ...r, swimmers_count: m[r.name] || 0 }));
  },
  columns: [
    { key: 'name', label: 'الاسم', html: row => `<b><i class="fas fa-school text-primary"></i> ${row.name}</b>` },
    { key: 'type', label: 'النوع', html: row => `<span class="badge badge-primary">${row.type}</span>` },
    { key: 'city', label: 'المدينة', html: row => row.city || '—' },
    { key: 'swimmers_count', label: 'السباحون', html: row => `<span class="badge badge-info">${row.swimmers_count} سباح</span>` }
  ],
  filters: async () => [
    { name: 'type', label: 'النوع', options: SCHOOL_TYPES.map(v => ({ value: v, label: v })) },
    { name: 'city', label: 'المدينة', options: (await db.prepare("SELECT DISTINCT city FROM schools WHERE city IS NOT NULL AND city != '' ORDER BY city").all()).map(c => ({ value: c.city, label: c.city })) }
  ],
  fields: [
    { key: 'name', label: 'اسم المدرسة / الجهة الدراسية', type: 'text', required: true, full: true, hint: 'يُستخدم هذا الاسم في ملف السباح' },
    { key: 'type', label: 'نوع الجهة', type: 'select', options: SCHOOL_TYPES.map(v => ({ value: v, label: v })) },
    { key: 'city', label: 'المدينة', type: 'text' },
    { key: 'notes', label: 'ملاحظات', type: 'textarea', full: true }
  ],
  view: true
});

module.exports = router;
