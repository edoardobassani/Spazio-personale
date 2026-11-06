# Spazio personale — v2.4

Assistente personale per organizzare impegni, progetti e interessi. È una PWA: si apre dal browser e si installa sulla schermata Home.

**Indirizzo:** https://edoardobassani.github.io/Spazio-personale/

## Cosa funziona davvero

**Oggi**
- Data, saluto e riepilogo della giornata.
- Impegni di oggi, scadenze passate non completate, prossimi 7 giorni.
- Promemoria attivi: un impegno compare in "Da ricordare" quando inizia il suo anticipo (es. il giorno prima).
- **Tempo libero**: per oggi, domani o il weekend l'app calcola gli intervalli liberi tra sveglia, lavoro, impegni e ora di andare a letto (orari in Impostazioni → Le tue giornate).
- **Proponimi qualcosa**: fino a tre proposte che stanno nel tempo libero, con durata, costo, perché e un pulsante per metterle in agenda. Con l'assistente collegato sono su misura; senza, vengono da progetti, interessi e cose salvate. Hanno un aspetto diverso dai tuoi impegni.
- Su ogni proposta: *Mi interessa*, *Non fa per me*, *Già lo so*, *Dopo* (finisce in Interessi → Salvati per dopo).

**Impegni**
- Tre tipi: appuntamento, attività (si può spuntare), scadenza (si può spuntare).
- Titolo, data, ora di inizio e fine, luogo, categoria, note.
- Ripetizioni: ogni giorno, settimana, mese o anno, ogni N, con data di fine facoltativa. Le ripetizioni settimanali possono cadere su più giorni (es. lunedì, mercoledì e venerdì).
- Per un impegno che si ripete puoi modificare o eliminare **solo una volta**, **quella e le successive** oppure **tutte**.
- Fino a cinque promemoria per impegno (es. il giorno prima e un'ora prima), con anticipo predefinito diverso per ogni tipo. Quando scatta il promemoria più vicino, l'impegno viene evidenziato con il tempo che manca.
- Viste giorno, settimana e mese.
- Inserimento rapido: frasi come «dentista il 20 novembre alle 15», «chiamare il commercialista venerdì» o «palestra lunedì, mercoledì e venerdì alle 18» vengono interpretate (date, orari, ripetizioni) e mostrate in un modulo da confermare.
- Dettatura vocale nella barra di inserimento rapido (Chrome su Android).

**Progetti**
- Nome, obiettivo, descrizione, scadenza, note.
- Passaggi da spuntare, con barra di avanzamento e "prossimo passo" visibile.
- Ogni passaggio si può fissare in agenda: quando segni fatto l'impegno, il passaggio si spunta anche nel progetto.
- Stati: attivo, in pausa, completato, archiviato.
- Se un progetto è fermo da almeno due settimane, la schermata Oggi può proporre di riprenderlo. Con "Non ora" la proposta sparisce per due settimane. Nessuna serie, nessun punteggio.

**Interessi**
- Interessi stabili e curiosità del momento.
- Pausa e ripresa, note, modifica ed eliminazione.
- Salvati per dopo: da mettere in agenda, segnare come fatti o togliere.

**Cosa ho imparato di te** (Interessi → in fondo)
- L'app impara dalle risposte alle proposte (anche quelle ignorate contano poco) e dagli impegni che segni come fatti: temi che ti interessano, temi che scarti, abitudini (es. «Palestra: di solito verso le 18, lun, mer, ven»).
- Tutto è visibile: puoi far dimenticare una singola cosa, cancellare tutto o mettere in pausa l'apprendimento.
- Le proposte e l'assistente lo usano come indicazione, se gli dai il permesso.

**Assistente (Google Gemini, piano gratuito)**
- Conversazione scritta o dettata, con lettura facoltativa delle risposte ad alta voce (voce del telefono).
- Legge agenda, progetti e interessi, solo se gli dai il permesso. Le note personali sono escluse se non le attivi.
- Può preparare impegni, modifiche, progetti con passaggi e interessi: compaiono come **proposte** da confermare o annullare. Nulla viene salvato senza il tuo tocco.
- Sceglie da solo il miglior modello Flash disponibile e passa a un altro se quello scelto non è gratuito.
- La chiave API resta solo sul dispositivo e non finisce nei backup.
- **Ricerca sul web**: l'assistente può cercare quando serve e mostra le fonti sotto la risposta. Usa la ricerca Google di Gemini se la chiave la consente (di solito serve un account con fatturazione); altrimenti Wikipedia in italiano, gratuita ma senza notizie, eventi o orari aggiornati, e l'assistente lo dice. Si può disattivare nelle impostazioni dell'assistente.
- Con il piano gratuito Google può usare le conversazioni per migliorare i suoi servizi.

**Ricerca nell'app**
- Lente in alto: trova impegni, progetti, interessi e salvati, cercando anche in luoghi, note e passaggi dei progetti, senza badare agli accenti.

**Dati**
- Tutto è salvato solo sul dispositivo.
- Backup scaricabile in un file e ripristino da file (Impostazioni).
- Protezione dei dati dalla pulizia automatica del browser.
- I dati della versione 0.1 vengono importati da soli al primo avvio e la loro copia originale non viene cancellata.
- Funziona anche senza connessione dopo la prima apertura.

## Cosa non c'è ancora

- **Notifiche sul telefono ad app chiusa.** I promemoria compaiono quando apri l'app. Per notifiche affidabili su Android serve un piccolo servizio esterno (fase 3).
- **Notizie ed eventi aggiornati con il piano gratuito**: Wikipedia non li contiene; serve la ricerca Google (account con fatturazione).
- **Altri fornitori AI**: la struttura li prevede (`js/ai/`), per ora c'è solo Gemini.
- **Sincronizzazione tra dispositivi**: per passare a un altro dispositivo usa backup e ripristino (fase 6).

## Struttura dei file

| File | Contenuto |
|---|---|
| `index.html` | Struttura della pagina e barra di navigazione |
| `styles.css` | Aspetto, anche in tema scuro |
| `js/app.js` | Avvio, navigazione e gestione dei tocchi |
| `js/views.js` | Le schermate e i pannelli di modifica |
| `js/store.js` | Salvataggio dei dati, importazione dalla v0.1, backup |
| `js/dates.js` | Calcoli su date e ripetizioni |
| `js/parse.js` | Interpretazione delle frasi dell'inserimento rapido |
| `js/learn.js` | Tempo libero, proposte, feedback, profilo appreso |
| `js/ai/assistant.js` | Conversazione, proposte, voce, impostazioni dell'assistente |
| `js/ai/gemini.js` | Collegamento a Google Gemini (sostituibile con altri fornitori) |
| `js/ai/tools.js` | Cosa l'assistente può leggere e proporre |
| `js/ai/search.js` | Ricerca sul web (Google o Wikipedia) |
| `sw.js` | Funzionamento offline |

Non inserire mai chiavi API in questi file: sono pubblici. La chiave si inserisce dall'app e resta sul telefono.

## Aggiornamenti

A ogni nuova versione: `sh scripts/nuova-versione.sh X.Y.Z` aggiorna il numero negli indirizzi dei file, così i telefoni non mescolano file vecchi e nuovi.


Ogni modifica caricata su GitHub viene pubblicata in un paio di minuti. Se il telefono mostra ancora la versione precedente, chiudi e riapri l'app.
