/**
 * طبقة عزل متعددة الأكاديميات (Multi-Tenant Scoping)
 *
 * تُحقن شرط `academy_id = <id>` في استعلامات SQL الخاصة بالأكاديميات بناءً على
 * سياق المستأجر النشط (lib/tenant-context.js).
 *
 * يعتمد التنفيذ على Tokenizer بسيط يمشي على الاستعلام مرة واحدة ويتتبّع
 * مستوى الأقواس لتحديد الجملة الرئيسية (FROM/INTO/UPDATE/DELETE) وجملة WHERE
 * الرئيسية قبل أي ORDER BY / LIMIT / GROUP BY ، ثم يحقن الشرط في نقطة واحدة.
 *
 * الاستعلامات الفرعية المقترنة تُعزل بتمريرة ثانية حذرة (SELECT ... FROM <tenant>).
 * القيمة تُحقن كحرفية عددية صحيحة، فلا تتغيّر مواضع الوسائط (?) إطلاقاً.
 *
 * أي حالة معقّدة لا يمكن معالجتها بأمان تُعاد دون تعديل.
 */

/* الجداول المملوكة لكل أكاديمية (تُعزل) */
const TENANT_TABLES = new Set([
  'swimmers', 'guardians', 'coaches', 'staff', 'programs', 'levels', 'groups',
  'sessions', 'attendance', 'assessments', 'tests', 'teams', 'competitions',
  'subscriptions', 'payments', 'revenues', 'expenses', 'coach_payments',
  'incoming_docs', 'outgoing_docs', 'documents', 'notifications', 'complaints',
  'branches', 'pools', 'schools', 'users',
  'announcements', 'swimmer_group', 'swimmer_transfers', 'level_progress',
  'assessment_criteria', 'team_members', 'competition_results',
  'player_measurements', 'subscription_history', 'notification_recipients',
  'messages', 'file_blobs', 'whatsapp_messages',
  'trainer_session_attendance', 'staff_attendance', 'trainer_rates', 'staff_rates',
  'salary_adjustments', 'payroll', 'payroll_transactions', 'attendance_policy'
]);

/* جداول مشتركة على مستوى المنصة تُستبعد دائماً */
const ALWAYS_SHARED = new Set(['plans', 'academies', 'academy_subscriptions', 'payments_history', 'payment_requests', 'settings', 'audit_log', 'password_reset_requests', 'sqlite_sequence', 'roles']);

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';
const identRe = new RegExp(IDENT, 'i');

function isTenantTable(name) {
  name = String(name || '').toLowerCase();
  if (ALWAYS_SHARED.has(name)) return false;
  return TENANT_TABLES.has(name);
}

/**
 * يجد المؤشرات التالية على المستوى الرئيسي (خارج الأقواس) في النص:
 *  - أول موضع للكلمة الرئيسية (FROM/INTO/UPDATE/DELETE) بعد بداية الاستعلام
 *  - أول جملة WHERE أو ORDER/LIMIT/GROUP/HAVING بعد ذلك من نفس المستوى.
 * نعيد مصفوفة نحلل بها الاستعلام.
 */
function findTopLevelClause(sql, keyword) {
  // نبحث عن أول تواجد للكلمة على المستوى الرئيسي
  let depth = 0;
  const re = new RegExp('\\b' + keyword + '\\b', 'i');
  let m;
  const searchFrom = 0;
  // نمشي حرفاً بحرف مع تتبع الأقواس والنصوص
  const tokens = tokenize(sql);
  // نبحث عن موضع الكلمة الرئيسية عند العمق 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'kw' && t.value.toUpperCase() === keyword.toUpperCase() && t.depth === 0) {
      return t.index;
    }
  }
  return -1;
}

/**
 * Tokenizer خفيف: ينتج قائمة بعناصر (نوع، قيمة، فهرس بداية، عمق).
 * لا يلتفت لتفاصيل المعرّفات، فقط يحدد الأقواس والكلمات.
 */
function tokenize(sql) {
  const tokens = [];
  let depth = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    // اقتباس نصي '...' أو "..."
    if (ch === "'" || ch === '"') {
      const q = ch;
      let j = i + 1;
      while (j < n && sql[j] !== q) { if (sql[j] === '\\') j++; j++; }
      tokens.push({ type: 'str', value: sql.slice(i, Math.min(j + 1, n)), index: i, depth });
      i = j + 1;
      continue;
    }
    // رقم
    if (/\d/.test(ch)) {
      let j = i;
      while (j < n && /[\d.]/.test(sql[j])) j++;
      tokens.push({ type: 'num', value: sql.slice(i, j), index: i, depth });
      i = j;
      continue;
    }
    // معرّف أو كلمة
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      const word = sql.slice(i, j);
      tokens.push({ type: 'kw', value: word, index: i, depth });
      i = j;
      continue;
    }
    if (ch === '(') { tokens.push({ type: '(', value: '(', index: i, depth }); depth++; i++; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); tokens.push({ type: ')', value: ')', index: i, depth }); i++; continue; }
    // أي رمز آخر
    tokens.push({ type: 'sym', value: ch, index: i, depth });
    i++;
  }
  return tokens;
}

/* يجد أول ظهور لكلمة عند العمق الرئيسي (0) يلي موضعاً معيناً */
function findKwAtDepth(tokens, kw, afterIndex) {
  for (const t of tokens) {
    if (t.depth === 0 && t.type === 'kw' && t.value.toUpperCase() === kw.toUpperCase() && t.index > afterIndex) {
      return t;
    }
  }
  return null;
}

/* يبحث عن جملة WHERE/ORDER/LIMIT/GROUP/HAVING بعد فهرس معين عند العمق الرئيسي */
function findTailClause(sql, fromEndIdx) {
  const tokens = tokenize(sql);
  for (const t of tokens) {
    if (t.depth !== 0 || t.type !== 'kw' || t.index <= fromEndIdx) continue;
    const w = t.value.toUpperCase();
    if (w === 'WHERE' || w === 'ORDER' || w === 'LIMIT' || w === 'GROUP' || w === 'HAVING') {
      return { kw: w, index: t.index };
    }
  }
  return null;
}

/* يجد موضع نهاية كلمة معيّنة (مثل FROM) في النص من فهرسها */
function kwEnd(sql, kwIndex) {
  const m = /\b[A-Za-z_]+\b/.exec(sql.slice(kwIndex));
  return kwIndex + m[0].length;
}

/* كلمات SQL محجوزة: لا تُعتبر اسماً مستعاراً بعد اسم الجدول */
const RESERVED = new Set(['WHERE','ORDER','LIMIT','GROUP','HAVING','JOIN','LEFT','RIGHT','INNER','OUTER','CROSS','ON','AS','BY','AND','OR','SELECT','FROM','INSERT','INTO','UPDATE','DELETE','SET','VALUES','WHEN','THEN','ELSE','END','CASE','NOT','EXISTS','IN','BETWEEN','IS','NULL','LIKE','DISTINCT','UNION','ALL','ASC','DESC','COALESCE','COUNT','SUM','AVG','MIN','MAX','DATE','CHECK','DEFAULT']);

/* يقرأ أول جدول بعد كلمة (FROM/INTO) واسمه المستعار اختيارياً،
   مع التوقف عند أي كلمة محجوزة. */
function readTableAfterKeyword(sql, kwIndex) {
  const after = sql.slice(kwEnd(sql, kwIndex)); // يبدأ مباشرة بعد الكلمة المحجوزة
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/.exec(after);
  if (!m) return null;
  let alias = null;
  // لا نقبل كلمة محجوزة كاسم مستعار (مثل WHERE/ORDER بعد اسم الجدول)
  if (m[2] && !RESERVED.has(m[2].toUpperCase())) alias = m[2];
  return { table: m[1].toLowerCase(), alias: alias || m[1] };
}

/* ---------- UPDATE ---------- */
function scopeUpdate(sql, academyId) {
  const um = new RegExp('^\\s*UPDATE\\s+(' + IDENT + ')', 'i').exec(sql);
  if (!um) return sql;
  const table = um[1].toLowerCase();
  if (!isTenantTable(table)) return sql;
  const afterUpdate = um.index + um[0].length;
  const ai = parseInt(academyId, 10);
  if (!isFinite(ai)) return sql;

  const tail = findTailClause(sql, afterUpdate);
  if (tail) {
    if (tail.kw === 'WHERE') {
      return sql.slice(0, tail.index) + 'WHERE ' + table + '.academy_id = ' + ai + ' AND ' + sql.slice(tail.index + 5);
    }
    // لا WHERE: ندرج قبل ORDER/LIMIT...
    return sql.slice(0, tail.index) + 'WHERE ' + table + '.academy_id = ' + ai + ' ' + sql.slice(tail.index);
  }
  return sql + ' WHERE ' + table + '.academy_id = ' + ai;
}

/* ---------- DELETE ---------- */
function scopeDelete(sql, academyId) {
  const dm = new RegExp('^\\s*DELETE\\s+FROM\\s+(' + IDENT + ')', 'i').exec(sql);
  if (!dm) return sql;
  const table = dm[1].toLowerCase();
  if (!isTenantTable(table)) return sql;
  const afterDelete = dm.index + dm[0].length;
  const ai = parseInt(academyId, 10);
  if (!isFinite(ai)) return sql;

  const tail = findTailClause(sql, afterDelete);
  if (tail) {
    if (tail.kw === 'WHERE') {
      return sql.slice(0, tail.index) + 'WHERE ' + table + '.academy_id = ' + ai + ' AND ' + sql.slice(tail.index + 5);
    }
    return sql.slice(0, tail.index) + 'WHERE ' + table + '.academy_id = ' + ai + ' ' + sql.slice(tail.index);
  }
  return sql + ' WHERE ' + table + '.academy_id = ' + ai;
}

/* ---------- INSERT ---------- */
function scopeInsert(sql, academyId) {
  const im = new RegExp('^\\s*INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+(' + IDENT + ')', 'i').exec(sql);
  if (!im) return sql;
  const table = im[1].toLowerCase();
  if (!isTenantTable(table)) return sql;
  const ai = parseInt(academyId, 10);
  if (!isFinite(ai)) return sql;

  const afterInto = sql.indexOf(im[0]) + im[0].length;
  const rest = sql.slice(afterInto);

  // بعد INTO اكتمل اسم الجدول؛ يتبقّى (اختيارياً) قائمة الأعمدة ثم إما VALUES أو SELECT
  const colGroupRel = /^\s*(\((?:[^()]|\([^()]*\))*\))?/.exec(rest);
  const afterTable = afterInto + (colGroupRel ? colGroupRel[0].length : 0);
  const tailText = sql.slice(afterTable);

  // INSERT ... SELECT
  const sel = /^\s*SELECT\b/i.test(tailText);
  if (sel) {
    const selIdx = afterTable + (/^\s*/i.exec(tailText)[0].length);
    const selSlice = sql.slice(selIdx);
    const scoped = scopeSelect(selSlice, academyId, true);
    if (scoped !== selSlice) return sql.slice(0, selIdx) + scoped;
    return sql;
  }

  // INSERT ... VALUES  (نضيف عموداً + قيمة حرفية)
  const colOpen = sql.indexOf('(', afterInto);
  if (colOpen === -1) return sql;
  // نجد قوس الأعمدة المغلق عند العمق 0
  let depth = 0;
  let colClose = -1;
  for (let i = colOpen; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') { depth--; if (depth === 0) { colClose = i; break; } }
  }
  if (colClose === -1) return sql;
  let cols = sql.slice(colOpen + 1, colClose);
  if (!cols.trim()) return sql;
  // يمنع الإضافة المزدوجة
  if (/academy_id/i.test(cols)) return sql;

  // نبحث عن VALUES بعد colClose
  const valsRe = /\bVALUES\b/i.exec(sql.slice(colClose));
  if (!valsRe) return sql; // DEFAULT VALUES
  const valsKwPos = colClose + valsRe.index;
  const vOpen = sql.indexOf('(', valsKwPos);
  if (vOpen === -1) return sql;
  let v2 = 0, vClose = -1;
  for (let i = vOpen; i < sql.length; i++) {
    if (sql[i] === '(') v2++;
    else if (sql[i] === ')') { v2--; if (v2 === 0) { vClose = i; break; } }
  }
  if (vClose === -1) return sql;
  const newCols = cols + ', academy_id';
  const newVals = sql.slice(vOpen + 1, vClose) + ', ' + ai;
  return sql.slice(0, colOpen + 1) + newCols + sql.slice(colClose, vOpen + 1) + newVals + sql.slice(vClose);
}

/* جلب مؤشرات UNION على المستوى الرئيسي (خارج الأقواس) */
function topLevelUnionIndices(sql) {
  const tokens = tokenize(sql);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.depth === 0 && t.type === 'kw' && t.value.toUpperCase() === 'UNION') {
      out.push(t.index);
    }
  }
  return out;
}

/* معالجة SELECT يحتوي Union: يُعالج كل فرع على حدة */
function scopeUnion(sql, academyId) {
  const unions = topLevelUnionIndices(sql);
  if (!unions.length || /^\s*SELECT\b/i.test(sql) === false) return null;
  // نقسّم: الفرع الأول قبل أول UNION، ثم كل فرع بعد كل UNION
  let parts = [];
  let prev = 0;
  for (const u of unions) {
    parts.push({ text: sql.slice(prev, u), union: true });
    prev = u;
  }
  // الفرع الأخير قد ينتهي بـ ORDER BY/LIMIT خاص بالـ UNION كاملة
  parts.push({ text: sql.slice(prev), union: false });

  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i === 0) {
      out += scopeSelect(p.text, academyId, false);
      continue;
    }
    // الفروع التالية تبدأ بـ UNION ALL / UNION ثم SELECT
    const km = /^(UNION\s+ALL\s+|UNION\s+)([\s\S]*)$/i.exec(p.text);
    const km2 = /^(UNION\s+)(ALL\s+)?/i.exec(p.text);
    if (!km) { out += p.text; continue; }
    const unionKw = km2[1] + (km2[2] || '');
    if (out && !/\s$/.test(out) && /^\S/.test(unionKw)) out += ' ';
    out += unionKw.replace(/\s+$/, ' ') + ' ';
    const selectBody = km[2];
    out += scopeSelect(selectBody, academyId, false);
  }
  return out;
}

/* ---------- SELECT ---------- */
function scopeSelect(sql, academyId, isSub) {
  // إن كان يحتوي Union على المستوى الرئيسي نعالجه فرعاً فرعاً
  const unioned = scopeUnion(sql, academyId);
  if (unioned !== null) return unioned;

  // الجدول الرئيسي بعد أول FROM على المستوى الرئيسي
  const tokens = tokenize(sql);
  let fromTok = null;
  for (const t of tokens) {
    if (t.type === 'kw' && t.value.toUpperCase() === 'FROM' && t.depth === 0) { fromTok = t; break; }
  }
  if (!fromTok) return sql;

  const first = readTableAfterKeyword(sql, fromTok.index);
  if (!first) return sql;
  const primaryIsTenant = isTenantTable(first.table);
  const ai = parseInt(academyId, 10);
  if (!isFinite(ai)) return sql;

  // جملة ذيلية (WHERE/ORDER/LIMIT/GROUP) بعد جملة FROM (منذ موضعها وليس نهاية الجدول)
  const tail = findTailClause(sql, fromTok.index);

  let result = sql;

  if (primaryIsTenant) {
    if (tail && tail.kw === 'WHERE') {
      result = sql.slice(0, tail.index) + 'WHERE ' + first.alias + '.academy_id = ' + ai + ' AND ' + sql.slice(tail.index + 5);
    } else if (tail) {
      result = sql.slice(0, tail.index) + 'WHERE ' + first.alias + '.academy_id = ' + ai + ' ' + sql.slice(tail.index);
    } else {
      result = sql + ' WHERE ' + first.alias + '.academy_id = ' + ai;
    }
  }

  // معالجة الاستعلامات الفرعية (حتى لو كان الجدول الرئيسي مشتركاً)
  return scopeSubqueries(result, academyId);
}

/* معالجة الاستعلامات الفرعية المقترنة `(SELECT ... FROM <tenant> ...)`
   نمرر على المواضع ذات العمق > 0 ونعزل الجدول الفرعي الرئيسي فيها. */
function scopeSubqueries(sql, academyId) {
  // نتعامل مع كل قوس مفتوح ونبحث عن أول SELECT ... FROM داخل ذلك القوس
  const tokens = tokenize(sql);
  // نجمّع الأقواس المتطابقة
  const stack = [];
  const groups = []; // {open, close, selectFrom, firstTable}
  for (const t of tokens) {
    if (t.type === '(') stack.push(t);
    else if (t.type === ')') {
      const open = stack.pop();
      if (open) groups.push({ openIndex: open.index, closeIndex: t.index });
    }
  }
  // لكل قوس، نفحص إن كان يبدأ بـ SELECT ونعزل جدوله الأول
  let out = sql;
  const edits = [];
  for (const g of groups) {
    const inner = sql.slice(g.openIndex + 1, g.closeIndex);
    if (!/^\s*SELECT\b/i.test(inner)) continue;
    // موضع كلمة FROM داخل inner
    const fromIdx = new RegExp('\\bFROM\\b', 'i').exec(inner);
    if (!fromIdx) continue;
    const fromTokIndex = fromIdx.index;
    const first = readTableAfterKeyword(inner, fromTokIndex);
    if (!first) continue;
    if (!isTenantTable(first.table)) continue;
    const alias = first.alias;
    const ai = parseInt(academyId, 10);
    if (!isFinite(ai)) continue;
    const itail = findTailClause(inner, fromTokIndex);
    let newInner;
    if (itail && itail.kw === 'WHERE') {
      newInner = inner.slice(0, itail.index) + 'WHERE ' + alias + '.academy_id = ' + ai + ' AND ' + inner.slice(itail.index + 5);
    } else if (itail) {
      newInner = inner.slice(0, itail.index) + 'WHERE ' + alias + '.academy_id = ' + ai + ' ' + inner.slice(itail.index);
    } else {
      newInner = inner + ' WHERE ' + alias + '.academy_id = ' + ai;
    }
    edits.push({ start: g.openIndex + 1, end: g.closeIndex, inner, newInner });
  }
  // نطبّق التعديلات من الخلف للأمام
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    // نتأكد أن النص الحالي لا يزال مطابقاً (بعد التعديلات السابقة في الأعمق)
    if (out.slice(e.start, e.end) === e.inner) {
      out = out.slice(0, e.start) + e.newInner + out.slice(e.end);
    } else {
      // محاولة إعادة التوافق بالبحث
    }
  }
  return out;
}

/* الواجهة الرئيسية */
function scopeSql(sql, academyId) {
  if (!sql || typeof sql !== 'string' || !academyId) return sql;
  const trimmed = sql.replace(/^\s+/, '');
  const m = /^(SELECT|WITH\s+SELECT|INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)/i.exec(trimmed);
  if (!m) return sql;
  const head = m[1].toUpperCase();
  try {
    if (head.indexOf('SELECT') === 0) return scopeSelect(sql, academyId, false);
    if (head.indexOf('UPDATE') === 0) return scopeUpdate(sql, academyId);
    if (head.indexOf('DELETE') === 0) return scopeDelete(sql, academyId);
    if (head.indexOf('INSERT') === 0) return scopeInsert(sql, academyId);
  } catch (e) {
    return sql;
  }
  return sql;
}

module.exports = { scopeSql, isTenantTable, TENANT_TABLES };
