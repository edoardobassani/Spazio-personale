// Piccoli strumenti per l'interfaccia: icone, avvisi, pannelli, voce.

export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const P = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.2 8.8l-1.9 4.5-4.5 1.9 1.9-4.5z"/>',
  layers: '<path d="M12 3.5l8.5 4.7L12 13 3.5 8.2z"/><path d="M3.5 12.3L12 17l8.5-4.7"/><path d="M3.5 16.2L12 21l8.5-4.8"/>',
  spark: '<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2-5.2-1.8 5.2-1.8z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>',
  left: '<path d="M14.5 6l-6 6 6 6"/>',
  right: '<path d="M9.5 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  pin: '<path d="M12 21s-6-5.6-6-10.5a6 6 0 0112 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>',
  repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 11.5V10a4 4 0 014-4h12M7 21l-3-3 3-3"/><path d="M20 12.5V14a4 4 0 01-4 4H4"/>',
  bell: '<path d="M6.5 16v-5a5.5 5.5 0 0111 0v5l1.5 2h-14z"/><path d="M10 20.5a2 2 0 004 0"/>',
  flag: '<path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  play: '<path d="M8 5.5l11 6.5-11 6.5z"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/>',
};
export const icon = (n, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

let toastTimer;
export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); }
  // Se un pannello è aperto l'avviso va dentro, altrimenti resterebbe coperto
  const sheet = document.getElementById('sheet');
  const host = sheet && sheet.open ? sheet : document.body;
  if (el.parentNode !== host) host.appendChild(el);
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
}

// Pannello che sale dal basso (dialog nativo)
export function openSheet(html, onMount) {
  const d = document.getElementById('sheet');
  d.innerHTML = `<div class="sheet-inner">${html}</div>`;
  if (!d.open) d.showModal();
  d.scrollTop = 0;
  if (onMount) onMount(d);
  return d;
}
export function closeSheet() {
  const d = document.getElementById('sheet');
  if (d.open) d.close();
}

// Dettatura vocale (Chrome su Android usa il riconoscimento vocale di Google).
// Funziona "a mano libera": resta in ascolto anche durante le pause, finché
// non tocchi Invia (che manda il testo) o di nuovo il microfono (che si ferma
// e lascia il testo nel campo da correggere). Il telefono chiude da solo
// l'ascolto dopo un po' di silenzio: in quel caso lo riavvio senza perdere niente.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;
let session = null;

export const isDictating = () => !!session;

export function stopDictation() {
  if (!session) return '';
  const s = session;
  session = null;
  s.active = false;
  try { s.rec.abort(); } catch (_) { /* già fermo */ }
  s.button.classList.remove('listening');
  s.button.setAttribute('aria-label', 'Detta');
  s.input.placeholder = s.input.dataset.placeholder || '';
  s.input.value = s.text().trim();
  return s.input.value;
}

export function dictate(input, button) {
  if (!SR) { toast('La dettatura non è disponibile su questo browser'); return; }
  if (session) {
    const same = session.input === input;
    stopDictation();
    if (same) { input.focus(); return; } // secondo tocco sul microfono: mi fermo
  }
  const before = input.value.trim();
  const s = {
    input, button, active: true, committed: before ? before + ' ' : '', interim: '', lastFinal: '', restarts: 0,
    text() { return (this.committed + this.interim).replace(/\s+/g, ' ').replace(/^\s/, ''); },
  };
  const join = (a, b) => (a && !/\s$/.test(a) ? a + ' ' : a) + b.trim();
  const start = () => {
    const rec = new SR();
    rec.lang = 'it-IT';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    s.rec = rec;
    rec.onresult = e => {
      if (!s.active) return;
      s.interim = '';
      for (let k = e.resultIndex; k < e.results.length; k++) {
        const t = e.results[k][0].transcript.trim();
        if (!t) continue;
        if (e.results[k].isFinal) {
          // Su alcuni Android il risultato finale ripete anche le frasi precedenti
          if (s.lastFinal && t.toLowerCase().startsWith(s.lastFinal.toLowerCase())) {
            s.committed = join(s.committed.slice(0, s.committed.length - s.lastFinal.length - 1).trimEnd(), t);
          } else s.committed = join(s.committed, t);
          s.committed += ' ';
          s.lastFinal = t;
        } else s.interim = join(s.interim, t);
      }
      input.value = s.text();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      s.restarts = 0;
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('Serve il permesso per usare il microfono'); stopDictation(); }
      else if (e.error === 'network') { toast('La dettatura richiede la connessione'); stopDictation(); }
      else if (e.error === 'audio-capture') { toast('Non trovo il microfono'); stopDictation(); }
      // "no-speech" e "aborted" sono normali durante le pause: si riparte da onend
    };
    rec.onend = () => {
      if (!s.active || session !== s) return;
      // Fine di un tratto: fisso il testo provvisorio e riprendo ad ascoltare
      if (s.interim) { s.committed = join(s.committed, s.interim) + ' '; s.interim = ''; }
      s.lastFinal = '';
      input.value = s.text();
      if (++s.restarts > 8) { toast('Dettatura in pausa: tocca il microfono per riprendere'); stopDictation(); return; }
      setTimeout(() => { if (s.active && session === s) { try { start(); } catch (_) { stopDictation(); } } }, 250);
    };
    rec.start();
  };
  session = s;
  button.classList.add('listening');
  button.setAttribute('aria-label', 'Ferma la dettatura');
  input.placeholder = 'Ti ascolto… tocca Invia quando hai finito';
  try { start(); } catch (err) { stopDictation(); toast('Dettatura non riuscita, riprova'); }
}

// Se lasci la schermata o l'app, la dettatura si ferma
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') stopDictation(); });
