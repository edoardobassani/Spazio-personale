// Adattatore per i fornitori compatibili con l'API di OpenAI: OpenAI e OpenRouter.
// Stesse funzioni dell'adattatore Gemini: listModels, generate, generateJSON.
import { AIError } from './gemini.js?v=2.6.0';

const parseArgs = s => { try { return typeof s === 'string' ? JSON.parse(s || '{}') : (s || {}); } catch (_) { return {}; } };
let seq = 0;
const newId = () => `call_${Date.now().toString(36)}_${(seq++).toString(36)}`;

// Cronologia neutra dell'app → messaggi in formato OpenAI
function toMessages(system, history) {
  const out = [{ role: 'system', content: system }];
  for (const h of history) {
    if (h.role === 'user') out.push({ role: 'user', content: h.text });
    else if (h.role === 'model') {
      const calls = (h.calls || []).map(c => ({ id: c.callId || (c.callId = newId()), type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
      if (!h.text && !calls.length) continue;
      out.push({ role: 'assistant', content: h.text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else if (h.role === 'tool') {
      for (const r of h.results) out.push({ role: 'tool', tool_call_id: r.callId, content: JSON.stringify(r.response) });
    }
  }
  return out;
}

const SKIP = /(audio|realtime|image|tts|transcribe|search|instruct|embedding|dall|whisper|moderation|codex|chat-latest|davinci|babbage|computer)/;

export function make({ id, name, base, headers = {} }) {
  async function call(path, key, body) {
    let res;
    try {
      res = await fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${key}`, ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new AIError(`Non riesco a raggiungere ${name}. Controlla la connessione e riprova.`, 'network');
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* risposta vuota */ }
    if (!res.ok) {
      const err = data && data.error;
      const m = (err && (err.message || err.code)) || '';
      if (res.status === 401 || res.status === 403) throw new AIError(`La chiave di ${name} non è valida o non ha accesso. Controllala nelle impostazioni dell'assistente.`, 'key', m);
      if (res.status === 402 || /insufficient_quota|credit/i.test(m)) throw new AIError(`Il credito su ${name} è esaurito: ricaricalo dal sito di ${name} o scegli un modello gratuito.`, 'credit', m);
      if (res.status === 429) throw new AIError('Hai raggiunto il limite di richieste. Riprova tra un minuto; se è il limite giornaliero, domani.', 'quota', m);
      if (res.status === 404) throw new AIError('Il modello scelto non è disponibile.', 'model', m);
      if (res.status === 400 && /tool|function/i.test(m)) throw new AIError('Il modello scelto non sa usare gli strumenti dell\'app: scegline un altro.', 'model', m);
      if (res.status >= 500) throw new AIError(`${name} ha un problema temporaneo. Riprova tra poco.`, 'server', m);
      throw new AIError(`Richiesta non riuscita (${res.status}). ${m}`.trim(), 'other', m);
    }
    return data;
  }

  async function listModels(key) {
    const data = await call('/models', key);
    const list = Array.isArray(data && data.data) ? data.data : [];
    if (id === 'openrouter') {
      // Solo i modelli che sanno usare gli strumenti; prima i gratuiti
      return list
        .filter(m => !m.supported_parameters || m.supported_parameters.includes('tools'))
        .map(m => {
          const free = /:free$/.test(m.id) || (m.pricing && +m.pricing.prompt === 0 && +m.pricing.completion === 0);
          return { id: m.id, label: `${m.name || m.id}${free ? ' (gratis)' : ''}`, free, created: m.created || 0 };
        })
        .sort((a, b) => (b.free - a.free) || (b.created - a.created))
        .slice(0, 60)
        .map(({ id: mid, label }) => ({ id: mid, label }));
    }
    // OpenAI: modelli di chat, prima i "mini" (buon equilibrio tra costo e capacità)
    const rank = s => (/mini/.test(s) ? 0 : /nano/.test(s) ? 1 : 2);
    return list.map(m => m.id).filter(x => /^(gpt-|o\d)/.test(x) && !SKIP.test(x))
      .sort((a, b) => rank(a) - rank(b) || b.localeCompare(a))
      .slice(0, 40).map(x => ({ id: x, label: x }));
  }

  async function generate({ key, model, system, history, tools }) {
    const body = { model, messages: toMessages(system, history) };
    if (tools && tools.length) body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    const data = await call('/chat/completions', key, body);
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new AIError('Il modello non ha risposto. Riprova.', 'empty');
    return {
      raw: null,
      text: (typeof msg.content === 'string' ? msg.content : '').trim(),
      calls: (msg.tool_calls || []).filter(tc => tc.function).map(tc => ({ callId: tc.id || newId(), name: tc.function.name, args: parseArgs(tc.function.arguments) })),
    };
  }

  async function generateJSON({ key, model, system, prompt, schema }) {
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: `${prompt}\n\nRispondi solo con un oggetto JSON valido, senza altro testo, con questa struttura (JSON Schema):\n${JSON.stringify(schema)}` },
    ];
    let data;
    try { data = await call('/chat/completions', key, { model, messages, response_format: { type: 'json_object' } }); }
    catch (e) {
      // Alcuni modelli non accettano il formato JSON obbligato: riprovo senza
      if (e.code !== 'other') throw e;
      data = await call('/chat/completions', key, { model, messages });
    }
    const text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    const m = text.match(/\{[\s\S]*\}/);
    try { return JSON.parse(m ? m[0] : text); }
    catch (_) { throw new AIError('La risposta del modello non era nel formato atteso. Riprova.', 'format'); }
  }

  return { listModels, generate, generateJSON };
}
