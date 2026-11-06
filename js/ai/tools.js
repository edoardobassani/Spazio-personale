// Strumenti che l'assistente può usare sui dati dell'app.
// Lettura: eseguita subito, nei limiti dei permessi.
// Scrittura: diventa una PROPOSTA che l'utente conferma o annulla con un tocco.
import { state, uid, touch, normEvent, normProject, normInterest } from '../store.js?v=2.3.0';
import * as D from '../dates.js?v=2.3.0';
import { items, TYPE, recLabel, remindersLabel } from '../views.js?v=2.3.0';

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = v => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
const S = (description, extra = {}) => ({ type: 'string', description, ...extra });
const I = description => ({ type: 'integer', description });
const FREQS = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

const EVENT_PROPS = {
  title: S('Titolo breve e chiaro'),
  type: S('appuntamento (con altre persone o in un luogo), attivita (cosa da fare), scadenza (entro una data)', { enum: ['appuntamento', 'attivita', 'scadenza'] }),
  date: S('Data nel formato AAAA-MM-GG'),
  start: S('Ora di inizio HH:MM (24 ore). Ometti se non serve'),
  end: S('Ora di fine HH:MM. Ometti se non serve'),
  location: S('Luogo'),
  category: S('Categoria, es. salute, casa, lavoro'),
  notes: S('Note'),
  repeat: S('Ripetizione', { enum: FREQS }),
  repeat_every: I('Ogni quanti giorni/settimane/mesi/anni, predefinito 1'),
  repeat_until: S('Ultima data della ripetizione AAAA-MM-GG, facoltativa'),
  repeat_days: { type: 'array', items: { type: 'string', enum: ['lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato', 'domenica'] },
    description: 'Solo per ripetizione settimanale su più giorni, es. ["lunedi","mercoledi","venerdi"]' },
  reminders_minutes: { type: 'array', items: { type: 'integer' },
    description: "Promemoria in minuti di anticipo, anche più di uno (60 = un'ora, 1440 = il giorno prima). Ometti per usare quello predefinito; [] per nessuno" },
};

const DEFS = [
  { name: 'get_events', access: 'events', write: false,
    description: "Legge gli impegni (appuntamenti, attività, scadenze) dell'utente tra due date, incluse le ripetizioni. Usalo sempre prima di rispondere su agenda o tempo libero.",
    parameters: { type: 'object', properties: { from: S('Data iniziale AAAA-MM-GG'), to: S('Data finale AAAA-MM-GG (massimo 120 giorni dopo)') }, required: ['from', 'to'] } },
  { name: 'create_event', access: 'events', write: true,
    description: "Propone un nuovo impegno. L'utente dovrà confermarlo.",
    parameters: { type: 'object', properties: EVENT_PROPS, required: ['title', 'type', 'date'] } },
  { name: 'update_event', access: 'events', write: true,
    description: "Propone di modificare un impegno esistente (usa l'id letto con get_events). Indica solo i campi da cambiare. Per un impegno che si ripete la modifica vale per tutte le ripetizioni.",
    parameters: { type: 'object', properties: { id: S("Id dell'impegno"), ...EVENT_PROPS }, required: ['id'] } },
  { name: 'delete_event', access: 'events', write: true,
    description: "Propone di eliminare un impegno (e tutte le sue ripetizioni).",
    parameters: { type: 'object', properties: { id: S("Id dell'impegno") }, required: ['id'] } },
  { name: 'get_projects', access: 'projects', write: false,
    description: "Legge i progetti personali dell'utente con stato, obiettivo, passaggi e data dell'ultima attività.",
    parameters: { type: 'object', properties: {} } },
  { name: 'create_project', access: 'projects', write: true,
    description: 'Propone un nuovo progetto, eventualmente già diviso in passaggi.',
    parameters: { type: 'object', properties: {
      name: S('Nome del progetto'), goal: S('Obiettivo'), description: S('Descrizione'),
      deadline: S('Scadenza AAAA-MM-GG, facoltativa'),
      steps: { type: 'array', items: { type: 'string' }, description: 'Passaggi concreti, brevi, in ordine' },
    }, required: ['name'] } },
  { name: 'update_project', access: 'projects', write: true,
    description: 'Propone modifiche a un progetto: stato, obiettivo, scadenza, nuovi passaggi, passaggi completati.',
    parameters: { type: 'object', properties: {
      id: S('Id del progetto'),
      status: S('Nuovo stato', { enum: ['attivo', 'pausa', 'completato', 'archiviato'] }),
      goal: S('Nuovo obiettivo'), deadline: S('Nuova scadenza AAAA-MM-GG'),
      add_steps: { type: 'array', items: { type: 'string' }, description: 'Passaggi da aggiungere in fondo' },
      complete_step_ids: { type: 'array', items: { type: 'string' }, description: 'Id dei passaggi da segnare come fatti' },
    }, required: ['id'] } },
  { name: 'get_interests', access: 'interests', write: false,
    description: "Legge gli interessi dell'utente: stabili o curiosità del momento, attivi o in pausa.",
    parameters: { type: 'object', properties: {} } },
  { name: 'add_interest', access: 'interests', write: true,
    description: 'Propone di aggiungere un interesse.',
    parameters: { type: 'object', properties: { name: S("Nome dell'argomento"), kind: S('stabile o curiosita', { enum: ['stabile', 'curiosita'] }) }, required: ['name'] } },
  { name: 'update_interest', access: 'interests', write: true,
    description: 'Propone di cambiare tipo o stato di un interesse (per esempio metterlo in pausa o riprenderlo).',
    parameters: { type: 'object', properties: {
      id: S("Id dell'interesse"), kind: S('Tipo', { enum: ['stabile', 'curiosita'] }), status: S('Stato', { enum: ['attivo', 'pausa'] }),
    }, required: ['id'] } },
];

export function toolDefs(perms) {
  return DEFS.filter(d => perms[d.access]).map(({ name, description, parameters }) => ({ name, description, parameters }));
}

// ---------- Descrizioni leggibili delle proposte

function when(date, start, end) {
  const n = D.daysBetween(D.todayISO(), date);
  // relDay dà già la data per i giorni lontani; per oggi/domani/giorni vicini la aggiungo
  const day = n >= -1 && n < 7 ? `${D.relDay(date)} ${D.fmt(date, { day: 'numeric', month: 'short' })}` : D.relDay(date);
  return `${day}${start ? ' alle ' + start : ''}${end ? '–' + end : ''}`;
}

function eventFromArgs(a, base = {}) {
  const out = { ...base };
  if (a.title != null) out.title = String(a.title);
  if (a.type) out.type = a.type;
  if (a.date != null) out.date = a.date;
  if (a.start != null) out.start = a.start || '';
  if (a.end != null) out.end = a.end || '';
  for (const k of ['location', 'category', 'notes']) if (a[k] != null) out[k] = String(a[k]);
  if (a.repeat || a.repeat_every || a.repeat_until != null || a.repeat_days) {
    const r = { ...(base.recurrence || { freq: 'none', interval: 1, until: '', days: [] }) };
    if (a.repeat) r.freq = a.repeat;
    if (a.repeat_every) r.interval = a.repeat_every;
    if (a.repeat_until != null) r.until = a.repeat_until || '';
    if (Array.isArray(a.repeat_days)) {
      const W = { domenica: 0, lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6 };
      r.days = a.repeat_days.map(x => W[String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')]).filter(x => x != null);
      if (r.days.length) r.freq = 'weekly';
    }
    if (r.freq !== 'weekly') r.days = [];
    out.recurrence = r;
  }
  if (Array.isArray(a.reminders_minutes)) out.reminders = a.reminders_minutes.map(Number).filter(n => Number.isFinite(n) && n >= 0);
  else if (a.reminder_minutes != null) out.reminders = [Number(a.reminder_minutes)];
  return out;
}

function checkEvent(e) {
  if (!e.title || !String(e.title).trim()) return 'manca il titolo';
  if (!isDate(e.date)) return 'la data deve essere nel formato AAAA-MM-GG';
  if (e.start && !isTime(e.start)) return "l'ora di inizio deve essere HH:MM";
  if (e.end && !isTime(e.end)) return "l'ora di fine deve essere HH:MM";
  if (e.end && !e.start) return "se c'è l'ora di fine serve anche l'inizio";
  if (e.start && e.end && e.end <= e.start) return "l'ora di fine deve essere dopo l'inizio";
  if (e.recurrence && !FREQS.includes(e.recurrence.freq)) return 'ripetizione non valida';
  if (e.type && !TYPE[e.type]) return 'tipo non valido';
  return '';
}

const findEvent = id => state.events.find(e => e.id === id);
const findProject = id => state.projects.find(p => p.id === id);
const findInterest = id => state.interests.find(i => i.id === id);

function proposal(kind, args, title, lines) {
  return { id: uid(), kind, args, title, lines: lines.filter(Boolean), status: 'pending' };
}

// ---------- Esecuzione

export function runTool(name, args, perms) {
  const def = DEFS.find(d => d.name === name);
  if (!def) return { response: { errore: `Strumento sconosciuto: ${name}` } };
  if (!perms[def.access]) return { response: { errore: "L'utente non ti ha dato il permesso di accedere a questi dati." } };
  try { return EXEC[name](args || {}, perms); }
  catch (e) { console.error(e); return { response: { errore: 'Errore interno: ' + e.message } }; }
}

const EXEC = {
  get_events({ from, to }, perms) {
    if (!isDate(from) || !isDate(to)) return { response: { errore: 'Le date devono essere AAAA-MM-GG' } };
    if (to < from) [from, to] = [to, from];
    if (D.daysBetween(from, to) > 120) to = D.addDaysISO(from, 120);
    const list = items(from, to).map(it => ({
      id: it.ev.id, titolo: it.ev.title, tipo: it.ev.type, data: it.date,
      giorno: D.fmt(it.date, { weekday: 'long' }),
      inizio: it.ev.start || undefined, fine: it.ev.end || undefined,
      luogo: it.ev.location || undefined, categoria: it.ev.category || undefined,
      ripetizione: recLabel(it.ev.recurrence) || undefined,
      promemoria: it.ev.reminders.length ? remindersLabel(it.ev.reminders) : undefined,
      progetto: it.ev.link ? (state.projects.find(p => p.id === it.ev.link.projectId) || {}).name : undefined,
      fatto: it.ev.type === 'appuntamento' ? undefined : it.done,
      note: perms.notes && it.ev.notes ? it.ev.notes : undefined,
    }));
    return { response: { dal: from, al: to, impegni: list, totale: list.length } };
  },

  create_event(a) {
    const e = eventFromArgs(a, { type: 'attivita' });
    const err = checkEvent(e);
    if (err) return { response: { errore: `Proposta non valida: ${err}` } };
    if (!e.reminders) e.reminders = state.settings.reminders[e.type] == null ? [] : [state.settings.reminders[e.type]];
    // la prima data deve cadere in uno dei giorni scelti
    if (e.recurrence && e.recurrence.days && e.recurrence.days.length) {
      const first = D.occurrences(normEvent(e), e.date, D.addDaysISO(e.date, 7))[0];
      if (first) e.date = first;
    }
    const p = proposal('create_event', e, `Nuovo ${TYPE[e.type].label.toLowerCase()}`, [
      `«${e.title}»`, when(e.date, e.start, e.end), e.location && `Luogo: ${e.location}`,
      e.recurrence && e.recurrence.freq !== 'none' && recLabel(normEvent(e).recurrence),
      `Promemoria: ${remindersLabel(normEvent(e).reminders)}`,
    ]);
    return { proposal: p, response: { stato: "in attesa di conferma dell'utente", proposta: p.lines.join(' · ') } };
  },

  update_event(a) {
    const ev = findEvent(a.id);
    if (!ev) return { response: { errore: 'Nessun impegno con questo id. Usa get_events per trovarlo.' } };
    const { id, ...rest } = a;
    const next = eventFromArgs(rest, JSON.parse(JSON.stringify(ev)));
    const err = checkEvent(next);
    if (err) return { response: { errore: `Proposta non valida: ${err}` } };
    const changes = [];
    if (next.title !== ev.title) changes.push(`Titolo: «${next.title}»`);
    if (next.date !== ev.date || next.start !== ev.start || next.end !== ev.end) changes.push(`Quando: ${when(next.date, next.start, next.end)}`);
    if (next.type !== ev.type) changes.push(`Tipo: ${TYPE[next.type].label}`);
    if (next.location !== ev.location) changes.push(`Luogo: ${next.location || 'nessuno'}`);
    if (next.notes !== ev.notes) changes.push('Note aggiornate');
    if (next.category !== ev.category) changes.push(`Categoria: ${next.category || 'nessuna'}`);
    if (JSON.stringify(normEvent(next).recurrence) !== JSON.stringify(ev.recurrence)) changes.push(`Ripetizione: ${recLabel(normEvent(next).recurrence) || 'nessuna'}`);
    if (JSON.stringify(normEvent(next).reminders) !== JSON.stringify(ev.reminders)) changes.push(`Promemoria: ${remindersLabel(normEvent(next).reminders)}`);
    if (!changes.length) return { response: { errore: 'Nessuna modifica rispetto a ora.' } };
    const p = proposal('update_event', { id: ev.id, data: next }, `Modifica «${ev.title}»`, changes);
    return { proposal: p, response: { stato: "in attesa di conferma dell'utente", proposta: changes.join(' · ') } };
  },

  delete_event({ id }) {
    const ev = findEvent(id);
    if (!ev) return { response: { errore: 'Nessun impegno con questo id.' } };
    const p = proposal('delete_event', { id }, 'Elimina impegno', [`«${ev.title}»`, when(ev.date, ev.start),
      ev.recurrence.freq !== 'none' && 'Anche tutte le ripetizioni']);
    return { proposal: p, response: { stato: "in attesa di conferma dell'utente" } };
  },

  get_projects(_, perms) {
    const t = D.todayISO();
    return { response: { progetti: state.projects.map(p => ({
      id: p.id, nome: p.name, stato: p.status, obiettivo: p.goal || undefined,
      descrizione: perms.notes ? p.description || undefined : undefined,
      scadenza: p.deadline || undefined,
      giorni_dall_ultima_attivita: D.daysBetween(D.toISO(new Date(p.lastActivityAt)), t),
      passaggi: p.steps.map(s => ({ id: s.id, testo: s.text, fatto: s.done })),
      note: perms.notes && p.notes ? p.notes : undefined,
    })) } };
  },

  create_project(a) {
    if (!a.name || !String(a.name).trim()) return { response: { errore: 'Manca il nome' } };
    if (a.deadline && !isDate(a.deadline)) return { response: { errore: 'Scadenza non valida (AAAA-MM-GG)' } };
    const steps = (Array.isArray(a.steps) ? a.steps : []).map(String).filter(s => s.trim()).slice(0, 30);
    const p = proposal('create_project', { ...a, steps }, 'Nuovo progetto', [
      `«${a.name}»`, a.goal && `Obiettivo: ${a.goal}`, a.deadline && `Entro ${D.fmt(a.deadline, { day: 'numeric', month: 'long' })}`,
      ...steps.map((s, i) => `${i + 1}. ${s}`),
    ]);
    return { proposal: p, response: { stato: "in attesa di conferma dell'utente" } };
  },

  update_project(a) {
    const pr = findProject(a.id);
    if (!pr) return { response: { errore: 'Nessun progetto con questo id. Usa get_projects.' } };
    if (a.deadline && !isDate(a.deadline)) return { response: { errore: 'Scadenza non valida' } };
    const lines = [];
    if (a.status && a.status !== pr.status) lines.push(`Stato: ${{ attivo: 'attivo', pausa: 'in pausa', completato: 'completato', archiviato: 'archiviato' }[a.status]}`);
    if (a.goal) lines.push(`Obiettivo: ${a.goal}`);
    if (a.deadline) lines.push(`Scadenza: ${D.fmt(a.deadline, { day: 'numeric', month: 'long' })}`);
    for (const s of a.add_steps || []) lines.push(`+ ${s}`);
    for (const sid of a.complete_step_ids || []) { const s = pr.steps.find(x => x.id === sid); if (s) lines.push(`✓ ${s.text}`); }
    if (!lines.length) return { response: { errore: 'Nessuna modifica valida.' } };
    const p = proposal('update_project', a, `Aggiorna «${pr.name}»`, lines);
    return { proposal: p, response: { stato: "in attesa di conferma dell'utente" } };
  },

  get_interests(_, perms) {
    return { response: { interessi: state.interests.map(i => ({
      id: i.id, nome: i.name, tipo: i.kind, stato: i.status,
      note: perms.notes && i.notes ? i.notes : undefined,
    })) } };
  },

  add_interest(a) {
    const name = String(a.name || '').trim();
    if (!name) return { response: { errore: 'Manca il nome' } };
    if (state.interests.some(i => i.name.toLowerCase() === name.toLowerCase())) return { response: { errore: 'Interesse già presente' } };
    const kind = a.kind === 'curiosita' ? 'curiosita' : 'stabile';
    const p = proposal('add_interest', { name, kind }, 'Nuovo interesse', [`«${name}»`, kind === 'curiosita' ? 'Curiosità del momento' : 'Interesse stabile']);
    return { proposal: p, response: { stato: "in attesa di conferma dell'utente" } };
  },

  update_interest(a) {
    const i = findInterest(a.id);
    if (!i) return { response: { errore: 'Nessun interesse con questo id.' } };
    const lines = [];
    if (a.kind && a.kind !== i.kind) lines.push(a.kind === 'curiosita' ? 'Diventa curiosità del momento' : 'Diventa interesse stabile');
    if (a.status && a.status !== i.status) lines.push(a.status === 'pausa' ? 'In pausa' : 'Di nuovo attivo');
    if (!lines.length) return { response: { errore: 'Nessuna modifica.' } };
    const p = proposal('update_interest', a, `«${i.name}»`, lines);
    return { proposal: p, response: { stato: "in attesa di conferma dell'utente" } };
  },
};

// ---------- Applicazione di una proposta confermata

export function applyProposal(p) {
  const a = p.args;
  const now = new Date().toISOString();
  switch (p.kind) {
    case 'create_event': {
      state.events.push(normEvent({ ...a, id: uid(), createdAt: now, updatedAt: now }));
      return 'Impegno aggiunto';
    }
    case 'update_event': {
      const ev = findEvent(a.id);
      if (!ev) throw new Error("L'impegno non esiste più");
      Object.assign(ev, normEvent({ ...ev, ...a.data, id: ev.id, done: ev.done }));
      touch(ev);
      return 'Impegno aggiornato';
    }
    case 'delete_event': {
      if (!findEvent(a.id)) throw new Error("L'impegno non esiste più");
      state.events = state.events.filter(e => e.id !== a.id);
      return 'Impegno eliminato';
    }
    case 'create_project': {
      state.projects.push(normProject({ name: a.name, goal: a.goal || '', description: a.description || '', deadline: a.deadline || '',
        steps: a.steps.map(text => ({ text })) }));
      return 'Progetto creato';
    }
    case 'update_project': {
      const pr = findProject(a.id);
      if (!pr) throw new Error('Il progetto non esiste più');
      if (a.status) pr.status = a.status;
      if (a.goal) pr.goal = String(a.goal);
      if (a.deadline) pr.deadline = a.deadline;
      for (const s of a.add_steps || []) pr.steps.push({ id: uid(), text: String(s), done: false });
      for (const sid of a.complete_step_ids || []) { const s = pr.steps.find(x => x.id === sid); if (s) s.done = true; }
      pr.lastActivityAt = now; pr.snoozedUntil = '';
      touch(pr);
      return 'Progetto aggiornato';
    }
    case 'add_interest': {
      state.interests.push(normInterest({ name: a.name, kind: a.kind }));
      return 'Interesse aggiunto';
    }
    case 'update_interest': {
      const i = findInterest(a.id);
      if (!i) throw new Error("L'interesse non esiste più");
      if (a.kind) i.kind = a.kind;
      if (a.status) i.status = a.status;
      i.lastTouchedAt = now;
      return 'Interesse aggiornato';
    }
    default: throw new Error('Proposta sconosciuta');
  }
}
