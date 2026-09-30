# Domain ownership

| Domain | Service | Primary data |
|---|---|---|
| Identity | identity + Keycloak | identity linkage |
| Users | users | profiles/preferences |
| Families | families | families/memberships/invitations |
| Products | products | canonical products |
| Barcode | barcode | resolution/cache metadata |
| Vision | vision | recognition jobs/results |
| Inventory | inventory | current pantry + inventory events |
| Expiration | expiration | rules/predictions |
| Shopping | shopping | lists/items |
| Stores | stores | stores/locations |
| Offers | offers | offers/prices/promotions |
| Recipes | recipes | recipes/ingredients |
| Nutrition | nutrition | nutrition projections |
| Notifications | notifications | notification state/preferences |
| Media | media | object metadata |
| Search | search | derived indexes |
| Analytics | analytics | derived aggregates |

## Data ownership

A service is the only writer of its primary data. Other services consume APIs or events. Cross-database joins are forbidden.

Inventory keeps only the current pantry state in `pantry_items`; historical actions live in `inventory_events` and do not become archived pantry products.
