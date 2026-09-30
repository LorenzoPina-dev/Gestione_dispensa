# Security

Keycloak/OIDC gestisce l'identità. Gateway e servizi verificano il contesto e l'autorizzazione sul proprio dominio.

Tenant isolation: familyId/subject viene verificato lato server; un ID fornito dal client non è autorizzazione.

Ogni servizio usa credenziali DB dedicate e privilegio minimo. Nessuna credenziale cross-service.

Inviti: token temporanei/revocabili/consumabili; il token non sostituisce autenticazione e la membership nasce solo durante accept autorizzato.

Secret, password, token e DB credentials non vanno nei log. Correlation/trace IDs sì quando appropriato.

Blob privati in MinIO sono protetti da policy/bucket e non da URL pubblici permanenti.
