# Privacy, profilazione e analytics

## 1. Principio guida

Il sistema puo personalizzare suggerimenti, ma non deve trasformare automaticamente dati di consumo in un profilo pubblicitario o sanitario. La profilazione e una capability distinta, opt-in, documentata e revocabile. I log tecnici non sono un dataset di marketing.

## 2. Dati classificati

| Classe | Esempi | Uso | Retention/accesso |
|---|---|---|---|
| Public/reference | categoria, prodotto canonico, barcode | catalogo | fonte e versioning |
| Household operational | scorte, movimenti, liste | servizio core | household members autorizzati |
| Personal preference | gusti, budget, dieta dichiarata | personalizzazione | opt-in, minimo necessario |
| Potentially sensitive inference | allergeni, dieta, patologie deducibili | solo funzione richiesta | accesso ristretto, mai advertising implicito |
| Security/audit | login, deny, export, admin action | sicurezza/compliance | append-only, operatori autorizzati |
| Telemetry | durata, errore, queue, trace | operativita | pseudonimizzata, retention limitata |

Le foto possono contenere dati incidentali e vengono trattate come dato personale potenziale: upload sicuro, EXIF rimosso, retention breve, cancellazione e accesso auditato.

## 3. Profili e segnali ammessi

Il profilo di personalizzazione deve usare solo segnali necessari e dichiarati:

- preferenze esplicitamente indicate;
- ricette viste, salvate o confermate;
- ingredienti frequentemente presenti, con finestra temporale e soglia minima;
- frequenza di consumo aggregata;
- budget e negozi preferiti se inseriti dall'utente;
- preferenze di formato, tempo di preparazione e stagionalita.

Non usare come segnali automatici senza consenso separato:

- diagnosi, gravidanza, religione, etnia o condizioni economiche inferite;
- acquisti di altri household;
- dati raw di osservabilita;
- contenuto di immagini per advertising;
- dati di minori senza tutela specifica;
- dati importati da retailer per costruire profili cross-service senza base giuridica.

## 4. Consensi e finalita

Consensi separati e registrati per:

1. servizio core e sicurezza, necessari al funzionamento;
2. suggerimenti personalizzati, facoltativi;
3. analytics prodotto aggregati, facoltativi dove richiesto;
4. offerte/promozioni personalizzate, sempre separati;
5. uso di provider AI/vision, con informativa su trasferimento e retention.

Il record di consenso conserva `subjectId`, finalita, versione informativa, timestamp, fonte, paese, stato e revoca. La revoca blocca nuovi usi e avvia la cancellazione o anonimizzazione secondo retention legale.

## 5. Architettura del profilo

Il profilo non viene calcolato nei servizi core di inventario. Pipeline consigliata:

```text
Consenso valido
  -> eventi minimizzati
  -> analytics/profile worker isolato
  -> feature store o tabelle aggregate con TTL
  -> recommendation service
  -> spiegazione + feedback utente
```

- il profile worker riceve solo eventi autorizzati e minimizzati;
- le feature hanno nome, definizione, finestra, fonte, versione, TTL e qualita;
- nessun dato grezzo e richiesto per ogni suggerimento;
- i profili sono separati per household e, quando necessario, per utente;
- i suggerimenti registrano modello/algoritmo, feature version, motivazione e feedback;
- cancellazione e revoca propagano tombstone alle feature e alle proiezioni.

Per il primo rilascio e preferibile un profilo deterministico e spiegabile, ad esempio "scorta bassa", "ingrediente in scadenza" o "ricetta compatibile", prima di modelli predittivi opachi.

## 6. Contratto dei suggerimenti

Ogni suggerimento deve contenere:

- `suggestionId`, `subjectScope`, `type`, `createdAt`, `expiresAt`;
- `reasonCodes` leggibili dall'utente;
- `inputSummary` minimizzato;
- `algorithmVersion` e `featureVersion`;
- `confidence` solo quando semanticamente valida;
- `dataQuality` e fonte;
- `dismissedAt`, `acceptedAt`, `feedback`;
- `consentPurpose` che autorizza il trattamento.

L'utente deve poter disattivare una categoria di suggerimenti e correggere preferenze errate. Non si deve presentare una correlazione statistica come fatto personale.

## 7. Multi-tenant per catene

Per supportare catene di supermercati il modello deve distinguere:

- tenant organizzativo;
- brand/catena;
- regione/paese;
- negozio;
- household o account cliente;
- operatori e ruoli di backoffice.

I dati di clienti diversi devono essere isolati a livello applicativo e database. Analytics aggregati devono usare soglie minime di gruppo, anonimizzazione e policy contro re-identificazione. Un tenant non puo usare dati di un altro tenant per training o ranking senza contratto e base giuridica.

Il catalogo globale puo essere condiviso solo se la provenance e separata dai dati di consumo. Le offerte sono scoped per retailer, area e validita. Il backoffice vede dati aggregati e autorizzati, non lo storico completo di un household per default.

## 8. Profiling tecnico e prodotto

Sono due cose diverse:

- **profiling tecnico**: CPU, memoria, p95, query lente, queue lag e traces; serve a ottimizzare il sistema e deve essere pseudonimizzato;
- **profiling utente**: preferenze e comportamento; serve a personalizzare e richiede finalita, consenso, retention e spiegazione.

Devono avere datastore, permessi, retention e dashboard separati. Mai usare `actorId`, `traceId` o payload raw come feature utente.

## 9. Governance AI e modelli

Per ogni modello/provider registrare:

- scopo, versione e proprietario;
- dati di input e localizzazione;
- retention e trasferimenti;
- metriche di qualita e casi limite;
- threshold di confidence e fallback umano;
- costi, rate limit e timeout;
- prompt/template versionati se applicabile;
- procedura di rollback e sostituzione provider.

I modelli non possono confermare autonomamente allergeni, valori nutrizionali o sicurezza alimentare quando l'errore puo causare danno. Le risposte generative sono etichettate e verificate nei flussi ad alto rischio.

## 10. Retention di riferimento

Da confermare con legale e DPO, ma la policy deve distinguere:

- sessioni e token: minimo necessario;
- foto raw: cancellazione dopo completamento/revisione, salvo consenso;
- eventi operativi: durata necessaria a audit e servizio;
- feature utente: TTL configurabile e cancellazione su revoca;
- log tecnici: retention breve, accesso ristretto;
- trace: sampling e retention breve rispetto alle metriche;
- backup: retention definita e cancellazione differita documentata.

## 11. Controlli obbligatori

Prima di attivare profilazione o offerte personalizzate:

- registro dei trattamenti e data classification;
- DPIA se il rischio lo richiede;
- verifica base giuridica, informative e consensi;
- DPA con provider AI, cloud e retailer;
- valutazione trasferimenti internazionali;
- test di cancellazione e revoca end-to-end;
- test di isolamento tenant e anti-reidentification;
- revisione umana dei suggerimenti ad alto impatto;
- canale per contestare o correggere una preferenza;
- audit periodico di accessi e usi secondari.
