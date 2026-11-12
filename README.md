# RegAlert

Monitoraggio normativo per il team compliance: raccoglie le novità da autorità UE e italiane, le sintetizza con l'AI, le smista con un triage tracciato e invia digest via email o Telegram.

## Componenti

| Parte | File | Cosa fa |
|---|---|---|
| Database | `supabase/migrations/001_schema.sql` | Fonti, alert, triage, audit trail append-only, team con ruoli (pending/viewer/analyst/admin), RLS |
| Fonti iniziali | `supabase/migrations/002_seed_sources.sql` | EBA, ESMA, Banca d'Italia, Consob, UIF |
| Pianificazione | `supabase/migrations/003_cron.sql` | pg_cron: raccolta ogni 30', avvisi immediati, digest feriale alle 7:40; segreto dei job nel Vault |
| Permessi | `supabase/migrations/004_hardening.sql` | Funzioni interne non chiamabili via API, utenti anonimi esclusi |
| Raccolta | `supabase/functions/collect` | Feed RSS/Atom, nuovi link su pagine-elenco, diff del testo di pagine; sintesi AI |
| Notifiche | `supabase/functions/digest` | Digest giornaliero e avvisi immediati via Resend e Telegram |
| Dashboard | `index.html` (pubblicata con GitHub Pages) | Inbox alert, triage, storico, registro fonti, team, impostazioni |

## Tre modi di monitorare una fonte

- **rss**: legge il feed ufficiale (il più affidabile).
- **links**: confronta i link di contenuto di una pagina-elenco (news, comunicati, consultazioni) e crea un alert per ogni link nuovo. `link_pattern` (regex) restringe ai link pertinenti.
- **page**: confronta il testo di una pagina (Q&A, pagine tematiche) e salva le righe aggiunte e rimosse.

Al primo controllo ogni fonte registra lo stato di partenza senza generare alert (dai feed si importano solo le uscite degli ultimi 7 giorni).

## Installazione

1. Applicare le migrazioni 001 e 002.
2. Pubblicare le edge function `collect` e `digest` (con `verify_jwt = false`: l'autorizzazione è gestita nel codice) includendo la cartella `_shared`.
3. Impostare i secret delle edge function (tutti facoltativi):
   - `ANTHROPIC_API_KEY` (sintesi AI; opzionale) e `AI_MODEL` (default `claude-haiku-5-5`)
   - `RESEND_API_KEY` e `DIGEST_FROM` (email; opzionali)
   - `TELEGRAM_BOT_TOKEN` (opzionale)
   - `DASHBOARD_URL` (link nel digest; opzionale)
4. Applicare 003 (sostituendo `__PROJECT_URL__`) e 004.
5. Dashboard: `index.html` contiene URL e chiave pubblica del progetto (pensata per stare nel browser; i dati sono protetti dalle policy RLS). È pubblicata con GitHub Pages dal branch `main`.
6. Registrarsi dalla dashboard: il primo iscritto da RegAlert diventa admin, gli altri restano in attesa finché un admin non assegna un ruolo. Gli utenti di altre app nello stesso progetto non entrano in RegAlert: se accedono dalla dashboard creano solo una richiesta di accesso.

## Test

```
cd supabase/functions && deno test -A _shared/parse_test.ts
```

## Limiti noti

- Le pagine che caricano i contenuti via JavaScript non sono leggibili con un semplice fetch: per quelle serve il feed o un endpoint alternativo.
- I PDF collegati non vengono letti dall'AI (la sintesi usa titolo ed estratto).
- Il digest delle 7:40 è espresso in UTC: va spostato di un'ora al cambio dell'ora legale.
- Le sintesi AI sono una valutazione preliminare: la valutazione d'impatto resta del team.
