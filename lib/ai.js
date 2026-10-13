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
    defaultModel: 'gemini-3.8-flash',
    hint: 'مفتاح من aistudio.google.com/apikey'
  },
  groq: {
    label: 'Groq (Llama مجاني وسريع)',
    defaultModel: 'llama-3.3-70b-versatile',
    hint: 'مفتاح مجاني من console.groq.com'
  },
  openrouter: {
    label: 'OpenRouter (نماذج مجانية متنوعة)',
    defaultModel: 'google/gemini-3.8-flash:free',
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

function buildUserPrompt({ clientMessage, guardianName, swimmerName }) {
  const who = [];
  if (guardianName) who.push('ولي الأمر: ' + guardianName);
  if (swimmerName) who.push('اللاعب: ' + swimmerName);
  return (who.length ? who.join(' — ') + '\n' : '') + 'رسالة العميل:\n' + String(clientMessage || '');
}

async function callProvider(provider, system, userPrompt, tmpCfg) {
  const s = tmpCfg || await settingsMap();
  const key = String(s.ai_api_key || '').trim();
  if (!key) return { ok: false, error: 'لم يتم إدخال مفتاح API في الإعدادات' };
  const p = PROVIDERS[provider] || PROVIDERS.gemini;
  const model = modelFor(s);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
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
  return callProvider(provider, buildSystem(s), buildUserPrompt(opts), s);
}

module.exports = { aiDraftReply, PROVIDERS, DEFAULT_MODEL: PROVIDERS.gemini.defaultModel, settingsMap };