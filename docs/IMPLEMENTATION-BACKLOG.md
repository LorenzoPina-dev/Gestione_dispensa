# Current implementation backlog

Questo backlog è orientato ai gap della codebase attuale, non alla costruzione di una precedente architettura.

## Verification hold

- `npm.cmd ci` + `npm.cmd run typecheck` on the Windows development host remain pending because the
  current host cannot run the verification step yet. This is a verification task, not permission to
  mark the TypeScript gate as passed.

## P0 — correctness and security

1. Applicare e testare PostgreSQL RLS su tutte le tabelle tenant-scoped.
2. Uniformare authorization e family-scope in tutti i servizi.
3. Completare audit trail `before/after` e restore per le risorse recuperabili.
4. Chiudere test contract Gateway ↔ service e test E2E attraverso Nginx.

## P1 — product capabilities

1. Completare OCR staging, confidence per campo e conferma atomica.
2. Completare Unit/Conversion service e usarlo nel cooking e nel price normalization.
3. Completare normalized price e confronto tra store.
4. Completare il calcolo nutrizionale e la pipeline asincrona.
5. Completare cooking → inventory consumption → nutrition event.
6. Completare offline conflict/merge oltre alla sola idempotency.
7. Implementare WebSocket Gateway per broadcast family-scoped.
8. Collegare provider push VAPID/FCM reali con consent/quiet-hours.

## P2 — platform

1. Hardening provider integrations.
2. Search projection rebuild/replay e benchmark.
3. Backup/restore drill e failure injection.
4. Load tests e SLO misurati.
5. Kubernetes deployment evidence.

Ogni item deve produrre codice, test, contratto e prova di esecuzione prima di essere marcato completo.
