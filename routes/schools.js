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
  columns: [
    { key: 'name', label: 'الاسم', html: row => `<b><i class="fas fa-school text-primary"></i> ${row.name}</b>` },
    { key: 'type', label: 'النوع', html: row => `<span class="badge badge-primary">${row.type}</span>` },
    { key: 'city', label: 'المدينة', html: row => row.city || '—' },
    { key: 'swimmers', label: 'السباحون', html: row => { const c = db.prepare("SELECT COUNT(*) AS n FROM swimmers WHERE school = ?").get(row.name); return `<span class="badge badge-info">${c.n} سباح</span>`; } }
  ],
  filters: [
    { name: 'type', label: 'النوع', options: SCHOOL_TYPES.map(v => ({ value: v, label: v })) },
    { name: 'city', label: 'المدينة', options: db.prepare("SELECT DISTINCT city FROM schools WHERE city IS NOT NULL AND city != '' ORDER BY city").all().map(c => ({ value: c.city, label: c.city })) }
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
