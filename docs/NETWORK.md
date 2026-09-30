# Network

Browser-facing:
```
Browser --HTTPS:8443--> Nginx
Nginx / -> Web
Nginx /api -> Gateway:3300
Nginx /realms -> Keycloak
```

Microservizi e datastore sono su rete interna. Le loro porte non sono pubblicate sull'host salvo debug controllato.

Data plane:
```
service-inventory -> inventory_db
service-family -> family_db
service-shopping -> shopping_db
service-catalog -> catalog_db
... ogni servizio -> proprio DB
off-lookup -> off_lookup_db
```

Nessun servizio dispone di credenziali per i DB degli altri servizi.
