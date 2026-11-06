// Le schermate dell'app e i pannelli di modifica.
import { state, commit, touch, uid, exportData, importData, stats, normEvent, normProject, normInterest } from './store.js?v=2.1.2';
import * as D from './dates.js?v=2.1.2';
import { esc, icon, openSheet, closeSheet, toast, voiceSupported } from './ui.js?v=2.1.2';

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
export const recLabel = r => (!r || r.freq === 'none' ? '' : r.interval > 1 ? `Ogni ${r.interval} ${UNIT[r.freq][1]}` : FREQ[r.freq]);
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

// Promemoria il cui anticipo è già iniziato (impegni futuri, non svolti)
export function activeReminders(horizonDays = 400) {
  const now = new Date();
  const t = D.todayISO();
  return items(t, D.addDaysISO(t, horizonDays)).filter(it => {
    if (it.done || it.ev.reminder == null) return false;
    const when = whenOf(it);
    if (when < now && it.date !== t) return false;
    return now >= new Date(when.getTime() - it.ev.reminder * 60000);
  });
}

function overdueDeadlines() {
  const t = D.todayISO();
  return items(D.addDaysISO(t, -60), D.addDaysISO(t, -1)).filter(it => it.ev.type === 'scadenza' && !it.done);
}

function suggestions() {
  const t = D.todayISO();
  const out = [];
  const projects = state.projects.filter(p => (p.status === 'attivo' || p.status === 'pausa') && !(p.snoozedUntil > t));
  const stale = projects
    .map(p => ({ p, days: D.daysBetween(D.toISO(new Date(p.lastActivityAt)), t) }))
    .filter(x => x.days >= 14)
    .sort((a, b) => b.days - a.days)[0];
  if (stale) {
    const weeks = Math.round(stale.days / 7);
    out.push({
      kind: 'project', id: stale.p.id,
      text: `Non tocchi «${stale.p.name}» da ${weeks <= 1 ? 'un paio di settimane' : weeks + ' settimane'}. Ti va di riprenderlo?`,
      why: stale.p.status === 'pausa' ? 'Progetto in pausa' : 'Progetto fermo da un po\'',
    });
  }
  const next = projects.find(p => p.status === 'attivo' && (!stale || p.id !== stale.p.id) && p.steps.some(s => !s.done));
  if (next) {
    out.push({
      kind: 'project', id: next.id,
      text: `Prossimo passo per «${next.name}»: ${next.steps.find(s => !s.done).text}`,
      why: 'Dal tuo progetto attivo',
    });
  }
  const ints = state.interests.filter(i => i.status === 'attivo' && !(i.snoozedUntil > t));
  if (ints.length && out.length < 2) {
    const i = ints[D.daysBetween('2026-01-01', t) % ints.length];
    out.push({ kind: 'interest', id: i.id, text: `Potresti dedicare un po' di tempo libero a «${i.name}».`, why: i.kind === 'curiosita' ? 'Curiosità del momento' : 'Dai tuoi interessi' });
  }
  return out.slice(0, 2);
}

// ---------- Componenti

export function quickAdd(placeholder = 'Es. dentista il 20 novembre alle 15') {
  return `<form class="quick" data-form="quick">
    <input name="q" placeholder="${esc(placeholder)}" data-placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="done" aria-label="Aggiungi un impegno">
    ${voiceSupported ? `<button type="button" class="icon-btn mic" data-action="voice" aria-label="Detta un impegno">${icon('mic')}</button>` : ''}
    <button class="icon-btn solid" aria-label="Aggiungi">${icon('plus')}</button>
  </form>`;
}

function itemRow(it, { showDate = false, bell = false } = {}) {
  const e = it.ev;
  const canDone = e.type !== 'appuntamento';
  const time = e.start ? `${e.start}${e.end ? '–' + e.end : ''}` : e.type === 'scadenza' ? 'Entro oggi' : 'In giornata';
  const meta = [TYPE[e.type].label, e.location && `${icon('pin', 'xs')}${esc(e.location)}`, recLabel(e.recurrence) && icon('repeat', 'xs')]
    .filter(Boolean).join('<span class="sep">·</span>');
  return `<div class="item ${TYPE[e.type].cls}${it.done ? ' is-done' : ''}">
    ${canDone
      ? `<button class="check${it.done ? ' on' : ''}" data-action="toggle-done" data-id="${e.id}" data-date="${it.date}" aria-label="${it.done ? 'Segna come da fare' : 'Segna come fatto'}">${icon('check')}</button>`
      : '<span class="bar"></span>'}
    <button class="item-main" data-action="edit-event" data-id="${e.id}">
      <span class="item-time">${showDate ? `${D.relDay(it.date)} · ` : ''}${esc(time)}${bell ? ` ${icon('bell', 'xs accent')}` : ''}</span>
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
  const remIds = new Set(reminders.map(r => r.ev.id + r.date));
  const later = reminders.filter(r => r.date > D.addDaysISO(t, 7));
  const overdue = overdueDeadlines();
  const light = open.length <= 2 && h < 22;
  const sugg = light ? suggestions() : [];

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
    ${later.length ? `<h2 class="sec">Da ricordare</h2><div class="list">${later.map(i => itemRow(i, { showDate: true, bell: true })).join('')}</div>` : ''}
    <h2 class="sec">Prossimi giorni</h2>
    <div class="list">${week.length ? week.slice(0, 6).map(i => itemRow(i, { showDate: true, bell: remIds.has(i.ev.id + i.date) })).join('')
      + (week.length > 6 ? `<a class="more" href="#impegni">Altri ${week.length - 6} nella settimana</a>` : '')
      : empty('Settimana tranquilla', 'Niente in programma per i prossimi sette giorni.')}</div>
    ${sugg.length ? `<h2 class="sec">Per il tempo libero</h2>
      <div class="list">${sugg.map(s => `<div class="suggest">
        <span class="suggest-tag">${icon('spark', 'xs')} Suggerimento · ${esc(s.why)}</span>
        <p>${esc(s.text)}</p>
        <div class="suggest-actions">
          <button class="btn small" data-action="open-${s.kind}" data-id="${s.id}">Apri</button>
          <button class="btn small ghost" data-action="snooze-${s.kind}" data-id="${s.id}">Non ora</button>
        </div></div>`).join('')}</div>` : ''}
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

function leadOptions(value) {
  const known = LEADS.some(l => l[0] === (value == null ? '' : String(value)));
  return LEADS.map(([v, l]) => `<option value="${v}"${(value == null ? '' : String(value)) === v ? ' selected' : ''}>${l}</option>`).join('')
    + `<option value="custom"${!known ? ' selected' : ''}>Personalizzato…</option>`;
}

export function openEventSheet(id, preset = {}, notes = []) {
  const ev = id ? state.events.find(e => e.id === id) : null;
  if (id && !ev) { toast('Impegno non trovato'); return; }
  const d = ev ? JSON.parse(JSON.stringify(ev)) : normEvent({ ...preset, reminder: undefined });
  if (!ev) d.reminder = state.settings.reminders[d.type] ?? null;
  const r = d.recurrence;
  const custom = d.reminder != null && !LEADS.some(l => l[0] === String(d.reminder));
  const cu = custom ? (d.reminder % 1440 === 0 ? ['1440', d.reminder / 1440] : d.reminder % 60 === 0 ? ['60', d.reminder / 60] : ['1', d.reminder]) : ['1440', 1];
  const cats = [...new Set(state.events.map(e => e.category).filter(Boolean))];

  openSheet(`
    <div class="sheet-head"><h2>${ev ? 'Modifica impegno' : 'Nuovo impegno'}</h2>
      <button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
    ${notes.length ? `<div class="notice">${icon('spark', 'xs')}<div><strong>Ho capito così: controlla e salva.</strong>${notes.filter(Boolean).map(n => `<p>${esc(n)}</p>`).join('')}</div></div>` : ''}
    <form class="form" id="ev-form" novalidate>
      <div class="seg type-seg">
        ${Object.entries(TYPE).map(([k, v]) => `<label class="${d.type === k ? 'on' : ''}"><input type="radio" name="type" value="${k}"${d.type === k ? ' checked' : ''}>${v.label}</label>`).join('')}
      </div>
      <label class="field"><span>Titolo</span><input name="title" value="${esc(d.title === 'Senza titolo' && !ev ? '' : d.title)}" required maxlength="140" placeholder="Cosa devi fare?"></label>
      <div class="row">
        <label class="field"><span>Data</span><input type="date" name="date" value="${d.date}" required></label>
      </div>
      <div class="row">
        <label class="field"><span>Inizio</span><input type="time" name="start" value="${d.start}"></label>
        <label class="field"><span>Fine</span><input type="time" name="end" value="${d.end}"></label>
      </div>
      <p class="hint">Lascia vuoti gli orari se non serve un'ora precisa.</p>
      <label class="field"><span>Promemoria</span><select name="reminder">${leadOptions(d.reminder)}</select></label>
      <div class="row custom-lead"${custom ? '' : ' hidden'}>
        <label class="field"><span>Quanto prima</span><input type="number" name="leadN" min="1" max="999" value="${cu[1]}"></label>
        <label class="field"><span>&nbsp;</span><select name="leadU">
          <option value="1"${cu[0] === '1' ? ' selected' : ''}>minuti</option>
          <option value="60"${cu[0] === '60' ? ' selected' : ''}>ore</option>
          <option value="1440"${cu[0] === '1440' ? ' selected' : ''}>giorni</option></select></label>
      </div>
      <label class="field"><span>Ripetizione</span><select name="freq">
        ${Object.entries(FREQ).map(([k, v]) => `<option value="${k}"${r.freq === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="row rec-extra"${r.freq === 'none' ? ' hidden' : ''}>
        <label class="field"><span>Ogni quanti</span><input type="number" name="interval" min="1" max="99" value="${r.interval}"></label>
        <label class="field"><span>Fino al (facoltativo)</span><input type="date" name="until" value="${r.until}"></label>
      </div>
      <label class="field"><span>Luogo</span><input name="location" value="${esc(d.location)}" maxlength="120" placeholder="Facoltativo"></label>
      <label class="field"><span>Categoria</span><input name="category" value="${esc(d.category)}" maxlength="40" list="cat-list" placeholder="Es. salute, casa, lavoro">
        <datalist id="cat-list">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="field"><span>Note</span><textarea name="notes" rows="3" maxlength="2000">${esc(d.notes)}</textarea></label>
      <p class="error" hidden></p>
      <div class="actions">
        ${ev ? `<button type="button" class="btn ghost danger" data-del>Elimina</button>` : ''}
        <button class="btn primary">Salva</button>
      </div>
      ${ev && r.freq !== 'none' ? '<p class="hint">Le modifiche valgono per tutte le ripetizioni di questo impegno.</p>' : ''}
    </form>`, sheet => {
    const f = sheet.querySelector('#ev-form');
    let leadTouched = !!ev;
    f.reminder.addEventListener('change', () => {
      leadTouched = true;
      sheet.querySelector('.custom-lead').hidden = f.reminder.value !== 'custom';
    });
    f.freq.addEventListener('change', () => { sheet.querySelector('.rec-extra').hidden = f.freq.value === 'none'; });
    f.querySelectorAll('input[name=type]').forEach(inp => inp.addEventListener('change', () => {
      f.querySelectorAll('.type-seg label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
      if (!leadTouched) {
        const v = state.settings.reminders[inp.value];
        f.reminder.innerHTML = leadOptions(v);
        sheet.querySelector('.custom-lead').hidden = f.reminder.value !== 'custom';
      }
    }));
    if (!ev && !preset.title) setTimeout(() => f.title.focus(), 50);
    const del = sheet.querySelector('[data-del]');
    if (del) del.addEventListener('click', () => {
      if (!confirm(`Eliminare «${ev.title}»${r.freq !== 'none' ? ' e tutte le sue ripetizioni' : ''}?`)) return;
      state.events = state.events.filter(e => e.id !== ev.id);
      closeSheet(); commit(); toast('Impegno eliminato');
    });
    f.addEventListener('submit', e => {
      e.preventDefault();
      const err = sheet.querySelector('.error');
      const val = n => f[n].value.trim();
      const fail = msg => { err.textContent = msg; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
      if (!val('title')) return fail('Scrivi un titolo.');
      if (!val('date')) return fail('Scegli una data.');
      if (val('start') && val('end') && val('end') <= val('start')) return fail("L'ora di fine deve essere dopo l'inizio.");
      if (val('end') && !val('start')) return fail("Se metti l'ora di fine, indica anche l'inizio.");
      if (f.freq.value !== 'none' && val('until') && val('until') < val('date')) return fail('La ripetizione deve finire dopo la data di inizio.');
      let reminder = f.reminder.value === '' ? null : f.reminder.value === 'custom'
        ? Math.max(1, parseInt(f.leadN.value, 10) || 1) * +f.leadU.value : +f.reminder.value;
      const data = normEvent({
        ...(ev || {}),
        id: ev ? ev.id : uid(),
        type: f.querySelector('input[name=type]:checked').value,
        title: val('title'), date: val('date'), start: val('start'), end: val('end'),
        location: val('location'), category: val('category'), notes: f.notes.value.trim(),
        recurrence: { freq: f.freq.value, interval: f.interval.value, until: f.freq.value === 'none' ? '' : val('until') },
        reminder,
        done: ev ? ev.done : [],
      });
      touch(data);
      if (ev) Object.assign(ev, data); else state.events.push(data);
      closeSheet(); commit();
      toast(ev ? 'Impegno aggiornato' : `Aggiunto: ${D.relDay(data.date).toLowerCase()}${data.start ? ' alle ' + data.start : ''}`);
    });
  });
}

export function toggleDone(id, date) {
  const ev = state.events.find(e => e.id === id);
  if (!ev) return;
  const i = ev.done.indexOf(date);
  if (i >= 0) ev.done.splice(i, 1); else ev.done.push(date);
  touch(ev); commit();
}

// ---------- PROGETTI

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
      <span><small>Prossimo passo</small>${esc(next.text)}</span></div>` : ''}
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
      <span>${esc(s.text)}</span>
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
      const tg = e.target.closest('[data-st-toggle]'), dl = e.target.closest('[data-st-del]');
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
    f.addEventListener('submit', e => {
      e.preventDefault();
      if (f.newStep.value.trim()) add();
      if (!f.name.value.trim()) { const er = sheet.querySelector('.error'); er.textContent = 'Dai un nome al progetto.'; er.hidden = false; return; }
      const data = normProject({
        ...d, id: p ? p.id : uid(), name: f.name.value, goal: f.goal.value.trim(), description: f.description.value.trim(),
        status: f.status.value, deadline: f.deadline.value, notes: f.notes.value.trim(), steps,
        lastActivityAt: new Date().toISOString(), snoozedUntil: '',
      });
      touch(data);
      if (p) Object.assign(p, data); else state.projects.push(data);
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

export function openSettings() {
  const s = stats();
  const last = state.meta.lastExport ? new Date(state.meta.lastExport).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : 'mai';
  const sel = (type) => `<select data-lead="${type}">${LEADS.map(([v, l]) => `<option value="${v}"${String(state.settings.reminders[type] ?? '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  openSheet(`
    <div class="sheet-head"><h2>Impostazioni</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
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
    <p class="hint version">Spazio personale · versione 2.1.2</p>`, sheet => {
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
