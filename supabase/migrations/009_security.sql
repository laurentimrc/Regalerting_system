-- RegAlert — sicurezza: verifica in due passaggi (MFA), registro di sicurezza, protezione dei ruoli e delle fonti.

-- ---------------------------------------------------------------- MFA
-- Chi ha attivato un'app di autenticazione deve aver completato il secondo passaggio (aal2) per vedere i dati.
-- Se l'amministratore attiva "require_mfa", vale per tutti: senza MFA si resta senza accesso ai dati.
insert into ra_settings (key, value) values ('require_mfa', 'false'), ('idle_timeout_minutes', '30')
on conflict (key) do nothing;

create or replace function ra_mfa_ok() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      or (not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
          and coalesce((select value from ra_settings where key = 'require_mfa'), 'false') <> 'true');
$$;

-- tutte le policy passano da qui: senza secondo passaggio il ruolo vale "pending"
create or replace function ra_current_role() returns ra_role
language sql stable security definer set search_path = public as $$
  select case
    when coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then 'pending'::ra_role
    when not ra_mfa_ok() then 'pending'::ra_role
    else coalesce((select role from ra_profiles where id = auth.uid()), 'pending'::ra_role) end;
$$;

-- stato di sicurezza dell'utente corrente, per la dashboard (non rivela nulla di altri utenti)
create or replace function ra_security_status() returns jsonb
language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'require_mfa', coalesce((select value from ra_settings where key = 'require_mfa'), 'false') = 'true',
    'idle_timeout_minutes', coalesce((select value from ra_settings where key = 'idle_timeout_minutes')::int, 30),
    'has_factor', exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'),
    'aal', coalesce(auth.jwt()->>'aal', 'aal1'),
    'mfa_ok', ra_mfa_ok());
$$;

-- per l'elenco del team: chi ha attivato la verifica in due passaggi (solo membri con accesso)
create or replace function ra_team_mfa() returns table (user_id uuid, has_mfa boolean)
language sql stable security definer set search_path = public, auth as $$
  select p.id, exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')
  from ra_profiles p where ra_is_member();
$$;

revoke execute on function ra_mfa_ok(), ra_security_status(), ra_team_mfa() from public, anon;
grant execute on function ra_mfa_ok(), ra_security_status(), ra_team_mfa() to authenticated;

-- ---------------------------------------------------------------- registro di sicurezza (append-only)
create table if not exists ra_audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  actor_email text,
  aal        text,
  action     text not null,
  entity     text not null,
  entity_id  text,
  details    jsonb
);
create index if not exists ra_audit_log_at_idx on ra_audit_log (at desc);

create or replace function ra_audit_immutable() returns trigger
language plpgsql set search_path = public as $$
begin raise exception 'Il registro di sicurezza non è modificabile'; end $$;
drop trigger if exists ra_audit_no_change on ra_audit_log;
create trigger ra_audit_no_change before update or delete on ra_audit_log for each row execute function ra_audit_immutable();
drop trigger if exists ra_audit_no_truncate on ra_audit_log;
create trigger ra_audit_no_truncate before truncate on ra_audit_log for each statement execute function ra_audit_immutable();

alter table ra_audit_log enable row level security;
drop policy if exists ra_audit_select on ra_audit_log;
create policy ra_audit_select on ra_audit_log for select to authenticated using (ra_is_admin());
revoke all on ra_audit_log from anon;
revoke insert, update, delete, truncate on ra_audit_log from authenticated;

create or replace function ra_audit(p_action text, p_entity text, p_entity_id text, p_details jsonb) returns void
language sql security definer set search_path = public, auth as $$
  insert into ra_audit_log (actor, actor_email, aal, action, entity, entity_id, details)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), auth.jwt()->>'aal', p_action, p_entity, p_entity_id, p_details);
$$;
revoke execute on function ra_audit(text, text, text, jsonb) from public, anon, authenticated;

-- profili: iscrizioni, cambi di ruolo, rimozioni
create or replace function ra_audit_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform ra_audit('signup', 'profile', new.id::text, jsonb_build_object('email', new.email, 'role', new.role));
  elsif tg_op = 'DELETE' then perform ra_audit('remove', 'profile', old.id::text, jsonb_build_object('email', old.email, 'role', old.role));
  elsif new.role is distinct from old.role then perform ra_audit('role_change', 'profile', new.id::text, jsonb_build_object('email', new.email, 'from', old.role, 'to', new.role));
  end if;
  return null;
end $$;
drop trigger if exists ra_audit_profiles_t on ra_profiles;
create trigger ra_audit_profiles_t after insert or update or delete on ra_profiles for each row execute function ra_audit_profiles();

-- fonti: solo le modifiche di configurazione (non i controlli periodici del raccoglitore)
create or replace function ra_audit_sources() returns trigger
language plpgsql security definer set search_path = public as $$
declare cfg_old jsonb; cfg_new jsonb;
begin
  if tg_op = 'INSERT' then perform ra_audit('create', 'source', new.id::text, jsonb_build_object('name', new.name, 'url', new.url, 'kind', new.kind));
  elsif tg_op = 'DELETE' then perform ra_audit('delete', 'source', old.id::text, jsonb_build_object('name', old.name, 'url', old.url));
  else
    cfg_old := jsonb_build_object('name', old.name, 'url', old.url, 'kind', old.kind, 'active', old.active, 'link_pattern', old.link_pattern, 'css_selector', old.css_selector, 'authority', old.authority);
    cfg_new := jsonb_build_object('name', new.name, 'url', new.url, 'kind', new.kind, 'active', new.active, 'link_pattern', new.link_pattern, 'css_selector', new.css_selector, 'authority', new.authority);
    if cfg_old <> cfg_new then perform ra_audit('update', 'source', new.id::text, jsonb_build_object('from', cfg_old, 'to', cfg_new)); end if;
  end if;
  return null;
end $$;
drop trigger if exists ra_audit_sources_t on ra_sources;
create trigger ra_audit_sources_t after insert or update or delete on ra_sources for each row execute function ra_audit_sources();

-- impostazioni
create or replace function ra_audit_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform ra_audit(lower(tg_op), 'setting', coalesce(new.key, old.key),
    jsonb_build_object('from', left(old.value, 300), 'to', left(new.value, 300)));
  return null;
end $$;
drop trigger if exists ra_audit_settings_t on ra_settings;
create trigger ra_audit_settings_t after insert or update or delete on ra_settings for each row execute function ra_audit_settings();

-- scadenze: cancellazioni e riaperture di elementi già completati o attestati
create or replace function ra_audit_deadlines() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform ra_audit('delete', 'deadline', old.id::text, jsonb_build_object('title', old.title, 'due_date', old.due_date, 'status', old.status));
  elsif old.status = 'done' and new.status <> 'done' then
    perform ra_audit('reopen', 'deadline', new.id::text, jsonb_build_object('title', new.title, 'due_date', new.due_date, 'outcome', old.outcome));
  end if;
  return null;
end $$;
drop trigger if exists ra_audit_deadlines_t on ra_deadlines;
create trigger ra_audit_deadlines_t after update or delete on ra_deadlines for each row execute function ra_audit_deadlines();

-- verifica in due passaggi attivata o rimossa (solo per gli utenti di RegAlert)
create or replace function ra_audit_mfa() returns trigger
language plpgsql security definer set search_path = public as $$
declare uid uuid := coalesce(new.user_id, old.user_id);
begin
  if not exists (select 1 from ra_profiles where id = uid) then return null; end if;
  if tg_op = 'DELETE' and old.status = 'verified' then
    insert into ra_audit_log (actor, actor_email, aal, action, entity, entity_id, details)
    values (auth.uid(), (select email from ra_profiles where id = uid), auth.jwt()->>'aal', 'mfa_removed', 'profile', uid::text, jsonb_build_object('factor', old.factor_type));
  elsif tg_op = 'UPDATE' and new.status = 'verified' and old.status is distinct from 'verified' then
    insert into ra_audit_log (actor, actor_email, aal, action, entity, entity_id, details)
    values (uid, (select email from ra_profiles where id = uid), auth.jwt()->>'aal', 'mfa_enabled', 'profile', uid::text, jsonb_build_object('factor', new.factor_type));
  end if;
  return null;
end $$;
drop trigger if exists ra_audit_mfa_t on auth.mfa_factors;
create trigger ra_audit_mfa_t after update or delete on auth.mfa_factors for each row execute function ra_audit_mfa();

-- accessi recenti (dal registro di Supabase Auth), solo per gli amministratori e solo per gli utenti di RegAlert
create or replace function ra_login_history(p_limit int default 100) returns table (at timestamptz, email text, action text, ip text)
language sql stable security definer set search_path = public, auth as $$
  select e.created_at, coalesce(e.payload->>'actor_username', p.email), e.payload->>'action', nullif(e.ip_address, '')
  from auth.audit_log_entries e
  join ra_profiles p on p.id::text = e.payload->>'actor_id'
  where ra_is_admin() and e.payload->>'action' in ('login', 'logout', 'user_recovery_requested', 'user_updated_password', 'token_refreshed_failed', 'user_signedup', 'factor_in_progress', 'verification_attempted')
  order by e.created_at desc limit least(greatest(p_limit, 1), 500);
$$;
revoke execute on function ra_login_history(int) from public, anon;
grant execute on function ra_login_history(int) to authenticated;

-- ---------------------------------------------------------------- ruoli
-- un admin non può togliersi il ruolo da solo, e deve restare almeno un admin
create or replace function ra_guard_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    if not ra_is_admin() then raise exception 'Solo un admin può modificare i ruoli'; end if;
    if old.id = auth.uid() then raise exception 'Non puoi cambiare il tuo ruolo: chiedilo a un altro amministratore'; end if;
    if old.role = 'admin' and not exists (select 1 from ra_profiles where role = 'admin' and id <> old.id) then
      raise exception 'Deve restare almeno un amministratore';
    end if;
  end if;
  if new.email is distinct from old.email and auth.uid() is not null then
    raise exception 'L''email del profilo segue quella dell''account e non si modifica da qui';
  end if;
  return new;
end $$;

-- colonne modificabili dal client: niente email, id o data di creazione
revoke update on ra_profiles from authenticated;
grant update (full_name, notify_daily, notify_instant, telegram_chat_id, role) on ra_profiles to authenticated;

-- ---------------------------------------------------------------- fonti: solo indirizzi pubblici
-- impedisce di puntare il raccoglitore su indirizzi interni (localhost, IP privati, servizi di metadati)
create or replace function ra_is_public_url(u text) returns boolean
language plpgsql immutable set search_path = public as $$
declare host text; port text;
begin
  if u is null or u !~* '^https?://[^/?#\s]+' or u ~ '\s' or length(u) > 2048 then return false; end if;
  host := lower(substring(u from '^[a-zA-Z]+://(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]+)'));
  port := substring(u from '^[a-zA-Z]+://(?:[^@/?#]*@)?(?:\[[^\]]*\]|[^:/?#]+):([0-9]+)');
  if u ~ '^[a-zA-Z]+://[^/?#]*@' then return false; end if;                         -- credenziali nell'URL
  if port is not null and port not in ('80', '443') then return false; end if;
  if host is null or host !~ '\.' or host ~ '^\[' then return false; end if;          -- serve un dominio; niente IPv6 letterali
  if host ~ '^[0-9.]+$' then return false; end if;                                   -- niente IP letterali
  if host ~ '(^|\.)(localhost|local|internal|intranet|lan|home|corp|svc|cluster\.local)$' then return false; end if;
  if host ~ '(^|\.)(supabase\.co|supabase\.in|supabase\.net)$' then return false; end if;
  return true;
end $$;

create or replace function ra_check_source_url() returns trigger
language plpgsql set search_path = public as $$
begin
  if not ra_is_public_url(new.url) then
    raise exception 'Indirizzo non ammesso: usa un sito pubblico http(s) con nome di dominio (niente IP, localhost, porte particolari o credenziali)';
  end if;
  return new;
end $$;
drop trigger if exists ra_sources_url_guard on ra_sources;
create trigger ra_sources_url_guard before insert or update of url on ra_sources for each row execute function ra_check_source_url();

-- link degli alert e delle scadenze: solo http(s), per evitare link "javascript:" nelle email e nella dashboard
do $$ begin
  alter table ra_alerts add constraint ra_alerts_url_http check (url is null or url ~* '^https?://') not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table ra_deadlines add constraint ra_deadlines_url_http check (url is null or url = '' or url ~* '^https?://') not valid;
exception when duplicate_object then null; end $$;
