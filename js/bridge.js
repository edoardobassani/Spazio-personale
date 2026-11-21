// Ponte con l'assistente su Claude (un artifact su claude.ai).
// Andata: Spazio copia negli appunti i dati scelti e apre l'assistente.
// Ritorno: l'assistente copia le proposte; Spazio le legge, le controlla e le fa confermare.
import { state, commit, discoveriesOf } from './store.js?v=2.8.2';
import * as D from './dates.js?v=2.8.2';
import { esc, icon, toast, openSheet, closeSheet, voiceSupported } from './ui.js?v=2.8.2';
import { items, recLabel, remindersLabel } from './views.js?v=2.8.2';
import { learnedSummary } from './learn.js?v=2.8.2';
import { runTool, applyProposal } from './ai/tools.js?v=2.8.2';

export const CLAUDE_URL = 'https://claude.ai/artifact/AekZm9tnac6HCS7h1mpjUo';
const OUT_HEAD = 'SPAZIO>CLAUDE';
const IN_HEAD = 'CLAUDE>SPAZIO';
const PENDING = 'spazio-ponte-attesa';
const DONE = 'spazio-ponte-importati';
const ALL = { events: true, projects: true, interests: true, notes: true, learning: true, web: false };

const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* niente */ } },
};
const opts = () => state.settings.bridge;
const ui = { draft: '' };
export const setDraft = t => { ui.draft = t; };

// ---------- Andata: i dati per Claude

const WEEK = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

export function buildPackage(request, force = {}) {
  const o = { ...opts(), ...force };
  const t = D.todayISO();
  const now = new Date();
  const d = state.settings.day;
  const notes = o.notes;
  const pkg = {
    app: 'spazio', v: 1,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    creato: now.toISOString(),
    richiesta: String(request || '').trim(),
    oggi: t, giorno: WEEK[now.getDay()],
    ora: `${D.pad(now.getHours())}:${D.pad(now.getMinutes())}`,
    fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
    giornata: {
      sveglia: d.wake, a_letto: d.sleep,
      lavoro: d.workStart && d.workEnd ? `${d.workDays.map(n => WEEK[n]).join(', ')} dalle ${d.workStart} alle ${d.workEnd}` : 'orari variabili',
    },
  };
  if (state.settings.ai.about.trim()) pkg.su_di_me = state.settings.ai.about.trim();
  if (state.settings.learning.enabled) { const l = learnedSummary(); if (l) pkg.preferenze_apprese = l; }
  if (o.events) {
    pkg.impegni = items(D.addDaysISO(t, -3), D.addDaysISO(t, 13)).map(it => ({
      id: it.ev.id, titolo: it.ev.title, tipo: it.ev.type, data: it.date, giorno: WEEK[D.parseISO(it.date).getDay()],
      inizio: it.ev.start || undefined, fine: it.ev.end || undefined, luogo: it.ev.location || undefined,
      categoria: it.ev.category || undefined, ripetizione: recLabel(it.ev.recurrence) || undefined,
      promemoria: it.ev.reminders.length ? remindersLabel(it.ev.reminders) : undefined,
      fatto: it.ev.type === 'appuntamento' ? undefined : it.done || undefined,
      note: notes && it.ev.notes ? it.ev.notes : undefined,
    }));
    // Più avanti: solo gli impegni singoli, per domande come "quando ho il dentista?"
    pkg.piu_avanti = items(D.addDaysISO(t, 14), D.addDaysISO(t, 365)).filter(it => it.ev.recurrence.freq === 'none')
      .slice(0, 60).map(it => ({ id: it.ev.id, titolo: it.ev.title, tipo: it.ev.type, data: it.date, inizio: it.ev.start || undefined }));
  }
  if (o.projects) {
    pkg.progetti = state.projects.filter(p => p.status === 'attivo' || p.status === 'pausa').map(p => ({
      id: p.id, nome: p.name, stato: p.status, obiettivo: p.goal || undefined, scadenza: p.deadline || undefined,
      fermo_da_giorni: D.daysBetween(D.toISO(new Date(p.lastActivityAt)), t),
      passaggi: p.steps.map(s => ({ id: s.id, testo: s.text, fatto: s.done })),
      descrizione: notes && p.description ? p.description : undefined, note: notes && p.notes ? p.notes : undefined,
    }));
  }
  if (o.projects || o.interests) {
    pkg.interessi = state.interests.map(i => {
      const mine = discoveriesOf(i).map(d => d.x);
      const fatti = mine.filter(x => x.status === 'fatto').slice(-25);
      return {
        id: i.id, nome: i.name, tipo: i.kind, stato: i.status, note: notes && i.notes ? i.notes : undefined,
        da_scoprire: mine.filter(x => x.status === 'da').slice(-40).map(x => `${x.title}${x.by ? ' – ' + x.by : ''} (${x.type})`),
        gia_fatti: fatti.length ? fatti.map(x => `${x.title}${x.by ? ' – ' + x.by : ''}${x.rating === 'piaciuto' ? ': gli è piaciuto' : x.rating === 'no' ? ': non gli è piaciuto' : ''}`) : undefined,
      };
    });
    if (state.saved.length) pkg.salvati_per_dopo = state.saved.slice(0, 15).map(s => s.title);
  }
  return `${OUT_HEAD} 1\n${JSON.stringify(pkg)}`;
}

function counts() {
  const t = D.todayISO();
  return {
    events: items(D.addDaysISO(t, -3), D.addDaysISO(t, 13)).length,
    projects: state.projects.filter(p => p.status === 'attivo' || p.status === 'pausa').length,
    interests: state.interests.length,
  };
}

// Copia i dati e lascia proseguire il collegamento verso Claude (stesso tocco)
export function goToClaude(link) {
  // Richiesta pronta sul pulsante (per esempio «Scopri con Claude») oppure scritta nel campo
  const preset = link.dataset.request;
  const form = preset ? null : link.closest('main').querySelector('[data-form=bridge]');
  const text = buildPackage(preset || (form ? form.q.value : ''), link.dataset.with === 'interests' ? { interests: true } : {});
  const ok = navigator.clipboard && navigator.clipboard.writeText
    ? navigator.clipboard.writeText(text).then(() => true, () => false) : Promise.resolve(false);
  ls.set(PENDING, { at: Date.now() });
  if (form) form.q.value = '';
  ui.draft = '';
  ok.then(done => {
    if (!done) {
      // Appunti non disponibili: mostro il testo da copiare a mano
      openSheet(`<div class="sheet-head"><h2>Copia i dati</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
        <p class="hint">Il telefono non mi ha permesso di copiarli da solo. Tieni premuto sul testo, scegli Seleziona tutto e poi Copia.</p>
        <textarea class="manual" readonly>${esc(text)}</textarea>`, s => s.querySelector('textarea').select());
    }
  });
}

// ---------- Schermata Assistente

const CHIPS = [
  'Organizzami la settimana',
  'Cosa potrei fare sabato?',
  'Ti mando uno screenshot: aggiungi gli eventi che trovi',
  'Consigliami un argomento da approfondire stasera',
];

export function renderBridge() {
  const o = opts();
  const c = counts();
  const row = (key, label, sub) => `<label class="toggle"><input type="checkbox" data-bridge-opt="${key}"${o[key] ? ' checked' : ''}><span><strong>${label}</strong><small>${sub}</small></span></label>`;
  return `<section class="view">
    <header class="page-head"><h1>Assistente</h1></header>
    <p class="intro">Scrivi o detta cosa ti serve: si apre Claude con i dati che scegli qui sotto. Le proposte tornano qui e le confermi tu.</p>
    <form class="bridge-form" data-form="bridge">
      <label class="field" for="bridge-q"><span>Cosa chiedi a Claude</span></label>
      <div class="bridge-box">
        <textarea id="bridge-q" name="q" rows="3" placeholder="Es. organizzami la settimana" data-placeholder="Es. organizzami la settimana">${esc(ui.draft)}</textarea>
        ${voiceSupported ? `<button type="button" class="icon-btn mic" data-action="voice" aria-label="Detta">${icon('mic')}</button>` : ''}
      </div>
    </form>
    <div class="chips">${CHIPS.map(t => `<button class="chip-btn" data-action="bridge-chip" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <h2 class="sec">Cosa mando a Claude</h2>
    <div class="toggles">
      ${row('events', 'Impegni', `Prossime due settimane: ${c.events === 1 ? '1 impegno' : c.events + ' impegni'}`)}
      ${row('projects', 'Progetti e interessi', `${c.projects} progetti in corso, ${c.interests} interessi`)}
      ${row('notes', 'Note personali', o.notes ? 'Incluse' : 'Escluse finché non le attivi')}
    </div>
    <a class="btn primary bridge-go" href="${CLAUDE_URL}" target="_blank" rel="noopener" data-action="bridge-go">${icon('spark', 'xs')} Apri in Claude</a>
    <p class="hint center">I dati vengono copiati: in Claude tieni premuto nel riquadro e scegli Incolla.</p>
    <button class="btn bridge-in" data-action="bridge-import">${icon('download', 'xs')} Incolla le proposte di Claude</button>
    <p class="hint center"><a href="#chat">Usa invece l'assistente con chiave API</a></p>
  </section>`;
}

// ---------- Ritorno: le proposte di Claude

function parseIncoming(text) {
  const t = String(text || '').trim();
  const i = t.indexOf(IN_HEAD);
  if (i < 0) throw new Error(t.includes(OUT_HEAD) ? 'Questi sono i dati che Spazio manda a Claude, non le proposte. In Claude tocca «Manda a Spazio».' : 'Non trovo proposte di Claude negli appunti. In Claude tocca «Manda a Spazio» e riprova.');
  const body = t.slice(i);
  const obj = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
  if (!obj || !Array.isArray(obj.azioni)) throw new Error('Le proposte incollate sono incomplete. Copiale di nuovo da Claude.');
  return obj;
}

async function review(pkg, sheet) {
  const done = ls.get(DONE) || [];
  const rows = [];
  for (const a of pkg.azioni.slice(0, 30)) {
    const out = a && a.tipo ? await runTool(a.tipo, a.args || {}, ALL) : { response: { errore: 'Proposta senza tipo' } };
    rows.push(out.proposal ? { p: out.proposal, a } : { err: out.response && out.response.errore || 'Proposta non valida', a });
  }
  const valid = rows.filter(r => r.p);
  const again = done.includes(pkg.id);
  sheet.querySelector('.bridge-body').innerHTML = `
    ${again ? '<p class="error">Queste proposte le hai già aggiunte. Se le confermi di nuovo, saranno doppie.</p>' : ''}
    ${rows.length ? `<div class="toggles">${rows.map((r, i) => r.p ? `<label class="toggle top">
        <input type="checkbox" data-row="${i}"${again ? '' : ' checked'}>
        <span><strong>${esc(r.p.title)}</strong>${r.p.lines.map(l => `<small>${esc(l)}</small>`).join('')}</span></label>`
      : `<div class="toggle top invalid"><span><strong>${esc(r.a && r.a.titolo || 'Proposta')}</strong><small>Non valida: ${esc(r.err)}</small></span></div>`).join('')}</div>`
      : '<p class="hint">Il pacchetto non contiene proposte.</p>'}
    <div class="actions">
      <button type="button" class="btn ghost" data-close>Non ora</button>
      <button type="button" class="btn primary" data-apply${valid.length ? '' : ' disabled'}>Aggiungi all'agenda</button>
    </div>`;
  const btn = sheet.querySelector('[data-apply]');
  const sync = () => {
    const n = sheet.querySelectorAll('[data-row]:checked').length;
    btn.disabled = !n;
    btn.textContent = n ? `Aggiungi ${n === 1 ? '1 proposta' : n + ' proposte'}` : 'Aggiungi all\'agenda';
  };
  sheet.querySelectorAll('[data-row]').forEach(c => c.addEventListener('change', sync));
  sync();
  btn.addEventListener('click', () => {
    let ok = 0; const fails = [];
    sheet.querySelectorAll('[data-row]:checked').forEach(c => {
      const r = rows[+c.dataset.row];
      try { applyProposal(r.p); ok++; } catch (e) { fails.push(`${r.p.title}: ${e.message}`); }
    });
    if (pkg.id) ls.set(DONE, [pkg.id, ...done.filter(x => x !== pkg.id)].slice(0, 30));
    ls.set(PENDING, null);
    closeSheet(); commit();
    toast(fails.length ? `Aggiunte ${ok}. Non riuscite: ${fails.join('; ')}` : ok === 1 ? 'Aggiunta 1 proposta' : `Aggiunte ${ok} proposte`, fails.length ? 'bad' : '');
  });
}

async function take(text, sheet) {
  const err = sheet.querySelector('.error.paste-err');
  try {
    const pkg = parseIncoming(text);
    await review(pkg, sheet);
  } catch (e) {
    err.textContent = e.message && !/JSON|token|position/i.test(e.message) ? e.message : 'Non riesco a leggere le proposte. Copiale di nuovo da Claude.';
    err.hidden = false;
  }
}

export function openImport() {
  openSheet(`
    <div class="sheet-head"><h2>Proposte da Claude</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('close')}</button></div>
    <div class="bridge-body">
      <p class="hint">In Claude hai toccato «Manda a Spazio»? Le proposte sono negli appunti.</p>
      <button type="button" class="btn primary wide" data-paste>${icon('download', 'xs')} Incolla le proposte</button>
      <p class="hint">Se non funziona, tieni premuto nel riquadro e scegli Incolla.</p>
      <textarea class="paste-area" placeholder="Tieni premuto qui e scegli Incolla" aria-label="Proposte di Claude"></textarea>
      <p class="error paste-err" hidden></p>
      <div class="actions"><button type="button" class="btn ghost" data-close>Non ora</button></div>
    </div>`, sheet => {
    sheet.querySelector('[data-paste]').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        await take(text, sheet);
      } catch (e) {
        const err = sheet.querySelector('.paste-err');
        err.textContent = 'Il telefono non mi ha permesso di leggere gli appunti: tieni premuto nel riquadro e scegli Incolla.';
        err.hidden = false;
      }
    });
    const area = sheet.querySelector('.paste-area');
    area.addEventListener('paste', e => {
      const t = e.clipboardData && e.clipboardData.getData('text');
      if (t) { e.preventDefault(); take(t, sheet); }
    });
    area.addEventListener('input', () => { if (area.value.includes(IN_HEAD)) take(area.value, sheet); });
  });
}

// Tornando da Claude subito dopo esserci andati, propongo di incollare
export function maybePromptReturn() {
  const p = ls.get(PENDING);
  if (!p || Date.now() - p.at > 3 * 3600e3 || Date.now() - p.at < 3000) return;
  const sheet = document.getElementById('sheet');
  if (sheet && sheet.open) return;
  ls.set(PENDING, null); // lo chiedo una volta sola; resta il pulsante nella schermata Assistente
  openImport();
}

export const actions = {
  'bridge-go': el => goToClaude(el),
  'bridge-chip': el => {
    const q = document.querySelector('[data-form=bridge] [name=q]');
    if (q) { q.value = el.dataset.text; q.focus(); }
  },
  'bridge-import': () => openImport(),
  'ask-claude': el => { ui.draft = el.dataset.text || ''; location.hash = '#assistente'; },
};

// Le opzioni "cosa mando" si salvano subito
document.addEventListener('change', e => {
  const c = e.target.closest('[data-bridge-opt]');
  if (!c) return;
  opts()[c.dataset.bridgeOpt] = c.checked;
  commit();
});
