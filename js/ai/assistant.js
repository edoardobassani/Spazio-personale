// Assistente: conversazione, uso degli strumenti, proposte da confermare, voce.
import { state, commit } from '../store.js';
import * as D from '../dates.js';
import { esc, icon, toast, openSheet, closeSheet, dictate, voiceSupported } from '../ui.js';
import * as gemini from './gemini.js';
import { toolDefs, runTool, applyProposal } from './tools.js';

const PROVIDERS = { gemini };
const KEY_STORE = 'spazio-personale-ai-key';
const CHAT_STORE = 'spazio-personale-chat';
const MAX_ROUNDS = 6;

let rerender = () => {};
export const setRender = fn => { rerender = fn; };

const ai = () => state.settings.ai;
const provider = () => PROVIDERS[ai().provider] || gemini;
export function getKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (_) { return ''; } }
function setKey(k) { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch (_) { /* niente */ } }
export const isConnected = () => !!getKey() && !!ai().model;

// ---------- Conversazione salvata sul dispositivo

const chat = { view: [], history: [], notes: [], busy: false };
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
- Distingui ciò che sai con certezza da ciò che non sai. Non hai accesso a internet: non conosci eventi, orari di apertura, meteo o notizie di oggi; se servono, dillo e suggerisci di verificare. Se consigli libri, podcast o documentari, cita solo opere che conosci con sicurezza e non inventare titoli o link.
- L'utente preferisce contenuti approfonditi e basati su fatti verificabili.

Dati a cui puoi accedere: ${can.length ? can.join(', ') : 'nessuno'}${p.notes ? ', comprese le note' : ' (senza le note personali)'}. Se ti serve qualcosa a cui non hai accesso, dillo.
Promemoria predefiniti: appuntamenti ${r.appuntamento ?? 'nessuno'} min, attività ${r.attivita ?? 'nessuno'} min, scadenze ${r.scadenza ?? 'nessuno'} min prima.
${ai().about.trim() ? `\nCosa l'utente ti ha detto di sé:\n${ai().about.trim()}` : ''}`;
}

// ---------- Invio di un messaggio

async function generateWithFallback(req) {
  const tried = new Set();
  let model = ai().model;
  for (;;) {
    tried.add(model);
    try {
      const res = await provider().generate({ ...req, model });
      if (model !== ai().model) {
        ai().model = model; commit();
        chat.view.push({ role: 'info', text: `Il modello precedente non è disponibile gratuitamente: ora uso ${labelOf(model)}.` });
      }
      return res;
    } catch (e) {
      if (!(e.code === 'not-free' || e.code === 'model')) throw e;
      const next = ai().models.map(m => m.id).find(id => !tried.has(id));
      if (!next) throw new gemini.AIError('Nessun modello gratuito disponibile per questa chiave in questo momento.', 'no-model');
      model = next;
    }
  }
}
const labelOf = id => (ai().models.find(m => m.id === id) || { label: id.replace('models/', '') }).label;

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
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await generateWithFallback({ key, system: systemPrompt(), history: chat.history, tools: toolDefs(ai().perms) });
      chat.history.push({ role: 'model', raw: res.raw });
      if (!res.calls.length) {
        finalText = res.text || 'Non ho una risposta da darti, prova a riformulare.';
        chat.view.push({ role: 'assistant', text: finalText });
        break;
      }
      if (res.text) chat.view.push({ role: 'assistant', text: res.text });
      const results = res.calls.map(c => {
        const out = runTool(c.name, c.args, ai().perms);
        if (out.proposal) chat.view.push({ role: 'proposal', proposal: out.proposal });
        return { callId: c.callId, name: c.name, response: out.response };
      });
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

function message(m, i) {
  if (m.role === 'user') return `<div class="msg user"><div class="bubble">${esc(m.text)}</div></div>`;
  if (m.role === 'assistant') return `<div class="msg bot"><div class="bubble">${md(m.text)}
    <button class="listen" data-action="ai-speak" data-i="${i}" aria-label="Ascolta la risposta">${icon('play', 'xs')} Ascolta</button></div></div>`;
  if (m.role === 'proposal') return `<div class="msg bot">${proposalCard(m.proposal)}</div>`;
  if (m.role === 'error') return `<div class="msg bot"><div class="bubble error-bubble"><p>${esc(m.text)}</p>
    ${m.retry ? `<button class="btn small" data-action="ai-retry" data-i="${i}">Riprova</button>` : ''}</div></div>`;
  return `<p class="msg-info">${esc(m.text)}</p>`;
}

function setupView() {
  return `<section class="view">
    <header class="page-head"><h1>Assistente</h1></header>
    <div class="status-card"><span class="status-dot"></span>
      <div><strong>Collega Google Gemini</strong>
      <p>Si usa il piano gratuito di Google: non serve una carta di credito. Ci vogliono un paio di minuti.</p></div></div>
    <ol class="setup">
      <li>Apri <a href="${gemini.info.keyUrl}" target="_blank" rel="noopener">Google AI Studio</a> e accedi con il tuo account Google.</li>
      <li>Tocca <strong>Create API key</strong> (Crea chiave API) e copia la chiave.</li>
      <li>Incollala qui sotto e tocca <strong>Collega</strong>.</li>
    </ol>
    <form class="key-form" data-form="ai-key">
      <input name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Incolla qui la chiave API" aria-label="Chiave API">
      <button class="btn primary">Collega</button>
    </form>
    <div class="info-card"><strong>Privacy</strong>
      <p>La chiave resta solo su questo telefono e non finisce nei backup. Quando usi l'assistente, la tua domanda e i dati che servono per rispondere vengono inviati a Google. Con il piano gratuito Google può usare queste conversazioni per migliorare i suoi servizi, e alcune possono essere lette da revisori. Nelle impostazioni dell'assistente scegli tu cosa può vedere: per esempio le note personali sono escluse.</p></div>
  </section>`;
}

export function renderAssistant() {
  if (!getKey() || !ai().model) return setupView();
  const msgs = chat.view.map(message).join('');
  return `<section class="view chat-view">
    <header class="page-head"><h1>Assistente</h1>
      <span class="head-actions">
        ${chat.view.length ? `<button class="icon-btn" data-action="ai-new" aria-label="Nuova conversazione">${icon('plus')}</button>` : ''}
        <button class="icon-btn" data-action="ai-settings" aria-label="Impostazioni dell'assistente">${icon('sliders')}</button>
      </span></header>
    <div class="chat">
      ${chat.view.length ? msgs : `<div class="chat-intro">
          <p>Chiedimi della tua agenda, del tempo libero, dei progetti. Posso preparare impegni e progetti: li confermi tu con un tocco.</p>
          <div class="chips">${EXAMPLES.map(e => `<button class="chip-btn" data-action="ai-prompt" data-text="${esc(e)}">${esc(e)}</button>`).join('')}</div>
        </div>`}
      ${chat.busy ? '<div class="msg bot"><div class="bubble typing"><i></i><i></i><i></i></div></div>' : ''}
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

export async function connect(key) {
  key = key.trim();
  if (!key) { toast('Incolla la chiave API'); return; }
  const btn = document.querySelector('[data-form=ai-key] button');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifico…'; }
  try {
    const models = await provider().listModels(key);
    if (!models.length) throw new gemini.AIError('Questa chiave non dà accesso a nessun modello Flash di Gemini.', 'no-model');
    setKey(key);
    ai().models = models;
    ai().model = models[0].id;
    commit();
    toast('Assistente collegato');
  } catch (e) {
    toast(e.message, 'bad');
    if (btn) { btn.disabled = false; btn.textContent = 'Collega'; }
  }
}

export function openAISettings() {
  const a = ai();
  const perm = (k, label, hint) => `<label class="toggle"><input type="checkbox" data-perm="${k}"${a.perms[k] ? ' checked' : ''}><span><strong>${label}</strong><small>${hint}</small></span></label>`;
  openSheet(`
    <div class="sheet-head"><h2>Impostazioni assistente</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
    <div class="form">
      <label class="field"><span>Modello</span><select data-model>
        ${a.models.map(m => `<option value="${esc(m.id)}"${m.id === a.model ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}
      </select></label>
      <p class="hint">Di solito va bene quello scelto in automatico. Se un modello non è gratuito, l'app ne prova da sola un altro.</p>
      <button type="button" class="btn small ghost" data-refresh>Aggiorna l'elenco dei modelli</button>
    </div>
    <h3 class="sub">Cosa può vedere</h3>
    <div class="toggles">
      ${perm('events', 'Impegni', 'Leggere l\'agenda e proporre impegni')}
      ${perm('projects', 'Progetti', 'Leggere i progetti e proporre modifiche')}
      ${perm('interests', 'Interessi', 'Leggere gli interessi e proporne di nuovi')}
      ${perm('notes', 'Note personali', 'Includere le note di impegni, progetti e interessi')}
    </div>
    <h3 class="sub">Su di te</h3>
    <p class="hint">Facoltativo. Quello che scrivi qui viene inviato all'assistente a ogni richiesta, per dargli il contesto (orari, lavoro, abitudini, preferenze).</p>
    <div class="form"><label class="field"><textarea data-about rows="5" maxlength="2000" placeholder="Es. Lavoro in un'azienda vitivinicola, mi sveglio alle 5:30 e vado a dormire verso le 22. Palestra tre volte a settimana, porto a spasso il cane.">${esc(a.about)}</textarea></label></div>
    <h3 class="sub">Voce</h3>
    <div class="toggles">
      <label class="toggle"><input type="checkbox" data-speak${a.speak ? ' checked' : ''}><span><strong>Leggi le risposte ad alta voce</strong><small>Usa la voce del telefono</small></span></label>
    </div>
    <div class="stack">
      <button class="btn" data-clear>${icon('plus', 'xs')} Nuova conversazione</button>
      <button class="btn danger" data-disconnect>Scollega e rimuovi la chiave</button>
    </div>`, sheet => {
    sheet.querySelector('[data-model]').addEventListener('change', e => { a.model = e.target.value; commit(); toast('Modello cambiato'); });
    sheet.querySelectorAll('[data-perm]').forEach(el => el.addEventListener('change', () => { a.perms[el.dataset.perm] = el.checked; commit(); }));
    const about = sheet.querySelector('[data-about]');
    about.addEventListener('change', () => { a.about = about.value.trim(); commit(); toast('Salvato'); });
    sheet.querySelector('[data-speak]').addEventListener('change', e => { a.speak = e.target.checked; commit(); if (a.speak) speak('Va bene, leggerò le risposte.'); });
    sheet.querySelector('[data-refresh]').addEventListener('click', async () => {
      try {
        a.models = await provider().listModels(getKey());
        if (!a.models.some(m => m.id === a.model) && a.models[0]) a.model = a.models[0].id;
        commit(); openAISettings(); toast('Elenco aggiornato');
      } catch (e) { toast(e.message, 'bad'); }
    });
    sheet.querySelector('[data-clear]').addEventListener('click', () => { resetChat(); closeSheet(); rerender(); });
    sheet.querySelector('[data-disconnect]').addEventListener('click', () => {
      if (!confirm("Rimuovere la chiave? L'assistente smetterà di funzionare finché non la inserisci di nuovo.")) return;
      setKey(''); a.model = ''; a.models = []; resetChat(); closeSheet(); commit();
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
  'ai-voice': el => { const f = el.closest('form'); dictate(f.q, el, t => { f.q.value = ''; send(t); }); },
};
