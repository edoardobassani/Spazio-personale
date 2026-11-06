// Ricerca sul web per l'assistente.
// 1) Google, tramite la ricerca integrata in Gemini, se la chiave lo consente
//    (di solito serve un account Google con fatturazione attiva).
// 2) Altrimenti Wikipedia in italiano: gratuita, ma senza notizie, eventi o orari attuali.
import { state, commit } from '../store.js?v=2.4.0';
import * as D from '../dates.js?v=2.4.0';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const RECHECK_DAYS = 7;

const web = () => state.settings.ai.web;

export function googleStatus() {
  const w = web();
  if (w.google === 'ok') return 'ok';
  if (w.google === 'unavailable' && w.checkedAt && D.daysBetween(w.checkedAt, D.todayISO()) < RECHECK_DAYS) return 'unavailable';
  return 'unknown';
}

function mark(status, detail = '') {
  const w = web();
  if (w.google === status && w.checkedAt === D.todayISO()) return;
  w.google = status; w.checkedAt = D.todayISO(); w.detail = String(detail).slice(0, 300);
  commit();
}
export function resetGoogle() { mark('unknown'); }

async function google(query, key, model) {
  const today = D.fmt(D.todayISO(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `Oggi è ${today}. Cerca sul web e rispondi in italiano, in modo fattuale e conciso (al massimo 150 parole), indicando date e luoghi quando servono. Domanda: ${query}` }] }],
      tools: [{ google_search: {} }],
    }),
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* niente */ }
  if (!res.ok) {
    const e = new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  const cand = data.candidates && data.candidates[0];
  const text = cand && cand.content ? (cand.content.parts || []).filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim() : '';
  const meta = (cand && cand.groundingMetadata) || {};
  const sources = (meta.groundingChunks || []).map(c => c.web).filter(w => w && w.uri)
    .map(w => ({ title: w.title || new URL(w.uri).hostname, url: w.uri })).slice(0, 6);
  return { engine: 'Google', text, sources, suggestionsHTML: (meta.searchEntryPoint && meta.searchEntryPoint.renderedContent) || '' };
}

const WIKI = 'https://it.wikipedia.org';
const wikiHeaders = { 'Api-User-Agent': 'SpazioPersonale/2.4 (app personale)' };

async function wikipedia(query) {
  const q = encodeURIComponent(query);
  const r = await fetch(`${WIKI}/w/api.php?action=query&list=search&srsearch=${q}&srlimit=3&format=json&origin=*`, { headers: wikiHeaders });
  if (!r.ok) throw new Error('Wikipedia non risponde');
  const hits = ((await r.json()).query || {}).search || [];
  const pages = await Promise.all(hits.slice(0, 3).map(async h => {
    try {
      const s = await fetch(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(h.title.replace(/ /g, '_'))}`, { headers: wikiHeaders });
      if (!s.ok) return null;
      const j = await s.json();
      return { title: j.title || h.title, extract: (j.extract || '').slice(0, 900), url: (j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) || `${WIKI}/wiki/${encodeURIComponent(h.title)}` };
    } catch (_) { return null; }
  }));
  const ok = pages.filter(Boolean);
  return {
    engine: 'Wikipedia',
    text: ok.map(p => `${p.title}: ${p.extract}`).join('\n\n'),
    sources: ok.map(p => ({ title: `${p.title} – Wikipedia`, url: p.url })),
    suggestionsHTML: '',
  };
}

// Restituisce { response per il modello, sources e suggerimenti di ricerca per lo schermo }
export async function webSearch({ query, purpose }, { key, model }) {
  query = String(query || '').trim().slice(0, 300);
  if (!query) return { response: { errore: 'Manca la ricerca da fare' } };
  let result = null, note = '';
  if (googleStatus() !== 'unavailable') {
    try {
      result = await google(query, key, model);
      mark('ok');
    } catch (e) {
      // Con il piano gratuito la ricerca Google di solito non è permessa
      if ([400, 403, 429].includes(e.status)) mark('unavailable', e.message);
      else note = 'La ricerca Google non ha risposto. ';
    }
  }
  if (!result) {
    try { result = await wikipedia(query); }
    catch (e) { return { response: { errore: 'Ricerca non riuscita: nessuna connessione o servizio non raggiungibile.' } }; }
    if (googleStatus() === 'unavailable') note += 'La ricerca Google non è disponibile con questa chiave (piano gratuito): uso Wikipedia. ';
    if (purpose === 'attualita' || purpose === 'luoghi_eventi') note += 'Wikipedia non contiene notizie, eventi, orari o prezzi aggiornati: dillo all\'utente e suggerisci di verificare. ';
  }
  return {
    response: {
      motore: result.engine,
      nota: note.trim() || undefined,
      risultato: result.text || 'Nessun risultato.',
      fonti: result.sources.map(s => `${s.title} (${s.url})`),
    },
    sources: result.sources,
    suggestionsHTML: result.suggestionsHTML,
  };
}
