// Avvio dell'app, navigazione e gestione dei tocchi.
import { load, onChange } from './store.js';
import { toast, dictate, closeSheet } from './ui.js';
import { parseQuick } from './parse.js';
import * as V from './views.js';

const ROUTES = {
  oggi: V.renderToday,
  impegni: V.renderAgenda,
  interessi: V.renderInterests,
  progetti: V.renderProjects,
  assistente: V.renderAssistant,
};
const main = document.getElementById('main');

const route = () => {
  const r = location.hash.replace('#', '');
  return ROUTES[r] ? r : 'oggi';
};

function render() {
  const r = route();
  main.innerHTML = ROUTES[r]();
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.route === r));
}

let lastRoute = null;
window.addEventListener('hashchange', () => {
  closeSheet();
  render();
  if (route() !== lastRoute) window.scrollTo(0, 0);
  lastRoute = route();
});

// Azioni attivate dai pulsanti con data-action
const actions = {
  'open-settings': () => V.openSettings(),
  'edit-event': el => V.openEventSheet(el.dataset.id),
  'new-event': () => V.openEventSheet(null, { date: V.newEventDate() }),
  'toggle-done': el => V.toggleDone(el.dataset.id, el.dataset.date),
  mode: el => { V.ui.mode = el.dataset.mode; render(); },
  prev: () => { V.shiftCursor(-1); render(); },
  next: () => { V.shiftCursor(1); render(); },
  'go-today': () => { V.ui.cursor = V.ui.selected = localToday(); render(); },
  'goto-day': el => { V.ui.mode = 'giorno'; V.ui.cursor = el.dataset.date; render(); },
  'select-day': el => { V.ui.selected = el.dataset.date; render(); },
  'new-project': () => V.openProjectSheet(null),
  'open-project': el => V.openProjectSheet(el.dataset.id),
  'step-done': el => V.stepDone(el.dataset.id, el.dataset.step),
  'toggle-archive': () => { V.ui.archive = !V.ui.archive; render(); },
  'open-interest': el => V.openInterestSheet(el.dataset.id),
  'pause-interest': el => V.setInterestStatus(el.dataset.id, 'pausa'),
  'resume-interest': el => V.setInterestStatus(el.dataset.id, 'attivo'),
  'snooze-project': el => V.snooze('project', el.dataset.id),
  'snooze-interest': el => V.snooze('interest', el.dataset.id),
  voice: el => {
    const form = el.closest('form');
    dictate(form.q, el, text => handleQuick(text));
  },
};

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) { e.preventDefault(); actions[el.dataset.action](el); return; }
  if (e.target.closest('[data-close]')) closeSheet();
});

// Tocco fuori dal pannello per chiuderlo
const sheet = document.getElementById('sheet');
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });

function handleQuick(text) {
  const t = text.trim();
  if (!t) { V.openEventSheet(null, { date: V.newEventDate() }); return; }
  const p = parseQuick(t);
  const form = document.querySelector('[data-form=quick]');
  if (form) form.q.value = '';
  V.openEventSheet(null, p, p.notes.length ? p.notes : ['']);
}

document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  if (f.dataset.form === 'quick') handleQuick(f.q.value);
  if (f.dataset.form === 'interest') {
    if (V.addInterest(f.name.value, f.querySelector('input[name=kind]:checked').value)) f.name.value = '';
  }
});

// Aspetto dei selettori "Interesse / Curiosità"
document.addEventListener('change', e => {
  const r = e.target.closest('.seg.mini input[type=radio]');
  if (r) r.closest('.seg').querySelectorAll('label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
});

// Avvio
const info = load();
onChange(ok => { if (!ok) toast('Non sono riuscito a salvare: lo spazio del browser potrebbe essere pieno', 'bad'); render(); });
lastRoute = route();
render();
if (info.migrated) toast('Ho importato i dati della versione precedente');
if (info.error) toast(info.error, 'bad');

// Aggiorna la schermata quando si torna sull'app (es. il giorno dopo)
let lastDay = localToday();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const d = localToday();
    if (d !== lastDay) { lastDay = d; V.ui.cursor = V.ui.selected = d; }
    if (!sheet.open) render();
  }
});
setInterval(() => { if (document.visibilityState === 'visible' && !sheet.open) render(); }, 5 * 60 * 1000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker non registrato', err));
}
document.documentElement.classList.add('ready');
