# Specifiche schermate e stati UI

## 1. Regole comuni

Ogni schermata definisce scopo, accesso, dati, azioni, stati, redirect, telemetria e accessibilita. Le schermate non mostrano token, dati di altre famiglie o valori nutrizionali senza qualita/fonte.

## 2. Shell e navigazione

**Route**: `/families/{familyId}/dashboard`.

**Mostra**: famiglia attiva, stato connessione, scorte urgenti, scadenze, lista attiva, lavori pendenti e azioni rapide.

**Azioni**: cambia famiglia, aggiungi prodotto, registra consumo, apri lista, apri ricette, impostazioni.

**Stati**: loading skeleton, empty con CTA, offline con timestamp ultimo sync, degraded capability banner, error retry.

**Redirect**: nessuna famiglia -> create; sessione assente -> login con returnTo allowlisted.

**Metriche**: time-to-dashboard, action-started/completed, error recovery, offline view.

## 3. Creazione famiglia

**Route**: `/families/create`.

**Campi**: nome, lingua, timezone, unita; preferenze opzionali separate.

**Submit**: `POST /families`; disabilita duplicati tramite Idempotency-Key.

**Successo**: `/families/{id}/welcome` con ruolo CREATOR.

**Errori**: nome non valido inline, conflict con retry, servizio indisponibile con draft locale non sensibile.

**Accessibilita**: label esplicite, error summary, focus sul primo errore, keyboard submit.

## 4. Invito QR

**Route creator**: `/families/{id}/members/invite`.

**Dati**: ruolo, scadenza, QR, codice fallback, timer e stato.

**Azioni**: genera, copia fallback, revoca, rigenera, chiudi.

**Stati**: creating, displayed, scanned, accepted, expired, revoked, error.

**Sicurezza UI**: QR non in URL/log; warning a non pubblicarlo; non mostrare token dopo navigazione.

**Successo**: lista membri aggiornata e audit invisibile all'utente ma disponibile al supporto autorizzato.

## 5. Join da QR

**Route**: `/join/review?attempt=<opaque-id>`.

**Pre-auth**: `/login?returnTo=/join/review...`; returnTo allowlisted e attempt breve.

**Mostra**: preview famiglia limitata, ruolo, scadenza, consensi.

**Azioni**: accetta, rifiuta, torna indietro.

**Redirect**: accept -> `/families/{id}/welcome`; unavailable -> `/join/unavailable`; session conflict -> `/join/account-conflict`.

**Non mostra**: scorte, altri membri, token, ID interni.

## 6. Dispensa e ricerca

**Route**: `/families/{id}/inventory`.

**Filtri**: testo, barcode, categoria, posizione, disponibilita, scadenza, soglia, dati incompleti.

**Riga prodotto**: nome, quantita/unit, scadenza, posizione, stato, ultimo aggiornamento.

**Azioni**: consumo rapido, modifica, sposta, spreco, dettaglio, aggiungi lista.

**Stati**: fresh, stale, offline, empty, query error, projection pending.

**Accessibilita**: filtri con nome, risultati annunciati, sort non solo colore, shortcut tastiera opzionali.

## 7. Aggiunta prodotto

**Route**: `/families/{id}/inventory/add`.

**Modalita**: manuale, barcode, foto, import batch.

**Manuale**: prodotto, quantita, unita, lotto, scadenza, posizione, soglia.

**Barcode**: preview, known/unknown, duplicate warning, conferma.

**Foto**: upload, progress, job pending, candidates, confidence, review.

**Successo**: ritorno a inventory con evidenza della riga creata e undo.

**Errori**: provider unavailable -> manual fallback; duplicate -> compare; invalid media -> retry/manual.

## 8. Lista della spesa

**Route**: `/families/{id}/shopping`.

**Sezioni**: suggeriti, attivi, completati, rimandati, archivio.

**Riga**: prodotto, quantita, origine, motivo, offerta, stato e autore ultima modifica.

**Azioni**: accetta/rifiuta batch, modifica, rimanda, completa, condividi, aggiungi manuale, carica in dispensa.

**Conflitto**: mostra versione locale/remota e permette merge o reload.

**Offline**: completa localmente solo azioni idempotenti; mostra pending sync e conflitti.

## 9. Scadenze

**Route**: `/families/{id}/expiry`.

**Gruppi**: scaduti, entro soglia, senza data.

**Azioni**: consuma, pianifica ricetta, congela, sposta, spreco, correggi.

**Regola**: scaduto non viene cancellato automaticamente.

## 10. Ricette/nutrizione/offerte

**Ricette route**: `/families/{id}/recipes`; mostra disponibili, mancanti, sostituzioni, porzioni, fonte, qualita e calorie.

**Nutrizione route**: `/families/{id}/nutrition`; mostra confermato vs stimato, periodo e fonte; disclaimer informativo.

**Offerte route**: `/families/{id}/offers`; solo offerte pertinenti, retailer/area/validita/condizioni e stale state.

**Azioni comuni**: salva, correggi, feedback, aggiungi mancanti, disattiva suggerimento.

## 11. Impostazioni e privacy

**Route**: `/families/{id}/settings` e `/account/privacy`.

**Sezioni**: membri/ruoli, lingua/unita/timezone, notifiche, consensi, personalizzazione, export, cancellazione, sessioni.

**Regola**: consenso non preselezionato; revoca immediata per nuovi trattamenti; azioni distruttive con conferma forte.

## 12. Telemetria UI

Evento consentito: `ui_action` con `screen`, `action`, `outcome`, `durationMs`, `capability`, `traceId` pseudonimizzato e schema version. Non inviare testo libero, prodotto specifico o payload foto salvo finalita documentata.

## 13. Definition of done UI

Ogni schermata deve avere wireframe, route, auth scope, schema dati, loading/empty/error/offline/degraded, keyboard/screen reader path, mobile layout, redirect test, telemetry event e acceptance criteria.
