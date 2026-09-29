# Composite Views / BFF

## Obiettivo

Ogni schermata principale viene caricata con una sola richiesta browser. Il Gateway compone le sezioni in parallelo senza trasferire business logic nel frontend.

## Dashboard

```text
GET /api/v1/views/dashboard-today?familyId=<id>
```

Fan-out:

```text
Family ───────────┐
Members ──────────┤
Inventory ────────┤
Shopping ─────────┤
Recipes suggestions ──┤──→ dashboard model
Notifications ────┤
OCR pending review ────┘
```

## Pantry

```text
Inventory + Shopping + Notifications
```

## Shopping

```text
Shopping + Inventory + Notifications
```

## Recipes

```text
Recipes suggestions + Inventory + Shopping + Notifications
```

## Nutrition

```text
Nutrition summary + Inventory + Notifications
```

## Family

```text
Family + Members + Invites + Notifications
```

## Notifications

```text
Notifications + Inventory-derived navigation summary
```

## Response contract

Ogni view restituisce:

```json
{
  "data": { "familyId": "..." },
  "meta": { "schemaVersion": "view.v1" }
}
```

Gli errori sono normalizzati dal Gateway. Le view non devono scrivere dati nei domini downstream.

## Frontend policy

TanStack Query gestisce:

- `staleTime` per evitare refetch inutili;
- cache per `familyId`;
- invalidazione dopo mutazioni;
- prefetch su navigazione intenzionale;
- rendering immediato dei dati cached durante revalidation.

Una Composite View non sostituisce le API di mutazione: serve a ottimizzare la lettura della schermata.
