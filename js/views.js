// Le schermate dell'app e i pannelli di modifica.
import { state, commit, touch, uid, exportData, importData, stats, normEvent, normProject, normInterest, normDiscovery, DISCOVERY_TYPES, discoveriesOf } from './store.js?v=2.8.2';
import * as D from './dates.js?v=2.8.2';
import { esc, icon, openSheet, closeSheet, toast, voiceSupported } from './ui.js?v=2.8.2';
import { renderFreeTime, renderSaved, recordFeedback } from './learn.js?v=2.8.2';
import { CLAUDE_URL } from './bridge.js?v=2.8.2';

export const ui = { mode: 'settimana', cursor: D.todayISO(), selected: D.todayISO(), archive: false, showDone: false };

export const TYPE = {
  appuntamento: { label: 'Appuntamento', cls: 't-app' },
  attivita: { label: 'Attività', cls: 't-att' },
  scadenza: { label: 'Scadenza', cls: 't-sca' },
};
const LEADS = [['', 'Nessun promemoria'], ['0', "All'ora dell'impegno"], ['15', '15 minuti prima'], ['60', '1 ora prima'],
  ['180', '3 ore prima'], ['1440', 'Il giorno prima'], ['2880', '2 giorni prima'], ['10080', 'Una settimana prima']];
const FREQ = { none: 'Non si ripete', daily: 'Ogni giorno', weekly: 'Ogni settimana', monthly: 'Ogni mese', yearly: 'Ogni anno' };
const UNIT = { daily: ['giorno', 'giorni'], weekly: ['settimana', 'settimane'], monthly: ['mese', 'mesi'], yearly: ['anno', 'anni'] };
const PSTATUS = { attivo: 'Attivo', pausa: 'In pausa', completato: 'Completato', archiviato: 'Archiviato' };

export function leadLabel(m) {
  if (m == null) return 'Nessun promemoria';
  const f = LEADS.find(l => l[0] === String(m));
  if (f) return f[1];
  if (m % 1440 === 0) return `${m / 1440} giorni prima`;
  if (m % 60 === 0) return `${m / 60} ore prima`;
  return `${m} minuti prima`;
}
const WD_SHORT = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
export function recLabel(r) {
  if (!r || r.freq === 'none') return '';
  const base = r.interval > 1 ? `Ogni ${r.interval} ${UNIT[r.freq][1]}` : FREQ[r.freq];
  if (r.freq === 'weekly' && r.days && r.days.length) {
    return `${base}: ${[...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => WD_SHORT[d]).join(', ')}`;
  }
  return base;
}
export const remindersLabel = list => (list && list.length ? list.map(leadLabel).join(', ') : 'Nessun promemoria');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- Dati calcolati

export function items(from, to) {
  const out = [];
  for (const ev of state.events) {
    for (const date of D.occurrences(ev, from, to)) out.push({ ev, date, done: ev.done.includes(date) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.ev.start || '').localeCompare(b.ev.start || '')
    || a.ev.title.localeCompare(b.ev.title));
}

// Senza orario, un impegno conta come "alle 9" per calcolare il promemoria
const whenOf = it => D.at(it.date, it.ev.start || '09:00');

// Stato dei promemoria di una ripetizione: null se nessuno è ancora scattato,
// "soon" quando è scattato anche il più vicino (es. un'ora prima)
export function reminderState(it, now = new Date()) {
  const list = it.ev.reminders;
  if (it.done || !list.length) return null;
  const when = whenOf(it);
  if (when < now && it.date !== D.todayISO()) return null;
  const passed = list.filter(m => now >= new Date(when.getTime() - m * 60000));
  if (!passed.length) return null;
  const nearest = Math.min(...list);
  return passed.includes(nearest) && (list.length > 1 || nearest <= 180) && when >= now ? 'soon' : 'on';
}

// Impegni futuri con almeno un promemoria già scattato
export function activeReminders(horizonDays = 400) {
  const now = new Date();
  const t = D.todayISO();
  return items(t, D.addDaysISO(t, horizonDays)).filter(it => reminderState(it, now));
}

const untilLabel = it => {
  const mins = Math.round((whenOf(it) - new Date()) / 60000);
  if (mins < 0) return '';
  if (mins < 60) return `tra ${mins} min`;
  if (mins < 24 * 60) return `tra ${Math.round(mins / 60)} h`;
  return '';
};

function overdueDeadlines() {
  const t = D.todayISO();
  return items(D.addDaysISO(t, -60), D.addDaysISO(t, -1)).filter(it => it.ev.type === 'scadenza' && !it.done);
}

// ---------- Componenti

export function quickAdd(placeholder = 'Es. dentista il 20 novembre alle 15') {
  return `<form class="quick" data-form="quick">
    <input name="q" placeholder="${esc(placeholder)}" data-placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="done" aria-label="Aggiungi un impegno">
    ${voiceSupported ? `<button type="button" class="icon-btn mic" data-action="voice" aria-label="Detta un impegno">${icon('mic')}</button>` : ''}
    <button class="icon-btn solid" aria-label="Aggiungi">${icon('plus')}</button>
  </form>`;
}

function itemRow(it, { showDate = false } = {}) {
  const e = it.ev;
  const rs = reminderState(it);
  const canDone = e.type !== 'appuntamento';
  const soon = rs === 'soon' && untilLabel(it);
  const meta = [
    showDate && esc(D.relDay(it.date)),
    e.end && `fino alle ${esc(e.end)}`,
    !e.start && e.type === 'scadenza' && 'Scadenza',
    e.location && `${icon('pin', 'xs')}${esc(e.location)}`,
    soon && `<em class="soon-tag">${icon('bell', 'xs')}${soon}</em>`,
    !soon && rs && icon('bell', 'xs accent'),
    recLabel(e.recurrence) && icon('repeat', 'xs muted-ic'),
    e.link && icon('layers', 'xs muted-ic'),
  ].filter(Boolean);
  return `<div class="item ${TYPE[e.type].cls}${it.done ? ' is-done' : ''}${rs === 'soon' ? ' soon' : ''}">
    <span class="item-time">${e.start ? esc(e.start) : ''}</span>
    ${canDone
      ? `<button class="check${it.done ? ' on' : ''}" data-action="toggle-done" data-id="${e.id}" data-date="${it.date}" aria-label="${it.done ? 'Segna come da fare' : 'Segna come fatto'}">${icon('check')}</button>`
      : `<span class="bar" title="${TYPE[e.type].label}"></span>`}
    <button class="item-main" data-action="edit-event" data-id="${e.id}" data-date="${it.date}">
      <strong>${esc(e.title)}</strong>
      ${meta.length ? `<small>${meta.join(' ')}</small>` : ''}
    </button>
  </div>`;
}

// Elenco raggruppato per giorno: il nome del giorno compare una volta sola
function byDayList(list, max = 99) {
  const days = [];
  let shown = 0;
  for (const it of list) {
    if (shown >= max) break;
    let g = days[days.length - 1];
    if (!g || g.date !== it.date) days.push(g = { date: it.date, rows: [] });
    g.rows.push(itemRow(it));
    shown++;
  }
  return days.map(g => `<p class="group-day">${esc(D.relDay(g.date))}<span>${esc(D.fmt(g.date, { day: 'numeric', month: 'long' }))}</span></p>
    <div class="list">${g.rows.join('')}</div>`).join('');
}

const empty = (title, text) => `<div class="empty"><strong>${title}</strong> ${text}</div>`;

// ---------- OGGI

export function renderToday() {
  const t = D.todayISO();
  const h = new Date().getHours();
  const greet = h < 5 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const today = items(t, t);
  const open = today.filter(i => !i.done);
  // Le routine di ogni giorno si vedono già in "Oggi": nei prossimi giorni sarebbero solo ripetizioni
  const week = items(D.addDaysISO(t, 1), D.addDaysISO(t, 7)).filter(i => !(i.ev.recurrence.freq === 'daily' && i.ev.recurrence.interval === 1));
  const reminders = activeReminders();
  const later = reminders.filter(r => r.date > D.addDaysISO(t, 7));
  const overdue = overdueDeadlines();

  const summary = open.length ? `${plural(open.length, 'cosa', 'cose')} in programma oggi`
    : today.length ? 'Hai fatto tutto quello che avevi in programma' : 'Oggi non hai impegni';

  return `<section class="view">
    <header class="hero">
      <p class="eyebrow">${greet}</p>
      <h1>${D.cap(D.fmt(t, { weekday: 'long' }))} <span>${D.fmt(t, { day: 'numeric', month: 'long' })}</span></h1>
      <p class="lead">${summary}</p>
    </header>
    ${quickAdd()}
    ${overdue.length ? `<h2 class="sec warn">Scadenze passate</h2><div class="list">${overdue.map(i => itemRow(i, { showDate: true })).join('')}</div>` : ''}
    <h2 class="sec">Oggi</h2>
    ${today.length ? `<div class="list">${today.map(i => itemRow(i)).join('')}</div>` : empty('Giornata libera.', 'Non hai niente in agenda per oggi.')}
    ${later.length ? `<h2 class="sec">Da ricordare</h2><div class="list">${later.map(i => itemRow(i, { showDate: true })).join('')}</div>` : ''}
    <h2 class="sec">Prossimi giorni</h2>
    ${week.length ? byDayList(week, 8) + (week.length > 8 ? `<a class="more" href="#impegni">Vedi tutta la settimana (${week.length})</a>` : '')
      : empty('Settimana tranquilla.', 'Niente in programma per i prossimi sette giorni.')}
    ${renderFreeTime()}
  </section>`;
}

// ---------- IMPEGNI

function rangeLabel() {
  if (ui.mode === 'giorno') return `${D.relDay(ui.cursor)} · ${D.fmt(ui.cursor, { day: 'numeric', month: 'long' })}`;
  if (ui.mode === 'settimana') {
    const s = D.startOfWeekISO(ui.cursor), e = D.addDaysISO(s, 6);
    const sm = D.parseISO(s).getMonth() === D.parseISO(e).getMonth();
    return `${D.fmt(s, sm ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} – ${D.fmt(e, { day: 'numeric', month: 'long' })}`;
  }
  return D.cap(D.fmt(ui.cursor, { month: 'long', year: 'numeric' }));
}

function dayView(iso) {
  const list = items(iso, iso);
  return list.length ? `<div class="list">${list.map(i => itemRow(i)).join('')}</div>` : empty('Niente in programma.', 'Tocca + per aggiungere qualcosa a questo giorno.');
}

function weekView() {
  const s = D.startOfWeekISO(ui.cursor);
  const all = items(s, D.addDaysISO(s, 6));
  const t = D.todayISO();
  let html = '';
  for (let k = 0; k < 7; k++) {
    const d = D.addDaysISO(s, k);
    const list = all.filter(i => i.date === d);
    html += `<div class="day-block${d === t ? ' is-today' : ''}">
      <button class="day-head" data-action="goto-day" data-date="${d}">
        <span>${D.cap(D.fmt(d, { weekday: 'long' }))}</span><small>${D.fmt(d, { day: 'numeric', month: 'short' })}</small>
      </button>
      ${list.length ? `<div class="list">${list.map(i => itemRow(i)).join('')}</div>` : '<p class="day-empty">Libero</p>'}
    </div>`;
  }
  return html;
}

function monthView() {
  const c = D.parseISO(ui.cursor);
  const y = c.getFullYear(), m = c.getMonth();
  const first = D.toISO(new Date(y, m, 1));
  const last = D.toISO(new Date(y, m + 1, 0));
  const gs = D.startOfWeekISO(first);
  const ge = D.addDaysISO(D.startOfWeekISO(last), 6);
  const all = items(gs, ge);
  const by = {};
  all.forEach(i => { (by[i.date] = by[i.date] || []).push(i); });
  const t = D.todayISO();
  if (ui.selected < first || ui.selected > last) ui.selected = t >= first && t <= last ? t : first;
  let cells = '';
  for (let d = gs; d <= ge; d = D.addDaysISO(d, 1)) {
    const list = by[d] || [];
    const types = [...new Set(list.map(i => i.ev.type))];
    cells += `<button class="cell${d < first || d > last ? ' out' : ''}${d === t ? ' today' : ''}${d === ui.selected ? ' sel' : ''}" data-action="select-day" data-date="${d}" aria-label="${D.fmt(d, { day: 'numeric', month: 'long' })}${list.length ? ', ' + plural(list.length, 'impegno', 'impegni') : ''}">
      <span>${D.parseISO(d).getDate()}</span>
      <i class="dots">${types.map(ty => `<b class="${TYPE[ty].cls}"></b>`).join('')}</i>
    </button>`;
  }
  return `<div class="month">
      <div class="wd">${['L', 'M', 'M', 'G', 'V', 'S', 'D'].map(x => `<span>${x}</span>`).join('')}</div>
      <div class="grid">${cells}</div>
    </div>
    <h2 class="sec">${D.relDay(ui.selected)} · ${D.fmt(ui.selected, { day: 'numeric', month: 'long' })}</h2>
    ${dayView(ui.selected)}`;
}

export function renderAgenda() {
  if (ui.mode === 'giorno') ui.selected = ui.cursor;
  const body = ui.mode === 'giorno' ? dayView(ui.cursor) : ui.mode === 'settimana' ? weekView() : monthView();
  return `<section class="view">
    <header class="page-head"><h1>Impegni</h1></header>
    ${quickAdd()}
    <div class="seg" role="tablist">
      ${['giorno', 'settimana', 'mese'].map(m => `<button role="tab" aria-selected="${ui.mode === m}" class="${ui.mode === m ? 'on' : ''}" data-action="mode" data-mode="${m}">${D.cap(m)}</button>`).join('')}
    </div>
    <div class="nav-row">
      <button class="icon-btn" data-action="prev" aria-label="Precedente">${icon('left')}</button>
      <strong>${rangeLabel()}</strong>
      <button class="icon-btn" data-action="next" aria-label="Successivo">${icon('right')}</button>
      <button class="btn small ghost" data-action="go-today">Oggi</button>
    </div>
    ${body}
    <button class="fab" data-action="new-event" aria-label="Nuovo impegno">${icon('plus')}</button>
  </section>`;
}

export function shiftCursor(dir) {
  if (ui.mode === 'giorno') ui.cursor = D.addDaysISO(ui.cursor, dir);
  else if (ui.mode === 'settimana') ui.cursor = D.addDaysISO(ui.cursor, 7 * dir);
  else { const c = D.parseISO(ui.cursor); ui.cursor = D.toISO(new Date(c.getFullYear(), c.getMonth() + dir, 1)); }
}

export function newEventDate() {
  if (ui.mode === 'mese') return ui.selected;
  if (ui.mode === 'giorno') return ui.cursor;
  const s = D.startOfWeekISO(ui.cursor), t = D.todayISO();
  return t >= s && t <= D.addDaysISO(s, 6) ? t : s;
}

// ---------- Pannello impegno

const WD_PICK = [1, 2, 3, 4, 5, 6, 0]; // da lunedì a domenica
const WD_LETTER = { 1: 'L', 2: 'M', 3: 'M', 4: 'G', 5: 'V', 6: 'S', 0: 'D' };
const WD_NAME = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

function leadOptions(value) {
  const known = LEADS.some(l => l[0] !== '' && l[0] === String(value));
  return LEADS.filter(l => l[0] !== '').map(([v, l]) => `<option value="${v}"${String(value) === v ? ' selected' : ''}>${l}</option>`).join('')
    + `<option value="custom"${!known ? ' selected' : ''}>Personalizzato…</option>`;
}
function splitLead(m) {
  if (m % 1440 === 0 && m >= 1440) return ['1440', m / 1440];
  if (m % 60 === 0 && m >= 60) return ['60', m / 60];
  return ['1', m || 30];
}
function reminderRow(m) {
  const known = LEADS.some(l => l[0] !== '' && l[0] === String(m));
  const [u, n] = splitLead(m);
  return `<div class="rem-row">
    <select data-rem aria-label="Anticipo del promemoria">${leadOptions(m)}</select>
    <span class="rem-custom"${known ? ' hidden' : ''}>
      <input type="number" data-rem-n min="1" max="999" value="${n}" aria-label="Quanto prima">
      <select data-rem-u aria-label="Unità"><option value="1"${u === '1' ? ' selected' : ''}>min</option><option value="60"${u === '60' ? ' selected' : ''}>ore</option><option value="1440"${u === '1440' ? ' selected' : ''}>giorni</option></select>
    </span>
    <button type="button" class="icon-btn tiny" data-rem-del aria-label="Togli promemoria">${icon('close')}</button>
  </div>`;
}
function readReminders(root) {
  return [...root.querySelectorAll('.rem-row')].map(row => {
    const sel = row.querySelector('[data-rem]').value;
    if (sel === 'custom') return Math.max(1, parseInt(row.querySelector('[data-rem-n]').value, 10) || 1) * +row.querySelector('[data-rem-u]').value;
    return +sel;
  });
}
const defaultReminders = type => (state.settings.reminders[type] == null ? [] : [state.settings.reminders[type]]);

// Chiede a cosa applicare la modifica di un impegno che si ripete
function askScope(sheet, verb) {
  return new Promise(resolve => {
    const box = sheet.querySelector('.scope');
    box.innerHTML = `<p><strong>${verb}</strong></p>
      <button type="button" class="btn" data-scope="this">Solo questa volta</button>
      <button type="button" class="btn" data-scope="future">Questa e le successive</button>
      <button type="button" class="btn" data-scope="all">Tutte le ripetizioni</button>
      <button type="button" class="btn ghost" data-scope="">Annulla</button>`;
    box.hidden = false;
    sheet.querySelector('.actions').hidden = true;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.onclick = e => {
      const b = e.target.closest('[data-scope]');
      if (!b) return;
      box.hidden = true; box.onclick = null;
      sheet.querySelector('.actions').hidden = false;
      resolve(b.dataset.scope || null);
    };
  });
}

const isFirstOccurrence = (ev, date) => D.occurrences({ ...ev, exdates: [] }, ev.date, date)[0] === date;

// Applica le modifiche a una ripetizione, alle successive o a tutte
function saveRecurring(ev, data, occ, scope) {
  if (scope === 'future' && isFirstOccurrence(ev, occ)) scope = 'all';
  if (scope === 'this') {
    if (!ev.exdates.includes(occ)) ev.exdates.push(occ);
    touch(ev);
    const copy = normEvent({ ...data, id: uid(), recurrence: { freq: 'none' }, exdates: [],
      done: ev.done.includes(occ) && data.date === occ ? [occ] : [] });
    state.events.push(copy);
    return 'Modificata solo questa volta';
  }
  if (scope === 'future') {
    const shift = D.daysBetween(occ, data.date);
    const next = normEvent({ ...data, id: uid(),
      done: ev.done.filter(d => d >= occ).map(d => D.addDaysISO(d, shift)),
      exdates: ev.exdates.filter(d => d >= occ).map(d => D.addDaysISO(d, shift)) });
    ev.recurrence.until = D.addDaysISO(occ, -1);
    ev.done = ev.done.filter(d => d < occ);
    ev.exdates = ev.exdates.filter(d => d < occ);
    touch(ev);
    state.events.push(next);
    return 'Modificate questa e le successive';
  }
  // Tutte: se hai spostato il giorno, sposto l'intera serie dello stesso numero di giorni
  const shift = D.daysBetween(occ, data.date);
  Object.assign(ev, normEvent({ ...data, id: ev.id, date: D.addDaysISO(ev.date, shift),
    done: ev.done.map(d => D.addDaysISO(d, shift)), exdates: ev.exdates.map(d => D.addDaysISO(d, shift)) }));
  touch(ev);
  return 'Modificate tutte le ripetizioni';
}

function deleteRecurring(ev, occ, scope) {
  if (scope === 'future' && isFirstOccurrence(ev, occ)) scope = 'all';
  if (scope === 'this') { ev.exdates.push(occ); touch(ev); return 'Eliminata solo questa volta'; }
  if (scope === 'future') {
    ev.recurrence.until = D.addDaysISO(occ, -1);
    ev.done = ev.done.filter(d => d < occ);
    touch(ev);
    return 'Eliminate questa e le successive';
  }
  state.events = state.events.filter(e => e.id !== ev.id);
  return 'Impegno eliminato';
}

export function openEventSheet(id, preset = {}, notes = [], occDate = '') {
  const ev = id ? state.events.find(e => e.id === id) : null;
  if (id && !ev) { toast('Impegno non trovato'); return; }
  const d = ev ? JSON.parse(JSON.stringify(ev)) : normEvent({ ...preset, reminders: preset.reminders || [] });
  if (!ev && !preset.reminders) d.reminders = defaultReminders(d.type);
  const recurring = ev && ev.recurrence.freq !== 'none';
  const occ = recurring ? (occDate || ev.date) : '';
  if (recurring) d.date = occ; // mostro la data della ripetizione toccata
  const r = d.recurrence;
  const days = r.days.length ? r.days : [D.parseISO(d.date).getDay()];
  const cats = [...new Set(state.events.map(e => e.category).filter(Boolean))];
  const project = d.link && state.projects.find(p => p.id === d.link.projectId);

  openSheet(`
    <div class="sheet-head"><h2>${ev ? 'Modifica impegno' : 'Nuovo impegno'}</h2>
      <button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
    ${notes.length ? `<div class="notice">${icon('spark', 'xs')}<div><strong>Ho capito così: controlla e salva.</strong>${notes.filter(Boolean).map(n => `<p>${esc(n)}</p>`).join('')}</div></div>` : ''}
    ${recurring ? `<p class="hint">${icon('repeat', 'xs')} ${esc(recLabel(r))} · stai guardando la volta di ${esc(D.fmt(occ, { weekday: 'long', day: 'numeric', month: 'long' }))}</p>` : ''}
    ${project ? `<p class="hint">${icon('layers', 'xs')} Passaggio del progetto «${esc(project.name)}»: quando lo segni fatto, si spunta anche nel progetto.</p>` : ''}
    <form class="form" id="ev-form" novalidate>
      <div class="seg type-seg">
        ${Object.entries(TYPE).map(([k, v]) => `<label class="${d.type === k ? 'on' : ''}"><input type="radio" name="type" value="${k}"${d.type === k ? ' checked' : ''}>${v.label}</label>`).join('')}
      </div>
      <label class="field"><span>Titolo</span><input name="title" value="${esc(d.title === 'Senza titolo' && !ev ? '' : d.title)}" required maxlength="140" placeholder="Cosa devi fare?"></label>
      <label class="field"><span>Data</span><input type="date" name="date" value="${d.date}" required></label>
      <div class="row">
        <label class="field"><span>Inizio</span><input type="time" name="start" value="${d.start}"></label>
        <label class="field"><span>Fine</span><input type="time" name="end" value="${d.end}"></label>
      </div>
      <p class="hint">Lascia vuoti gli orari se non serve un'ora precisa.</p>
      <div class="field"><span>Promemoria</span>
        <div class="rem-list">${d.reminders.map(reminderRow).join('')}</div>
        <button type="button" class="btn small ghost add-rem" data-rem-add>${icon('bell', 'xs')} Aggiungi promemoria</button>
      </div>
      <label class="field"><span>Ripetizione</span><select name="freq">
        ${Object.entries(FREQ).map(([k, v]) => `<option value="${k}"${r.freq === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="field wd-field"${r.freq === 'weekly' ? '' : ' hidden'}><span>Nei giorni</span>
        <div class="wd-pick">${WD_PICK.map(n => `<label class="${days.includes(n) ? 'on' : ''}" title="${WD_NAME[n]}"><input type="checkbox" name="wd" value="${n}"${days.includes(n) ? ' checked' : ''}>${WD_LETTER[n]}</label>`).join('')}</div>
      </div>
      <div class="row rec-extra"${r.freq === 'none' ? ' hidden' : ''}>
        <label class="field"><span>Ogni quanti</span><input type="number" name="interval" min="1" max="99" value="${r.interval}"></label>
        <label class="field"><span>Fino al (facoltativo)</span><input type="date" name="until" value="${r.until}"></label>
      </div>
      <label class="field"><span>Luogo</span><input name="location" value="${esc(d.location)}" maxlength="120" placeholder="Facoltativo"></label>
      <label class="field"><span>Categoria</span><input name="category" value="${esc(d.category)}" maxlength="40" list="cat-list" placeholder="Es. salute, casa, lavoro">
        <datalist id="cat-list">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="field"><span>Note</span><textarea name="notes" rows="3" maxlength="2000">${esc(d.notes)}</textarea></label>
      <p class="error" hidden></p>
      <div class="scope" hidden></div>
      <div class="actions">
        ${ev ? `<button type="button" class="btn ghost danger" data-del>Elimina</button>` : ''}
        <button class="btn primary">Salva</button>
      </div>
    </form>`, sheet => {
    const f = sheet.querySelector('#ev-form');
    const remList = sheet.querySelector('.rem-list');
    let remTouched = !!ev || !!preset.reminders;
    const refreshAdd = () => { sheet.querySelector('[data-rem-add]').hidden = remList.children.length >= 5; };
    refreshAdd();
    sheet.querySelector('[data-rem-add]').addEventListener('click', () => {
      remTouched = true;
      const used = readReminders(remList);
      const next = [1440, 60, 15, 180, 2880, 10080, 0].find(m => !used.includes(m)) ?? 60;
      remList.insertAdjacentHTML('beforeend', reminderRow(next));
      refreshAdd();
    });
    remList.addEventListener('change', e => {
      remTouched = true;
      const sel = e.target.closest('[data-rem]');
      if (sel) sel.parentNode.querySelector('.rem-custom').hidden = sel.value !== 'custom';
    });
    remList.addEventListener('click', e => {
      const del = e.target.closest('[data-rem-del]');
      if (del) { remTouched = true; del.closest('.rem-row').remove(); refreshAdd(); }
    });
    const showRec = () => {
      sheet.querySelector('.rec-extra').hidden = f.freq.value === 'none';
      sheet.querySelector('.wd-field').hidden = f.freq.value !== 'weekly';
    };
    f.freq.addEventListener('change', showRec);
    sheet.querySelector('.wd-pick').addEventListener('change', () => {
      sheet.querySelectorAll('.wd-pick label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
    });
    f.querySelectorAll('input[name=type]').forEach(inp => inp.addEventListener('change', () => {
      f.querySelectorAll('.type-seg label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
      if (!remTouched) { remList.innerHTML = defaultReminders(inp.value).map(reminderRow).join(''); refreshAdd(); }
    }));
    if (!ev && !preset.title) setTimeout(() => f.title.focus(), 50);

    const del = sheet.querySelector('[data-del]');
    if (del) del.addEventListener('click', async () => {
      let msg;
      if (recurring) {
        const scope = await askScope(sheet, 'Cosa vuoi eliminare?');
        if (!scope) return;
        msg = deleteRecurring(ev, occ, scope);
      } else {
        if (!confirm(`Eliminare «${ev.title}»?`)) return;
        state.events = state.events.filter(e => e.id !== ev.id);
        msg = 'Impegno eliminato';
      }
      closeSheet(); commit(); toast(msg);
    });

    f.addEventListener('submit', async e => {
      e.preventDefault();
      const err = sheet.querySelector('.error');
      err.hidden = true;
      const val = n => f[n].value.trim();
      const fail = msg => { err.textContent = msg; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
      if (!val('title')) return fail('Scrivi un titolo.');
      if (!val('date')) return fail('Scegli una data.');
      if (val('start') && val('end') && val('end') <= val('start')) return fail("L'ora di fine deve essere dopo l'inizio.");
      if (val('end') && !val('start')) return fail("Se metti l'ora di fine, indica anche l'inizio.");
      if (f.freq.value !== 'none' && val('until') && val('until') < val('date')) return fail('La ripetizione deve finire dopo la data di inizio.');
      let wd = [...f.querySelectorAll('input[name=wd]:checked')].map(x => +x.value);
      if (f.freq.value === 'weekly' && !wd.length) return fail('Scegli almeno un giorno della settimana.');
      // Un solo giorno uguale a quello della data: è la normale ripetizione settimanale
      if (wd.length === 1 && wd[0] === D.parseISO(val('date')).getDay()) wd = [];
      const data = normEvent({
        ...(ev || {}), ...(ev ? {} : { link: preset.link || null }),
        id: ev ? ev.id : uid(),
        type: f.querySelector('input[name=type]:checked').value,
        title: val('title'), date: val('date'), start: val('start'), end: val('end'),
        location: val('location'), category: val('category'), notes: f.notes.value.trim(),
        recurrence: { freq: f.freq.value, interval: f.interval.value, until: f.freq.value === 'none' ? '' : val('until'), days: f.freq.value === 'weekly' ? wd : [] },
        reminders: readReminders(remList),
        done: ev ? ev.done : [],
      });
      if (data.recurrence.freq === 'weekly' && data.recurrence.days.length && !data.recurrence.days.includes(D.parseISO(data.date).getDay()) && !recurring) {
        // La data iniziale deve cadere in uno dei giorni scelti: sposto al primo giorno utile
        const first = D.occurrences({ ...data, exdates: [] }, data.date, D.addDaysISO(data.date, 7))[0];
        if (first) data.date = first;
      }
      let msg;
      if (recurring) {
        const scope = await askScope(sheet, 'A cosa applico la modifica?');
        if (!scope) return;
        msg = saveRecurring(ev, data, occ, scope);
      } else {
        touch(data);
        if (ev) Object.assign(ev, data); else state.events.push(data);
        msg = ev ? 'Impegno aggiornato' : `Aggiunto: ${D.relDay(data.date).toLowerCase()}${data.start ? ' alle ' + data.start : ''}`;
      }
      closeSheet(); commit(); toast(msg);
    });
  });
}

export function toggleDone(id, date) {
  const ev = state.events.find(e => e.id === id);
  if (!ev) return;
  const i = ev.done.indexOf(date);
  const nowDone = i < 0;
  if (nowDone) ev.done.push(date); else ev.done.splice(i, 1);
  touch(ev);
  // Se è un passaggio di un progetto, lo spunto anche lì
  let extra = '';
  if (ev.link) {
    const p = state.projects.find(x => x.id === ev.link.projectId);
    const s = p && p.steps.find(x => x.id === ev.link.stepId);
    if (s) {
      s.done = nowDone;
      p.lastActivityAt = new Date().toISOString();
      touch(p);
      if (nowDone) extra = ` · passaggio fatto in «${p.name}»`;
    }
  }
  commit();
  if (extra) toast('Fatto' + extra);
}

// ---------- PROGETTI

// Se un passaggio è fissato in agenda, restituisce la prossima data
function stepDate(stepId) {
  const t = D.todayISO();
  const evs = state.events.filter(e => e.link && e.link.stepId === stepId);
  let best = '';
  for (const e of evs) {
    const next = D.occurrences(e, t, D.addDaysISO(t, 400))[0] || (e.recurrence.freq === 'none' ? e.date : '');
    if (next && (!best || next < best)) best = next;
  }
  return best;
}
const stepDateLabel = iso => D.relDay(iso);

function projectCard(p) {
  const total = p.steps.length, done = p.steps.filter(s => s.done).length;
  const next = p.steps.find(s => !s.done);
  return `<div class="card project ${p.status}">
    <button class="card-main" data-action="open-project" data-id="${p.id}">
      <span class="card-top"><strong>${esc(p.name)}</strong>${p.status === 'completato' || p.status === 'archiviato' ? `<em class="chip">${PSTATUS[p.status]}</em>` : ''}</span>
      ${p.goal ? `<small>${esc(p.goal)}</small>` : p.description ? `<small>${esc(p.description)}</small>` : ''}
      ${total ? `<span class="progress" aria-label="${done} di ${total} passaggi"><i style="width:${Math.round(done / total * 100)}%"></i></span>
        <small class="muted">${done} di ${total} passaggi${p.deadline ? ` · entro ${D.fmt(p.deadline, { day: 'numeric', month: 'short' })}` : ''}</small>`
      : p.deadline ? `<small class="muted">Entro ${D.fmt(p.deadline, { day: 'numeric', month: 'long' })}</small>` : ''}
    </button>
    ${next && p.status === 'attivo' ? `<div class="next-step">
      <button class="check" data-action="step-done" data-id="${p.id}" data-step="${next.id}" aria-label="Segna il passaggio come fatto">${icon('check')}</button>
      <span><small>Prossimo passo${stepDate(next.id) ? ` · ${icon('calendar', 'xs')} ${esc(stepDateLabel(stepDate(next.id)).toLowerCase())}` : ''}</small>${esc(next.text)}</span></div>` : ''}
  </div>`;
}

export function renderProjects() {
  const by = s => state.projects.filter(p => p.status === s).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  const active = by('attivo'), paused = by('pausa');
  const archived = [...by('completato'), ...by('archiviato')];
  return `<section class="view">
    <header class="page-head"><h1>Progetti</h1>
      <button class="btn small primary" data-action="new-project">${icon('plus', 'xs')} Nuovo</button></header>
    <p class="intro">Le cose che vuoi portare avanti, con i tuoi tempi. Puoi metterle in pausa e riprenderle quando vuoi.</p>
    ${active.length ? `<h2 class="sec">Attivi</h2><div class="cards">${active.map(projectCard).join('')}</div>` : ''}
    ${paused.length ? `<h2 class="sec">In pausa</h2><div class="cards">${paused.map(projectCard).join('')}</div>` : ''}
    ${!active.length && !paused.length ? empty('Nessun progetto in corso.', "Aggiungi un'idea anche solo per non perderla di vista.") : ''}
    ${archived.length ? `<button class="sec-toggle" data-action="toggle-archive">${ui.archive ? 'Nascondi' : 'Mostra'} archivio (${archived.length})</button>
      ${ui.archive ? `<div class="cards">${archived.map(projectCard).join('')}</div>` : ''}` : ''}
  </section>`;
}

export function openProjectSheet(id, preset = {}) {
  const p = id ? state.projects.find(x => x.id === id) : null;
  if (id && !p) { toast('Progetto non trovato'); return; }
  const d = p ? JSON.parse(JSON.stringify(p)) : normProject(preset);
  const steps = d.steps;
  const stepsHTML = () => steps.length ? steps.map(s => `<li class="${s.done ? 'is-done' : ''}">
      <button type="button" class="check${s.done ? ' on' : ''}" data-st-toggle="${s.id}" aria-label="Fatto">${icon('check')}</button>
      <span>${esc(s.text)}${stepDate(s.id) ? `<small class="step-when">${icon('calendar', 'xs')} ${esc(stepDateLabel(stepDate(s.id)))}</small>` : ''}</span>
      ${s.done ? '' : `<button type="button" class="icon-btn tiny" data-st-plan="${s.id}" aria-label="Fissa in agenda">${icon('calendar')}</button>`}
      <button type="button" class="icon-btn tiny" data-st-del="${s.id}" aria-label="Elimina passaggio">${icon('close')}</button></li>`).join('')
    : '<li class="muted">Nessun passaggio. Spezzare un progetto in piccoli passi aiuta a ripartire.</li>';

  openSheet(`
    <div class="sheet-head"><h2>${p ? 'Progetto' : 'Nuovo progetto'}</h2>
      <button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
    <form class="form" id="pr-form" novalidate>
      <label class="field"><span>Nome</span><input name="name" value="${p || preset.name ? esc(d.name) : ''}" maxlength="100" required placeholder="Es. Imparare a fare il pane"></label>
      <label class="field"><span>Obiettivo</span><input name="goal" value="${esc(d.goal)}" maxlength="200" placeholder="Cosa vuoi ottenere?"></label>
      <label class="field"><span>Descrizione</span><textarea name="description" rows="2" maxlength="1000">${esc(d.description)}</textarea></label>
      <div class="row">
        <label class="field"><span>Stato</span><select name="status">${Object.entries(PSTATUS).map(([k, v]) => `<option value="${k}"${d.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Scadenza (facoltativa)</span><input type="date" name="deadline" value="${d.deadline}"></label>
      </div>
      <div class="field"><span>Passaggi</span>
        <ul class="steps">${stepsHTML()}</ul>
        <div class="add-step"><input name="newStep" placeholder="Aggiungi un passaggio" maxlength="160" enterkeyhint="enter">
          <button type="button" class="icon-btn solid" data-st-add aria-label="Aggiungi passaggio">${icon('plus')}</button></div>
      </div>
      <label class="field"><span>Note</span><textarea name="notes" rows="3" maxlength="4000">${esc(d.notes)}</textarea></label>
      <p class="error" hidden></p>
      <div class="actions">
        ${p ? '<button type="button" class="btn ghost danger" data-del>Elimina</button>' : ''}
        <button class="btn primary">Salva</button>
      </div>
    </form>`, sheet => {
    const f = sheet.querySelector('#pr-form');
    const list = sheet.querySelector('.steps');
    const redraw = () => { list.innerHTML = stepsHTML(); };
    const add = () => {
      const t = f.newStep.value.trim();
      if (!t) return;
      steps.push({ id: uid(), text: t, done: false });
      f.newStep.value = ''; redraw(); f.newStep.focus();
    };
    sheet.querySelector('[data-st-add]').addEventListener('click', add);
    f.newStep.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    list.addEventListener('click', e => {
      const tg = e.target.closest('[data-st-toggle]'), dl = e.target.closest('[data-st-del]'), pl = e.target.closest('[data-st-plan]');
      if (pl) {
        // Salvo il progetto e apro un nuovo impegno collegato al passaggio
        const saved = save();
        if (!saved) return;
        commit();
        const step = saved.steps.find(x => x.id === pl.dataset.stPlan);
        openEventSheet(null, { title: step.text, type: 'attivita', date: D.todayISO(), link: { projectId: saved.id, stepId: step.id } });
        return;
      }
      if (tg) { const s = steps.find(x => x.id === tg.dataset.stToggle); s.done = !s.done; redraw(); }
      if (dl) { const i = steps.findIndex(x => x.id === dl.dataset.stDel); steps.splice(i, 1); redraw(); }
    });
    if (!p) setTimeout(() => f.name.focus(), 50);
    const del = sheet.querySelector('[data-del]');
    if (del) del.addEventListener('click', () => {
      if (!confirm(`Eliminare definitivamente «${p.name}»? Se vuoi solo toglierlo di mezzo, puoi archiviarlo.`)) return;
      state.projects = state.projects.filter(x => x.id !== p.id);
      closeSheet(); commit(); toast('Progetto eliminato');
    });
    let target = p;
    function save() {
      if (f.newStep.value.trim()) add();
      if (!f.name.value.trim()) { const er = sheet.querySelector('.error'); er.textContent = 'Dai un nome al progetto.'; er.hidden = false; return null; }
      const data = normProject({
        ...d, id: target ? target.id : d.id, name: f.name.value, goal: f.goal.value.trim(), description: f.description.value.trim(),
        status: f.status.value, deadline: f.deadline.value, notes: f.notes.value.trim(), steps,
        lastActivityAt: new Date().toISOString(), snoozedUntil: '',
      });
      touch(data);
      if (target) Object.assign(target, data); else { state.projects.push(data); target = data; }
      return target;
    }
    f.addEventListener('submit', e => {
      e.preventDefault();
      if (!save()) return;
      closeSheet(); commit(); toast(p ? 'Progetto aggiornato' : 'Progetto creato');
    });
  });
}

export function stepDone(id, stepId) {
  const p = state.projects.find(x => x.id === id);
  const s = p && p.steps.find(x => x.id === stepId);
  if (!s) return;
  s.done = true;
  p.lastActivityAt = new Date().toISOString();
  touch(p); commit();
  toast(p.steps.every(x => x.done) ? 'Tutti i passaggi fatti! Puoi segnare il progetto come completato.' : 'Passaggio fatto');
}

// ---------- INTERESSI

const todo = i => discoveriesOf(i).filter(d => d.x.status === 'da');

function interestRow(i) {
  const n = todo(i).length;
  const sub = n ? `${n} da scoprire` : (i.notes ? i.notes.split('\n')[0] : '');
  return `<div class="item interest">
    <a class="item-main" href="#interesse/${i.id}">
      <strong>${esc(i.name)}</strong>
      ${sub ? `<small>${esc(sub)}</small>` : ''}
    </a>
    ${i.status === 'pausa'
      ? `<button class="btn small ghost" data-action="resume-interest" data-id="${i.id}">Riprendi</button>`
      : `<span class="go" aria-hidden="true">${icon('right')}</span>`}
  </div>`;
}

// Richiesta già pronta per l'assistente su Claude
function discoverRequest(i) {
  const n = i ? 5 : 6;
  return i
    ? `Proponimi ${n} cose da scoprire sull'interesse «${i.name}» (id ${i.id}): libri, podcast, video, documentari, articoli o esperienze, mescolando i tipi. Tieni conto di cosa ho già in lista e di cosa mi è piaciuto o no.`
    : `Guarda i miei interessi e proponimi ${n} cose da scoprire, distribuite tra gli interessi attivi, tenendo conto di cosa ho già in lista e di cosa mi è piaciuto o no.`;
}
const claudeLink = (req, label, cls = 'btn primary') =>
  `<a class="${cls} bridge-go" href="${CLAUDE_URL}" target="_blank" rel="noopener" data-action="bridge-go" data-request="${esc(req)}" data-with="interests">${icon('spark', 'xs')} ${label}</a>`;

export function renderInterests() {
  const act = state.interests.filter(i => i.status === 'attivo');
  const stable = act.filter(i => i.kind === 'stabile');
  const cur = act.filter(i => i.kind === 'curiosita');
  const paused = state.interests.filter(i => i.status === 'pausa');
  const next = act.flatMap(i => i.items.filter(x => x.status === 'da').map(x => ({ i, x }))).sort((a, b) => b.x.createdAt.localeCompare(a.x.createdAt)).slice(0, 3);
  return `<section class="view">
    <header class="page-head"><h1>Interessi</h1></header>
    <form class="add-interest" data-form="interest">
      <input name="name" placeholder="Un argomento che ti interessa" maxlength="80" autocomplete="off" aria-label="Nuovo interesse">
      <div class="seg mini">
        <label class="on"><input type="radio" name="kind" value="stabile" checked>Interesse</label>
        <label><input type="radio" name="kind" value="curiosita">Curiosità del momento</label>
      </div>
      <button class="btn primary">Aggiungi</button>
    </form>
    ${act.length ? `<div class="discover-all">${claudeLink(discoverRequest(null), 'Scopri qualcosa con Claude', 'btn wide')}</div>` : ''}
    ${next.length ? `<h2 class="sec">Ultime cose da scoprire</h2><div class="list">${next.map(({ i, x }) => discoveryRow(i, x, true)).join('')}</div>` : ''}
    <h2 class="sec">Interessi stabili</h2>
    ${stable.length ? `<div class="list">${stable.map(interestRow).join('')}</div>` : empty('Ancora nessuno.', 'Gli argomenti che ti accompagnano da tempo.')}
    <h2 class="sec">Curiosità del momento</h2>
    ${cur.length ? `<div class="list">${cur.map(interestRow).join('')}</div>` : empty('Nessuna curiosità.', 'Le cose che ti hanno preso di recente, senza impegno.')}
    ${paused.length ? `<h2 class="sec">In pausa</h2><div class="list">${paused.map(interestRow).join('')}</div>` : ''}
    ${renderSaved()}
    <button class="btn profile-btn" data-action="open-profile">${icon('spark', 'xs')} Cosa ho imparato di te</button>
  </section>`;
}

const searchUrl = x => {
  const q = encodeURIComponent([x.title, x.by].filter(Boolean).join(' '));
  return ['canale', 'video'].includes(x.type) ? `https://www.youtube.com/results?search_query=${q}` : `https://www.google.com/search?q=${q}`;
};
const dur = m => !m ? '' : m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m < 1440 ? `${m / 60} h` : '';

// i = interesse a cui appartiene; page = interesse della pagina aperta (se c'è)
function discoveryRow(i, x, showInterest = false, page = null) {
  const names = [i, ...x.also.map(id => state.interests.find(o => o.id === id))].filter(o => o && o !== page).map(o => o.name);
  const where = showInterest ? names.join(', ') : names.length ? `anche in ${names.join(', ')}` : '';
  const meta = [DISCOVERY_TYPES[x.type], x.by, dur(x.minutes), where].filter(Boolean).map(esc).join(' · ');
  const btn = (action, ic, label, extra = '') => `<button class="icon-btn tiny" data-action="${action}" data-id="${i.id}" data-item="${x.id}" aria-label="${label}"${extra}>${icon(ic)}</button>`;
  const done = x.status === 'fatto';
  return `<div class="item disc${done ? ' is-done' : ''}${x.from === 'claude' ? ' from-ai' : ''}">
    ${done ? '' : `<button class="check" data-action="disc-done" data-id="${i.id}" data-item="${x.id}" aria-label="Fatto: visto, letto o ascoltato">${icon('check')}</button>`}
    <div class="disc-main">
      <button class="disc-title" data-action="disc-edit" data-id="${i.id}" data-item="${x.id}">${esc(x.title)}</button>
      <small>${meta}${x.from === 'claude' ? ` · <span class="ai-tag">${icon('spark', 'xs')} Claude</span>` : ''}</small>
      ${x.why && !done ? `<small class="why">${esc(x.why)}</small>` : ''}
      ${done ? `<span class="rate">
        <button class="pill${x.rating === 'piaciuto' ? ' on' : ''}" data-action="disc-rate" data-id="${i.id}" data-item="${x.id}" data-v="piaciuto">Mi è piaciuto</button>
        <button class="pill${x.rating === 'no' ? ' on' : ''}" data-action="disc-rate" data-id="${i.id}" data-item="${x.id}" data-v="no">Non fa per me</button></span>` : ''}
    </div>
    <span class="disc-actions">
      <a class="icon-btn tiny" href="${esc(x.link || searchUrl(x))}" target="_blank" rel="noopener" aria-label="${x.link ? 'Apri il collegamento' : 'Cerca sul web'}">${icon(x.link ? 'right' : 'search')}</a>
      ${done ? '' : btn('disc-plan', 'calendar', 'Metti in agenda')}
    </span>
  </div>`;
}

export function renderInterest(id) {
  const i = state.interests.find(x => x.id === id);
  if (!i) return `<section class="view"><a class="back" href="#interessi">${icon('left', 'xs')} Interessi</a>${empty('Interesse non trovato.', 'Forse è stato eliminato.')}</section>`;
  const all = discoveriesOf(i);
  const list = all.filter(d => d.x.status === 'da').sort((a, b) => b.x.createdAt.localeCompare(a.x.createdAt));
  const done = all.filter(d => d.x.status === 'fatto').sort((a, b) => (b.x.doneAt || '').localeCompare(a.x.doneAt || ''));
  return `<section class="view interest-page">
    <a class="back" href="#interessi">${icon('left', 'xs')} Interessi</a>
    <header class="page-head"><h1>${esc(i.name)}</h1>
      <button class="btn small ghost" data-action="open-interest" data-id="${i.id}">Modifica</button></header>
    <p class="intro">${i.kind === 'curiosita' ? 'Curiosità del momento' : 'Interesse stabile'}${i.status === 'pausa' ? ' · in pausa' : ''}</p>
    ${i.notes ? `<div class="info-card notes-card"><p>${esc(i.notes).replace(/\n/g, '<br>')}</p></div>` : ''}
    <div class="interest-cta">
      ${claudeLink(discoverRequest(i), 'Scopri con Claude', 'btn primary wide')}
      <button class="btn ghost wide" data-action="interest-project" data-id="${i.id}">${icon('layers', 'xs')} Trasforma in progetto</button>
    </div>
    <form class="add-disc" data-form="discovery" data-id="${i.id}">
      <input name="what" placeholder="Un libro, un podcast, un posto…" maxlength="200" autocomplete="off" aria-label="Cosa vuoi scoprire">
      <select name="dtype" aria-label="Tipo">${Object.entries(DISCOVERY_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <button class="icon-btn solid" aria-label="Aggiungi">${icon('plus')}</button>
    </form>
    <h2 class="sec">Da scoprire</h2>
    ${list.length ? `<div class="list">${list.map(d => discoveryRow(d.owner, d.x, false, i)).join('')}</div>` : empty('La lista è vuota.', 'Aggiungi qualcosa qui sopra o chiedi idee a Claude.')}
    ${done.length ? `<button class="sec-toggle" data-action="toggle-done-list">${ui.showDone ? 'Nascondi' : 'Mostra'} già fatti (${done.length})</button>
      ${ui.showDone ? `<div class="list">${done.map(d => discoveryRow(d.owner, d.x, false, i)).join('')}</div>` : ''}` : ''}
  </section>`;
}

const findDisc = (id, itemId) => {
  const i = state.interests.find(x => x.id === id);
  const x = i && i.items.find(o => o.id === itemId);
  return x ? { i, x } : null;
};
const discTags = (i, x) => [i.name.toLowerCase(), DISCOVERY_TYPES[x.type].toLowerCase()];

export function addDiscovery(id, title, type) {
  const i = state.interests.find(x => x.id === id);
  const t = String(title || '').trim();
  if (!i) return false;
  if (!t) { toast('Scrivi cosa vuoi scoprire'); return false; }
  if (discoveriesOf(i).some(d => d.x.title.toLowerCase() === t.toLowerCase())) { toast('È già nella lista'); return false; }
  i.items.push(normDiscovery({ title: t, type }));
  i.lastTouchedAt = new Date().toISOString();
  commit(); toast('Aggiunto alla lista');
  return true;
}

export function discoveryDone(id, itemId) {
  const f = findDisc(id, itemId);
  if (!f) return;
  f.x.status = 'fatto'; f.x.doneAt = new Date().toISOString();
  f.i.lastTouchedAt = f.x.doneAt;
  ui.showDone = true;
  commit(); toast('Fatto! Dimmi se ti è piaciuto');
}

export function discoveryUndo(id, itemId) {
  const f = findDisc(id, itemId);
  if (!f) return;
  f.x.status = 'da'; f.x.doneAt = ''; f.x.rating = '';
  commit();
}

export function discoveryRate(id, itemId, v) {
  const f = findDisc(id, itemId);
  if (!f) return;
  const value = f.x.rating === v ? '' : v; // ritocco = tolgo il giudizio
  f.x.rating = value;
  if (value) recordFeedback({ title: f.x.title, kind: 'scoperta', tags: discTags(f.i, f.x) }, value === 'piaciuto' ? 'scelto' : 'no');
  commit();
}

export function discoveryDelete(id, itemId) {
  const f = findDisc(id, itemId);
  if (!f) return;
  f.i.items = f.i.items.filter(x => x.id !== itemId);
  commit(); toast('Tolto dalla lista');
}

export function discoveryPlan(id, itemId) {
  const f = findDisc(id, itemId);
  if (!f) return;
  const { x, i } = f;
  const notes = [x.by && `${DISCOVERY_TYPES[x.type]} di ${x.by}`, x.why, x.link, `Interesse: ${i.name}`].filter(Boolean).join('\n');
  const preset = { title: x.title, type: x.type === 'evento' ? 'appuntamento' : 'attivita', date: D.todayISO(), notes, reminders: [] };
  if (x.minutes && x.minutes <= 600) { preset.start = '21:00'; const e = 21 * 60 + x.minutes; if (e < 24 * 60) preset.end = `${D.pad(Math.floor(e / 60))}:${D.pad(e % 60)}`; }
  openEventSheet(null, preset);
}

export function openDiscoverySheet(id, itemId) {
  const f = findDisc(id, itemId);
  if (!f) return;
  const { i, x } = f;
  openSheet(`
    <div class="sheet-head"><h2>Da scoprire</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
    <form class="form" id="dc-form" novalidate>
      <label class="field"><span>Titolo</span><input name="what" value="${esc(x.title)}" maxlength="200" required></label>
      <div class="row">
        <label class="field"><span>Tipo</span><select name="dtype">${Object.entries(DISCOVERY_TYPES).map(([k, v]) => `<option value="${k}"${x.type === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Autore o fonte</span><input name="by" value="${esc(x.by)}" maxlength="120"></label>
      </div>
      <label class="field"><span>Perché</span><textarea name="why" rows="2" maxlength="400">${esc(x.why)}</textarea></label>
      <div class="row">
        <label class="field"><span>Collegamento</span><input name="link" type="url" value="${esc(x.link)}" placeholder="https://…" maxlength="500"></label>
        <label class="field"><span>Durata (minuti)</span><input name="minutes" type="number" min="0" inputmode="numeric" value="${x.minutes || ''}"></label>
      </div>
      <fieldset class="field pick-interests"><legend>Interessi <small>(anche più di uno)</small></legend>
        <div class="pills">${state.interests.map(o => `<label class="pill-check"><input type="checkbox" name="int" value="${o.id}"${o.id === i.id || x.also.includes(o.id) ? ' checked' : ''}><span>${esc(o.name)}</span></label>`).join('')}</div>
        <small class="err" hidden>Scegli almeno un interesse</small>
      </fieldset>
      <div class="actions">
        <button type="button" class="btn ghost danger" data-del>Togli</button>
        ${x.status === 'fatto' ? '<button type="button" class="btn ghost" data-undo>Non ancora fatto</button>' : ''}
        <button class="btn primary">Salva</button>
      </div>
    </form>`, sheet => {
    const fm = sheet.querySelector('#dc-form');
    sheet.querySelector('[data-del]').addEventListener('click', () => { closeSheet(); discoveryDelete(i.id, x.id); });
    const undo = sheet.querySelector('[data-undo]');
    if (undo) undo.addEventListener('click', () => { closeSheet(); discoveryUndo(i.id, x.id); });
    fm.addEventListener('submit', e => {
      e.preventDefault();
      if (!fm.what.value.trim()) return;
      const chosen = [...fm.querySelectorAll('[name=int]:checked')].map(c => c.value);
      if (!chosen.length) { fm.querySelector('.pick-interests .err').hidden = false; return; }
      // Resta dov'è se l'interesse principale è ancora scelto, altrimenti passa al primo scelto
      const ownerId = chosen.includes(i.id) ? i.id : chosen[0];
      Object.assign(x, normDiscovery({ ...x, title: fm.what.value, type: fm.dtype.value, by: fm.by.value, why: fm.why.value, link: fm.link.value.trim(), minutes: fm.minutes.value, also: chosen.filter(c => c !== ownerId) }));
      if (ownerId !== i.id) {
        const to = state.interests.find(o => o.id === ownerId);
        if (to) { i.items = i.items.filter(o => o.id !== x.id); to.items.push(x); }
      }
      closeSheet(); commit(); toast('Salvato');
    });
  });
}

export function interestToProject(id) {
  const i = state.interests.find(x => x.id === id);
  if (!i) return;
  const verb = { autore: 'Scoprire', canale: 'Seguire', libro: 'Leggere', podcast: 'Ascoltare', video: 'Guardare', documentario: 'Guardare', film: 'Guardare', articolo: 'Leggere', corso: 'Seguire', luogo: 'Visitare', evento: 'Andare a', esperienza: 'Provare', altro: '' };
  openProjectSheet(null, {
    name: i.name, description: i.notes,
    steps: todo(i).slice(0, 8).map(({ x }) => ({ text: `${verb[x.type] ? verb[x.type] + ' ' : ''}${x.title}`.trim() })),
  });
}

export function openInterestSheet(id) {
  const i = state.interests.find(x => x.id === id);
  if (!i) return;
  openSheet(`
    <div class="sheet-head"><h2>Interesse</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
    <form class="form" id="in-form" novalidate>
      <label class="field"><span>Nome</span><input name="name" value="${esc(i.name)}" maxlength="80" required></label>
      <div class="row">
        <label class="field"><span>Tipo</span><select name="kind">
          <option value="stabile"${i.kind === 'stabile' ? ' selected' : ''}>Interesse stabile</option>
          <option value="curiosita"${i.kind === 'curiosita' ? ' selected' : ''}>Curiosità del momento</option></select></label>
        <label class="field"><span>Stato</span><select name="status">
          <option value="attivo"${i.status === 'attivo' ? ' selected' : ''}>Attivo</option>
          <option value="pausa"${i.status === 'pausa' ? ' selected' : ''}>In pausa</option></select></label>
      </div>
      <label class="field"><span>Note</span><textarea name="notes" rows="5" maxlength="4000" placeholder="Cosa ti incuriosisce, cosa vuoi approfondire, fonti che ti sono piaciute…">${esc(i.notes)}</textarea></label>
      <div class="actions">
        <button type="button" class="btn ghost danger" data-del>Elimina</button>
        <button class="btn primary">Salva</button>
      </div>
    </form>`, sheet => {
    const f = sheet.querySelector('#in-form');
    sheet.querySelector('[data-del]').addEventListener('click', () => {
      const own = i.items.filter(x => !x.also.length).length;
      if (!confirm(`Eliminare «${i.name}»${own ? ' e la sua lista di cose da scoprire' : ''}?`)) return;
      state.interests = state.interests.filter(x => x.id !== i.id);
      // Le cose condivise con altri interessi non si perdono: passano al primo degli altri
      for (const x of i.items) {
        const to = x.also.map(id => state.interests.find(o => o.id === id)).find(Boolean);
        if (to) { x.also = x.also.filter(id => id !== to.id); to.items.push(x); }
      }
      for (const o of state.interests) for (const x of o.items) x.also = x.also.filter(id => id !== i.id);
      closeSheet();
      if (location.hash.startsWith('#interesse/')) location.hash = '#interessi';
      commit(); toast('Interesse eliminato');
    });
    f.addEventListener('submit', e => {
      e.preventDefault();
      if (!f.name.value.trim()) return;
      Object.assign(i, { name: f.name.value.trim(), kind: f.kind.value, status: f.status.value, notes: f.notes.value.trim(), lastTouchedAt: new Date().toISOString() });
      closeSheet(); commit(); toast('Interesse aggiornato');
    });
  });
}

export function addInterest(name, kind) {
  const n = name.trim();
  if (!n) { toast('Scrivi il nome di un argomento'); return false; }
  if (state.interests.some(i => i.name.toLowerCase() === n.toLowerCase())) { toast('È già nella lista'); return false; }
  state.interests.push(normInterest({ name: n, kind }));
  commit(); toast('Interesse aggiunto');
  return true;
}

export function setInterestStatus(id, status) {
  const i = state.interests.find(x => x.id === id);
  if (!i) return;
  i.status = status; i.lastTouchedAt = new Date().toISOString(); i.snoozedUntil = '';
  commit(); toast(status === 'pausa' ? 'Messo in pausa: lo ritrovi in fondo' : 'Bentornato!');
}

export function snooze(kind, id) {
  const list = kind === 'project' ? state.projects : state.interests;
  const x = list.find(o => o.id === id);
  if (!x) return;
  x.snoozedUntil = D.addDaysISO(D.todayISO(), kind === 'project' ? 14 : 3);
  commit(); toast('Va bene, non te lo ripropongo per un po\'');
}

// ---------- IMPOSTAZIONI

export function openSettings(section = '') {
  const s = stats();
  const last = state.meta.lastExport ? new Date(state.meta.lastExport).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : 'mai';
  const sel = (type) => `<select data-lead="${type}">${LEADS.map(([v, l]) => `<option value="${v}"${String(state.settings.reminders[type] ?? '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  openSheet(`
    <div class="sheet-head"><h2>Impostazioni</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
    <h3 class="sub" id="set-day">Le tue giornate</h3>
    <p class="hint">Servono a calcolare il tempo libero per le proposte.</p>
    <div class="form day-form">
      <div class="row">
        <label class="field"><span>Sveglia</span><input type="time" data-day="wake" value="${state.settings.day.wake}"></label>
        <label class="field"><span>A letto</span><input type="time" data-day="sleep" value="${state.settings.day.sleep}"></label>
      </div>
      <div class="row">
        <label class="field"><span>Lavoro dalle</span><input type="time" data-day="workStart" value="${state.settings.day.workStart}"></label>
        <label class="field"><span>alle</span><input type="time" data-day="workEnd" value="${state.settings.day.workEnd}"></label>
      </div>
      <div class="field"><span>Giorni di lavoro</span>
        <div class="wd-pick">${[1, 2, 3, 4, 5, 6, 0].map(n => `<label class="${state.settings.day.workDays.includes(n) ? 'on' : ''}"><input type="checkbox" data-wday value="${n}"${state.settings.day.workDays.includes(n) ? ' checked' : ''}>${'DLMMGVS'[n]}</label>`).join('')}</div></div>
      <p class="hint">Lascia vuoto l'orario di lavoro se cambia spesso: puoi sempre segnare i turni come impegni.</p>
    </div>
    <h3 class="sub">Promemoria predefiniti</h3>
    <p class="hint">Valgono per i nuovi impegni; puoi sempre cambiarli caso per caso.</p>
    <div class="form">
      <label class="field"><span>Appuntamenti</span>${sel('appuntamento')}</label>
      <label class="field"><span>Attività</span>${sel('attivita')}</label>
      <label class="field"><span>Scadenze</span>${sel('scadenza')}</label>
    </div>
    <div class="info-card"><strong>Come funzionano i promemoria</strong>
      <p>Per ora compaiono nella schermata Oggi quando apri l'app. Le notifiche sul telefono anche ad app chiusa arriveranno in una fase successiva.</p></div>
    <h3 class="sub">I tuoi dati</h3>
    <p class="hint">Tutto è salvato solo su questo dispositivo: ${plural(s.events, 'impegno', 'impegni')}, ${plural(s.projects, 'progetto', 'progetti')}, ${plural(s.interests, 'interesse', 'interessi')}. Ultimo backup: ${last}.</p>
    <div class="stack">
      <button class="btn" data-export>${icon('download', 'xs')} Scarica un backup</button>
      <label class="btn">${icon('upload', 'xs')} Ripristina da un backup<input type="file" accept="application/json,.json" data-import hidden></label>
      <button class="btn" data-persist>${icon('shield', 'xs')} Proteggi i dati dalla pulizia automatica</button>
    </div>
    <p class="hint persist-status"></p>
    <p class="hint version">Spazio personale · versione 2.8.2</p>`, sheet => {
    sheet.querySelectorAll('[data-day]').forEach(el => el.addEventListener('change', () => {
      state.settings.day[el.dataset.day] = el.value;
      commit(); toast('Salvato');
    }));
    sheet.querySelectorAll('[data-wday]').forEach(el => el.addEventListener('change', () => {
      el.parentNode.classList.toggle('on', el.checked);
      state.settings.day.workDays = [...sheet.querySelectorAll('[data-wday]:checked')].map(x => +x.value).sort();
      commit();
    }));
    if (section === 'day') setTimeout(() => sheet.querySelector('#set-day').scrollIntoView({ block: 'start' }), 60);
    sheet.querySelectorAll('[data-lead]').forEach(el => el.addEventListener('change', () => {
      state.settings.reminders[el.dataset.lead] = el.value === '' ? null : +el.value;
      commit(); toast('Salvato');
    }));
    sheet.querySelector('[data-export]').addEventListener('click', () => {
      const blob = new Blob([exportData()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `spazio-personale-backup-${D.todayISO()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('Backup scaricato');
    });
    sheet.querySelector('[data-import]').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        if (!confirm('Il ripristino sostituisce tutti i dati attuali con quelli del backup. Continuare?')) return;
        importData(text);
        closeSheet(); toast('Dati ripristinati');
      } catch (err) { toast(err.message || 'File non valido', 'bad'); }
      finally { e.target.value = ''; }
    });
    const status = sheet.querySelector('.persist-status');
    const showPersist = p => { status.textContent = p ? 'Protezione attiva: il browser non cancellerà i dati da solo per liberare spazio.' : ''; };
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(showPersist);
    sheet.querySelector('[data-persist]').addEventListener('click', async () => {
      if (!navigator.storage || !navigator.storage.persist) { toast('Funzione non disponibile su questo browser'); return; }
      const ok = await navigator.storage.persist();
      showPersist(ok);
      toast(ok ? 'Dati protetti' : 'Il browser non l\'ha concessa: di solito succede dopo aver installato l\'app');
    });
  });
}

// ---------- RICERCA NELL'APP

const foldText = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Evidenzia le parole cercate nel testo (già senza HTML)
function mark(text, words) {
  let out = esc(text);
  if (!words.length) return out;
  const plain = foldText(text);
  const ranges = [];
  for (const w of words) {
    let i = plain.indexOf(w);
    while (i >= 0) { ranges.push([i, i + w.length]); i = plain.indexOf(w, i + w.length); }
  }
  if (!ranges.length) return out;
  ranges.sort((a, b) => a[0] - b[0]);
  let res = '', pos = 0;
  for (const [a, b] of ranges) {
    if (a < pos) continue;
    res += esc(text.slice(pos, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>';
    pos = b;
  }
  return res + esc(text.slice(pos));
}

// Frammento di testo attorno alla prima parola trovata
function snippet(text, words) {
  const plain = foldText(text);
  const i = Math.min(...words.map(w => plain.indexOf(w)).filter(x => x >= 0));
  if (!Number.isFinite(i)) return '';
  const a = Math.max(0, i - 30), b = Math.min(text.length, i + 70);
  return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ') + (b < text.length ? '…' : '');
}

export function searchAll(query) {
  const words = foldText(query).split(/\s+/).filter(w => w.length >= 2);
  if (!words.length) return { words, groups: [] };
  const hit = fields => words.every(w => fields.some(f => foldText(f).includes(w)));
  const t = D.todayISO();
  const ev = state.events.filter(e => hit([e.title, e.location, e.notes, e.category])).map(e => {
    const next = D.occurrences(e, t, D.addDaysISO(t, 400))[0];
    const last = next ? '' : (D.occurrences(e, D.addDaysISO(t, -730), D.addDaysISO(t, -1)).pop() || e.date);
    const date = next || last;
    const extra = [e.notes, e.location].find(x => x && words.some(w => foldText(x).includes(w)));
    return { kind: 'event', id: e.id, date, title: e.title, sub: `${next ? D.relDay(next) : 'Passato: ' + D.fmt(date, { day: 'numeric', month: 'short', year: 'numeric' })}${e.start ? ' · ' + e.start : ''} · ${TYPE[e.type].label}${recLabel(e.recurrence) ? ' · ' + recLabel(e.recurrence) : ''}`, extra: extra ? snippet(extra, words) : '', sort: next ? 0 : 1, key: date };
  }).sort((a, b) => a.sort - b.sort || (a.sort ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key)));
  const pr = state.projects.filter(p => hit([p.name, p.goal, p.description, p.notes, ...p.steps.map(s => s.text)])).map(p => {
    const where = [p.goal, p.description, p.notes, ...p.steps.map(s => s.text)].find(x => x && words.some(w => foldText(x).includes(w)));
    return { kind: 'project', id: p.id, title: p.name, sub: `Progetto · ${PSTATUS[p.status]}`, extra: where ? snippet(where, words) : '' };
  });
  const it = state.interests.filter(i => hit([i.name, i.notes])).map(i => ({
    kind: 'interest', id: i.id, title: i.name, sub: i.kind === 'curiosita' ? 'Curiosità del momento' : 'Interesse',
    extra: i.notes && words.some(w => foldText(i.notes).includes(w)) ? snippet(i.notes, words) : '',
  }));
  const dc = state.interests.flatMap(i => i.items.filter(x => hit([x.title, x.by, x.why])).map(x => ({
    kind: 'interest', id: i.id, title: x.title, sub: `${DISCOVERY_TYPES[x.type]}${x.by ? ' · ' + x.by : ''} · ${[i.name, ...x.also.map(id => (state.interests.find(o => o.id === id) || {}).name).filter(Boolean)].join(', ')}${x.status === 'fatto' ? ' · fatto' : ''}`, extra: '',
  })));
  const sv = state.saved.filter(x => hit([x.title, x.detail])).map(x => ({ kind: 'saved', id: x.id, title: x.title, sub: 'Salvato per dopo', extra: x.detail ? snippet(x.detail, words) : '' }));
  const groups = [['Impegni', ev], ['Progetti', pr], ['Interessi', it], ['Da scoprire', dc], ['Salvati per dopo', sv]].filter(([, l]) => l.length);
  return { words, groups };
}

export function openSearch() {
  openSheet(`
    <div class="sheet-head"><h2>Cerca</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
    <div class="search-box">${icon('search')}<input type="search" data-q placeholder="Impegni, progetti, interessi, note…" autocomplete="off" enterkeyhint="search" aria-label="Cerca"></div>
    <div class="search-results"><p class="hint">Cerca nei titoli, nei luoghi, nelle note e nei passaggi dei progetti.</p></div>`, sheet => {
    const input = sheet.querySelector('[data-q]');
    const box = sheet.querySelector('.search-results');
    let timer;
    const run = () => {
      const q = input.value.trim();
      const { words, groups } = searchAll(q);
      if (!words.length) { box.innerHTML = '<p class="hint">Scrivi almeno due lettere.</p>'; return; }
      if (!groups.length) { box.innerHTML = `<p class="hint">Nessun risultato per «${esc(q)}».</p>`; return; }
      box.innerHTML = groups.map(([label, list]) => `<h3 class="sub">${label} <small>${list.length}</small></h3>
        <div class="list">${list.slice(0, 20).map(r => `<button class="result" data-kind="${r.kind}" data-id="${r.id}" data-date="${r.date || ''}">
          <strong>${mark(r.title, words)}</strong><small>${esc(r.sub)}</small>${r.extra ? `<span class="snip">${mark(r.extra, words)}</span>` : ''}</button>`).join('')}</div>`).join('');
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 120); });
    box.addEventListener('click', e => {
      const r = e.target.closest('.result');
      if (!r) return;
      const { kind, id, date } = r.dataset;
      if (kind === 'event') openEventSheet(id, {}, [], date);
      else if (kind === 'project') openProjectSheet(id);
      else if (kind === 'interest') { closeSheet(); location.hash = `#interesse/${id}`; }
      else { closeSheet(); location.hash = '#interessi'; }
    });
    setTimeout(() => input.focus(), 60);
  });
}
