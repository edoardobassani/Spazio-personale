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

// Dettatura vocale (Chrome su Android usa il riconoscimento vocale di Google)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;
let rec = null;
export function dictate(input, button, onFinal) {
  if (!SR) { toast('La dettatura non è disponibile su questo browser'); return; }
  if (rec) { rec.stop(); return; }
  rec = new SR();
  rec.lang = 'it-IT';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finalText = '';
  button.classList.add('listening');
  input.placeholder = 'Ti ascolto…';
  rec.onresult = e => {
    let text = '';
    for (const r of e.results) text += r[0].transcript;
    input.value = text;
    if (e.results[e.results.length - 1].isFinal) finalText = text;
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Serve il permesso per usare il microfono');
    else if (e.error === 'no-speech') toast('Non ho sentito niente, riprova');
    else if (e.error === 'network') toast('La dettatura richiede la connessione');
    else if (e.error !== 'aborted') toast('Dettatura non riuscita, riprova');
  };
  rec.onend = () => {
    button.classList.remove('listening');
    input.placeholder = input.dataset.placeholder || '';
    rec = null;
    const t = (finalText || input.value).trim();
    if (t && onFinal) onFinal(t);
  };
  try { rec.start(); } catch (err) { rec = null; button.classList.remove('listening'); toast('Dettatura non riuscita, riprova'); }
}
