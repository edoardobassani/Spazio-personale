// Tempo libero, proposte, feedback e quello che l'app impara dalle tue scelte.
// Tutto è calcolato dai tuoi dati e si può vedere, correggere e cancellare dal profilo.
import { state, commit, uid } from './store.js?v=2.5.0';
import * as D from './dates.js?v=2.5.0';
import { esc, icon, toast, openSheet } from './ui.js?v=2.5.0';
import { items, openEventSheet, openSettings } from './views.js?v=2.5.0';
import { askJSON, isConnected } from './ai/assistant.js?v=2.5.0';

const L = () => state.settings.learning;
const ui = { day: '', busy: false };
const toM = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toT = m => `${D.pad(Math.floor(m / 60) % 24)}:${D.pad(m % 60)}`;
const durLabel = m => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`);
const normTitle = s => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();

// ---------- Tempo libero

export function freeSlots(date) {
  const d = state.settings.day;
  let from = toM(d.wake), to = toM(d.sleep);
  if (to <= from) to = 24 * 60 - 1;
  if (date === D.todayISO()) {
    const n = new Date();
    from = Math.max(from, Math.ceil((n.getHours() * 60 + n.getMinutes()) / 15) * 15);
  }
  const busy = [];
  if (d.workStart && d.workEnd && d.workDays.includes(D.parseISO(date).getDay())) busy.push([toM(d.workStart), toM(d.workEnd)]);
  for (const it of items(date, date)) {
    if (!it.ev.start) continue;
    const s = toM(it.ev.start), e = it.ev.end ? toM(it.ev.end) : s + 60;
    busy.push([s - 15, e + 15]); // un quarto d'ora di margine prima e dopo
  }
  busy.sort((a, b) => a[0] - b[0]);
  const slots = [];
  let cur = from;
  for (const [s, e] of busy) {
    if (s > cur && Math.min(s, to) - cur >= 30) slots.push([cur, Math.min(s, to)]);
    cur = Math.max(cur, e);
    if (cur >= to) break;
  }
  if (to - cur >= 30) slots.push([cur, to]);
  return slots.map(([s, e]) => ({ start: toT(s), end: toT(e), minutes: e - s }));
}

function dayOptions() {
  const t = D.todayISO();
  const out = [{ date: t, label: 'Oggi' }, { date: D.addDaysISO(t, 1), label: 'Domani' }];
  for (let k = 2; k <= 7 && out.length < 4; k++) {
    const d = D.addDaysISO(t, k), wd = D.parseISO(d).getDay();
    if (wd === 6 || wd === 0) out.push({ date: d, label: D.cap(D.fmt(d, { weekday: 'short', day: 'numeric' })) });
  }
  return out;
}

// ---------- Apprendimento

const WEIGHT = { scelto: 3, interessa: 2, dopo: 1, conosciuto: 0, ignorato: -0.5, no: -3 };

export function tagScores() {
  const forgotten = new Set(L().forgotten);
  const sc = {};
  const now = Date.now();
  for (const f of state.feedback) {
    const age = (now - Date.parse(f.at)) / 864e5;
    const w = WEIGHT[f.value] * (age > 180 ? 0.5 : 1); // le scelte vecchie contano meno
    for (const t of f.tags) if (!forgotten.has('tag:' + t)) sc[t] = (sc[t] || 0) + w;
  }
  return sc;
}

// Abitudini osservate negli impegni fatti degli ultimi tre mesi
export function observedHabits() {
  const t = D.todayISO();
  const forgotten = new Set(L().forgotten);
  const groups = {};
  for (const it of items(D.addDaysISO(t, -90), D.addDaysISO(t, -1))) {
    const done = it.ev.type === 'appuntamento' ? false : it.done;
    if (!done) continue;
    const k = normTitle(it.ev.title);
    if (!k) continue;
    (groups[k] = groups[k] || { title: it.ev.title, list: [] }).list.push(it);
  }
  const WDS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  const out = [];
  for (const [k, g] of Object.entries(groups)) {
    if (g.list.length < 3 || forgotten.has('abit:' + k)) continue;
    const hours = g.list.filter(i => i.ev.start).map(i => +i.ev.start.slice(0, 2));
    const days = {};
    g.list.forEach(i => { const w = D.parseISO(i.date).getDay(); days[w] = (days[w] || 0) + 1; });
    const topDays = Object.entries(days).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => WDS[w]);
    let hourTxt = '';
    if (hours.length >= 2) {
      const counts = {};
      hours.forEach(h => { counts[h] = (counts[h] || 0) + 1; });
      const [h] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      hourTxt = `di solito verso le ${h}`;
    }
    out.push({ key: 'abit:' + k, text: `«${g.title}»: fatto ${g.list.length} volte negli ultimi tre mesi${topDays.length ? ', soprattutto ' + topDays.join(', ') : ''}${hourTxt ? ', ' + hourTxt : ''}` });
  }
  return out.sort((a, b) => a.text.localeCompare(b.text)).slice(0, 10);
}

export function profile() {
  const entries = Object.entries(tagScores());
  return {
    likes: entries.filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t),
    dislikes: entries.filter(([, v]) => v <= -2.5).sort((a, b) => a[1] - b[1]).slice(0, 12).map(([t]) => t),
    habits: observedHabits(),
  };
}

const recentTitles = (values, n = 15) => [...new Set(state.feedback.filter(f => values.includes(f.value)).slice(-n * 2).map(f => f.title))].slice(-n);

// Riassunto per l'assistente (vuoto se l'apprendimento è spento)
export function learnedSummary() {
  if (!L().enabled) return '';
  const p = profile();
  const lines = [];
  if (p.likes.length) lines.push(`- Temi che di solito gli interessano: ${p.likes.join(', ')}`);
  if (p.dislikes.length) lines.push(`- Temi che di solito scarta: ${p.dislikes.join(', ')}`);
  p.habits.forEach(h => lines.push(`- Abitudine: ${h.text}`));
  const known = recentTitles(['conosciuto', 'scelto', 'no']);
  if (known.length) lines.push(`- Già proposti (conosciuti, già scelti o scartati: non riproporli uguali): ${known.join('; ')}`);
  if (state.saved.length) lines.push(`- Salvati per dopo: ${state.saved.slice(0, 6).map(s => s.title).join('; ')}`);
  return lines.join('\n');
}

export function recordFeedback(item, value) {
  state.feedback.push({ at: new Date().toISOString(), value, title: item.title, kind: item.kind || '', tags: item.tags || [] });
  if (state.feedback.length > 400) state.feedback = state.feedback.slice(-400);
}

// ---------- Proposte

function currentProposals(date) { return state.proposals.find(p => p.date === date); }

// Le proposte di giorni passati vengono archiviate: quelle senza risposta contano come "ignorate"
export function pruneProposals() {
  const t = D.todayISO();
  const old = state.proposals.filter(p => p.date < t);
  if (!old.length) return;
  old.forEach(p => p.items.filter(i => !i.status).forEach(i => recordFeedback(i, 'ignorato')));
  state.proposals = state.proposals.filter(p => p.date >= t);
  commit();
}

// Orario di inizio sensato dentro un intervallo libero: dal pomeriggio se possibile
function niceStart(slot, minutes) {
  const s = toM(slot.start), e = toM(slot.end);
  const target = Math.max(s, Math.min(16 * 60, e - minutes));
  return toT(Math.ceil(target / 15) * 15 > e - minutes ? s : Math.ceil(target / 15) * 15);
}

function ruleProposals(date, slots) {
  const t = D.todayISO();
  const longest = slots.slice().sort((a, b) => b.minutes - a.minutes)[0];
  if (!longest) return [];
  const avoid = new Set(recentTitles(['no', 'conosciuto', 'scelto'], 40).map(normTitle));
  const scores = tagScores();
  const fit = (m) => Math.min(m, longest.minutes);
  const cands = [];
  state.saved.slice(0, 3).forEach(s => cands.push({ title: s.title, detail: s.detail, why: 'L\'avevi salvato per dopo', minutes: fit(s.minutes || 45), kind: 'salvato', tags: s.tags, savedId: s.id }));
  const projects = state.projects.filter(p => p.status === 'attivo' || p.status === 'pausa');
  for (const p of projects) {
    const next = p.steps.find(s => !s.done);
    const idle = D.daysBetween(D.toISO(new Date(p.lastActivityAt)), t);
    if (!next && idle < 14) continue;
    cands.push({
      title: next ? `${p.name}: ${next.text}` : `Riprendere «${p.name}»`,
      detail: next ? 'Il prossimo passaggio del progetto.' : 'Anche solo mezz\'ora per ripartire.',
      why: idle >= 14 ? `Non lo tocchi da ${Math.round(idle / 7)} settimane` : 'È il tuo progetto attivo',
      minutes: fit(60), kind: 'progetto', tags: ['progetto', p.name.toLowerCase()], projectId: p.id, stepId: next ? next.id : '',
      bonus: idle >= 14 ? 1 : 0,
    });
  }
  const ints = state.interests.filter(i => i.status === 'attivo');
  ints.forEach((i, n) => cands.push({
    title: `Approfondire ${i.name}`, detail: 'Un articolo lungo, un capitolo o un documentario sul tema.',
    why: i.kind === 'curiosita' ? 'È una tua curiosità del momento' : 'È tra i tuoi interessi',
    minutes: fit(45), kind: 'approfondimento', tags: ['approfondimento', i.name.toLowerCase()], interestId: i.id,
    bonus: (n + D.daysBetween('2026-01-01', date)) % ints.length === 0 ? 0.5 : 0,
  }));
  cands.push({ title: 'Una camminata all\'aperto', detail: 'Mezz\'ora senza meta, magari in un posto nuovo vicino a casa.', why: 'Un po\' di movimento leggero', minutes: fit(30), kind: 'attivita', tags: ['movimento', 'all aperto'], outdoor: true });
  const score = c => c.tags.reduce((s, tg) => s + (scores[tg] || 0), 0) + (c.bonus || 0) + (c.kind === 'salvato' ? 1.5 : 0);
  return cands.filter(c => !avoid.has(normTitle(c.title)) && score(c) > -2.5)
    .sort((a, b) => score(b) - score(a)).slice(0, 3)
    .map(c => ({ ...c, id: uid(), start: niceStart(longest, c.minutes), cost: 'gratis', outdoor: !!c.outdoor, status: '' }));
}

const SCHEMA = {
  type: 'object',
  properties: {
    proposte: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          titolo: { type: 'string' }, descrizione: { type: 'string' }, perche: { type: 'string' },
          minuti: { type: 'integer' }, costo: { type: 'string', enum: ['gratis', 'basso', 'medio', 'alto'] },
          all_aperto: { type: 'boolean' },
          tipo: { type: 'string', enum: ['attivita', 'progetto', 'approfondimento', 'esperienza', 'relax', 'sociale'] },
          etichette: { type: 'array', items: { type: 'string' } },
          inizio: { type: 'string' }, progetto_id: { type: 'string' }, interesse_id: { type: 'string' },
        },
        required: ['titolo', 'descrizione', 'perche', 'minuti', 'costo', 'all_aperto', 'tipo', 'etichette', 'inizio'],
      },
    },
  },
  required: ['proposte'],
};

async function aiProposals(date, slots) {
  const perms = state.settings.ai.perms;
  const dayTxt = D.fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const busy = perms.events ? items(date, date).map(i => `- ${i.ev.start || 'in giornata'}${i.ev.end ? '–' + i.ev.end : ''}: ${i.ev.title}`).join('\n') : '(non condivisi)';
  const projects = perms.projects ? state.projects.filter(p => p.status === 'attivo' || p.status === 'pausa').map(p => {
    const next = p.steps.find(s => !s.done);
    return `- [id ${p.id}] ${p.name} (${p.status}${p.goal ? ', obiettivo: ' + p.goal : ''}${next ? ', prossimo passo: ' + next.text : ''}, fermo da ${D.daysBetween(D.toISO(new Date(p.lastActivityAt)), D.todayISO())} giorni)`;
  }).join('\n') : '(non condivisi)';
  const ints = perms.interests ? state.interests.filter(i => i.status === 'attivo').map(i => `- [id ${i.id}] ${i.name} (${i.kind === 'curiosita' ? 'curiosità del momento' : 'interesse stabile'})`).join('\n') : '(non condivisi)';
  const learned = perms.learning ? learnedSummary() : '';
  const about = state.settings.ai.about.trim();
  const system = `Sei il motore di proposte per il tempo libero dell'app «Spazio personale». Proponi poche cose concrete e adatte alla persona, in italiano.
Regole:
- Da 1 a 3 proposte, diverse tra loro (per esempio movimento o aria aperta, un progetto personale, un approfondimento), a meno che le preferenze dicano altro.
- Ogni proposta deve stare in uno degli intervalli liberi: "inizio" è un orario HH:MM dentro un intervallo, e "minuti" non supera la fine di quell'intervallo.
- Rispetta il ritmo della persona: niente di faticoso subito prima di dormire, niente che la trasformi in un obbligo.
- "perche" collega la proposta ai suoi interessi, progetti o abitudini in una frase breve.
- Non hai accesso a internet: non inventare eventi, orari di apertura, luoghi precisi, titoli o link. Se proponi un libro, un podcast o un documentario, scegli solo opere che conosci con certezza; altrimenti descrivi il tipo di contenuto.
- "etichette": 2-4 parole chiave minuscole e generiche (es. "storia", "all aperto", "lettura", "cucina", "movimento").
- Se la proposta riguarda un progetto o un interesse elencato, metti il suo id in "progetto_id" o "interesse_id".
- Non riproporre cose che la persona ha già scartato, conosce o ha già scelto di recente.`;
  const prompt = `Giorno: ${dayTxt}.
Intervalli liberi: ${slots.map(s => `${s.start}–${s.end} (${s.minutes} min)`).join(', ')}.
Impegni del giorno:
${busy || '(nessuno)'}
Progetti:
${projects || '(nessuno)'}
Interessi:
${ints || '(nessuno)'}
${about ? `Cosa la persona dice di sé:\n${about}\n` : ''}${learned ? `Preferenze apprese:\n${learned}\n` : ''}
Proponi cosa fare nel tempo libero di questo giorno.`;
  const res = await askJSON({ system, prompt, schema: SCHEMA });
  const list = Array.isArray(res && res.proposte) ? res.proposte : [];
  const inSlot = (start, min) => slots.find(s => start >= s.start && toM(start) + min <= toM(s.end) + 5);
  return list.slice(0, 3).filter(p => p && p.titolo).map(p => {
    let minutes = Math.max(10, Math.min(480, parseInt(p.minuti, 10) || 45));
    let start = /^\d{2}:\d{2}$/.test(p.inizio || '') ? p.inizio : '';
    if (!start || !inSlot(start, minutes)) {
      const s = slots.find(x => x.minutes >= minutes) || slots[0];
      start = s.start; minutes = Math.min(minutes, s.minutes);
    }
    const project = state.projects.find(x => x.id === p.progetto_id);
    const interest = state.interests.find(x => x.id === p.interesse_id);
    const next = project && project.steps.find(s => !s.done);
    return {
      id: uid(), title: String(p.titolo).slice(0, 120), detail: String(p.descrizione || '').slice(0, 400), why: String(p.perche || '').slice(0, 300),
      minutes, start, cost: p.costo || '', outdoor: !!p.all_aperto, kind: p.tipo || 'attivita',
      tags: (Array.isArray(p.etichette) ? p.etichette : []).map(x => String(x).toLowerCase().trim()).filter(Boolean).slice(0, 5),
      projectId: project ? project.id : '', stepId: next ? next.id : '', interestId: interest ? interest.id : '', status: '',
    };
  });
}

export async function propose(date) {
  if (ui.busy) return;
  const slots = freeSlots(date);
  if (!slots.length) { toast('In quel giorno non vedo tempo libero'); return; }
  ui.busy = true; ui.day = date;
  commit(); // mostra "Sto pensando…"
  let list = [], source = 'regole';
  try {
    if (isConnected()) { list = await aiProposals(date, slots); source = 'ai'; }
    else list = ruleProposals(date, slots);
  } catch (e) {
    console.error(e);
    toast(`${e.message} Ti mostro proposte semplici.`, 'bad');
    list = ruleProposals(date, slots);
  }
  const prev = currentProposals(date);
  if (prev) prev.items.filter(i => !i.status).forEach(i => recordFeedback(i, 'ignorato'));
  state.proposals = state.proposals.filter(p => p.date !== date);
  state.proposals.push({ date, source, createdAt: new Date().toISOString(), items: list });
  ui.busy = false;
  commit();
  if (!list.length) toast('Non ho trovato proposte adatte: prova a cambiare giorno');
}

function findItem(id) {
  for (const p of state.proposals) { const it = p.items.find(i => i.id === id); if (it) return { p, it }; }
  return {};
}

export function feedback(id, value) {
  const { p, it } = findItem(id);
  if (!it) return;
  it.status = value;
  recordFeedback(it, value);
  if (value === 'dopo' && !state.saved.some(s => s.title === it.title)) {
    state.saved.unshift({ id: uid(), title: it.title, detail: it.detail, why: it.why, minutes: it.minutes, tags: it.tags, createdAt: new Date().toISOString() });
  }
  commit();
  toast({ interessa: 'Bene, ne terrò conto', no: 'Ok, te ne proporrò di meno simili', conosciuto: 'Ok, non te lo ripropongo', dopo: 'Salvato per dopo: lo trovi in Interessi' }[value] || 'Fatto');
  return p;
}

export function plan(id) {
  const { p, it } = findItem(id);
  if (!it) return;
  if (it.status !== 'scelto') { it.status = 'scelto'; recordFeedback(it, 'scelto'); commit(); }
  const end = toT(Math.min(toM(it.start) + it.minutes, 24 * 60 - 1));
  openEventSheet(null, {
    title: it.title, type: 'attivita', date: p.date, start: it.start, end,
    notes: [it.detail, it.why && `Perché: ${it.why}`].filter(Boolean).join('\n'),
    link: it.projectId && it.stepId ? { projectId: it.projectId, stepId: it.stepId } : null,
    reminders: [],
  });
}

// ---------- Schermate

function proposalCard(it) {
  const meta = [durLabel(it.minutes), it.start && `dalle ${it.start}`, it.cost && (it.cost === 'gratis' ? 'gratis' : `costo ${it.cost}`), it.outdoor && 'all\'aperto'].filter(Boolean).join(' · ');
  if (it.status === 'no' || it.status === 'conosciuto') {
    return `<div class="prop-card dim"><p>${esc(it.title)} <em>· ${it.status === 'no' ? 'scartata' : 'già conosciuta'}</em></p></div>`;
  }
  const fb = (v, label, ic) => `<button class="fb${it.status === v ? ' on' : ''}" data-action="prop-fb" data-id="${it.id}" data-v="${v}">${ic}${label}</button>`;
  return `<div class="prop-card${it.status ? ' answered' : ''}">
    <span class="suggest-tag">${icon('spark', 'xs')} ${esc(meta)}</span>
    <strong>${esc(it.title)}</strong>
    ${it.detail ? `<p>${esc(it.detail)}</p>` : ''}
    ${it.why ? `<p class="why">${esc(it.why)}</p>` : ''}
    <div class="suggest-actions">
      <button class="btn small primary" data-action="prop-plan" data-id="${it.id}">${icon('calendar', 'xs')} ${it.status === 'scelto' ? 'Di nuovo in agenda' : 'Mettilo in agenda'}</button>
      ${it.projectId ? `<button class="btn small ghost" data-action="open-project" data-id="${it.projectId}">Progetto</button>` : ''}
    </div>
    <div class="fb-row">
      ${fb('interessa', 'Mi interessa', '👍 ')}${fb('no', 'Non fa per me', '👎 ')}${fb('conosciuto', 'Già lo so', '✓ ')}${fb('dopo', 'Dopo', '🔖 ')}
    </div>
  </div>`;
}

export function renderFreeTime() {
  pruneProposals();
  const opts = dayOptions();
  if (!opts.some(o => o.date === ui.day)) ui.day = opts[0].date;
  const slots = freeSlots(ui.day);
  const cur = currentProposals(ui.day);
  const conn = isConnected();
  return `<h2 class="sec">Tempo libero</h2>
    <div class="free-card">
      <div class="day-chips">${opts.map(o => `<button class="${o.date === ui.day ? 'on' : ''}" data-action="prop-day" data-date="${o.date}">${esc(o.label)}</button>`).join('')}</div>
      <p class="slots">${slots.length ? `Libero: ${slots.map(s => `${s.start}–${s.end}`).join(', ')}` : 'Nessun tempo libero in questo giorno.'}
        <button class="link" data-action="open-day-settings">Orari</button></p>
      <button class="btn primary propose" data-action="propose"${ui.busy || !slots.length ? ' disabled' : ''}>${icon('spark', 'xs')} ${ui.busy ? 'Ci penso…' : cur ? 'Altre proposte' : 'Proponimi qualcosa'}</button>
      ${!conn ? `<p class="hint">Proposte semplici dai tuoi progetti e interessi. <a href="#assistente">Collega l'assistente</a> per proposte su misura.</p>` : ''}
    </div>
    ${cur && cur.items.length ? `<div class="list">${cur.items.map(proposalCard).join('')}</div>
      <p class="hint center">${cur.source === 'ai' ? 'Proposte dell\'assistente' : 'Proposte automatiche'}: le tue risposte aiutano a migliorare le prossime.</p>` : ''}`;
}

export function renderSaved() {
  if (!state.saved.length) return '';
  return `<h2 class="sec">Salvati per dopo</h2>
    <div class="list">${state.saved.map(s => `<div class="item saved">
      <div class="item-main static"><strong>${esc(s.title)}</strong>${s.detail ? `<small>${esc(s.detail)}</small>` : ''}</div>
      <div class="saved-actions">
        <button class="icon-btn tiny" data-action="saved-plan" data-id="${s.id}" aria-label="Metti in agenda">${icon('calendar')}</button>
        <button class="icon-btn tiny" data-action="saved-done" data-id="${s.id}" aria-label="Fatto">${icon('check')}</button>
        <button class="icon-btn tiny" data-action="saved-del" data-id="${s.id}" aria-label="Togli">${icon('close')}</button>
      </div></div>`).join('')}</div>`;
}

export function openProfile() {
  const p = profile();
  const chip = (key, label) => `<span class="pchip">${esc(label)}<button data-forget="${esc(key)}" aria-label="Dimentica">${icon('close', 'xs')}</button></span>`;
  const fbCount = state.feedback.filter(f => f.value !== 'ignorato').length;
  openSheet(`
    <div class="sheet-head"><h2>Cosa ho imparato</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
    <p class="hint">Tutto viene dalle tue risposte alle proposte (${fbCount}) e dagli impegni che segni come fatti. Resta sul telefono. Tocca × per far dimenticare una cosa.</p>
    <label class="toggle"><input type="checkbox" data-learn${L().enabled ? ' checked' : ''}><span><strong>Impara dalle mie scelte</strong><small>Se lo spegni, proposte e assistente ignorano quello che è stato imparato</small></span></label>
    <h3 class="sub">Ti interessano</h3>
    <div class="pchips">${p.likes.length ? p.likes.map(t => chip('tag:' + t, t)).join('') : '<p class="hint">Ancora niente: rispondi a qualche proposta con «Mi interessa».</p>'}</div>
    <h3 class="sub">Di solito scarti</h3>
    <div class="pchips">${p.dislikes.length ? p.dislikes.map(t => chip('tag:' + t, t)).join('') : '<p class="hint">Niente.</p>'}</div>
    <h3 class="sub">Abitudini osservate</h3>
    ${p.habits.length ? `<ul class="habits">${p.habits.map(h => `<li><span>${esc(h.text)}</span><button class="icon-btn tiny" data-forget="${esc(h.key)}" aria-label="Dimentica">${icon('close')}</button></li>`).join('')}</ul>`
      : '<p class="hint">Compariranno quando avrai segnato come fatte le stesse attività almeno tre volte.</p>'}
    <div class="stack">
      ${L().forgotten.length ? '<button class="btn" data-unforget>Ripristina le cose dimenticate</button>' : ''}
      <button class="btn danger" data-wipe>Cancella tutto quello che ho imparato</button>
    </div>`, sheet => {
    sheet.querySelector('[data-learn]').addEventListener('change', e => { L().enabled = e.target.checked; commit(); toast(e.target.checked ? 'Apprendimento attivo' : 'Apprendimento in pausa'); });
    sheet.querySelectorAll('[data-forget]').forEach(b => b.addEventListener('click', () => {
      if (!L().forgotten.includes(b.dataset.forget)) L().forgotten.push(b.dataset.forget);
      commit(); openProfile();
    }));
    const un = sheet.querySelector('[data-unforget]');
    if (un) un.addEventListener('click', () => { L().forgotten = []; commit(); openProfile(); });
    sheet.querySelector('[data-wipe]').addEventListener('click', () => {
      if (!confirm('Cancellare tutte le risposte alle proposte e quello che ne ho imparato? I tuoi impegni non vengono toccati.')) return;
      state.feedback = []; L().forgotten = [];
      commit(); openProfile(); toast('Cancellato');
    });
  });
}

export const actions = {
  'prop-day': el => { ui.day = el.dataset.date; commit(); },
  propose: () => propose(ui.day),
  'prop-fb': el => feedback(el.dataset.id, el.dataset.v),
  'prop-plan': el => plan(el.dataset.id),
  'open-day-settings': () => openSettings('day'),
  'open-profile': () => openProfile(),
  'saved-plan': el => {
    const s = state.saved.find(x => x.id === el.dataset.id);
    if (s) openEventSheet(null, { title: s.title, type: 'attivita', date: D.todayISO(), notes: s.detail, reminders: [] });
  },
  'saved-done': el => {
    const s = state.saved.find(x => x.id === el.dataset.id);
    if (!s) return;
    recordFeedback({ title: s.title, tags: s.tags, kind: 'salvato' }, 'scelto');
    state.saved = state.saved.filter(x => x.id !== s.id);
    commit(); toast('Fatto, lo tolgo dalla lista');
  },
  'saved-del': el => { state.saved = state.saved.filter(x => x.id !== el.dataset.id); commit(); },
};

