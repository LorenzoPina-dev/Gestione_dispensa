# Flussi applicativi

La raccolta dei diagrammi sequenza/flowchart è in [DIAGRAMS.md](DIAGRAMS.md#flussi-funzionali). Questo documento sintetizza il percorso, l'owner dei dati e i limiti osservati nel codice.

## Ingresso e identità

`Browser → NGINX :8443 → Web` oppure `NGINX /api → Gateway :3300 → servizio owner`. Keycloak fornisce OIDC; Gateway verifica il JWT e il servizio owner verifica autorizzazioni e ambito familiare. Le route interne non sono esposte direttamente al browser.

## Prodotto e barcode

Catalog riceve ricerca o codice a barre. Per i dati OFF, `off-lookup` consulta OpenSearch; in caso di miss/indisponibilità interroga il provider Open Food Facts e aggiorna MongoDB. La sincronizzazione con OpenSearch è best-effort. La scelta del candidato viene risolta da Catalog e salvata come prodotto applicativo prima di usarlo in Inventory.

## Identità semantica e traduzione

Catalog, Recipes e Shopping interrogano Food Semantics per normalizzare identità alimentari e label. Il servizio combina le sorgenti ontologiche configurate con LibreTranslate quando serve. Un risultato ambiguo può restare senza mapping: similarità di stringa e traduzione automatica non garantiscono che due alimenti siano lo stesso ingrediente.

## Dispensa e flusso eventi

Inventory possiede stock, lotti e ledger dei movimenti. Nelle operazioni che emettono eventi, la transazione scrive dato e outbox; il relay del dominio pubblica su Redis Stream `events:domain`; i consumer aggiornano il proprio dominio in modo idempotente. Vedere [EVENTS.md](EVENTS.md) per envelope, versionamento e consumo.

## Ricette e nutrienti

Recipes espone ricerca/catalogo, dettaglio, suggerimenti in base alla dispensa e inserimento degli ingredienti mancanti in una lista Shopping. Nutrition espone target, diario e summary. **Nel branch verificato non risulta un endpoint “completa ricetta” che sottragga automaticamente ingredienti Inventory e registri il relativo apporto Nutrition**: i diagrammi non lo presentano come implementato.

## Riordino e scadenza

Shopping possiede gli articoli lista; Inventory fornisce lo stato stock. Il worker Shopping riceve gli eventi previsti e materializza suggerimenti. Per shelf-life, eventi/job vengono elaborati dal worker; la stima resta distinguibile dalla data dichiarata.

## Ricevuta OCR

OCR salva il file nel provider oggetti configurato, registra un job, lo mette nella coda Redis e restituisce draft/righe. Worker OCR chiede a service-ocr di elaborare. L'utente rivede il draft; la conferma è separata dalle mutazioni Inventory/Stores. Se il provider OCR non è configurato, la funzione può restare degradata.

## Famiglie, notifiche e privacy

Family gestisce membership, inviti e tentativi di join; l'apertura di un invito non equivale ad accettazione. Notifications gestisce preferenze e stato deduplicato; la consegna dipende dal provider configurato. Privacy persiste consensi e richieste. Export/erasure possono essere registrati e accodati come job, ma la presenza di una richiesta non dimostra da sola l'esecuzione di tutti i consumer/step sui database coinvolti.

## Diagrammi

Per architettura, 15 database logici, chiavi e relazioni SQL intra-dominio e i flussi dettagliati, vedere [DIAGRAMS.md](DIAGRAMS.md).
