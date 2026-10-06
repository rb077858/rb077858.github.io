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

const langName = code => LANGS[code] || code;

async function generate({ key, model, base }, system, text) {
  const res = await fetch(`${base || 'https://generativelanguage.googleapis.com'}/v1beta/models/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const out = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  return JSON.parse(out.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
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
