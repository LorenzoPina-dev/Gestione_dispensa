# ADR-0002: piattaforma unificata di osservabilita

- **Stato**: accettata
- **Data**: 2026-09-09
- **Decisione**: OpenTelemetry Collector, Prometheus, Grafana, Alertmanager, Loki e Tempo

## Contesto

Il sistema deve essere diagnosticabile sia a livello globale sia sulla singola richiesta: gateway, API, database, Redis, code, consumer e provider esterni. Deve funzionare su un server domestico limitato e poter crescere su Kubernetes per installazioni professionali.

## Decisione

Adottiamo una pipeline standardizzata:

```text
Services -> OpenTelemetry Collector -> Prometheus / Loki / Tempo
                                           |
                                           v
                                      Grafana
                                           |
                                           v
                                      Alertmanager
```

- OpenTelemetry fornisce instrumentation e contesto W3C Trace Context;
- Collector centralizza batching, sampling, retry, redazione e routing;
- Prometheus raccoglie metriche e valuta regole SLO/alert;
- Grafana offre dashboard, correlazione e drill-down;
- Alertmanager invia alert indipendentemente dalla UI Grafana;
- Loki conserva log strutturati;
- Tempo conserva trace distribuite.

## Profili

- `home-small`: Prometheus, Grafana, Alertmanager e Collector leggero, retention breve;
- `home-plus`: aggiunge Loki e Tempo persistenti;
- `production`: componenti replicati, storage persistente, backup/remote write e retention conforme agli accordi operativi.

Lo stack osservabile e non funzionale: se Grafana, Loki o Tempo sono indisponibili, il sistema deve continuare a gestire scorte e API. I segnali possono essere bufferizzati o persi secondo una policy esplicita, ma non devono bloccare il dominio.

## Regole professionali

- metriche, log e trace condividono `traceId`, `requestId`, servizio, versione, ambiente e capability;
- dashboard e alert sono provisioning-as-code;
- ogni alert ha severita, soglia, finestra, owner, runbook e destinazione;
- niente payload alimentari, token, immagini o dati sensibili nei log;
- le label Prometheus/Loki sono a cardinalita controllata: mai user id o trace id come label;
- gli alert critici sono valutati da Prometheus/Alertmanager, non solo da pannelli Grafana;
- le regole sono testate in CI e gli alert simulati prima del rilascio;
- retention e accesso ai segnali sono separati per sicurezza e contenimento dei costi.

## Conseguenze

### Positive

- diagnosi end-to-end di bottleneck e failure;
- stesso modello operativo su Compose, k3s e Kubernetes;
- alert affidabili anche durante un problema della dashboard;
- integrazione naturale con SLO, error budget e postmortem;
- possibilità di ridurre il profilo sul vecchio PC senza cambiare il codice applicativo.

### Negative

- consumo aggiuntivo di CPU, memoria e disco;
- retention e cardinalita devono essere controllate;
- lo stack deve essere sottoposto a backup, aggiornamenti e hardening;
- tracing e log completi possono richiedere sampling e storage esterno a scala elevata.

## Criterio di accettazione

Prima del primo rilascio il team deve poter seguire un'operazione dal browser fino a database/coda/provider usando `traceId`, vedere latenza e errori in Grafana, ricevere un alert di prova via Alertmanager e completare un restore delle configurazioni e dei dati di osservabilita necessari al troubleshooting.
