// Assistente: conversazione, uso degli strumenti, proposte da confermare, voce.
import { state, commit } from '../store.js?v=2.6.0';
import * as D from '../dates.js?v=2.6.0';
import { esc, icon, toast, openSheet, closeSheet, dictate, voiceSupported } from '../ui.js?v=2.6.0';
import * as gemini from './gemini.js?v=2.6.0';
import { PROVIDERS, PROVIDER_IDS } from './providers.js?v=2.6.0';
import { toolDefs, runTool, applyProposal } from './tools.js?v=2.6.0';
import { learnedSummary } from '../learn.js?v=2.6.0';
import { googleStatus, resetGoogle } from './search.js?v=2.6.0';

const KEYS_STORE = 'spazio-personale-ai-keys';
const OLD_KEY_STORE = 'spazio-personale-ai-key';
const CHAT_STORE = 'spazio-personale-chat';
const MAX_ROUNDS = 6;

let rerender = () => {};
export const setRender = fn => { rerender = fn; };

const ai = () => state.settings.ai;
const pid = () => (PROVIDERS[ai().provider] ? ai().provider : 'gemini');
const provider = () => PROVIDERS[pid()].adapter;
// Impostazioni del fornitore attivo (modello scelto ed elenco)
function cfg(id = pid()) {
  const a = ai();
  if (!a.byProvider) a.byProvider = {};
  if (!a.byProvider[id]) a.byProvider[id] = { model: '', models: [] };
  return a.byProvider[id];
}

// Una chiave per fornitore, solo su questo dispositivo (mai nei backup)
function readKeys() {
  let keys = {};
  try { keys = JSON.parse(localStorage.getItem(KEYS_STORE) || '{}') || {}; } catch (_) { keys = {}; }
  try {
    const old = localStorage.getItem(OLD_KEY_STORE);
    if (old && !keys.gemini) { keys.gemini = old; localStorage.setItem(KEYS_STORE, JSON.stringify(keys)); }
    if (old) localStorage.removeItem(OLD_KEY_STORE);
  } catch (_) { /* niente */ }
  return keys;
}
export function getKey(id = pid()) { return readKeys()[id] || ''; }
function setKey(id, k) {
  const keys = readKeys();
  if (k) keys[id] = k; else delete keys[id];
  try { localStorage.setItem(KEYS_STORE, JSON.stringify(keys)); } catch (_) { /* niente */ }
}
export const connectedProviders = () => PROVIDER_IDS.filter(id => getKey(id) && cfg(id).model);
export const isConnected = () => !!getKey() && !!cfg().model;
export const providerName = (id = pid()) => PROVIDERS[id].name;
const ui = { setup: '' }; // fornitore scelto nella schermata di collegamento

// ---------- Conversazione salvata sul dispositivo

const chat = { view: [], history: [], notes: [], busy: false, status: '' };
function loadChat() {
  try {
    const c = JSON.parse(localStorage.getItem(CHAT_STORE) || 'null');
    if (c && Array.isArray(c.view) && Array.isArray(c.history)) { chat.view = c.view; chat.history = c.history; chat.notes = c.notes || []; }
  } catch (_) { /* conversazione illeggibile: si riparte */ }
}
function saveChat() {
  chat.view = chat.view.slice(-80);
  trimHistory();
  try { localStorage.setItem(CHAT_STORE, JSON.stringify({ view: chat.view, history: chat.history, notes: chat.notes })); } catch (_) { /* spazio pieno */ }
}
// Tiene al modello solo gli ultimi scambi, tagliando sempre all'inizio di un messaggio dell'utente
function trimHistory() {
  if (chat.history.length <= 40) return;
  let i = chat.history.length - 40;
  while (i < chat.history.length && chat.history[i].role !== 'user') i++;
  chat.history = chat.history.slice(i);
}
export function resetChat() {
  chat.view = []; chat.history = []; chat.notes = [];
  saveChat();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
loadChat();

// ---------- Istruzioni per il modello

function systemPrompt() {
  const now = new Date();
  const t = D.todayISO();
  const p = ai().perms;
  const can = [p.events && 'impegni', p.projects && 'progetti', p.interests && 'interessi'].filter(Boolean);
  const r = state.settings.reminders;
  return `Sei l'assistente personale dentro l'app «Spazio personale». Aiuti l'utente a organizzare impegni, tempo libero, progetti e interessi, riducendo il carico mentale senza trasformare ogni momento in un obbligo.

Adesso: ${D.fmt(t, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ore ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} (oggi = ${t}). Fuso orario dell'utente: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.

Come rispondere:
- Sempre in italiano, in modo diretto e breve: l'utente legge sul telefono. Usa elenchi solo quando servono. Niente intestazioni.
- Per domande su agenda, giornate o tempo libero, leggi prima i dati con gli strumenti: non supporre e non inventare impegni.
- Gli strumenti che modificano i dati NON salvano nulla: creano una proposta che l'utente conferma con un pulsante. Quindi di' «te l'ho preparato, confermalo qui sopra», mai «l'ho aggiunto».
- Se manca un'informazione essenziale (per esempio la data) o la richiesta è ambigua, chiedi prima di proporre. Se la data è relativa («venerdì», «tra due settimane») calcolala tu da oggi.
- Quando suggerisci attività o cose da fare: poche proposte (al massimo tre), pertinenti, con il motivo, il tempo richiesto ed eventuali costi. La decisione è sempre dell'utente. Niente punteggi, serie o sensi di colpa per le cose lasciate a metà.
- Distingui ciò che sai con certezza da ciò che non sai. ${p.web ? `Puoi cercare sul web con lo strumento cerca_web: usalo per eventi, luoghi, orari, notizie e fatti recenti, e quando vuoi verificare qualcosa. Basa la risposta su quello che trovi e non inventare dettagli che i risultati non dicono. Le fonti vengono mostrate all'utente sotto la tua risposta, quindi non serve elencare i link.` : 'Non hai accesso a internet: non conosci eventi, orari di apertura, meteo o notizie di oggi; se servono, dillo e suggerisci di verificare.'} Se consigli libri, podcast o documentari, cita solo opere che conosci con sicurezza o che hai trovato cercando, e non inventare titoli o link.
- L'utente preferisce contenuti approfonditi e basati su fatti verificabili.

Dati a cui puoi accedere: ${can.length ? can.join(', ') : 'nessuno'}${p.notes ? ', comprese le note' : ' (senza le note personali)'}. Se ti serve qualcosa a cui non hai accesso, dillo.
Promemoria predefiniti: appuntamenti ${r.appuntamento ?? 'nessuno'} min, attività ${r.attivita ?? 'nessuno'} min, scadenze ${r.scadenza ?? 'nessuno'} min prima.
${ai().about.trim() ? `\nCosa l'utente ti ha detto di sé:\n${ai().about.trim()}` : ''}${p.learning && learnedSummary() ? `\nPreferenze e abitudini apprese dall'app (l'utente può correggerle; usale come indicazioni, non come regole):\n${learnedSummary()}` : ''}`;
}

// ---------- Invio di un messaggio

// Prova il modello scelto; se non è gratuito o non esiste più, passa al successivo
async function withModel(run) {
  const tried = new Set();
  let model = cfg().model;
  for (;;) {
    tried.add(model);
    try {
      const res = await run(model);
      if (model !== cfg().model) {
        cfg().model = model; commit();
        chat.view.push({ role: 'info', text: `Il modello precedente non è disponibile gratuitamente: ora uso ${labelOf(model)}.` });
      }
      return res;
    } catch (e) {
      if (!(e.code === 'not-free' || e.code === 'model')) throw e;
      // Passo a un altro modello solo con Gemini (dove l'elenco è ordinato per gratuità)
      const next = pid() === 'gemini' ? cfg().models.map(m => m.id).find(id => !tried.has(id)) : null;
      if (!next && pid() !== 'gemini') throw e;
      if (!next) throw new gemini.AIError('Nessun modello gratuito disponibile per questa chiave in questo momento.', 'no-model');
      model = next;
    }
  }
}
const generateWithFallback = req => withModel(model => provider().generate({ ...req, model }));

// Domanda con risposta strutturata (JSON), usata da altre parti dell'app
export async function askJSON({ system, prompt, schema }) {
  const key = getKey();
  if (!key || !cfg().model) throw new gemini.AIError("L'assistente non è collegato.", 'key');
  return withModel(model => provider().generateJSON({ key, model, system, prompt, schema }));
}
const labelOf = id => (cfg().models.find(m => m.id === id) || { label: id.replace('models/', '') }).label;

export async function send(text) {
  text = text.trim();
  if (!text || chat.busy) return;
  const key = getKey();
  if (!key) { toast("Prima collega l'assistente"); return; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const mark = chat.history.length;
  const notes = chat.notes.splice(0);
  chat.view.push({ role: 'user', text });
  chat.history.push({ role: 'user', text: notes.length ? `${notes.join('\n')}\n\n${text}` : text });
  chat.busy = true;
  rerender();
  let finalText = '';
  const found = { sources: [], html: '' };
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await generateWithFallback({ key, system: systemPrompt(), history: chat.history, tools: toolDefs(ai().perms) });
      chat.history.push({ role: 'model', provider: pid(), text: res.text, calls: res.calls, raw: res.raw || undefined });
      if (!res.calls.length) {
        finalText = res.text || 'Non ho una risposta da darti, prova a riformulare.';
        const seen = new Set();
        const sources = found.sources.filter(x => !seen.has(x.url) && seen.add(x.url)).slice(0, 8);
        chat.view.push({ role: 'assistant', text: finalText, sources, searchHTML: found.html || undefined });
        break;
      }
      if (res.text) chat.view.push({ role: 'assistant', text: res.text });
      const results = [];
      for (const c of res.calls) {
        if (c.name === 'cerca_web') { chat.status = `Cerco sul web: ${String((c.args || {}).query || '').slice(0, 60)}`; rerender(); }
        // La ricerca Google passa sempre da una chiave Gemini, se ce n'è una
        const out = await runTool(c.name, c.args, ai().perms, { key: getKey('gemini'), model: cfg('gemini').model });
        chat.status = '';
        if (out.proposal) chat.view.push({ role: 'proposal', proposal: out.proposal });
        if (out.sources) found.sources.push(...out.sources);
        if (out.suggestionsHTML) found.html = out.suggestionsHTML;
        results.push({ callId: c.callId, name: c.name, response: out.response });
      }
      chat.history.push({ role: 'tool', results });
      rerender();
      if (round === MAX_ROUNDS - 1) chat.view.push({ role: 'assistant', text: 'Mi sono fermato: la richiesta richiedeva troppi passaggi. Prova a dividerla.' });
    }
  } catch (e) {
    console.error(e);
    chat.history.length = mark; // la cronologia resta coerente per il prossimo tentativo
    chat.notes.unshift(...notes);
    chat.view.push({ role: 'error', text: e.message || 'Qualcosa è andato storto.', retry: text });
  } finally {
    chat.busy = false;
    saveChat();
    rerender();
    if (finalText && ai().speak) speak(finalText);
  }
}

export function retry(i) {
  const m = chat.view[i];
  if (!m || m.role !== 'error') return;
  chat.view.splice(i, 1);
  // tolgo anche il messaggio dell'utente rimasto senza risposta
  if (chat.view[i - 1] && chat.view[i - 1].role === 'user' && chat.view[i - 1].text === m.retry) chat.view.splice(i - 1, 1);
  send(m.retry);
}

export function decide(pid, ok) {
  const m = chat.view.find(x => x.role === 'proposal' && x.proposal.id === pid);
  if (!m || m.proposal.status !== 'pending') return;
  const p = m.proposal;
  if (ok) {
    try {
      const msg = applyProposal(p);
      p.status = 'done';
      chat.notes.push(`[Nota dell'app: l'utente ha CONFERMATO la proposta «${p.title}: ${p.lines.join(' · ')}», che ora è salvata.]`);
      saveChat(); commit(); toast(msg);
    } catch (e) {
      p.status = 'failed'; p.error = e.message;
      saveChat(); rerender(); toast(e.message, 'bad');
    }
  } else {
    p.status = 'cancelled';
    chat.notes.push(`[Nota dell'app: l'utente ha ANNULLATO la proposta «${p.title}: ${p.lines.join(' · ')}».]`);
    saveChat(); rerender();
  }
}

// ---------- Voce in uscita

const plain = s => s.replace(/\*\*|__|`|#+\s/g, '').replace(/^\s*[-*]\s+/gm, '').replace(/https?:\/\/\S+/g, 'il link');
export function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(plain(text));
  u.lang = 'it-IT';
  const v = speechSynthesis.getVoices().find(x => x.lang && x.lang.toLowerCase().startsWith('it'));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

// ---------- Testo formattato (grassetto, elenchi, link)

function md(text) {
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*(?!\s)([^*]+?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const out = [];
  let list = null;
  for (const line of text.split('\n')) {
    const ul = line.match(/^\s*[-*•]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) {
      const tag = ul ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { if (list) out.push(`</${list.tag}>`); list = { tag }; out.push(`<${tag}>`); }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    if (list) { out.push(`</${list.tag}>`); list = null; }
    const h = line.match(/^\s*#{1,6}\s+(.*)/);
    if (h) out.push(`<p><strong>${inline(h[1])}</strong></p>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`</${list.tag}>`);
  return out.join('');
}

// ---------- Schermata

const EXAMPLES = [
  'Che cosa ho da fare oggi?',
  'Com’è messa la mia settimana?',
  'Sabato sono libero: cosa potrei fare?',
  'Consigliami un argomento da approfondire stasera',
  'Ricordami di chiamare il commercialista venerdì alle 10',
  'Aiutami a dividere un progetto in passaggi',
];

function proposalCard(p) {
  const st = { pending: '', done: 'Confermato', cancelled: 'Annullato', failed: `Non riuscito: ${p.error || ''}` }[p.status];
  return `<div class="proposal ${p.status}">
    <span class="suggest-tag">${icon('spark', 'xs')} Proposta dell'assistente</span>
    <strong>${esc(p.title)}</strong>
    <ul>${p.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    ${p.status === 'pending' ? `<div class="suggest-actions">
      <button class="btn small primary" data-action="ai-confirm" data-id="${p.id}">${icon('check', 'xs')} Conferma</button>
      <button class="btn small ghost" data-action="ai-cancel" data-id="${p.id}">Annulla</button></div>`
      : `<p class="proposal-status">${esc(st)}</p>`}
  </div>`;
}

// Fonti della ricerca web, e i suggerimenti di ricerca che Google chiede di mostrare
function sourcesHTML(m) {
  if (!m.sources || !m.sources.length) return '';
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
  return `<div class="sources"><span>Fonti</span>${m.sources.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || host(x.url))}</a>`).join('')}</div>
    ${m.searchHTML ? `<iframe class="gsearch" sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc="${esc(m.searchHTML)}" title="Ricerche suggerite da Google"></iframe>` : ''}`;
}

function message(m, i) {
  if (m.role === 'user') return `<div class="msg user"><div class="bubble">${esc(m.text)}</div></div>`;
  if (m.role === 'assistant') return `<div class="msg bot"><div class="bubble">${md(m.text)}${sourcesHTML(m)}
    <button class="listen" data-action="ai-speak" data-i="${i}" aria-label="Ascolta la risposta">${icon('play', 'xs')} Ascolta</button></div></div>`;
  if (m.role === 'proposal') return `<div class="msg bot">${proposalCard(m.proposal)}</div>`;
  if (m.role === 'error') return `<div class="msg bot"><div class="bubble error-bubble"><p>${esc(m.text)}</p>
    ${m.retry ? `<button class="btn small" data-action="ai-retry" data-i="${i}">Riprova</button>` : ''}</div></div>`;
  return `<p class="msg-info">${esc(m.text)}</p>`;
}

function setupView() {
  const sel = PROVIDERS[ui.setup] ? ui.setup : pid();
  const p = PROVIDERS[sel];
  return `<section class="view">
    <header class="page-head"><h1>Assistente</h1>${connectedProviders().length ? `<button class="btn small ghost" data-action="ai-setup-cancel">Annulla</button>` : ''}</header>
    <div class="status-card"><span class="status-dot"></span>
      <div><strong>Collega un fornitore AI</strong>
      <p>L'app funziona con diversi fornitori: scegli quello che preferisci, puoi cambiarlo quando vuoi.</p></div></div>
    <div class="prov-pick">${PROVIDER_IDS.map(id => `<button class="${id === sel ? 'on' : ''}" data-action="ai-setup-pick" data-id="${id}">${esc(PROVIDERS[id].name)}${getKey(id) ? ' ✓' : ''}</button>`).join('')}</div>
    <p class="hint prov-price">${esc(p.price)}</p>
    <ol class="setup">
      <li>Apri <a href="${p.keyUrl}" target="_blank" rel="noopener">${esc(p.site)}</a>. ${p.steps[0]}</li>
      <li>${p.steps[1]}</li>
      <li>Incollala qui sotto e tocca <strong>Collega</strong>.</li>
    </ol>
    <form class="key-form" data-form="ai-key">
      <input type="hidden" name="provider" value="${sel}">
      <input name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Incolla qui la chiave API" aria-label="Chiave API">
      <button class="btn primary">Collega</button>
    </form>
    <div class="info-card"><strong>Privacy</strong>
      <p>La chiave resta solo su questo telefono e non finisce nei backup. Quando usi l'assistente, la tua domanda e i dati che servono per rispondere vengono inviati al fornitore scelto. ${esc(p.privacy)} Nelle impostazioni dell'assistente scegli tu cosa può vedere: per esempio le note personali sono escluse.</p></div>
  </section>`;
}

export function renderAssistant() {
  if (ui.setup || !isConnected()) return setupView();
  const msgs = chat.view.map(message).join('');
  return `<section class="view chat-view">
    <header class="page-head"><h1>Assistente</h1>
      <span class="head-actions">
        <span class="prov-badge">${esc(providerName())}</span>
        ${chat.view.length ? `<button class="icon-btn" data-action="ai-new" aria-label="Nuova conversazione">${icon('plus')}</button>` : ''}
        <button class="icon-btn" data-action="ai-settings" aria-label="Impostazioni dell'assistente">${icon('sliders')}</button>
      </span></header>
    <div class="chat">
      ${chat.view.length ? msgs : `<div class="chat-intro">
          <p>Chiedimi della tua agenda, del tempo libero, dei progetti. Posso preparare impegni e progetti: li confermi tu con un tocco.</p>
          <div class="chips">${EXAMPLES.map(e => `<button class="chip-btn" data-action="ai-prompt" data-text="${esc(e)}">${esc(e)}</button>`).join('')}</div>
        </div>`}
      ${chat.busy ? `<div class="msg bot"><div class="bubble typing"><i></i><i></i><i></i>${chat.status ? `<span class="typing-status">${esc(chat.status)}</span>` : ''}</div></div>` : ''}
    </div>
    <form class="chat-input" data-form="ai-chat">
      <textarea name="q" rows="1" placeholder="Scrivi o detta…" data-placeholder="Scrivi o detta…" enterkeyhint="send" aria-label="Messaggio"${chat.busy ? ' disabled' : ''}></textarea>
      ${voiceSupported ? `<button type="button" class="icon-btn mic" data-action="ai-voice" aria-label="Detta"${chat.busy ? ' disabled' : ''}>${icon('mic')}</button>` : ''}
      <button class="icon-btn solid" aria-label="Invia"${chat.busy ? ' disabled' : ''}>${icon('right')}</button>
    </form>
  </section>`;
}

// Dopo ogni aggiornamento della schermata: scorri in fondo alla conversazione
export function afterRender() {
  const c = document.querySelector('.chat-view');
  if (c) requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
}

// ---------- Collegamento e impostazioni

export async function connect(key, id = ui.setup || pid()) {
  key = key.trim();
  if (!PROVIDERS[id]) id = 'gemini';
  if (!key) { toast('Incolla la chiave API'); return; }
  const btn = document.querySelector('[data-form=ai-key] button');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifico…'; }
  try {
    const models = await PROVIDERS[id].adapter.listModels(key);
    if (!models.length) throw new gemini.AIError(`Questa chiave non dà accesso a nessun modello adatto di ${PROVIDERS[id].name}.`, 'no-model');
    setKey(id, key);
    cfg(id).models = models;
    if (!models.some(m => m.id === cfg(id).model)) cfg(id).model = models[0].id;
    const switching = ai().provider !== id;
    ai().provider = id;
    ui.setup = '';
    if (switching) resetChat(); // le conversazioni non passano da un fornitore all'altro
    commit();
    toast(`${PROVIDERS[id].name} collegato`);
  } catch (e) {
    toast(e.message, 'bad');
    if (btn) { btn.disabled = false; btn.textContent = 'Collega'; }
  }
}

function switchProvider(id) {
  if (id === pid() || !getKey(id) || !cfg(id).model) return;
  if (chat.view.length && !confirm('Cambiando fornitore la conversazione attuale ricomincia da capo. Continuare?')) return;
  ai().provider = id;
  resetChat();
  commit();
  toast(`Ora uso ${PROVIDERS[id].name}`);
}

export function openAISettings() {
  const a = ai();
  const perm = (k, label, hint) => `<label class="toggle"><input type="checkbox" data-perm="${k}"${a.perms[k] ? ' checked' : ''}><span><strong>${label}</strong><small>${hint}</small></span></label>`;
  openSheet(`
    <div class="sheet-head"><h2>Impostazioni assistente</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
    <div class="form">
      <label class="field"><span>Fornitore</span><select data-provider>
        ${connectedProviders().map(id => `<option value="${id}"${id === pid() ? ' selected' : ''}>${esc(PROVIDERS[id].name)}</option>`).join('')}
      </select></label>
      <button type="button" class="btn small ghost" data-add-provider>${icon('plus', 'xs')} Collega un altro fornitore</button>
      <label class="field"><span>Modello</span><select data-model>
        ${cfg().models.map(m => `<option value="${esc(m.id)}"${m.id === cfg().model ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}
      </select></label>
      <p class="hint">${pid() === 'gemini' ? "Di solito va bene quello scelto in automatico. Se un modello non è gratuito, l'app ne prova da sola un altro." : pid() === 'openrouter' ? 'I modelli segnati «gratis» non costano nulla ma hanno un limite di richieste al giorno.' : 'Il primo della lista è il più economico.'}</p>
      <button type="button" class="btn small ghost" data-refresh>Aggiorna l'elenco dei modelli</button>
    </div>
    <h3 class="sub">Cosa può vedere</h3>
    <div class="toggles">
      ${perm('events', 'Impegni', 'Leggere l\'agenda e proporre impegni')}
      ${perm('projects', 'Progetti', 'Leggere i progetti e proporre modifiche')}
      ${perm('interests', 'Interessi', 'Leggere gli interessi e proporne di nuovi')}
      ${perm('notes', 'Note personali', 'Includere le note di impegni, progetti e interessi')}
      ${perm('learning', 'Preferenze apprese', 'Usare quello che l\'app ha imparato dalle tue scelte')}
      ${perm('web', 'Ricerca sul web', 'Cercare notizie, eventi, luoghi e contenuti (le ricerche vanno a Google o Wikipedia)')}
    </div>
    <p class="hint web-status">${!getKey('gemini') ? 'Ricerca web: uso Wikipedia, che non ha notizie né eventi aggiornati. La ricerca Google richiede una chiave Gemini con fatturazione attiva.' : { ok: 'Ricerca web: uso Google.', unavailable: 'Ricerca web: Google non è disponibile con la chiave Gemini (di solito serve un account con fatturazione). Uso Wikipedia, che non ha notizie né eventi aggiornati.', unknown: 'Ricerca web: Google verrà provato alla prima ricerca; se non è disponibile, uso Wikipedia.' }[googleStatus()]}
      ${getKey('gemini') && googleStatus() === 'unavailable' ? '<button type="button" class="link" data-web-retry>Riprova Google</button>' : ''}</p>
    <h3 class="sub">Su di te</h3>
    <p class="hint">Facoltativo. Quello che scrivi qui viene inviato all'assistente a ogni richiesta, per dargli il contesto (orari, lavoro, abitudini, preferenze).</p>
    <div class="form"><label class="field"><textarea data-about rows="5" maxlength="2000" placeholder="Es. Lavoro in un'azienda vitivinicola, mi sveglio alle 5:30 e vado a dormire verso le 22. Palestra tre volte a settimana, porto a spasso il cane.">${esc(a.about)}</textarea></label></div>
    <h3 class="sub">Voce</h3>
    <div class="toggles">
      <label class="toggle"><input type="checkbox" data-speak${a.speak ? ' checked' : ''}><span><strong>Leggi le risposte ad alta voce</strong><small>Usa la voce del telefono</small></span></label>
    </div>
    <div class="stack">
      <button class="btn" data-clear>${icon('plus', 'xs')} Nuova conversazione</button>
      <button class="btn danger" data-disconnect>Scollega ${esc(providerName())} e rimuovi la chiave</button>
    </div>`, sheet => {
    sheet.querySelector('[data-model]').addEventListener('change', e => { cfg().model = e.target.value; commit(); toast('Modello cambiato'); });
    sheet.querySelector('[data-provider]').addEventListener('change', e => { switchProvider(e.target.value); openAISettings(); });
    sheet.querySelector('[data-add-provider]').addEventListener('click', () => { ui.setup = PROVIDER_IDS.find(id => !getKey(id)) || PROVIDER_IDS.find(id => id !== pid()); closeSheet(); rerender(); });
    sheet.querySelectorAll('[data-perm]').forEach(el => el.addEventListener('change', () => { a.perms[el.dataset.perm] = el.checked; commit(); }));
    const about = sheet.querySelector('[data-about]');
    about.addEventListener('change', () => { a.about = about.value.trim(); commit(); toast('Salvato'); });
    sheet.querySelector('[data-speak]').addEventListener('change', e => { a.speak = e.target.checked; commit(); if (a.speak) speak('Va bene, leggerò le risposte.'); });
    sheet.querySelector('[data-refresh]').addEventListener('click', async () => {
      try {
        cfg().models = await provider().listModels(getKey());
        if (!cfg().models.some(m => m.id === cfg().model) && cfg().models[0]) cfg().model = cfg().models[0].id;
        commit(); openAISettings(); toast('Elenco aggiornato');
      } catch (e) { toast(e.message, 'bad'); }
    });
    sheet.querySelector('[data-clear]').addEventListener('click', () => { resetChat(); closeSheet(); rerender(); });
    const wr = sheet.querySelector('[data-web-retry]');
    if (wr) wr.addEventListener('click', () => { resetGoogle(); openAISettings(); toast('Riproverò Google alla prossima ricerca'); });
    sheet.querySelector('[data-disconnect]').addEventListener('click', () => {
      if (!confirm(`Rimuovere la chiave di ${providerName()}?`)) return;
      setKey(pid(), ''); cfg().model = ''; cfg().models = [];
      const other = connectedProviders()[0];
      if (other) ai().provider = other;
      resetChat(); closeSheet(); commit();
    });
  });
}

export const actions = {
  'ai-prompt': el => send(el.dataset.text),
  'ai-confirm': el => decide(el.dataset.id, true),
  'ai-cancel': el => decide(el.dataset.id, false),
  'ai-retry': el => retry(+el.dataset.i),
  'ai-speak': el => { const m = chat.view[+el.dataset.i]; if (m) speak(m.text); },
  'ai-new': () => { if (confirm('Iniziare una nuova conversazione?')) { resetChat(); rerender(); } },
  'ai-settings': () => openAISettings(),
  'ai-setup-pick': el => { ui.setup = el.dataset.id; rerender(); },
  'ai-setup-cancel': () => { ui.setup = ''; rerender(); },
  'ai-voice': el => dictate(el.closest('form').q, el),
};
