/** مولد وحدات CRUD قابلة لإعادة الاستخدام */
const { db } = require('./db');
const { audit, canView, canAdd, canEdit, canDel, parseJSON } = require('./helpers');
const { upload, removeUploaded } = require('./upload');

function buildFieldValues(fields, body) {
  const values = {};
  for (const f of fields) {
    if (body[f.key] === undefined) continue;
    let val = body[f.key];
    if (f.type === 'checkbox') val = val === '1' || val === 1 ? 1 : 0;
    if (f.json) val = JSON.stringify(val);
    if (f.number && val !== '') val = Number(val);
    values[f.key] = val;
  }
  return values;
}

/**
 * opts: { table, module, title, icon, columns, fields, filters, orderBy,
 *         view: bool, viewFields, listMap(row), beforeSave(body), searchCols,
 *         canAdd, canEdit, canDel, onCreated(row), onUpdated(row) }
 */
module.exports = function crud(app, base, opts) {
  const { table } = opts;
  const uploadField = opts.upload ? opts.upload.field : null;
  const uploadMiddle = uploadField ? upload.single(uploadField) : function (req, res, next) { next(); };

  function handleUpload(values, id) {
    if (!uploadField || !values.__file) return;
    const newPath = '/uploads/' + values.__file;
    delete values.__file;
    if (id) {
      const old = db.prepare(`SELECT ${uploadField} FROM ${table} WHERE id = ?`).get(id);
      if (old && old[uploadField] && old[uploadField] !== newPath) removeUploaded(old[uploadField]);
    }
    values[uploadField] = newPath;
  }

  /* القائمة */
  app.get(base, function (req, res) {
    if (!canView(req.session.user, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.session.user });
    const rows = db.prepare(`SELECT * FROM ${table} ${opts.orderBy ? 'ORDER BY ' + opts.orderBy : ''}`).all();
    const page = {
      title: opts.title,
      subtitle: opts.subtitle || '',
      icon: opts.icon || 'fa-list',
      module: opts.module,
      active: opts.active || opts.module,
      columns: opts.columns,
      rows: opts.listMap ? rows.map(opts.listMap) : rows,
      filters: opts.filters,
      canAdd: opts.canAdd !== undefined ? opts.canAdd : canAdd(req.session.user, opts.module),
      addUrl: opts.addUrl !== undefined ? opts.addUrl : (canAdd(req.session.user, opts.module) ? base + '/new' : null),
      addLabel: opts.addLabel || 'إضافة جديدة',
      actions: () => opts.actions ? opts.actions(req.session.user) : defaultActions(base, req.session.user, opts.module)
    };
    res.render('list', { page });
  });

  /* نموذج جديد */
  app.get(base + '/new', function (req, res) {
    if (!canAdd(req.session.user, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.session.user });
    res.render('form', { form: buildForm(base, opts, {}, 'POST', false) });
  });

  /* حفظ جديد */
  app.post(base + '/new', uploadMiddle, function (req, res) {
    if (!canAdd(req.session.user, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.session.user });
    const values = buildFieldValues(opts.fields, req.body);
    if (opts.beforeSave) Object.assign(values, opts.beforeSave(req.body, req) || {});
    if (req.file) values.__file = req.file.filename;
    handleUpload(values);
    const cols = Object.keys(values);
    const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(c => '?').join(',')})`;
    try {
      const info = db.prepare(sql).run(...cols.map(c => values[c]));
      const id = info.lastInsertRowid;
      if (opts.onCreated) opts.onCreated({ id, ...values }, req);
      audit(req.session.user.id, req.session.user.full_name, 'add', opts.entity || table, id, 'إضافة ' + opts.singular, req);
      return res.redirect(base + (opts.view ? '/' + id : ''));
    } catch (err) {
      return res.status(400).send('خطأ في الحفظ: ' + err.message);
    }
  });

  /* عرض تفصيلي */
  if (opts.view) {
    app.get(base + '/:id', function (req, res) {
      if (!canView(req.session.user, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.session.user });
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(req.params.id));
      if (!row) return res.redirect(base);
      const fields = (opts.viewFields || opts.fields).map(function (f) {
        let val = row[f.key];
        if (val === null || val === undefined) val = '—';
        return { label: f.label, value: f.html ? f.html(val, row) : val };
      });
      const page = {
        title: opts.title + ' — تفاصيل',
        subtitle: opts.viewTitle ? opts.viewTitle(row) : '',
        icon: opts.icon,
        fields: fields,
        canEdit: canEdit(req.session.user, opts.module),
        editUrl: base + '/' + row.id + '/edit',
        canDelete: canDel(req.session.user, opts.module),
        deleteUrl: base + '/' + row.id + '/delete',
        backUrl: base
      };
      res.render('detail', { page });
    });

    app.get(base + '/:id/edit', function (req, res) {
      if (!canEdit(req.session.user, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.session.user });
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(req.params.id));
      if (!row) return res.redirect(base);
      res.render('form', { form: buildForm(base, opts, row, 'POST', true) });
    });

    app.post(base + '/:id/edit', uploadMiddle, function (req, res) {
      if (!canEdit(req.session.user, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.session.user });
      const id = Number(req.params.id);
      const values = buildFieldValues(opts.fields, req.body);
      if (opts.beforeSave) Object.assign(values, opts.beforeSave(req.body, req) || {});
      if (req.file) values.__file = req.file.filename;
      handleUpload(values, id);
      const sets = Object.keys(values).map(k => `${k} = ?`).join(', ');
      try {
        db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...Object.values(values), id);
        if (opts.onUpdated) opts.onUpdated({ id, ...values }, req);
        audit(req.session.user.id, req.session.user.full_name, 'edit', opts.entity || table, id, 'تعديل ' + opts.singular, req);
        return res.redirect(base + '/' + id);
      } catch (err) {
        return res.status(400).send('خطأ في التعديل: ' + err.message);
      }
    });

    app.post(base + '/:id/delete', function (req, res) {
      if (!canDel(req.session.user, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.session.user });
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(req.params.id));
      audit(req.session.user.id, req.session.user.full_name, 'delete', opts.entity || table, Number(req.params.id), 'حذف ' + opts.singular, req);
      res.redirect(base);
    });
  } else {
    /* حذف مباشر من القائمة */
    app.post(base + '/:id/delete', function (req, res) {
      if (!canDel(req.session.user, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.session.user });
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(req.params.id));
      audit(req.session.user.id, req.session.user.full_name, 'delete', opts.entity || table, Number(req.params.id), 'حذف ' + opts.singular, req);
      res.redirect(base);
    });
  }
};

function defaultActions(base, user, module) {
  return function (row) {
    const actions = [];
    if (canEdit(user, module)) actions.push({ label: 'عرض', icon: 'fa-eye', href: base + '/' + row.id });
    if (canDel(user, module)) actions.push({ label: 'حذف', icon: 'fa-trash', href: base + '/' + row.id + '/delete', confirm: 'هل أنت متأكد من الحذف؟', cls: 'text-danger' });
    return actions;
  };
}

function buildForm(base, opts, values, method, isEdit) {
  const fields = opts.fields.map(function (f) {
    const field = { ...f, value: values[f.key] !== undefined ? values[f.key] : '' };
    if (typeof f.options === 'function') field.options = f.options(values) || [];
    return field;
  });
  return {
    title: (isEdit ? 'تعديل ' : 'إضافة ') + opts.singular,
    subtitle: opts.title,
    icon: opts.icon,
    active: opts.active || opts.module,
    action: isEdit ? base + '/' + values.id + '/edit' : base + '/new',
    encType: opts.fields.some(function (f) { return f.type === 'file'; }) ? 'multipart/form-data' : '',
    fields,
    values: values || {},
    submitLabel: isEdit ? 'حفظ التعديلات' : opts.submitLabel || 'إضافة',
    cancelUrl: base,
    csrf: ''
  };
}
