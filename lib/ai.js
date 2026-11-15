/** مساعد الردود الذكية للعملاء عبر مزوّدي ذكاء اصطناعي مجانيين (Gemini / Groq / OpenRouter)
 *  تفاعل مباشر عبر REST و fetch المدمج — بدون أي مكتبات خارجية. */
const { db } = require('./db');

async function settingsMap() {
  const rows = await db.all('SELECT key, value FROM settings');
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return s;
}

const PROVIDERS = {
  gemini: {
    label: 'Google Gemini (مجاني)',
    defaultModel: 'gemini-1.5-flash-latest',
    hint: 'مفتاح من aistudio.google.com/apikey'
  },
  groq: {
    label: 'Groq (Llama مجاني وسريع)',
    defaultModel: 'llama-3.3-70b-versatile',
    hint: 'مفتاح مجاني من console.groq.com'
  },
  openrouter: {
    label: 'OpenRouter (نماذج مجانية متنوعة)',
    defaultModel: 'google/gemini-2.0-flash-lite-preview-02-05:free',
    hint: 'مفتاح من openrouter.ai'
  }
};

function modelFor(s) {
  const def = PROVIDERS[s.ai_provider] || PROVIDERS.gemini;
  return String(s.ai_model || def.defaultModel).trim() || def.defaultModel;
}

/* صياغة توجيهات النظام المشتركة لكل المزوّدين */
function buildSystem(s) {
  const academyName = String(s.site_name || 'الأكاديمية').trim();
  const tone = String(s.ai_tone || 'مهني').trim();
  const maxLen = Math.min(Math.max(parseInt(s.ai_max_length || '300', 10) || 300, 100), 1000);
  const instructions = String(s.ai_instructions || '').trim();
  return [
    'أنت مساعد الرد على العملاء في أكاديمية سباحة اسمها "' + academyName + '".',
    'ردّ دائماً باللغة العربية فقط، بأسلوب ' + tone + '، مهذّب ومختصر، وبصيغة مباشرة تتحدث فيها بالأكاديمية.',
    instructions ? 'تعليمات إضافية من إدارة الأكاديمية: ' + instructions : '',
    'لا تذكر أبداً أنك ذكاء اصطناعي أو نموذج لغوي.',
    'إن كان السؤال خارج اختصاص الأكاديمية، اعتذر بلطف واطلب التواصل هاتفياً مع الإدارة.',
    'ألّا يزيد طول الرد عن ' + maxLen + ' حرفاً.'
  ].filter(Boolean).join('\n');
}

function buildUserPrompt({ clientMessage, guardianName, swimmerName, contextPrepend }) {
  const parts = [];
  if (contextPrepend) parts.push('بيانات الأكاديمية الحالية (حدّث منها إجابتك):\n' + String(contextPrepend));
  const who = [];
  if (guardianName) who.push('ولي الأمر: ' + guardianName);
  if (swimmerName) who.push('اللاعب: ' + swimmerName);
  parts.push((who.length ? who.join(' — ') + '\n' : '') + 'رسالة العميل:\n' + String(clientMessage || ''));
  return parts.join('\n\n');
}

/* بيانات حيّة ومحدثة باستمرار من قاعدة البيانات */
async function loadSiteContext() {
  const s = await settingsMap();
  const ctx = { settings: s, programs: [], news: [], coaches: [], branches: [], sports: [] };
  try { ctx.programs = await db.prepare('SELECT name, type, price FROM programs ORDER BY name LIMIT 50').all(); } catch (e) { /* تجاهل */ }
  try { ctx.news = await db.prepare('SELECT title FROM announcements ORDER BY id DESC LIMIT 5').all(); } catch (e) { /* تجاهل */ }
  try { ctx.coaches = await db.prepare('SELECT full_name, specialization FROM coaches WHERE deleted_at IS NULL ORDER BY full_name LIMIT 30').all(); } catch (e) { /* تجاهل */ }
  try { ctx.branches = await db.prepare('SELECT name, address, phone FROM branches ORDER BY name LIMIT 20').all(); } catch (e) { /* تجاهل */ }
  try { ctx.sports = await db.prepare('SELECT name, description FROM sports ORDER BY sort_order LIMIT 20').all(); } catch (e) { /* تجاهل */ }
  return ctx;
}

async function buildAcademyContext() {
  const ctx = await loadSiteContext();
  const s = ctx.settings;
  const lines = [];
  const defs = [
    ['اسم الأكاديمية', 'site_name'], ['مواعيد العمل', 'work_hours'],
    ['هاتف التواصل', 'phone'], ['واتساب', 'whatsapp'], ['العنوان', 'address'],
    ['نبذة عن الأكاديمية', 'about'], ['اسم الإداري', 'admin_name'], ['المدير الفني', 'tech_director_name']
  ];
  for (const [label, k] of defs) {
    const v = String(s[k] || '').trim();
    if (v) lines.push(label + ': ' + v);
  }
  if (ctx.programs.length) {
    lines.push('البرامج والأسعار:');
    ctx.programs.forEach(p => lines.push(' - ' + (p.name || '') + (p.type ? ' (' + p.type + ')' : '') + (p.price != null && p.price !== '' ? ' — ' + p.price + ' ج.م' : '')));
  }
  if (ctx.news.length) {
    lines.push('آخر الأخبار:');
    ctx.news.forEach(n => lines.push(' - ' + String(n.title || '').slice(0, 80)));
  }
  if (ctx.coaches.length) {
    lines.push('فريق الكباتن والمدربين:');
    ctx.coaches.forEach(c => lines.push(' - ' + (c.full_name || '') + (c.specialization ? ' (' + c.specialization + ')' : '')));
  }
  if (ctx.branches.length) {
    lines.push('الفروع:');
    ctx.branches.forEach(b => lines.push(' - ' + (b.name || '') + (b.address ? ' — ' + b.address : '') + (b.phone ? ' — ' + b.phone : '')));
  }
  if (ctx.sports.length) {
    lines.push('الألعاب الرياضية المتاحة:');
    ctx.sports.forEach(sp => lines.push(' - ' + (sp.name || '') + (sp.description ? ' (' + String(sp.description).slice(0, 60) + ')' : '')));
  }
  return lines.join('\n') || '(لا توجد بيانات إضافية)';
}

/* رد ذكي محلي لا يحتاج API خارجية — يحلل السؤال ويبني الإجابة من بيانات الموقع */
function normalizeArabic(t) {
  return String(t || '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
}
function hasAny(msg, words) {
  const n = normalizeArabic(msg);
  return words.some(function (w) { return n.indexOf(w) !== -1; });
}
function joinList(items, limit) {
  if (!items || !items.length) return '';
  var out = items.slice(0, limit || items.length).map(function (x) { return '• ' + x; }).join('\n');
  if (items.length > (limit || items.length)) out += '\n• ...';
  return out;
}
async function localSmartReply(message) {
  const ctx = await loadSiteContext();
  const s = ctx.settings || {};
  const siteName = String(s.site_name || 'الأكاديمية').trim();
  const parts = [];

  if (hasAny(message, ['مرحب', 'السلام', 'اهلا', 'هلا', 'هاي', 'صباح', 'مساء', 'تحيه', 'مرحبا'])) {
    parts.push('أهلاً بك في ' + siteName + '! 😊 أنا مساعدك الذكي — اسألني عن البرامج، الأسعار، الكباتن، الفروع، مواعيد العمل أو طريقة التسجيل.');
  }
  if (hasAny(message, ['برنامج', 'دوره', 'دورات', 'سعر', 'اسعار', 'تكلفه', 'مصاريف', 'اشتراك', 'اشتراكات', 'تدريب', 'حصه', 'حصص'])) {
    if (ctx.programs.length) {
      var list = ctx.programs.map(function (p) { return (p.name || '') + (p.type ? ' (' + p.type + ')' : '') + (p.price != null && p.price !== '' ? ' — ' + p.price + ' ج.م' : ''); });
      parts.push('البرامج المتاحة:\n' + joinList(list, 12));
    } else {
      parts.push('لدينا برامج متنوعة لتعليم السباحة لجميع الأعمار. يمكنك الاطلاع على التفاصيل من صفحة البرامج أو التواصل معنا.');
    }
  }
  if (hasAny(message, ['كابتن', 'مدرب', 'مدربين', 'مدربون', 'coach'])) {
    if (ctx.coaches.length) {
      var list = ctx.coaches.map(function (c) { return (c.full_name || '') + (c.specialization ? ' — ' + c.specialization : ''); });
      parts.push('فريق الكباتن والمدربين:\n' + joinList(list, 15));
    } else {
      parts.push('يتكون فريقنا من مدربين معتمدين وذوي خبرة. يمكنك معرفة المزيد من صفحة الكباتن.');
    }
  }
  if (hasAny(message, ['فرع', 'فروع', 'موقع', 'عنوان', 'مكان', 'مواقع'])) {
    if (ctx.branches.length) {
      var list = ctx.branches.map(function (b) { return (b.name || '') + (b.address ? ' — ' + b.address : '') + (b.phone ? ' — ' + b.phone : ''); });
      parts.push('فروعنا:\n' + joinList(list, 10));
    } else {
      parts.push('يمكنك معرفة عنوان الفروع من صفحة التواصل معنا.');
    }
  }
  if (hasAny(message, ['مواعيد', 'ساعات', 'متى', 'فتح', 'مفتوح', 'دوام', 'عمل'])) {
    parts.push('مواعيد العمل:\n' + (s.work_hours || 'السبت - الخميس: 9 صباحاً - 9 مساءً'));
  }
  if (hasAny(message, ['هاتف', 'تليفون', 'موبايل', 'واتس', 'واتساب', 'تواصل', 'ايميل', 'بريد', 'اتصل'])) {
    var contact = [];
    if (s.phone) contact.push('📞 هاتف: ' + s.phone);
    if (s.whatsapp) contact.push('💬 واتساب: ' + s.whatsapp);
    if (s.email) contact.push('✉️ بريد: ' + s.email);
    parts.push('للتواصل مع ' + siteName + ':\n' + (contact.length ? contact.join('\n') : 'تواصل مع الإدارة عبر صفحة التواصل معنا.'));
  }
  if (hasAny(message, ['خبر', 'اخبار', 'إعلان', 'إعلانات', 'جديد', 'أخبار'])) {
    if (ctx.news.length) {
      var list = ctx.news.map(function (n) { return String(n.title || '').slice(0, 90); });
      parts.push('آخر الأخبار والإعلانات:\n' + joinList(list, 8));
    } else {
      parts.push('تابع صفحة الأخبار والإعلانات لمعرفة كل جديد.');
    }
  }
  if (hasAny(message, ['رياضه', 'رياضات', 'لعبه', 'العاب', 'نشاط', 'انشطه'])) {
    if (ctx.sports.length) {
      var list = ctx.sports.map(function (sp) { return (sp.name || '') + (sp.description ? ' (' + String(sp.description).slice(0, 50) + ')' : ''); });
      parts.push('الألعاب والأنشطة الرياضية:\n' + joinList(list, 10));
    } else {
      parts.push('نقدم العديد من الأنشطة الرياضية بالإضافة للسباحة. تفقد صفحة الألعاب الرياضية.');
    }
  }
  if (hasAny(message, ['عن', 'معلومات', 'تعريف'])) {
    parts.push(String(s.about || 'نحن ' + siteName + '، أكاديمية متخصصة في تعليم السباحة لجميع الأعمار وفق أعلى معايير السلامة والاحتراف.'));
  }
  if (hasAny(message, ['سجل', 'اشترك', 'حجز', 'احجز', 'تسجيل', 'اشتراك', 'انضم'])) {
    parts.push('للتسجيل أو حجز مكان، يمكنك التواصل معنا مباشرة' + (s.whatsapp ? ' عبر واتساب ' + s.whatsapp : '') + (s.phone ? ' أو الاتصال على ' + s.phone : '') + '، كما يمكنك تعبئة نموذج الحجز على الموقع.');
  }

  if (!parts.length) {
    parts.push('أهلاً بك في ' + siteName + '! 🤖 يمكنني مساعدتك في:\n• البرامج والأسعار\n• فريق الكباتن\n• الفروع ومواعيد العمل\n• التسجيل والتواصل');
    if (ctx.programs.length) {
      var list = ctx.programs.map(function (p) { return (p.name || '') + (p.price != null && p.price !== '' ? ' (' + p.price + ' ج.م)' : ''); });
      parts.push('من البرامج المتاحة:\n' + joinList(list, 8));
    }
    if (s.phone || s.whatsapp) {
      parts.push('للمزيد تواصل معنا: ' + (s.whatsapp || s.phone));
    }
  }

  var reply = parts.join('\n\n');
  if (reply.length > 1400) reply = reply.slice(0, 1400) + '\n... (للمزيد تواصل مع الإدارة)';
  return reply;
}

async function smartPublicReply(message) {
  return localSmartReply(message);
}

async function callProvider(provider, system, userPrompt, tmpCfg) {
  const s = tmpCfg || await settingsMap();
  const key = String(s.ai_api_key || '').trim();
  if (!key) return { ok: false, error: 'لم يتم إدخال مفتاح API في الإعدادات' };
  const p = PROVIDERS[provider] || PROVIDERS.gemini;
  const model = modelFor(s);
  const ctrl = new AbortController();
  const timeoutMs = (s && s.__timeout) || 20000;
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const common = { model, temperature: 0.7, max_tokens: 1024 };

  try {
    let url, init;
    if (provider === 'groq' || provider === 'openrouter') {
      const base = provider === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
      const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
      if (provider === 'openrouter') { headers['HTTP-Referer'] = 'https://swimming-academy-system.vercel.app'; headers['X-Title'] = 'Swim Academy'; }
      url = base;
      init = {
        method: 'POST', headers, signal: ctrl.signal,
        body: JSON.stringify({ ...common, messages: [{ role: 'system', content: system }, { role: 'user', content: userPrompt }] })
      };
    } else {
      url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
      init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
        }),
        signal: ctrl.signal
      };
    }

    const r = await fetch(url, init);
    clearTimeout(t);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      let msg = 'HTTP ' + r.status + ' ' + txt.slice(0, 200);
      try { msg = String(JSON.parse(txt).error.message || msg).slice(0, 200); } catch (e) { /* نص عادي */ }
      return { ok: false, error: msg };
    }
    const j = await r.json();
    let text = '';
    if (provider === 'groq' || provider === 'openrouter') {
      text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    } else {
      text = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts)
        ? j.candidates[0].content.parts.map(x => x.text || '').join('') : '';
    }
    if (!text) {
      const reason = provider === 'gemini' ? ((j.promptFeedback && j.promptFeedback.blockReason) || 'لا نص') : ((j.choices && j.choices[0] && j.choices[0].finish_reason) || 'لا نص');
      return { ok: false, error: 'لم يتم توليد رد (' + reason + ')' };
    }
    return { ok: true, text: text.trim() };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: (e.name === 'AbortError') ? 'انتهت مهلة الاتصال بالمزوّد (20 ثانية)' : e.message };
  }
}

/**
 * توليد رد مقترح لرسالة عميل عبر المزوّد المختار في الإعدادات.
 * @returns {Promise<{ok:boolean,text?:string,error?:string}>}
 */
async function aiDraftReply(opts) {
  const s = await settingsMap();
  if (s.ai_enabled !== '1') return { ok: false, error: 'ميزة الردود الذكية غير مفعّلة من الإعدادات' };
  const provider = String(s.ai_provider || 'gemini').trim();
  if (!PROVIDERS[provider]) return { ok: false, error: 'مزوّد غير معروف: ' + provider };
  if (!String(opts.clientMessage || '').trim()) return { ok: false, error: 'أدخل نص رسالة العميل أولاً' };
  const _s = Object.assign({}, s);
  if (opts.timeoutMs) _s.__timeout = opts.timeoutMs;
  const ctx = await buildAcademyContext();
  return callProvider(provider, buildSystem(_s), buildUserPrompt(Object.assign({}, opts, { contextPrepend: ctx })), _s);
}

module.exports = { aiDraftReply, smartPublicReply, PROVIDERS, DEFAULT_MODEL: PROVIDERS.gemini.defaultModel, settingsMap, buildAcademyContext, buildContext: buildAcademyContext };