# ADR-0001: architettura a servizi con deployment progressivo

- **Stato**: accettata
- **Data**: 2026-09-09
- **Decisione**: servizi modulari indipendenti, orchestrazione progressiva

## Contesto

Il prodotto deve crescere con moduli per catalogo e barcode, riconoscimento fotografico, ricette, nutrizione, offerte, ricerca e notifiche. Il primo ambiente di esecuzione sara probabilmente un vecchio PC con memoria, CPU, disco e affidabilita limitati.

Serve quindi separare i carichi senza introdurre subito il costo operativo di un cluster Kubernetes completo. In particolare OCR/vision, import offerte, indicizzazione e generazione ricette possono essere intermittenti e piu costosi dell'API e dell'inventario.

## Opzioni valutate

### Monolite unico

Semplice da installare, ma impedisce di spegnere o scalare selettivamente i carichi e aumenta il rischio che un job lento degradi l'API.

### Microservizi Kubernetes dal primo giorno

Offrono isolamento e scaling, ma su un solo vecchio PC aggiungono costi fissi: control plane, ingress, networking, registry, monitoraggio e manutenzione. Il database e lo storage rimangono comunque dipendenze stateful difficili da rendere realmente resilienti su un singolo nodo.

### Servizi modulari con deployment progressivo

Definiscono da subito confini, contratti, code, ownership dei dati e immagini container, ma raggruppano inizialmente i moduli in pochi processi. Quando un carico lo richiede, il gruppo viene separato e scalato senza cambiare il contratto.

## Decisione

Adottiamo la terza opzione.

I deployable iniziali sono:

- `web`;
- `api`;
- `worker-core`;
- `worker-integrations` opzionale;
- `worker-notifications` opzionale;
- PostgreSQL, Redis e object storage.

In sviluppo e sul server iniziale si usa Docker Compose con profili. L'applicazione essenziale (`web`, `api`, `worker-core`, PostgreSQL e Redis) deve funzionare senza OCR, AI, offerte o ricerca avanzata. I componenti opzionali consumano code e pubblicano risultati; la loro assenza produce stato pendente o non disponibile, senza bloccare le funzioni core.

Il passaggio operativo e:

1. Docker Compose su un singolo Linux host;
2. k3s su singolo nodo quando servono manifest dichiarativi, secret, restart e rolling update;
3. k3s multi-node o Kubernetes gestito quando servono replica, autoscaling e alta disponibilita;
4. PostgreSQL, Redis e object storage gestiti o replicati prima di dichiarare alta disponibilita dell'applicazione.

## Vincoli obbligatori

- nessun servizio deve condividere tabelle di un altro servizio senza contratto;
- i comandi asincroni devono essere idempotenti e avere retry/backoff/dead-letter queue;
- tutte le immagini hanno limiti CPU/memoria e health/readiness check;
- le API non chiamano direttamente provider lenti senza timeout, circuit breaker e fallback;
- le migrazioni devono essere backward-compatible;
- i dati autorevoli restano in PostgreSQL; le proiezioni di ricerca possono essere ricostruite;
- ogni servizio espone metriche e correlation id;
- la configurazione dei componenti opzionali e validata all'avvio e documentata.

## Conseguenze

### Positive

- consumo minimo sul server iniziale;
- possibilità di spegnere OCR, offerte o AI quando non necessari;
- scaling indipendente dei worker;
- isolamento dei provider esterni e dei job lenti;
- percorso di crescita verso Kubernetes senza riscrivere il dominio.

### Negative

- bisogna mantenere contratti ed eventi versionati;
- debugging e tracing sono piu importanti rispetto a un singolo processo;
- la consistenza tra servizi e asincrona;
- un singolo PC non fornisce alta disponibilita, anche se usa Kubernetes.

## Criteri per estrarre un nuovo servizio

Un modulo diventa servizio autonomo solo se almeno una di queste condizioni e verificata:

- necessita di un profilo CPU/memoria molto diverso;
- ha un backlog o una frequenza di esecuzione indipendente;
- richiede dipendenze incompatibili o provider separati;
- ha un ciclo di rilascio diverso;
- richiede isolamento di sicurezza o di affidabilita;
- supera un limite misurato di latenza, throughput o disponibilita.

La sola presenza di un nuovo modulo funzionale non e sufficiente.
