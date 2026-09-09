# User journeys e requisiti di esperienza

## 1. Obiettivo

L'app deve ridurre il lavoro di ricordare, cercare e ricomprare. L'utente non dovrebbe essere costretto a capire il modello dati, scegliere una capability o attendere provider esterni per completare una operazione semplice.

Principi UX:

- **prima il percorso rapido**: poche azioni per registrare un acquisto o un consumo;
- **progressive disclosure**: i dettagli avanzati compaiono quando servono;
- **stato sempre visibile**: quantita, scadenza, sincronizzazione e job devono essere comprensibili;
- **correzione facile**: annullare o correggere e piu semplice che ripetere tutto;
- **nessuna sorpresa**: niente aggiunte automatiche irreversibili alla lista o profilazione senza consenso;
- **accessibile e tollerante agli errori**: touch, tastiera, screen reader, rete debole e dati incompleti.

## 2. Navigazione principale

La navigazione deve rendere immediatamente disponibili:

1. **Panoramica**: scorte urgenti, scadenze, lista attiva e azioni rapide;
2. **Dispensa**: ricerca, filtri, posizioni e dettaglio scorta;
3. **Lista della spesa**: lista corrente, completati, rimandati e liste archiviate;
4. **Aggiungi**: barcode, foto, manuale e import;
5. **Ricette**: disponibili ora, in scadenza, preferite e pianificate;
6. **Profilo/impostazioni**: household, preferenze, privacy, notifiche e integrazioni.

La dashboard non deve diventare un muro di metriche: deve prioritizzare azioni utili all'utente.

## 3. Journey: primo avvio

### Obiettivo

Passare da installazione a prima scorta con attrito minimo.

### Flusso

1. spiegazione breve del valore e dei dati richiesti;
2. login o creazione account;
3. creazione household o accettazione invito;
4. scelta lingua, paese, unita e timezone;
5. impostazioni opzionali: allergeni, preferenze, budget, retailer, notifiche;
6. scelta tra inserimento manuale, barcode, foto o import CSV;
7. prima conferma di prodotto e quantita;
8. panoramica con prossima azione consigliata.

### Acceptance

- nessun consenso marketing pre-selezionato;
- skip possibile senza perdere il percorso core;
- l'utente capisce quali dati sono facoltativi;
- un household vuoto mostra una call to action, non uno stato di errore;
- import fallito mostra cosa e stato importato e cosa no.

## 4. Journey: acquisto e carico dispensa

### Caso rapido

L'utente scansiona piu barcode consecutivamente, conferma prodotti riconosciuti e registra quantita/scadenza senza uscire dal flusso.

### Caso foto

L'utente scatta una foto, vede candidati e confidence, corregge campi ambigui e conferma. Un provider lento non blocca la navigazione: il job resta visibile nello stato lavori.

### Caso manuale

L'utente cerca un prodotto esistente o ne crea uno con nome, unita e quantita minima; i dettagli nutrizionali sono opzionali e marcati come mancanti.

### Acceptance

- modalita batch e singola;
- annulla/undo dell'ultima operazione;
- conferma chiara prima di creare duplicati;
- default ragionevoli ma mai dati inventati;
- possibilità di impostare lotto, scadenza e posizione ora o dopo;
- feedback di successo comprensibile e non solo un toast che scompare.

## 5. Journey: consultazione dispensa

L'utente deve rispondere rapidamente a: cosa ho, quanto ne ho, cosa scade, dove si trova e cosa devo ricomprare.

Filtri predefiniti:

- tutto, disponibile, quasi esaurito, esaurito;
- scade presto, scaduto, senza scadenza;
- posizione, categoria, brand, allergeni;
- acquistato di recente, usato spesso, mai usato;
- prodotto con dati incompleti o da verificare.

Ogni card/riga mostra nome, quantita e unita, scadenza, posizione e stato soglia. I dettagli tecnici e la provenance sono secondari ma raggiungibili.

## 6. Journey: consumo e correzione

L'azione piu comune deve essere un consumo rapido dalla dashboard, dalla scheda prodotto o dalla ricetta. L'utente sceglie quantita e motivo, conferma e puo annullare entro una finestra definita.

Sono necessari:

- consumo totale o parziale;
- consumo ricorrente rapido;
- spreco separato dal consumo;
- rettifica con motivo;
- cronologia leggibile;
- conflitto esplicito se un altro membro ha modificato la stessa scorta;
- aggiornamento immediato della quantita e stato eventuale della lista.

Il sistema non deve trasformare automaticamente una previsione in un consumo reale senza evidenziarlo.

## 7. Journey: lista della spesa

### Generazione

La lista puo ricevere suggerimenti da soglie, scadenze, ricette pianificate, consumo previsto e preferenze. Ogni riga indica origine e motivo; l'utente puo disattivare una fonte.

### Preparazione

L'utente deve poter:

- accettare/rifiutare suggerimenti in batch;
- cambiare quantita e formato;
- raggruppare per negozio, reparto o percorso;
- cercare e aggiungere un prodotto non catalogato;
- segnare acquistato anche offline;
- condividere e vedere chi ha modificato la riga;
- rimandare senza cancellare;
- vedere offerte applicabili con prezzo, periodo e condizioni;
- archiviare la lista mantenendo lo storico.

### Dopo l'acquisto

Il completamento deve offrire un'azione rapida per caricare i prodotti nella dispensa, senza obbligare a ripetere la scansione se la riga e gia identificata. La quantita realmente acquistata resta confermabile.

## 8. Journey: scadenze e spreco

La dashboard deve evidenziare prima le scadenze realmente azionabili. L'utente puo configurare anticipo, timezone e canale. Un alimento scaduto non viene cancellato automaticamente: viene marcato e richiede decisione.

Azioni: consuma, pianifica ricetta, congela, sposta, ignora, registra spreco, correggi data.

## 9. Journey: ricette e pianificazione

La proposta deve rispondere a filtri umani: tempo, porzioni, difficolta, ingredienti da usare, scadenze, allergeni e preferenze. La schermata distingue chiaramente:

- ingredienti disponibili;
- ingredienti mancanti;
- sostituzioni possibili;
- quantita che verranno consumate;
- calorie e nutrienti con qualita della fonte;
- contenuto verificato rispetto a proposta AI.

Azioni: salva, cucina, adatta porzioni, aggiungi mancanti alla lista, sostituisci ingrediente, segnala errore, non suggerire piu.

## 10. Journey: offerte

Le offerte non devono distrarre dal compito. Vanno mostrate solo quando pertinenti a una riga o a una preferenza, con retailer, area, validita, prezzo/condizioni, fonte e data aggiornamento. Un confronto tra confezioni deve usare prezzo per unita coerente e dichiarata.

## 11. Journey: errori e stati non ideali

Ogni stato deve avere messaggio, conseguenza e azione:

- offline: mostra ultimo dato sincronizzato e coda locale;
- provider lento: continua il flusso e mostra job pendente;
- barcode sconosciuto: proposta di creazione manuale;
- duplicato possibile: confronto prima della scelta;
- conflitto: mostra entrambe le modifiche e permette scelta;
- permesso insufficiente: spiega cosa manca senza rivelare dati;
- dati incerti: mostra confidence e revisione;
- servizio non disponibile: core utilizzabile e capability marcata degradata;
- sessione scaduta: conserva bozza non sensibile e permette ripresa sicura.

Mai usare solo colori per comunicare uno stato. I messaggi devono essere specifici, brevi e traducibili.

## 12. Accessibilita, localizzazione e dispositivi

- target WCAG 2.2 AA per flussi core;
- focus visibile, ordine tastiera, label e errori associati ai campi;
- touch target adeguati e uso con una mano sui flussi rapidi;
- contrasto e testo non dipendenti dal colore;
- responsive da telefono a desktop;
- lingua e formato data/numero configurabili;
- unita metriche e conversioni esplicite;
- timezone household per scadenze e notifiche;
- supporto reduced motion e screen reader;
- PWA installabile, con offline limitato e trasparente.

## 13. Notifiche

Categorie separabili e configurabili: scorta bassa, scadenza, job completato, errore import, lista condivisa, digest ricette e offerte. Ogni notifica ha priorita, canale, quiet hours, deduplica e link a un'azione. Nessuna notifica promozionale senza consenso.

## 14. Personalizzazione controllabile

L'utente deve poter vedere, correggere, disattivare e cancellare preferenze e suggerimenti. Ogni suggerimento espone il motivo in linguaggio semplice. La personalizzazione non puo modificare scorte, lista o consensi senza conferma.

## 15. Metriche UX

Misurare in forma aggregata e conforme alla privacy:

- tempo al primo prodotto registrato;
- completamento onboarding;
- tempo per registrare un acquisto batch;
- tasso di correzione barcode/OCR;
- accuratezza percepita delle quantita;
- suggerimento lista accettato/rifiutato/ignorato;
- tempo per completare una lista;
- ricette salvate/cucinate e ingredienti effettivamente consumati;
- errori per journey e tasso di recovery;
- uso offline e conflitti;
- accessibilita e completamento da tastiera;
- opt-out notifiche e personalizzazione.

Le metriche non devono essere usate per profilazione individuale senza consenso e finalita documentata.

## 16. Funzioni da classificare prima del backlog

**MUST core**: onboarding, dashboard, inserimento manuale/barcode, stock, consumo, soglie, lista condivisa, ricerca, scadenze, undo/correzione, error states, accessibilita base.

**SHOULD**: foto/OCR, import CSV/scontrino, offline limitato, ricette, offerte pertinenti, notifiche avanzate, FEFO, statistiche nutrizionali.

**COULD**: pianificazione pasti, budget, confronto prezzo per unita, calendario, previsioni consumo, integrazioni POS/ERP, profilo personalizzato.

**WONT iniziale**: acquisto autonomo, consigli medici, automazioni irreversibili, profilazione pubblicitaria implicita.
