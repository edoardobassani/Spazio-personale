// Avvio dell'app, navigazione e gestione dei tocchi.
import { load, onChange } from './store.js?v=2.6.0';
import { toast, dictate, stopDictation, isDictating, closeSheet } from './ui.js?v=2.6.0';
import { parseQuick } from './parse.js?v=2.6.0';
import * as V from './views.js?v=2.6.0';
import * as AI from './ai/assistant.js?v=2.6.0';
import * as LEARN from './learn.js?v=2.6.0';

const ROUTES = {
  oggi: V.renderToday,
  impegni: V.renderAgenda,
  interessi: V.renderInterests,
  progetti: V.renderProjects,
  assistente: AI.renderAssistant,
};
const main = document.getElementById('main');

const route = () => {
  const r = location.hash.replace('#', '');
  return ROUTES[r] ? r : 'oggi';
};

function render() {
  const r = route();
  stopDictation(); // il testo dettato fin qui resta nel campo
  // Conserva quello che stavi scrivendo se la schermata si aggiorna
  const typing = [...main.querySelectorAll('[data-form] [name=q]')].map(el => [el.closest('[data-form]').dataset.form, el.value, el === document.activeElement]);
  main.innerHTML = ROUTES[r]();
  for (const [form, value, focused] of typing) {
    const el = main.querySelector(`[data-form=${form}] [name=q]`);
    if (el && value) { el.value = value; if (focused) el.focus(); }
  }
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.route === r));
  if (r === 'assistente') AI.afterRender();
}
AI.setRender(render);

let lastRoute = null;
window.addEventListener('hashchange', () => {
  stopDictation();
  closeSheet();
  render();
  if (route() !== lastRoute) window.scrollTo(0, 0);
  lastRoute = route();
});

// Azioni attivate dai pulsanti con data-action
const actions = {
  'open-settings': () => V.openSettings(),
  'open-search': () => V.openSearch(),
  'edit-event': el => V.openEventSheet(el.dataset.id, {}, [], el.dataset.date || ''),
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
  ...AI.actions,
  ...LEARN.actions,
  voice: el => dictate(el.closest('form').q, el),
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
  if (f.dataset.form === 'quick' || f.dataset.form === 'ai-chat') stopDictation(); // Invia ferma la dettatura e usa il testo dettato
  if (f.dataset.form === 'quick') handleQuick(f.q.value);
  if (f.dataset.form === 'ai-key') AI.connect(f.key.value, f.provider ? f.provider.value : undefined);
  if (f.dataset.form === 'ai-chat') { const t = f.q.value; f.q.value = ''; AI.send(t); }
  if (f.dataset.form === 'interest') {
    if (V.addInterest(f.name.value, f.querySelector('input[name=kind]:checked').value)) f.name.value = '';
  }
});

// Nella chat: Invio manda il messaggio, Maiusc+Invio va a capo; il campo cresce col testo
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && e.target.matches('[data-form=ai-chat] textarea')) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
});
document.addEventListener('input', e => {
  if (e.target.matches('[data-form=ai-chat] textarea')) {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
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
setInterval(() => { if (document.visibilityState === 'visible' && !sheet.open && !isDictating()) render(); }, 5 * 60 * 1000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker non registrato', err));
}
document.documentElement.classList.add('ready');
