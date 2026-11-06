// Inserimento rapido: interpreta frasi come "dentista il 20 novembre alle 15".
// Non usa l'AI: riconosce date, orari e tipo con regole semplici.
// Il risultato viene sempre mostrato in un modulo da confermare.
import { toISO, addDays, pad } from './dates.js?v=2.1.2';

const MONTHS = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8,
  settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
  gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, sett: 9, ott: 10, nov: 11, dic: 12,
};
const WD = { domenica: 0, lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6 };
const NUM = { un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, dieci: 10 };

// Minuscole e senza accenti, mantenendo la stessa lunghezza del testo originale
const fold = s => s.toLowerCase()
  .replace(/[àáâä]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
  .replace(/[òóôö]/g, 'o').replace(/[ùúûü]/g, 'u');

export function parseQuick(input, now = new Date()) {
  let orig = ` ${input.trim()} `;
  let lc = fold(orig);
  const cut = m => {
    const s = m.index, e = s + m[0].length, blank = ' '.repeat(e - s);
    orig = orig.slice(0, s) + blank + orig.slice(e);
    lc = lc.slice(0, s) + blank + lc.slice(e);
  };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const notes = [];
  let date = null, start = '', end = '', m;

  // Tipo, deciso prima di togliere le parole dal testo
  let type = null;
  if (/\b(scadenza|scade|scadono|entro|pagare|pagamento|bolletta|rinnovo|rinnovare|consegnare)\b/.test(lc)) type = 'scadenza';
  else if (/\b(dentista|medico|visita|appuntamento|riunione|incontro|cena|pranzo|colloquio|aperitivo|parrucchiere|barbiere|meccanico|veterinario)\b/.test(lc)) type = 'appuntamento';

  // ---- Data
  const mn = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
  if ((m = lc.match(new RegExp(`\\b(?:(?:entro |per )?(?:il |l')|entro )?(\\d{1,2}) (${mn})\\b(?: (\\d{4}))?`)))) {
    const d = +m[1], mo = MONTHS[m[2]];
    let y = m[3] ? +m[3] : today.getFullYear();
    let dt = new Date(y, mo - 1, d);
    if (!m[3] && dt < today) dt = new Date(y + 1, mo - 1, d);
    if (dt.getDate() === d) { date = toISO(dt); cut(m); }
  } else if ((m = lc.match(/\b(?:(?:entro |per )?il )?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/))) {
    const d = +m[1], mo = +m[2];
    let y = m[3] ? +m[3] : today.getFullYear();
    if (y < 100) y += 2000;
    let dt = new Date(y, mo - 1, d);
    if (!m[3] && dt < today) dt = new Date(y + 1, mo - 1, d);
    if (dt.getDate() === d && dt.getMonth() === mo - 1) { date = toISO(dt); cut(m); }
  } else if ((m = lc.match(/\b(?:entro |per )?(dopodomani|domani|oggi|stasera|stamattina|stanotte)\b/))) {
    const k = m[1];
    date = toISO(addDays(today, k === 'dopodomani' ? 2 : k === 'domani' ? 1 : 0));
    if (k === 'stasera') notes.push('stasera');
    cut(m);
  } else if ((m = lc.match(/\btra (\d+|un|una|uno|due|tre|quattro|cinque|sei|sette|otto|dieci) (giorn[oi]|settiman[ae]|mes[ei])\b/))) {
    const n = NUM[m[1]] || +m[1];
    if (m[2].startsWith('giorn')) date = toISO(addDays(today, n));
    else if (m[2].startsWith('settim')) date = toISO(addDays(today, 7 * n));
    else { const dt = new Date(today); dt.setMonth(dt.getMonth() + n); date = toISO(dt); }
    cut(m);
  } else if ((m = lc.match(/\b(?:(?:entro |per )?(?:il |la )?(?:prossim[oa] |quest[oa] )?)(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)(?: prossim[oa])?\b/))) {
    const wd = WD[m[1]];
    const diff = (wd - today.getDay() + 7) % 7 || 7;
    date = toISO(addDays(today, diff));
    cut(m);
  }

  // ---- Orario
  const qual = () => {
    const q = lc.match(/\b(?:del|di|nel) (pomeriggio|sera|mattina|mattino)\b/);
    if (q) { cut(q); return q[1]; }
    return null;
  };
  const mk = (h, mi = 0, q = null) => {
    h = +h; mi = +mi || 0;
    if (q && /pomeriggio|sera/.test(q) && h < 12) h += 12;
    if (h > 23 || mi > 59) return '';
    return `${pad(h)}:${pad(mi)}`;
  };
  const amb = h => { if (+h >= 1 && +h <= 7) notes.push(`Controlla l'orario: ho capito ${pad(+h)}:00 del mattino.`); };
  if ((m = lc.match(/\bdalle (\d{1,2})(?:[:.](\d{2}))? alle (\d{1,2})(?:[:.](\d{2}))?\b/))) {
    cut(m); const q = qual();
    start = mk(m[1], m[2], q); end = mk(m[3], m[4], q);
    if (!q) amb(m[1]);
  } else if ((m = lc.match(/\ba mezzogiorno\b/))) { cut(m); start = '12:00'; }
  else if ((m = lc.match(/\b(?:alle ore|alle|ore|verso le|per le|all')\s?(\d{1,2})(?:[:.](\d{2}))?(?: e (mezza|un quarto|trenta|quindici))?\b/))) {
    cut(m); const q = qual();
    const extra = m[3] === 'mezza' || m[3] === 'trenta' ? 30 : m[3] ? 15 : 0;
    start = mk(m[1], m[2] ? +m[2] : extra, q);
    if (!q && !m[2]) amb(m[1]);
  } else if ((m = lc.match(/\b(\d{1,2})[:.](\d{2})\b/))) { cut(m); start = mk(m[1], m[2]); }

  if (!type) type = start ? 'appuntamento' : 'attivita';

  // ---- Titolo: quello che resta
  let title = orig.replace(/\s+/g, ' ').trim();
  title = title.replace(/^(ricordami (?:di|che devo|che)|ricordarmi di|ricorda(?:mi)? di|ricordami|devo|promemoria:?|aggiungi|segna(?:mi)?|appunta(?:mi)?)\s+/i, '');
  for (let i = 0; i < 3; i++) title = title.replace(/\s+(il|lo|la|l'|alle|ore|per|entro|di|a|e|da|del)\s*$/i, '').trim();
  title = title.replace(/^(il|lo|la|di)\s+/i, '');
  if (title) title = title[0].toUpperCase() + title.slice(1);

  const ix = notes.indexOf('stasera');
  if (ix >= 0) notes.splice(ix, 1, ...(start ? [] : ['Ho capito "stasera": se vuoi, aggiungi un orario.']));
  if (!date) {
    const nowHM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (start && start <= nowHM) {
      date = toISO(addDays(today, 1));
      notes.push(`Non ho trovato una data e le ${start} di oggi sono già passate: ho messo domani.`);
    } else {
      date = toISO(today);
      notes.push('Non ho trovato una data: ho messo oggi.');
    }
  }
  return { title, date, start, end, type, notes };
}
