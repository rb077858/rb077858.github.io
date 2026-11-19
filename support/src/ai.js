// Automatic translation between a customer and an agent who don't share a language — Gemini API.
// The admin pastes a Gemini API key in Settings → Translation (or sets the GEMINI_API_KEY secret).

export const DEFAULT_MODEL = 'gemini-flash-latest';

// Languages offered in the dashboard's pickers. Detection can return any ISO 639-1 code.
export const LANGS = {
  he: 'Hebrew', en: 'English', ar: 'Arabic', ru: 'Russian', fr: 'French', es: 'Spanish', de: 'German',
  am: 'Amharic', uk: 'Ukrainian', it: 'Italian', pt: 'Portuguese', tr: 'Turkish', pl: 'Polish', ro: 'Romanian',
  nl: 'Dutch', hu: 'Hungarian', fa: 'Persian', hi: 'Hindi', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', yi: 'Yiddish', ti: 'Tigrinya', ka: 'Georgian', el: 'Greek',
};

export const cleanLang = code => {
  const c = String(code || '').toLowerCase().trim().slice(0, 8).split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(c) ? c : '';
};

export const langName = code => LANGS[code] || code;

async function generateText({ key, model, base }, system, input, { temperature = 0, json = true } = {}) {
  // input: a text, or the turns of a conversation [{ role: 'user' | 'model', text }]
  const contents = Array.isArray(input)
    ? input.map(t => ({ role: t.role === 'model' ? 'model' : 'user', parts: [{ text: t.text }] }))
    : [{ role: 'user', parts: [{ text: input }] }];
  const res = await fetch(`${base || 'https://generativelanguage.googleapis.com'}/v1beta/models/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
}

const unfence = out => out.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
const parseJsonText = out => JSON.parse(unfence(out));

/**
 * The same, but forgiving about the usual slip of a model: a double quote inside a text that was not escaped
 * (100 ש"ח, 5" screen). A quote inside a string is the end of the string only if what follows is , } ] or :.
 */
export function parseLoose(out) {
  const text = unfence(String(out).trim());
  try { return JSON.parse(text); } catch { /* repair below */ }
  let fixed = '', inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!inString) { if (c === '"') inString = true; fixed += c; continue; }
    if (escaped) { escaped = false; fixed += c; continue; }
    if (c === '\\') { escaped = true; fixed += c; continue; }
    if (c === '"') {
      const next = text.slice(i + 1).match(/\S/);
      if (!next || ',}]:'.includes(next[0])) { inString = false; fixed += c; } else fixed += '\\"';
      continue;
    }
    fixed += c === '\n' ? '\\n' : c;
  }
  return JSON.parse(fixed);
}
const generate = async (cfg, system, text) => parseJsonText(await generateText(cfg, system, text));

/**
 * One reply of an AI agent. turns: [{ role: 'user' | 'model', text }] ending with the customer's message.
 * Returns { reply, handoff, pay, gift, coupon, upgrade, pack, look_up, ask_team, close } (the model is told to answer in JSON; plain text is taken as the reply).
 */
export async function converse(cfg, system, turns) {
  // Gemini wants the conversation to start with the customer and to alternate: neighbours of one side are merged.
  const merged = [];
  for (const t of turns) {
    const text = String(t.text || '').trim();
    if (!text) continue;
    const last = merged.at(-1);
    if (last && last.role === t.role) last.text += '\n' + text;
    else merged.push({ role: t.role, text });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  if (!merged.length) throw new Error('nothing to answer');
  const out = await generateText(cfg, system, merged, { temperature: 0.4 });
  let r;
  try { r = parseLoose(out); } catch {
    // Text that is plainly not JSON is the reply (the model forgot the format). Anything that looks like JSON but is broken is NEVER
    // sent to a customer: it is an error, and the caller tries again or hands the chat over.
    if (/^\s*[{\[`]/.test(out) || /"reply"\s*:/.test(out)) throw new Error('the model answered with JSON that could not be read');
    r = { reply: out };
  }
  return {
    reply: typeof r?.reply === 'string' ? r.reply.trim() : '',
    handoff: r?.handoff === true,
    pay: r?.pay && typeof r.pay === 'object' ? r.pay : null,
    gift: r?.gift && typeof r.gift === 'object' ? r.gift : null,
    coupon: r?.coupon && typeof r.coupon === 'object' ? r.coupon : null,
    upgrade: r?.upgrade && typeof r.upgrade === 'object' ? r.upgrade : null,
    pack: r?.pack && typeof r.pack === 'object' ? r.pack : null,
    // it said it would look into it / ask the team: what, so that the chat does it and calls it again
    look_up: r?.look_up ? String(r.look_up).slice(0, 40) : '',
    ask_team: r?.ask_team && (typeof r.ask_team === 'string' || typeof r.ask_team === 'object') ? r.ask_team : null,
    close: r?.close === true,
  };
}

/** ISO 639-1 code of the language `text` is written in, or '' when it can't tell (e.g. "ok", "👍"). */
export async function detectLanguage(cfg, text) {
  const r = await generate(cfg,
    'You identify the language of a customer-support chat message. Reply with JSON {"lang":"<ISO 639-1 code>"}. ' +
    'If the message is too short or has no words to tell (only emoji, numbers, a name, "ok"), reply {"lang":""}. ' +
    'Hebrew or Arabic written in Latin letters still counts as that language.',
    String(text).slice(0, 1500));
  return cleanLang(r?.lang);
}

/** Translate a chat message. Returns { text, source } — source is the detected original language. */
export async function translate(cfg, text, target) {
  const r = await generate(cfg,
    `You translate customer-support chat messages into ${langName(target)} (${target}). ` +
    'Keep the tone, emoji, line breaks, URLs, email addresses, numbers, names and code exactly as they are. ' +
    'Translate only — never answer the message or add notes. ' +
    'Reply with JSON {"source":"<ISO 639-1 code of the original>","text":"<the translation>"}. ' +
    `If the message is already in ${langName(target)}, return it unchanged.`,
    String(text).slice(0, 5000));
  const out = typeof r?.text === 'string' ? r.text.trim() : '';
  if (!out) throw new Error('empty translation');
  return { text: out.slice(0, 6000), source: cleanLang(r.source) };
}

/** An independent reviewer's verdict: { allow, reason, missing }. Anything but a clear "allow" is a no. */
export async function judge(cfg, system, text) {
  const r = parseJsonText(await generateText(cfg, system, text, { temperature: 0 }));
  return { allow: r?.allow === true, reason: String(r?.reason || '').slice(0, 300), missing: String(r?.missing || '').slice(0, 300) };
}
