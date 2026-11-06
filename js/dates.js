// Utilità per le date. Tutte le date sono stringhe "AAAA-MM-GG" in ora locale.

export const pad = n => String(n).padStart(2, '0');
export const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
export const addDaysISO = (iso, n) => toISO(addDays(parseISO(iso), n));
export const todayISO = () => toISO(new Date());
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
export const startOfWeekISO = iso => { const d = parseISO(iso); return toISO(addDays(d, -((d.getDay() + 6) % 7))); };
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
export const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const fmt = (iso, o) => parseISO(iso).toLocaleDateString('it-IT', o);

// Data e ora come oggetto Date
export function at(iso, time) {
  const d = parseISO(iso);
  if (time) { const [h, mi] = time.split(':').map(Number); d.setHours(h, mi, 0, 0); }
  return d;
}

export function relDay(iso) {
  const n = daysBetween(todayISO(), iso);
  if (n === 0) return 'Oggi';
  if (n === 1) return 'Domani';
  if (n === -1) return 'Ieri';
  if (n > 1 && n < 7) return cap(fmt(iso, { weekday: 'long' }));
  return cap(fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' }));
}

export function inDays(iso) {
  const n = daysBetween(todayISO(), iso);
  if (n === 0) return 'oggi';
  if (n === 1) return 'domani';
  if (n === -1) return 'ieri';
  if (n < 0) return `${-n} giorni fa`;
  if (n < 14) return `tra ${n} giorni`;
  if (n < 60) return `tra ${Math.round(n / 7)} settimane`;
  return `tra ${Math.round(n / 30)} mesi`;
}

// Restituisce le date (ISO) in cui un impegno cade nell'intervallo [from, to].
export function occurrences(ev, from, to) {
  const ex = ev.exdates && ev.exdates.length ? new Set(ev.exdates) : null;
  const list = rawOccurrences(ev, from, to);
  return ex ? list.filter(d => !ex.has(d)) : list;
}

function rawOccurrences(ev, from, to) {
  if (!ev.date) return [];
  const r = ev.recurrence || {};
  const freq = r.freq || 'none';
  if (freq === 'none') return ev.date >= from && ev.date <= to ? [ev.date] : [];
  const end = r.until && r.until < to ? r.until : to;
  if (ev.date > end) return [];
  const step = Math.max(1, parseInt(r.interval, 10) || 1);
  const out = [];
  let guard = 0;
  if (freq === 'weekly' && r.days && r.days.length) {
    // Più giorni nella settimana (es. lunedì, mercoledì e venerdì)
    const span = 7 * step;
    const ws = startOfWeekISO(ev.date);
    const offs = r.days.map(d => (d + 6) % 7).sort((a, b) => a - b);
    let k = ev.date < from ? Math.max(0, Math.floor(daysBetween(ws, from) / span) - 1) : 0;
    while (guard++ < 5000) {
      const w = addDaysISO(ws, k * span);
      if (w > end) break;
      for (const o of offs) {
        const iso = addDaysISO(w, o);
        if (iso >= ev.date && iso >= from && iso <= end) out.push(iso);
      }
      k++;
    }
  } else if (freq === 'daily' || freq === 'weekly') {
    const span = freq === 'daily' ? step : 7 * step;
    let k = ev.date < from ? Math.floor(daysBetween(ev.date, from) / span) : 0;
    let cur = addDaysISO(ev.date, k * span);
    while (cur <= end && guard++ < 5000) {
      if (cur >= from) out.push(cur);
      k++;
      cur = addDaysISO(ev.date, k * span);
    }
  } else {
    const months = freq === 'monthly' ? step : 12 * step;
    const s = parseISO(ev.date);
    const day = s.getDate();
    const f = parseISO(from);
    const diff = (f.getFullYear() - s.getFullYear()) * 12 + f.getMonth() - s.getMonth();
    let k = Math.max(0, Math.floor(diff / months) - 1);
    while (guard++ < 5000) {
      const tm = s.getMonth() + k * months;
      const y = s.getFullYear() + Math.floor(tm / 12);
      const m = tm % 12;
      if (toISO(new Date(y, m, 1)) > end) break;
      // Se il giorno non esiste in quel mese (es. 31 aprile) quel mese viene saltato
      if (day <= daysInMonth(y, m)) {
        const iso = toISO(new Date(y, m, day));
        if (iso >= from && iso <= end && iso >= ev.date) out.push(iso);
      }
      k++;
    }
  }
  return out;
}
