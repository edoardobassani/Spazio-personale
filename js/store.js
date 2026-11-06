// Archivio dei dati: tutto resta sul dispositivo (localStorage).
import { todayISO } from './dates.js';

export const KEY = 'spazio-personale-v2';
const OLD_KEY = 'spazio-personale-v1'; // dati della prima versione: non vengono mai cancellati
export const TYPES = ['appuntamento', 'attivita', 'scadenza'];
export const PROJECT_STATUS = ['attivo', 'pausa', 'completato', 'archiviato'];

export const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const nowISO = () => new Date().toISOString();

export const state = {};
const listeners = [];
export const onChange = fn => listeners.push(fn);

function defaults() {
  return {
    version: 2,
    events: [],
    projects: [],
    interests: [],
    settings: { reminders: { appuntamento: 1440, attivita: 60, scadenza: 1440 } },
    meta: { createdAt: nowISO(), lastExport: null, migratedFromV1: false },
  };
}

const str = v => (v == null ? '' : String(v));
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = v => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);

export function normEvent(e = {}) {
  const r = e.recurrence || {};
  return {
    id: str(e.id) || uid(),
    type: TYPES.includes(e.type) ? e.type : 'attivita',
    title: str(e.title).trim() || 'Senza titolo',
    date: isDate(e.date) ? e.date : todayISO(),
    start: isTime(e.start) ? e.start : '',
    end: isTime(e.end) ? e.end : '',
    location: str(e.location),
    category: str(e.category),
    notes: str(e.notes),
    recurrence: {
      freq: ['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(r.freq) ? r.freq : 'none',
      interval: Math.max(1, parseInt(r.interval, 10) || 1),
      until: isDate(r.until) ? r.until : '',
    },
    reminder: Number.isFinite(e.reminder) && e.reminder >= 0 ? e.reminder : null,
    done: Array.isArray(e.done) ? e.done.filter(isDate) : [],
    createdAt: str(e.createdAt) || nowISO(),
    updatedAt: str(e.updatedAt) || nowISO(),
  };
}

export function normProject(p = {}) {
  return {
    id: str(p.id) || uid(),
    name: str(p.name).trim() || 'Progetto senza nome',
    description: str(p.description),
    goal: str(p.goal),
    status: PROJECT_STATUS.includes(p.status) ? p.status : 'attivo',
    deadline: isDate(p.deadline) ? p.deadline : '',
    steps: (Array.isArray(p.steps) ? p.steps : []).filter(s => s && s.text)
      .map(s => ({ id: str(s.id) || uid(), text: str(s.text), done: !!s.done })),
    notes: str(p.notes),
    createdAt: str(p.createdAt) || nowISO(),
    updatedAt: str(p.updatedAt) || nowISO(),
    lastActivityAt: str(p.lastActivityAt) || str(p.createdAt) || nowISO(),
    snoozedUntil: isDate(p.snoozedUntil) ? p.snoozedUntil : '',
  };
}

export function normInterest(i = {}) {
  return {
    id: str(i.id) || uid(),
    name: str(i.name).trim() || 'Senza nome',
    kind: i.kind === 'curiosita' ? 'curiosita' : 'stabile',
    status: i.status === 'pausa' ? 'pausa' : 'attivo',
    notes: str(i.notes),
    createdAt: str(i.createdAt) || nowISO(),
    lastTouchedAt: str(i.lastTouchedAt) || str(i.createdAt) || nowISO(),
    snoozedUntil: isDate(i.snoozedUntil) ? i.snoozedUntil : '',
  };
}

export function normalize(raw) {
  const d = defaults();
  const s = raw && typeof raw === 'object' ? raw : {};
  const arr = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []);
  return {
    version: 2,
    events: arr(s.events).map(normEvent),
    projects: arr(s.projects).map(normProject),
    interests: arr(s.interests).map(normInterest),
    settings: { reminders: { ...d.settings.reminders, ...(s.settings && s.settings.reminders) } },
    meta: { ...d.meta, ...(s.meta || {}) },
  };
}

function replaceState(next) {
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, next);
}

// Importa i dati della prima versione (promemoria, interessi come testo, progetti con solo nome)
function migrateV1(o, n) {
  for (const r of Array.isArray(o.reminders) ? o.reminders : []) {
    if (!r || !r.title) continue;
    n.events.push(normEvent({
      id: r.id, title: r.title, date: r.date || todayISO(), start: r.time || '',
      type: r.time ? 'appuntamento' : 'attivita',
      reminder: r.time ? 1440 : 60,
      notes: r.date ? '' : 'Data non indicata nella versione precedente: controlla.',
    }));
  }
  for (const i of Array.isArray(o.interests) ? o.interests : []) {
    const name = typeof i === 'string' ? i : i && i.name;
    if (name) n.interests.push(normInterest({ name }));
  }
  for (const p of Array.isArray(o.projects) ? o.projects : []) {
    if (p && (p.name || p.title)) n.projects.push(normProject({ id: p.id, name: p.name || p.title }));
  }
  n.meta.migratedFromV1 = true;
}

function seed(n) {
  ['Geopolitica', 'Tecnologia', 'Storia', 'Viticoltura', 'Enologia']
    .forEach(name => n.interests.push(normInterest({ name })));
}

export function load() {
  const info = { migrated: false, error: null };
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { info.error = 'Il browser non permette di salvare dati.'; }
  if (raw) {
    try { replaceState(normalize(JSON.parse(raw))); return info; }
    catch (e) {
      // Dati illeggibili: ne conservo una copia prima di ripartire
      info.error = 'I dati salvati erano danneggiati: ne ho conservato una copia e ripreso da zero.';
      try { localStorage.setItem(`${KEY}-danneggiato-${Date.now()}`, raw); } catch (_) { /* niente */ }
    }
  }
  const n = defaults();
  try {
    const old = localStorage.getItem(OLD_KEY);
    if (old && !info.error) { migrateV1(JSON.parse(old), n); info.migrated = true; } else if (!info.error) seed(n);
  } catch (e) { seed(n); }
  replaceState(n);
  save();
  return info;
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
  catch (e) { console.error(e); return false; }
}

// Salva e aggiorna lo schermo
export function commit() {
  const ok = save();
  listeners.forEach(fn => fn(ok));
  return ok;
}

export const touch = obj => { obj.updatedAt = nowISO(); };

export function exportData() {
  state.meta.lastExport = nowISO();
  save();
  return JSON.stringify({ ...state, exportedAt: nowISO(), app: 'Spazio personale' }, null, 2);
}

export function importData(text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object') throw new Error('File non valido');
  // Accetta sia i backup di questa versione sia l'esportazione della prima versione
  let next;
  if (Array.isArray(raw.events) || Array.isArray(raw.projects) || raw.version === 2) next = normalize(raw);
  else if (Array.isArray(raw.reminders) || Array.isArray(raw.interests)) { next = defaults(); migrateV1(raw, next); }
  else throw new Error('Questo file non sembra un backup di Spazio personale');
  replaceState(next);
  return commit();
}

export function stats() {
  return { events: state.events.length, projects: state.projects.length, interests: state.interests.length };
}

