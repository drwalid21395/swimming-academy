/** مولد وحدات CRUD قابلة لإعادة الاستخدام */
const { db } = require('./db');
const { audit, canView, canAdd, canEdit, canDel } = require('./helpers');
const { setFlash } = require('./auth-cookie');
const { uploadFields, removeUploaded } = require('./upload');

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
  const softDelete = !!opts.softDelete;
  const uploadField = opts.upload ? opts.upload.field : null;
  const imageFields = opts.imageFields || [];
  const allFieldNames = [];
  if (uploadField) allFieldNames.push(uploadField);
  imageFields.forEach(f => { if (f !== uploadField) allFieldNames.push(f); });
  const uploadMiddle = allFieldNames.length ? uploadFields(allFieldNames) : function (req, res, next) { next(); };

  async function handleUpload(values, id, req) {
    if (!allFieldNames.length || !req.__uploads) return;
    for (const name of allFieldNames) {
      const newPath = req.__uploads[name];
      if (!newPath) continue;
      if (id) {
        const old = await db.prepare(`SELECT ${name} FROM ${table} WHERE id = ?`).get(id);
        if (old && old[name] && old[name] !== newPath) removeUploaded(old[name]);
      }
      values[name] = newPath;
    }
  }

  /* القائمة */
  app.get(base, async function (req, res) {
    if (!canView(req.currentUser, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
    let rows = softDelete
      ? await db.prepare(`SELECT * FROM ${table} WHERE deleted_at IS NULL ${opts.orderBy ? 'ORDER BY ' + opts.orderBy : ''}`).all()
      : await db.prepare(`SELECT * FROM ${table} ${opts.orderBy ? 'ORDER BY ' + opts.orderBy : ''}`).all();
    if (opts.beforeRender) rows = await opts.beforeRender(rows);
    const filters = typeof opts.filters === 'function' ? await opts.filters(req.currentUser) : opts.filters;
    const page = {
      title: opts.title,
      subtitle: opts.subtitle || '',
      icon: opts.icon || 'fa-list',
      module: opts.module,
      active: opts.active || opts.module,
      columns: opts.columns,
      rows: opts.listMap ? rows.map(opts.listMap) : rows,
      filters,
      canAdd: opts.canAdd !== undefined ? opts.canAdd : canAdd(req.currentUser, opts.module),
      addUrl: opts.addUrl !== undefined ? opts.addUrl : (canAdd(req.currentUser, opts.module) ? base + '/new' : null),
      addLabel: opts.addLabel || 'إضافة جديدة',
      actions: () => opts.actions ? opts.actions(req.currentUser) : defaultActions(base, req.currentUser, opts.module, opts.view)
    };
    res.render('list', { page });
  });

  /* نموذج جديد */
  app.get(base + '/new', async function (req, res) {
    if (!canAdd(req.currentUser, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
    res.render('form', { form: await buildForm(base, opts, {}, 'POST', false) });
  });

  /* حفظ جديد */
  app.post(base + '/new', uploadMiddle, async function (req, res) {
    if (!canAdd(req.currentUser, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
    const values = buildFieldValues(await getFields(opts), req.body);
    if (opts.beforeSave) Object.assign(values, opts.beforeSave(req.body, req) || {});
    await handleUpload(values, null, req);
    const cols = Object.keys(values);
    const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(c => '?').join(',')})`;
    try {
      const info = await db.prepare(sql).run(...cols.map(c => values[c]));
      const id = info.lastInsertRowid;
      if (opts.onCreated) await opts.onCreated({ id, ...values }, req);
      audit(req.currentUser.id, req.currentUser.full_name, 'add', opts.entity || table, id, 'إضافة ' + opts.singular, req);
      return res.redirect(base + (opts.view ? '/' + id : ''));
    } catch (err) {
      return res.status(400).send('خطأ في الحفظ: ' + err.message);
    }
  });

  async function handleDelete(req, res) {
    if (!canDel(req.currentUser, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.redirect(base);
    try {
      if (opts.beforeDelete) await opts.beforeDelete(id, req);
      if (softDelete) {
        await db.prepare(`UPDATE ${opts.table} SET deleted_at = datetime('now','localtime') WHERE id = ?`).run(id);
      } else {
        await db.prepare(`DELETE FROM ${opts.table} WHERE id = ?`).run(id);
      }
      audit(req.currentUser.id, req.currentUser.full_name, 'delete', opts.entity || opts.table, id, 'حذف ' + opts.singular, req);
      if (opts.onAfterDelete) await opts.onAfterDelete(id, req);
      setFlash(res, { type: 'success', message: softDelete ? (opts.softDeleteMsg || ('تم حذف ' + opts.singular + ' مع الاحتفاظ بسجل بياناته')) : ('تم حذف ' + opts.singular + ' بنجاح') });
    } catch (e) {
      console.error('فشل حذف ' + opts.table + ' #' + req.params.id + ':', e.message);
      setFlash(res, { type: 'error', message: 'تعذّر الحذف: ' + e.message });
    }
    res.redirect(base);
  }

  /* عرض تفصيلي */
  if (opts.view) {
    app.get(base + '/:id', async function (req, res) {
      if (!canView(req.currentUser, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
      const rowId = Number(req.params.id);
      if (!Number.isSafeInteger(rowId) || rowId <= 0) return res.redirect(base);
      const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId);
      if (!row) return res.redirect(base);
      const fields = (opts.viewFields || await getFields(opts)).map(function (f) {
        let val = row[f.key];
        if (val === null || val === undefined) val = '—';
        return { label: f.label, value: f.html ? f.html(val, row) : val };
      });
      const page = {
        title: opts.title + ' — تفاصيل',
        subtitle: opts.viewTitle ? opts.viewTitle(row) : '',
        icon: opts.icon,
        fields: fields,
        canEdit: canEdit(req.currentUser, opts.module),
        editUrl: base + '/' + row.id + '/edit',
        canDelete: canDel(req.currentUser, opts.module),
        deleteUrl: base + '/' + row.id + '/delete',
        backUrl: base
      };
      res.render('detail', { page });
    });

    app.get(base + '/:id/edit', async function (req, res) {
      if (!canEdit(req.currentUser, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
      const rowId = Number(req.params.id);
      if (!Number.isSafeInteger(rowId) || rowId <= 0) return res.redirect(base);
      const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId);
      if (!row) return res.redirect(base);
      res.render('form', { form: await buildForm(base, opts, row, 'POST', true) });
    });

    app.post(base + '/:id/edit', uploadMiddle, async function (req, res) {
      if (!canEdit(req.currentUser, opts.module)) return res.status(403).render('errors/403', { layout: false, user: req.currentUser });
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).send('معرف غير صالح');
      const values = buildFieldValues(await getFields(opts), req.body);
      if (opts.beforeSave) Object.assign(values, opts.beforeSave(req.body, req) || {});
      await handleUpload(values, id, req);
      const sets = Object.keys(values).map(k => `${k} = ?`).join(', ');
      try {
        await db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...Object.values(values), id);
        if (opts.onUpdated) await opts.onUpdated({ id, ...values }, req);
        audit(req.currentUser.id, req.currentUser.full_name, 'edit', opts.entity || table, id, 'تعديل ' + opts.singular, req);
        return res.redirect(base + '/' + id);
      } catch (err) {
        return res.status(400).send('خطأ في التعديل: ' + err.message);
      }
    });

    app.post(base + '/:id/delete', handleDelete);
  } else {
    /* حذف مباشر من القائمة */
    app.post(base + '/:id/delete', handleDelete);
  }
};

function defaultActions(base, user, module, view) {
  return function (row) {
    const actions = [];
    if (view && canView(user, module)) actions.push({ label: 'عرض', icon: 'fa-eye', href: base + '/' + row.id });
    if (view && canEdit(user, module)) actions.push({ label: 'تعديل', icon: 'fa-pen', href: base + '/' + row.id + '/edit' });
    if (canDel(user, module)) actions.push({ label: 'حذف', icon: 'fa-trash', href: base + '/' + row.id + '/delete', confirm: 'هل أنت متأكد من الحذف؟', cls: 'text-danger' });
    return actions;
  };
}

async function getFields(opts) {
  return typeof opts.fields === 'function' ? await opts.fields() : opts.fields;
}

async function buildForm(base, opts, values, method, isEdit) {
  const fieldDefs = await getFields(opts);
  const fields = fieldDefs.map(function (f) {
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
    encType: fieldDefs.some(function (f) { return f.type === 'file'; }) ? 'multipart/form-data' : '',
    fields,
    values: values || {},
    submitLabel: isEdit ? 'حفظ التعديلات' : opts.submitLabel || 'إضافة',
    cancelUrl: base,
    csrf: ''
  };
}
