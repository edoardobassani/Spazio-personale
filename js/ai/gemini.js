// Adattatore per Google Gemini (API di Google AI Studio).
// Ogni fornitore AI ha un adattatore con le stesse due funzioni: listModels e generate.
// Il resto dell'app non sa quale fornitore sta usando.

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class AIError extends Error {
  constructor(message, code, detail = '') { super(message); this.code = code; this.detail = detail; }
}

async function call(path, key, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new AIError("Non riesco a raggiungere Google. Controlla la connessione e riprova.", 'network');
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* risposta vuota */ }
  if (!res.ok) {
    const m = (data && data.error && data.error.message) || '';
    if (res.status === 400 && /api key|API_KEY/i.test(m)) throw new AIError("La chiave API non è valida. Controllala nelle impostazioni dell'assistente.", 'key', m);
    if (res.status === 401 || res.status === 403) throw new AIError('Questa chiave non ha accesso a Gemini. Verifica di averla creata su Google AI Studio.', 'key', m);
    if (res.status === 429) {
      if (/limit:\s*0\b/.test(m)) throw new AIError('Questo modello non è incluso nel piano gratuito.', 'not-free', m);
      throw new AIError('Hai raggiunto il limite gratuito di richieste. Riprova tra un minuto; se è il limite giornaliero, domani.', 'quota', m);
    }
    if (res.status === 404) throw new AIError('Il modello scelto non è più disponibile.', 'model', m);
    if (res.status >= 500) throw new AIError('Il servizio di Google ha un problema temporaneo. Riprova tra poco.', 'server', m);
    throw new AIError(`Richiesta non riuscita (${res.status}). ${m}`.trim(), 'other', m);
  }
  return data;
}

// Ordine di preferenza: alias "flash-latest" (si aggiorna da solo), poi Flash stabili
// più recenti, poi anteprime, infine i modelli Lite.
function rank(name) {
  const n = name.replace(/^models\//, '');
  if (!/flash/.test(n) || /(image|tts|live|audio|embed|exp|thinking|robotics|computer|native|8b)/.test(n)) return null;
  const lite = /lite/.test(n), preview = /preview/.test(n), latest = /latest/.test(n);
  const ver = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
  const tier = lite ? (latest ? 4 : preview ? 5 : 3) : (latest ? 0 : preview ? 2 : 1);
  return { tier, ver };
}

export async function listModels(key) {
  const out = [];
  let token = '';
  for (let page = 0; page < 5; page++) {
    const data = await call(`/models?pageSize=200${token ? '&pageToken=' + encodeURIComponent(token) : ''}`, key);
    for (const m of data.models || []) {
      if (!(m.supportedGenerationMethods || []).includes('generateContent')) continue;
      const r = rank(m.name);
      if (r) out.push({ id: m.name, label: m.displayName || m.name.replace('models/', ''), ...r });
    }
    token = data.nextPageToken;
    if (!token) break;
  }
  return out.sort((a, b) => a.tier - b.tier || b.ver - a.ver).map(({ id, label }) => ({ id, label }));
}

// Lo schema dei parametri usa i tipi in maiuscolo, come richiesto da Gemini
function schema(s) {
  if (!s || typeof s !== 'object') return s;
  const o = { ...s };
  if (o.type) o.type = String(o.type).toUpperCase();
  if (o.properties) o.properties = Object.fromEntries(Object.entries(o.properties).map(([k, v]) => [k, schema(v)]));
  if (o.items) o.items = schema(o.items);
  return o;
}

// Converte la cronologia neutra dell'app nel formato Gemini
function toContents(history) {
  return history.map(h => {
    if (h.role === 'user') return { role: 'user', parts: [{ text: h.text }] };
    if (h.role === 'model') return h.raw; // conservato così com'è (contiene anche le "firme" del ragionamento)
    if (h.role === 'tool') {
      return {
        role: 'user',
        parts: h.results.map(r => ({ functionResponse: { name: r.name, ...(r.callId ? { id: r.callId } : {}), response: r.response } })),
      };
    }
    return null;
  }).filter(Boolean);
}

export async function generate({ key, model, system, history, tools }) {
  const body = {
    contents: toContents(history),
    systemInstruction: { parts: [{ text: system }] },
    generationConfig: { temperature: 0.6 },
  };
  if (tools && tools.length) {
    body.tools = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: schema(t.parameters) })) }];
  }
  const data = await call(`/${model}:generateContent`, key, body);
  const cand = data.candidates && data.candidates[0];
  if (!cand || !cand.content) {
    if (data.promptFeedback && data.promptFeedback.blockReason) throw new AIError('Google ha bloccato questa richiesta con i suoi filtri.', 'blocked');
    if (cand && cand.finishReason === 'SAFETY') throw new AIError('Google ha bloccato la risposta con i suoi filtri.', 'blocked');
    throw new AIError('Il modello non ha risposto. Riprova.', 'empty');
  }
  const parts = cand.content.parts || [];
  return {
    raw: { role: 'model', parts },
    text: parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim(),
    calls: parts.filter(p => p.functionCall).map(p => ({ callId: p.functionCall.id || '', name: p.functionCall.name, args: p.functionCall.args || {} })),
  };
}

export const info = {
  id: 'gemini',
  name: 'Google Gemini',
  keyUrl: 'https://aistudio.google.com/apikey',
};
