# SLO, SLI ed error budget

## 1. Principi

Gli SLO sono obiettivi operativi misurati, non promesse assolute. Ogni SLO ha owner, query metriche, finestra, esclusioni dichiarate e conseguenza sul rilascio.

## 2. SLO iniziali

| Area | SLI | Target | Finestra | Owner |
|---|---|---:|---|---|
| API core availability | richieste non 5xx/timeout | 99.9% | 30 giorni | API/SRE |
| API read latency | p95 route core | < 400 ms | 30 giorni | API |
| Inventory command | p95 movimento | < 600 ms | 30 giorni | Inventory |
| Family join | p95 accept | < 1.5 s | 30 giorni | Family |
| Queue core | job success entro SLA | 99% entro 60 s | 30 giorni | Core worker |
| Recognition | risultato o stato finale | 95% entro 60 s | 30 giorni | Integration |
| Search freshness | projection lag p95 | < 60 s | 30 giorni | Search |
| Offer freshness | feed entro validita | source-specific | 30 giorni | Offers |
| Backup | ultimo backup valido | < 24 h home, < 15 min WAL prod | rolling | SRE |
| Restore | recovery drill success | 100% drill | mensile | SRE |
| Alert delivery | alert critici ricevuti | 99% entro 5 min | 30 giorni | SRE |
| Data durability | movimento confermato perso | 0 | sempre | Platform |

## 3. Error budget

Per un SLO 99.9% su 30 giorni il budget teorico e circa 43 minuti di indisponibilita. Il budget viene consumato da errori, timeout e violazioni di latenza secondo definizione SLI.

Policy:

- budget > 50%: rilascio normale con review;
- budget 25-50%: bloccare cambi rischiosi e privilegiare reliability work;
- budget < 25%: feature freeze salvo sicurezza/data loss;
- budget esaurito: incident review, remediation e approvazione SRE prima di nuove capability.

Per il server domestico l'uptime non puo essere garantito: si misurano comunque errori applicativi, recovery e perdita dati senza presentare il profilo home come HA.

## 4. Esclusioni

- manutenzione annunciata;
- provider esterni, misurati separatamente dal servizio;
- client offline e reti dell'utente;
- richieste 4xx causate dal client, salvo abuso/rate limit separato.

Le esclusioni non devono nascondere incidenti: provider, rete e rate limit hanno metriche e alert propri.

## 5. Alert policy

Ogni alert include `severity`, `slo`, `window`, `owner`, `runbook`, `dashboard`, `deduplicationKey` e `lastTraceLink`.

P1: DB core down, perdita dati, backup oltre RPO, auth compromise, API core unavailable.

P2: error budget burn rapido, DLQ crescente, queue oldest age oltre SLA, restore fallito, storage quasi pieno.

P3: provider degradato, stale offer, confidence bassa, costo AI anomalo, projection lag.

## 6. Reporting

Report settimanale: SLO, budget consumato, incidenti, top trace lente, backlog, errori per provider, costi e azioni. Postmortem P1/P2 con causa, detection gap, timeline, impatto e remediation owner.
