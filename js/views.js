// Le schermate dell'app e i pannelli di modifica.
import { state, commit, touch, uid, exportData, importData, stats, normEvent, normProject, normInterest } from './store.js?v=2.3.0';
import * as D from './dates.js?v=2.3.0';
import { esc, icon, openSheet, closeSheet, toast, voiceSupported } from './ui.js?v=2.3.0';
import { renderFreeTime, renderSaved } from './learn.js?v=2.3.0';

export const ui = { mode: 'settimana', cursor: D.todayISO(), selected: D.todayISO(), archive: false };

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
  const bell = !!rs;
  const canDone = e.type !== 'appuntamento';
  const time = e.start ? `${e.start}${e.end ? '–' + e.end : ''}` : e.type === 'scadenza' ? 'Entro oggi' : 'In giornata';
  const meta = [TYPE[e.type].label, e.location && `${icon('pin', 'xs')}${esc(e.location)}`, recLabel(e.recurrence) && icon('repeat', 'xs'), e.link && icon('layers', 'xs')]
    .filter(Boolean).join('<span class="sep">·</span>');
  return `<div class="item ${TYPE[e.type].cls}${it.done ? ' is-done' : ''}${rs === 'soon' ? ' soon' : ''}">
    ${canDone
      ? `<button class="check${it.done ? ' on' : ''}" data-action="toggle-done" data-id="${e.id}" data-date="${it.date}" aria-label="${it.done ? 'Segna come da fare' : 'Segna come fatto'}">${icon('check')}</button>`
      : '<span class="bar"></span>'}
    <button class="item-main" data-action="edit-event" data-id="${e.id}" data-date="${it.date}">
      <span class="item-time">${showDate ? `${D.relDay(it.date)} · ` : ''}${esc(time)}${bell ? ` ${icon('bell', 'xs accent')}` : ''}${rs === 'soon' && untilLabel(it) ? ` <em class="soon-tag">${untilLabel(it)}</em>` : ''}</span>
      <strong>${esc(e.title)}</strong>
      <small>${meta}</small>
    </button>
  </div>`;
}

const empty = (title, text) => `<div class="empty"><strong>${title}</strong><p>${text}</p></div>`;

// ---------- OGGI

export function renderToday() {
  const t = D.todayISO();
  const h = new Date().getHours();
  const greet = h < 5 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const today = items(t, t);
  const open = today.filter(i => !i.done);
  const week = items(D.addDaysISO(t, 1), D.addDaysISO(t, 7));
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
    <div class="list">${today.length ? today.map(i => itemRow(i)).join('') : empty('Giornata libera', 'Non hai niente in agenda per oggi.')}</div>
    ${later.length ? `<h2 class="sec">Da ricordare</h2><div class="list">${later.map(i => itemRow(i, { showDate: true })).join('')}</div>` : ''}
    <h2 class="sec">Prossimi giorni</h2>
    <div class="list">${week.length ? week.slice(0, 6).map(i => itemRow(i, { showDate: true })).join('')
      + (week.length > 6 ? `<a class="more" href="#impegni">Altri ${week.length - 6} nella settimana</a>` : '')
      : empty('Settimana tranquilla', 'Niente in programma per i prossimi sette giorni.')}</div>
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
  return `<div class="list">${list.length ? list.map(i => itemRow(i)).join('') : empty('Niente in programma', 'Tocca + per aggiungere qualcosa a questo giorno.')}</div>`;
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
      <span class="card-top"><strong>${esc(p.name)}</strong>${p.status !== 'attivo' ? `<em class="chip">${PSTATUS[p.status]}</em>` : ''}</span>
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
    ${!active.length && !paused.length ? empty('Nessun progetto in corso', "Aggiungi un'idea anche solo per non perderla di vista.") : ''}
    ${archived.length ? `<button class="sec-toggle" data-action="toggle-archive">${ui.archive ? 'Nascondi' : 'Mostra'} archivio (${archived.length})</button>
      ${ui.archive ? `<div class="cards">${archived.map(projectCard).join('')}</div>` : ''}` : ''}
  </section>`;
}

export function openProjectSheet(id) {
  const p = id ? state.projects.find(x => x.id === id) : null;
  if (id && !p) { toast('Progetto non trovato'); return; }
  const d = p ? JSON.parse(JSON.stringify(p)) : normProject({});
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
      <label class="field"><span>Nome</span><input name="name" value="${p ? esc(d.name) : ''}" maxlength="100" required placeholder="Es. Imparare a fare il pane"></label>
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

function interestRow(i) {
  return `<div class="item interest">
    <button class="item-main" data-action="open-interest" data-id="${i.id}">
      <strong>${esc(i.name)}</strong>
      ${i.notes ? `<small>${esc(i.notes.split('\n')[0])}</small>` : ''}
    </button>
    ${i.status === 'pausa'
      ? `<button class="btn small ghost" data-action="resume-interest" data-id="${i.id}">Riprendi</button>`
      : `<button class="icon-btn tiny" data-action="pause-interest" data-id="${i.id}" aria-label="Metti in pausa">${icon('pause')}</button>`}
  </div>`;
}

export function renderInterests() {
  const act = state.interests.filter(i => i.status === 'attivo');
  const stable = act.filter(i => i.kind === 'stabile');
  const cur = act.filter(i => i.kind === 'curiosita');
  const paused = state.interests.filter(i => i.status === 'pausa');
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
    <h2 class="sec">Interessi stabili</h2>
    <div class="list">${stable.length ? stable.map(interestRow).join('') : empty('Ancora nessuno', 'Gli argomenti che ti accompagnano da tempo.')}</div>
    <h2 class="sec">Curiosità del momento</h2>
    <div class="list">${cur.length ? cur.map(interestRow).join('') : empty('Nessuna curiosità', 'Le cose che ti hanno preso di recente, senza impegno.')}</div>
    ${paused.length ? `<h2 class="sec">In pausa</h2><div class="list">${paused.map(interestRow).join('')}</div>` : ''}
    ${renderSaved()}
    <button class="btn profile-btn" data-action="open-profile">${icon('spark', 'xs')} Cosa ho imparato di te</button>
    <div class="info-card">
      <strong>Scoperta di contenuti</strong>
      <p>Per farti consigliare libri, podcast, documentari o un argomento da approfondire, chiedilo all'<a href="#assistente">Assistente</a>: conosce i tuoi interessi, se gli dai il permesso. Non ha accesso a internet, quindi non conosce le uscite più recenti.</p>
    </div>
  </section>`;
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
      if (!confirm(`Eliminare «${i.name}»?`)) return;
      state.interests = state.interests.filter(x => x.id !== i.id);
      closeSheet(); commit(); toast('Interesse eliminato');
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
    <p class="hint version">Spazio personale · versione 2.3.0</p>`, sheet => {
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
