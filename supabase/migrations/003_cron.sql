-- RegAlert — pianificazione con pg_cron + pg_net.
-- Sostituire __PROJECT_URL__ con l'URL del progetto (es. https://xxxx.supabase.co).
-- Il segreto dei job è generato nel database e resta nel Vault: non serve impostarlo a mano.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ra_cron_secret', 'RegAlert: autenticazione dei job pianificati')
where not exists (select 1 from vault.secrets where name = 'ra_cron_secret');

-- usata dalle edge function (service role) per verificare l'header x-cron-secret
create or replace function ra_check_cron(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_secret = (select decrypted_secret from vault.decrypted_secrets where name = 'ra_cron_secret'), false);
$$;
revoke execute on function ra_check_cron(text) from public, anon, authenticated;
grant execute on function ra_check_cron(text) to service_role;

create or replace function ra_call_function(fn text, payload jsonb default '{}'::jsonb) returns bigint
language sql security definer set search_path = public as $$
  select net.http_post(
    url := '__PROJECT_URL__/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ra_cron_secret')
    ),
    body := payload,
    timeout_milliseconds := 150000
  );
$$;
revoke execute on function ra_call_function(text, jsonb) from public, anon, authenticated;

select cron.unschedule('ra-collect') where exists (select 1 from cron.job where jobname = 'ra-collect');
select cron.schedule('ra-collect', '*/30 * * * *', $$ select ra_call_function('collect'); $$);

select cron.unschedule('ra-instant') where exists (select 1 from cron.job where jobname = 'ra-instant');
select cron.schedule('ra-instant', '10,40 * * * *', $$ select ra_call_function('digest', '{"mode":"instant"}'); $$);

-- 06:40 UTC = 7:40 ora italiana (ora solare; d'estate diventa 8:40)
select cron.unschedule('ra-daily') where exists (select 1 from cron.job where jobname = 'ra-daily');
select cron.schedule('ra-daily', '40 6 * * 1-5', $$ select ra_call_function('digest', '{"mode":"daily"}'); $$);
