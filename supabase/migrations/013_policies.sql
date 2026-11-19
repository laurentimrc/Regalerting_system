-- RegAlert — registro delle politiche e procedure: versione, data di ultimo aggiornamento, scadenza di revisione, storico.
create table if not exists ra_policies (
  id            bigint generated always as identity primary key,
  code          text unique check (code is null or length(code) <= 40),        -- es. POL-AML-01
  title         text not null check (length(trim(title)) between 1 and 300),
  doc_type      text not null default 'policy' check (doc_type in ('policy', 'procedura', 'regolamento', 'manuale', 'altro')),
  area          text,                                                           -- es. AML/CFT, Market Abuse, Reclami
  regulation    text,                                                           -- riferimento normativo
  owner         uuid references ra_profiles(id) on delete set null,             -- responsabile in RegAlert
  owner_label   text,                                                           -- funzione responsabile esterna al team
  approver      text,                                                           -- organo che approva (CdA, AD, ...)
  version       text,
  last_updated  date,
  review_months int check (review_months is null or review_months between 1 and 120),
  next_review   date,                                                           -- entro quando va rivista
  remind_days   int not null default 30 check (remind_days between 0 and 180),
  status        text not null default 'in_force' check (status in ('draft', 'in_force', 'under_review', 'retired')),
  url           text check (url is null or url = '' or url ~* '^https?://'),
  notes         text check (length(notes) <= 5000),
  created_by    uuid references ra_profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ra_policies_review_idx on ra_policies (status, next_review);

-- se manca la scadenza ma c'è la periodicità, la calcola dall'ultimo aggiornamento
create or replace function ra_policies_defaults() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.next_review is null and new.review_months is not null and new.last_updated is not null then
    new.next_review := (new.last_updated + make_interval(months => new.review_months))::date;
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end $$;
drop trigger if exists ra_policies_defaults_t on ra_policies;
create trigger ra_policies_defaults_t before insert or update on ra_policies for each row execute function ra_policies_defaults();

-- storico degli aggiornamenti: non modificabile
create table if not exists ra_policy_versions (
  id           bigint generated always as identity primary key,
  policy_id    bigint not null references ra_policies(id) on delete cascade,
  version      text,
  updated_on   date not null,
  approved_by  text,
  note         text check (length(note) <= 3000),
  recorded_by  uuid references ra_profiles(id) on delete set null default auth.uid(),
  recorded_at  timestamptz not null default now()
);
create index if not exists ra_policy_versions_policy_idx on ra_policy_versions (policy_id, updated_on desc);
create or replace function ra_policy_versions_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from ra_policies where id = old.policy_id) then return old; end if;  -- cancellazione a cascata della politica
  raise exception 'Lo storico degli aggiornamenti non è modificabile';
end $$;
drop trigger if exists ra_policy_versions_no_change on ra_policy_versions;
create trigger ra_policy_versions_no_change before update or delete on ra_policy_versions for each row execute function ra_policy_versions_immutable();

alter table ra_policies enable row level security;
alter table ra_policy_versions enable row level security;
drop policy if exists ra_policies_select on ra_policies;
create policy ra_policies_select on ra_policies for select to authenticated using (ra_is_member());
drop policy if exists ra_policies_write on ra_policies;
create policy ra_policies_write on ra_policies for all to authenticated using (ra_can_edit()) with check (ra_can_edit());
drop policy if exists ra_policy_versions_select on ra_policy_versions;
create policy ra_policy_versions_select on ra_policy_versions for select to authenticated using (ra_is_member());
revoke all on ra_policies, ra_policy_versions from anon;
grant select, insert, update, delete on ra_policies to authenticated;
grant select on ra_policy_versions to authenticated;
revoke insert, update, delete, truncate on ra_policy_versions from authenticated;

-- registra un aggiornamento: storico + versione, data e prossima revisione della politica
create or replace function ra_policy_record_update(p_id bigint, p_version text, p_date date, p_approved_by text default null, p_note text default null, p_next_review date default null)
returns date
language plpgsql security definer set search_path = public as $$
declare p ra_policies; nxt date;
begin
  if not ra_can_edit() then raise exception 'Non autorizzato'; end if;
  select * into p from ra_policies where id = p_id for update;
  if not found then raise exception 'Politica non trovata'; end if;
  if p_date is null or p_date > current_date + 1 then raise exception 'Data di aggiornamento non valida'; end if;
  nxt := coalesce(p_next_review, case when p.review_months is not null then (p_date + make_interval(months => p.review_months))::date end);
  insert into ra_policy_versions (policy_id, version, updated_on, approved_by, note, recorded_by)
  values (p_id, nullif(trim(p_version), ''), p_date, nullif(trim(p_approved_by), ''), nullif(trim(p_note), ''), auth.uid());
  update ra_policies set version = coalesce(nullif(trim(p_version), ''), version), last_updated = p_date, next_review = nxt,
    approver = coalesce(nullif(trim(p_approved_by), ''), approver), status = case when status in ('under_review', 'draft') then 'in_force' else status end
  where id = p_id;
  return nxt;
end $$;
revoke execute on function ra_policy_record_update(bigint, text, date, text, text, date) from public, anon;
grant execute on function ra_policy_record_update(bigint, text, date, text, text, date) to authenticated;

-- cancellazioni nel registro di sicurezza
create or replace function ra_audit_policies() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform ra_audit('delete', 'policy', old.id::text, jsonb_build_object('title', old.title, 'code', old.code, 'version', old.version));
  return null;
end $$;
drop trigger if exists ra_audit_policies_t on ra_policies;
create trigger ra_audit_policies_t after delete on ra_policies for each row execute function ra_audit_policies();
revoke execute on function ra_policies_defaults(), ra_policy_versions_immutable(), ra_audit_policies() from public, anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table ra_policies;
exception when others then null; end $$;
