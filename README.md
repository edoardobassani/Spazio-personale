# Spazio personale — PWA v0.1

Prima versione installabile dell'app personale.

## Cosa funziona già
- Navigazione tra Oggi, Impegni, Interessi, Progetti e Assistente.
- Creazione ed eliminazione di promemoria, interessi e progetti.
- Salvataggio locale sul dispositivo tramite `localStorage`.
- Esportazione dei dati personali in JSON.
- Struttura PWA con manifest e service worker per uso offline dopo il primo caricamento.
- Sezione Assistente AI completa a livello di interfaccia: conversazione, prompt suggeriti, comandi, configurazione, voce e accesso ai dati. Le azioni AI sono volutamente non operative e segnalate come non collegate.

## Installazione sul Samsung
La PWA deve essere pubblicata su un indirizzo HTTPS (ad esempio GitHub Pages).

1. Crea un repository GitHub, ad esempio `spazio-personale`.
2. Carica tutti i file contenuti in questa cartella nella radice del repository.
3. In GitHub apri **Settings → Pages**.
4. Seleziona la pubblicazione dal branch principale e dalla cartella `/ (root)`.
5. Attendi la pubblicazione e apri l'indirizzo HTTPS sul Samsung con Chrome.
6. Dal menu di Chrome scegli **Installa app** oppure **Aggiungi a schermata Home**.

Puoi anche testarla in locale con un server statico; l'installazione PWA e il service worker richiedono localhost o HTTPS.

## Architettura prevista per l'AI
L'interfaccia non chiama direttamente alcun modello. In una fase successiva:
- aggiungere un modulo `ai-client` indipendente dal fornitore;
- collegarlo a un backend/proxy sicuro;
- conservare le chiavi API esclusivamente lato server;
- definire permessi espliciti per il contesto personale condiviso con il modello;
- integrare input vocale, sintesi vocale, strumenti/azioni e conferma prima delle azioni sensibili.

Non inserire mai chiavi API in `app.js` o in altri file pubblici.

## Limiti attuali
- I dati sono salvati solo nel browser/dispositivo: cancellare i dati del sito può eliminarli. Esporta periodicamente una copia.
- Nessuna sincronizzazione cloud o backup crittografato.
- Nessuna notifica programmata.
- Nessun assistente AI collegato, nessun riconoscimento o generazione vocale.
- Il font esterno è caricato da Google Fonts; il resto dell'app è disponibile offline dopo il primo caricamento.
