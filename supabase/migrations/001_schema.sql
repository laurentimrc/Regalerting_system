-- RegAlert — schema base
-- Registro fonti, alert, triage, audit trail, team con ruoli.
-- Tutte le tabelle hanno prefisso ra_ per poter convivere in un progetto esistente.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tipi
do $$ begin
  create type ra_role as enum ('pending', 'viewer', 'analyst', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ra_source_kind as enum ('rss', 'links', 'page');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ra_status as enum ('new', 'in_review', 'action_required', 'closed', 'not_relevant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ra_priority as enum ('low', 'medium', 'high', 'critical');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- team
create table if not exists ra_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text,
  role          ra_role not null default 'pending',
  notify_daily  boolean not null default true,      -- digest giornaliero via email
  notify_instant boolean not null default false,    -- alert immediati (rilevanza alta)
  telegram_chat_id text,
  created_at    timestamptz not null default now()
);

-- Ruolo dell'utente corrente (security definer: evita ricorsione nelle policy)
create or replace function ra_current_role() returns ra_role
language sql stable security definer set search_path = public as $$
  select coalesce((select role from ra_profiles where id = auth.uid()), 'pending'::ra_role);
$$;

create or replace function ra_is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select ra_current_role() in ('viewer', 'analyst', 'admin');
$$;

create or replace function ra_can_edit() returns boolean
language sql stable security definer set search_path = public as $$
  select ra_current_role() in ('analyst', 'admin');
$$;

create or replace function ra_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select ra_current_role() = 'admin';
$$;

-- Nuovo utente → profilo, solo per le iscrizioni fatte dalla dashboard RegAlert
-- (metadato app = 'regalert'): così gli utenti di altre app nello stesso progetto restano fuori.
-- Il primo iscritto da RegAlert diventa admin; gli altri restano "pending" finché un admin non li approva.
create or replace function ra_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_user_meta_data->>'app', '') <> 'regalert' then
    return new;
  end if;
  insert into ra_profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    case when exists (select 1 from ra_profiles where role = 'admin') then 'pending'::ra_role else 'admin'::ra_role end
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Utente già esistente nel progetto che entra per la prima volta in RegAlert: richiesta di accesso (pending).
create or replace function ra_join() returns void
language sql security definer set search_path = public as $$
  insert into ra_profiles (id, email, full_name, role)
  select u.id, u.email, coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1)), 'pending'
  from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;
$$;
revoke execute on function ra_join() from public, anon;
grant execute on function ra_join() to authenticated;

drop trigger if exists ra_on_auth_user_created on auth.users;
create trigger ra_on_auth_user_created
  after insert on auth.users
  for each row execute function ra_handle_new_user();

-- Solo un admin può cambiare ruoli
create or replace function ra_guard_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() nullo = service role o console SQL: consentito
  if new.role is distinct from old.role and auth.uid() is not null and not ra_is_admin() then
    raise exception 'Solo un admin può modificare i ruoli';
  end if;
  return new;
end $$;

drop trigger if exists ra_profiles_guard on ra_profiles;
create trigger ra_profiles_guard before update on ra_profiles
  for each row execute function ra_guard_role_change();

-- ---------------------------------------------------------------- fonti
create table if not exists ra_sources (
  id              bigint generated always as identity primary key,
  name            text not null,
  authority       text not null,                 -- es. ESMA, EBA, Banca d'Italia
  jurisdiction    text not null default 'EU',    -- EU | IT | INT
  url             text not null unique,
  kind            ra_source_kind not null,
  -- links: filtro opzionale sugli URL dei nuovi link (regex)
  link_pattern    text,
  -- page/links: selettore CSS opzionale per isolare il contenuto principale
  css_selector    text,
  tags            text[] not null default '{}',  -- es. {MiCAR,AML,DORA}
  active          boolean not null default true,
  check_every_minutes int not null default 360,
  last_checked_at timestamptz,
  last_status     text,                          -- ok | changed | error
  last_error      text,
  last_hash       text,
  last_snapshot   text,                          -- testo (page) o JSON dei link (links)
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- alert
create table if not exists ra_alerts (
  id              bigint generated always as identity primary key,
  source_id       bigint not null references ra_sources(id) on delete cascade,
  fingerprint     text not null,                 -- dedup: guid/url/hash
  url             text,
  title           text not null,
  excerpt         text,                          -- testo/descrizione originale
  diff            text,                          -- per le pagine: righe aggiunte/rimosse
  published_at    timestamptz,
  detected_at     timestamptz not null default now(),
  tags            text[] not null default '{}',
  -- arricchimento AI
  ai_summary      text,
  ai_relevance    text check (ai_relevance in ('high','medium','low','none')),
  ai_impact       text,
  ai_topics       text[],
  ai_processed_at timestamptz,
  -- triage
  status          ra_status not null default 'new',
  priority        ra_priority not null default 'medium',
  assignee        uuid references ra_profiles(id) on delete set null,
  impact_assessment text,
  actions         text,
  due_date        date,
  closed_at       timestamptz,
  updated_at      timestamptz not null default now(),
  -- notifiche
  notified_daily_at   timestamptz,
  notified_instant_at timestamptz,
  unique (source_id, fingerprint)
);

create index if not exists ra_alerts_status_idx   on ra_alerts (status, detected_at desc);
create index if not exists ra_alerts_detected_idx on ra_alerts (detected_at desc);
create index if not exists ra_alerts_assignee_idx on ra_alerts (assignee);
create index if not exists ra_alerts_tags_idx     on ra_alerts using gin (tags);

-- ---------------------------------------------------------------- audit trail (append-only)
create table if not exists ra_alert_events (
  id         bigint generated always as identity primary key,
  alert_id   bigint not null references ra_alerts(id) on delete cascade,
  actor      uuid references ra_profiles(id) on delete set null,
  action     text not null,          -- created | status | priority | assignee | assessment | actions | due_date | comment
  from_value text,
  to_value   text,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists ra_alert_events_alert_idx on ra_alert_events (alert_id, created_at);

create or replace function ra_alerts_before_update() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.status in ('closed', 'not_relevant') and old.status not in ('closed', 'not_relevant') then
    new.closed_at := now();
  elsif new.status not in ('closed', 'not_relevant') then
    new.closed_at := null;
  end if;
  return new;
end $$;

create or replace function ra_alerts_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare a uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into ra_alert_events (alert_id, actor, action, to_value)
    values (new.id, null, 'created', new.title);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into ra_alert_events (alert_id, actor, action, from_value, to_value)
    values (new.id, a, 'status', old.status::text, new.status::text);
  end if;
  if new.priority is distinct from old.priority then
    insert into ra_alert_events (alert_id, actor, action, from_value, to_value)
    values (new.id, a, 'priority', old.priority::text, new.priority::text);
  end if;
  if new.assignee is distinct from old.assignee then
    insert into ra_alert_events (alert_id, actor, action, from_value, to_value)
    values (new.id, a, 'assignee',
            (select coalesce(full_name, email) from ra_profiles where id = old.assignee),
            (select coalesce(full_name, email) from ra_profiles where id = new.assignee));
  end if;
  if new.impact_assessment is distinct from old.impact_assessment then
    insert into ra_alert_events (alert_id, actor, action, from_value, to_value)
    values (new.id, a, 'assessment', old.impact_assessment, new.impact_assessment);
  end if;
  if new.actions is distinct from old.actions then
    insert into ra_alert_events (alert_id, actor, action, from_value, to_value)
    values (new.id, a, 'actions', old.actions, new.actions);
  end if;
  if new.due_date is distinct from old.due_date then
    insert into ra_alert_events (alert_id, actor, action, from_value, to_value)
    values (new.id, a, 'due_date', old.due_date::text, new.due_date::text);
  end if;
  return new;
end $$;

drop trigger if exists ra_alerts_bu on ra_alerts;
create trigger ra_alerts_bu before update on ra_alerts
  for each row execute function ra_alerts_before_update();

drop trigger if exists ra_alerts_ai on ra_alerts;
create trigger ra_alerts_ai after insert or update on ra_alerts
  for each row execute function ra_alerts_audit();

-- ---------------------------------------------------------------- impostazioni
create table if not exists ra_settings (
  key   text primary key,
  value text not null
);

insert into ra_settings (key, value) values
  ('org_profile', 'CASP autorizzato in Italia ai sensi del Reg. (UE) 2023/1114 (MiCAR). Servizi: custodia e amministrazione di cripto-attività, scambio cripto/fondi, esecuzione e ricezione/trasmissione ordini. Soggetto obbligato AML/CFT (D.Lgs. 231/2007), Travel Rule (Reg. UE 2023/1113), DORA (Reg. UE 2022/2554). Autorità competenti: Consob e Banca d''Italia; UIF per AML.'),
  ('digest_recipients_extra', '')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- RLS
alter table ra_profiles     enable row level security;
alter table ra_sources      enable row level security;
alter table ra_alerts       enable row level security;
alter table ra_alert_events enable row level security;
alter table ra_settings     enable row level security;

-- profili
drop policy if exists ra_profiles_select on ra_profiles;
create policy ra_profiles_select on ra_profiles for select to authenticated
  using (id = auth.uid() or ra_is_member());
drop policy if exists ra_profiles_update_self on ra_profiles;
create policy ra_profiles_update_self on ra_profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists ra_profiles_update_admin on ra_profiles;
create policy ra_profiles_update_admin on ra_profiles for update to authenticated
  using (ra_is_admin()) with check (ra_is_admin());

-- fonti
drop policy if exists ra_sources_select on ra_sources;
create policy ra_sources_select on ra_sources for select to authenticated using (ra_is_member());
drop policy if exists ra_sources_write on ra_sources;
create policy ra_sources_write on ra_sources for all to authenticated
  using (ra_can_edit()) with check (ra_can_edit());

-- alert: lettura per i membri, modifica (solo campi di triage) per analyst/admin
drop policy if exists ra_alerts_select on ra_alerts;
create policy ra_alerts_select on ra_alerts for select to authenticated using (ra_is_member());
drop policy if exists ra_alerts_update on ra_alerts;
create policy ra_alerts_update on ra_alerts for update to authenticated
  using (ra_can_edit()) with check (ra_can_edit());

revoke update on ra_alerts from authenticated;
grant update (status, priority, assignee, impact_assessment, actions, due_date) on ra_alerts to authenticated;

-- audit: lettura per i membri, solo commenti in inserimento, nessuna modifica/cancellazione
drop policy if exists ra_events_select on ra_alert_events;
create policy ra_events_select on ra_alert_events for select to authenticated using (ra_is_member());
drop policy if exists ra_events_comment on ra_alert_events;
create policy ra_events_comment on ra_alert_events for insert to authenticated
  with check (ra_can_edit() and action = 'comment' and actor = auth.uid());

revoke update, delete, truncate on ra_alert_events from authenticated, anon;
revoke insert, update, delete, truncate on ra_alerts from anon;

-- impostazioni
drop policy if exists ra_settings_select on ra_settings;
create policy ra_settings_select on ra_settings for select to authenticated using (ra_is_member());
drop policy if exists ra_settings_write on ra_settings;
create policy ra_settings_write on ra_settings for all to authenticated
  using (ra_is_admin()) with check (ra_is_admin());

-- ---------------------------------------------------------------- vista per la dashboard
create or replace view ra_alerts_view with (security_invoker = true) as
select a.*,
       s.name      as source_name,
       s.authority as source_authority,
       s.jurisdiction,
       p.full_name as assignee_name
from ra_alerts a
join ra_sources s on s.id = a.source_id
left join ra_profiles p on p.id = a.assignee;

grant select on ra_alerts_view to authenticated;
