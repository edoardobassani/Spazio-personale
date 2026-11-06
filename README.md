# Spazio personale — v2.1

Assistente personale per organizzare impegni, progetti e interessi. È una PWA: si apre dal browser e si installa sulla schermata Home.

**Indirizzo:** https://edoardobassani.github.io/Spazio-personale/

## Cosa funziona davvero

**Oggi**
- Data, saluto e riepilogo della giornata.
- Impegni di oggi, scadenze passate non completate, prossimi 7 giorni.
- Promemoria attivi: un impegno compare in "Da ricordare" quando inizia il suo anticipo (es. il giorno prima).
- Nei giorni con pochi impegni: al massimo due proposte per il tempo libero, scelte con regole semplici dai tuoi progetti e interessi. Sono segnate come "Suggerimento" e hanno un aspetto diverso dai tuoi impegni.

**Impegni**
- Tre tipi: appuntamento, attività (si può spuntare), scadenza (si può spuntare).
- Titolo, data, ora di inizio e fine, luogo, categoria, note.
- Ripetizioni: ogni giorno, settimana, mese o anno, ogni N, con data di fine facoltativa.
- Promemoria per impegno, con anticipo predefinito diverso per ogni tipo (modificabile nelle impostazioni).
- Viste giorno, settimana e mese.
- Inserimento rapido: frasi come «dentista il 20 novembre alle 15» o «chiamare il commercialista venerdì» vengono interpretate e mostrate in un modulo da confermare.
- Dettatura vocale nella barra di inserimento rapido (Chrome su Android).

**Progetti**
- Nome, obiettivo, descrizione, scadenza, note.
- Passaggi da spuntare, con barra di avanzamento e "prossimo passo" visibile.
- Stati: attivo, in pausa, completato, archiviato.
- Se un progetto è fermo da almeno due settimane, la schermata Oggi può proporre di riprenderlo. Con "Non ora" la proposta sparisce per due settimane. Nessuna serie, nessun punteggio.

**Interessi**
- Interessi stabili e curiosità del momento.
- Pausa e ripresa, note, modifica ed eliminazione.

**Assistente (Google Gemini, piano gratuito)**
- Conversazione scritta o dettata, con lettura facoltativa delle risposte ad alta voce (voce del telefono).
- Legge agenda, progetti e interessi, solo se gli dai il permesso. Le note personali sono escluse se non le attivi.
- Può preparare impegni, modifiche, progetti con passaggi e interessi: compaiono come **proposte** da confermare o annullare. Nulla viene salvato senza il tuo tocco.
- Sceglie da solo il miglior modello Flash disponibile e passa a un altro se quello scelto non è gratuito.
- La chiave API resta solo sul dispositivo e non finisce nei backup.
- Limiti: non ha accesso a internet (non conosce eventi, orari o notizie del giorno); con il piano gratuito Google può usare le conversazioni per migliorare i suoi servizi.

**Dati**
- Tutto è salvato solo sul dispositivo.
- Backup scaricabile in un file e ripristino da file (Impostazioni).
- Protezione dei dati dalla pulizia automatica del browser.
- I dati della versione 0.1 vengono importati da soli al primo avvio e la loro copia originale non viene cancellata.
- Funziona anche senza connessione dopo la prima apertura.

## Cosa non c'è ancora

- **Notifiche sul telefono ad app chiusa.** I promemoria compaiono quando apri l'app. Per notifiche affidabili su Android serve un piccolo servizio esterno (fase 3).
- **Ricerca sul web per l'assistente** (eventi, notizie, contenuti recenti).
- **Apprendimento automatico delle preferenze**: per ora il contesto si scrive a mano in «Su di te».
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
| `js/ai/assistant.js` | Conversazione, proposte, voce, impostazioni dell'assistente |
| `js/ai/gemini.js` | Collegamento a Google Gemini (sostituibile con altri fornitori) |
| `js/ai/tools.js` | Cosa l'assistente può leggere e proporre |
| `sw.js` | Funzionamento offline |

Non inserire mai chiavi API in questi file: sono pubblici. La chiave si inserisce dall'app e resta sul telefono.

## Aggiornamenti

Ogni modifica caricata su GitHub viene pubblicata in un paio di minuti. Se il telefono mostra ancora la versione precedente, chiudi e riapri l'app.
