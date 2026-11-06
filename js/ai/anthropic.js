// Adattatore per Claude (Anthropic). Stesse funzioni degli altri adattatori.
import { AIError } from './gemini.js?v=2.5.0';

const BASE = 'https://api.anthropic.com/v1';
let seq = 0;
const newId = () => `toolu_${Date.now().toString(36)}${(seq++).toString(36)}`;

async function call(path, key, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true', // necessario per chiamate da una web app
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new AIError('Non riesco a raggiungere Anthropic. Controlla la connessione e riprova.', 'network');
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* risposta vuota */ }
  if (!res.ok) {
    const m = (data && data.error && data.error.message) || '';
    if (res.status === 401 || res.status === 403) throw new AIError("La chiave di Anthropic non è valida. Controllala nelle impostazioni dell'assistente.", 'key', m);
    if (/credit balance|billing/i.test(m)) throw new AIError('Il credito su Anthropic è esaurito o non è stato aggiunto: ricaricalo dalla Console di Anthropic.', 'credit', m);
    if (res.status === 429) throw new AIError('Hai raggiunto il limite di richieste. Riprova tra un minuto.', 'quota', m);
    if (res.status === 404) throw new AIError('Il modello scelto non è disponibile.', 'model', m);
    if (res.status >= 500) throw new AIError('Anthropic ha un problema temporaneo. Riprova tra poco.', 'server', m);
    throw new AIError(`Richiesta non riuscita (${res.status}). ${m}`.trim(), 'other', m);
  }
  return data;
}

// Cronologia neutra → messaggi Anthropic (ruoli che si alternano, risultati degli strumenti come "user")
function toMessages(history) {
  const out = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const h of history) {
    if (h.role === 'user') push('user', [{ type: 'text', text: h.text }]);
    else if (h.role === 'model') {
      push('assistant', [
        ...(h.text ? [{ type: 'text', text: h.text }] : []),
        ...(h.calls || []).map(c => ({ type: 'tool_use', id: c.callId || (c.callId = newId()), name: c.name, input: c.args || {} })),
      ]);
    } else if (h.role === 'tool') {
      push('user', h.results.map(r => ({ type: 'tool_result', tool_use_id: r.callId, content: JSON.stringify(r.response) })));
    }
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export async function listModels(key) {
  const data = await call('/models?limit=100', key);
  const list = Array.isArray(data && data.data) ? data.data : [];
  // Prima Haiku (il più economico), poi Sonnet, poi gli altri; i più recenti in alto
  const rank = id => (/haiku/.test(id) ? 0 : /sonnet/.test(id) ? 1 : 2);
  return list
    .sort((a, b) => rank(a.id) - rank(b.id) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .map(m => ({ id: m.id, label: m.display_name || m.id }));
}

export async function generate({ key, model, system, history, tools }) {
  const body = { model, max_tokens: 1500, system, messages: toMessages(history) };
  if (tools && tools.length) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const data = await call('/messages', key, body);
  const blocks = (data && data.content) || [];
  return {
    raw: null,
    text: blocks.filter(b => b.type === 'text').map(b => b.text).join('').trim(),
    calls: blocks.filter(b => b.type === 'tool_use').map(b => ({ callId: b.id, name: b.name, args: b.input || {} })),
  };
}

// Risposta strutturata: chiedo al modello di usare un unico strumento con lo schema voluto
export async function generateJSON({ key, model, system, prompt, schema }) {
  const data = await call('/messages', key, {
    model, max_tokens: 2000, system,
    messages: [{ role: 'user', content: prompt }],
    tools: [{ name: 'rispondi', description: 'Restituisci la risposta in forma strutturata.', input_schema: schema }],
    tool_choice: { type: 'tool', name: 'rispondi' },
  });
  const use = ((data && data.content) || []).find(b => b.type === 'tool_use');
  if (!use) throw new AIError('La risposta del modello non era nel formato atteso. Riprova.', 'format');
  return use.input;
}
