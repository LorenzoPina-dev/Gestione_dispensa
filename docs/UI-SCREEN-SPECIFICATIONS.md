# UI screen specifications

## Screen data policy

Ogni screen principale usa la Composite View corrispondente. Le mutation usano l'API di dominio attraverso il Gateway.

| Screen | View endpoint | Main domains |
|---|---|---|
| Dashboard | `/views/dashboard-today` | Family, Inventory, Shopping, Recipes, Notifications, OCR |
| Pantry | `/views/pantry-screen` | Inventory, Shopping, Notifications |
| Shopping | `/views/shopping-screen` | Shopping, Inventory, Notifications |
| Recipes | `/views/recipes-screen` | Recipes, Inventory, Shopping, Notifications |
| Nutrition | `/views/nutrition-screen` | Nutrition, Inventory, Notifications |
| Family | `/views/family-screen` | Family, Notifications |
| Notifications | `/views/notifications-screen` | Notifications, Inventory summary |

## UI mutation examples

```text
Consume item → PATCH/POST Inventory
Discard item → POST Inventory
Add shopping item → POST Shopping
Cook recipe → POST Recipes/:id/cook
Confirm OCR → POST OCR-jobs/:id/confirm
Add price → POST Stores/:storeId/prices
Update profile → Identity
Invite member → Family
```

## Cache policy

TanStack Query keys include family scope and view name. Mutations invalidate only affected views/resources. Cached data is rendered while revalidation runs in background.

## Offline policy

Only explicitly offline-safe mutations enter the local mutation queue. Every queued command has:

- stable idempotency key;
- original timestamp;
- family scope;
- resource version when available;
- retry count;
- terminal conflict/error state.

The UI must never silently discard a conflict.
