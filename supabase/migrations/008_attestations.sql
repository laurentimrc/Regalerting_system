-- RegAlert — registro delle attestazioni: numerato, non modificabile, con catena di impronte SHA-256.
create sequence if not exists ra_attestation_seq;

create table if not exists ra_attestations (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint not null unique default nextval('ra_attestation_seq'),
  number        text not null unique,                     -- es. ATT-2026-00001
  deadline_id   bigint,                                   -- riferimento senza vincolo: la scadenza può essere cancellata, l'attestazione resta
  control_code  text,                                     -- codice del piano (es. C-05), se presente
  control_title text not null,
  area          text,
  owner_label   text,
  kind          text not null check (kind in ('presidio', 'controllo')),
  period        text not null,                            -- AAAA-MM per i presidi, data di scadenza per i controlli
  outcome       text not null check (outcome in ('ok', 'issues')),
  note          text,
  attested_by   uuid not null,
  attested_by_name  text,
  attested_by_email text,
  attested_at   timestamptz not null,
  backfilled    boolean not null default false,           -- registrata dopo, da un'attestazione già esistente
  prev_hash     text not null,
  hash          text not null unique
);
create index if not exists ra_attestations_deadline_idx on ra_attestations (deadline_id);
create index if not exists ra_attestations_period_idx on ra_attestations (period);

-- stringa canonica: ogni campo che conta entra nell'impronta
create or replace function ra_attestation_payload(a ra_attestations) returns text
language sql immutable set search_path = public as $$
  select concat_ws('|', a.number, a.id::text, coalesce(a.deadline_id::text, ''), coalesce(a.control_code, ''), a.control_title,
    coalesce(a.area, ''), coalesce(a.owner_label, ''), a.kind, a.period, a.outcome, coalesce(a.note, ''),
    a.attested_by::text, coalesce(a.attested_by_email, ''),
    to_char(a.attested_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), a.backfilled::text, a.prev_hash);
$$;

create or replace function ra_attestation_hash(a ra_attestations) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(ra_attestation_payload(a), 'sha256'), 'hex');
$$;

-- registro append-only: nessuna modifica o cancellazione, per nessuno
create or replace function ra_attestations_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Il registro delle attestazioni non è modificabile';
end $$;
drop trigger if exists ra_attestations_no_change on ra_attestations;
create trigger ra_attestations_no_change before update or delete on ra_attestations
  for each row execute function ra_attestations_immutable();
drop trigger if exists ra_attestations_no_truncate on ra_attestations;
create trigger ra_attestations_no_truncate before truncate on ra_attestations
  for each statement execute function ra_attestations_immutable();
revoke execute on function ra_attestations_immutable() from public, anon, authenticated;

alter table ra_attestations enable row level security;
drop policy if exists ra_attestations_select on ra_attestations;
create policy ra_attestations_select on ra_attestations for select to authenticated using (ra_is_member());
revoke insert, update, delete, truncate on ra_attestations from anon, authenticated;
revoke all on ra_attestations from anon;

-- inserimento interno: numera, concatena e firma con l'impronta
create or replace function ra_attestation_append(d ra_deadlines, p_outcome text, p_note text, p_user uuid, p_at timestamptz, p_backfilled boolean)
returns ra_attestations
language plpgsql security definer set search_path = public, extensions as $$
declare a ra_attestations; u record;
begin
  perform pg_advisory_xact_lock(hashtext('ra_attestations'));   -- catena lineare anche con attestazioni simultanee
  select au.email, coalesce(p.full_name, split_part(au.email, '@', 1)) as name into u
    from auth.users au left join ra_profiles p on p.id = au.id where au.id = p_user;
  a.id := gen_random_uuid();
  a.seq := nextval('ra_attestation_seq');
  a.number := 'ATT-' || to_char(p_at at time zone 'Europe/Rome', 'YYYY') || '-' || lpad(a.seq::text, 5, '0');
  a.deadline_id := d.id;
  a.control_code := coalesce(substring(d.notes from 'Codice piano: ([A-Za-z0-9.\-]+)'), substring(d.title from '^([A-Z]{1,4}-\d{1,4}) ·'));
  a.control_title := d.title; a.area := d.area; a.owner_label := d.owner_label;
  a.kind := case when d.continuous then 'presidio' else 'controllo' end;
  a.period := case when d.continuous then to_char(d.due_date, 'YYYY-MM') else d.due_date::text end;
  a.outcome := coalesce(p_outcome, 'ok'); a.note := nullif(trim(p_note), '');
  a.attested_by := p_user; a.attested_by_name := u.name; a.attested_by_email := u.email;
  a.attested_at := p_at; a.backfilled := p_backfilled;
  a.prev_hash := coalesce((select hash from ra_attestations order by seq desc limit 1), repeat('0', 64));
  a.hash := ra_attestation_hash(a);
  insert into ra_attestations select a.*;
  return a;
end $$;
revoke execute on function ra_attestation_append(ra_deadlines, text, text, uuid, timestamptz, boolean) from public, anon, authenticated;

-- completamento: per controlli e presidi crea l'attestazione nel registro
drop function if exists ra_complete_deadline(bigint, text, text);
create or replace function ra_complete_deadline(p_id bigint, p_outcome text default null, p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare d ra_deadlines; next_id bigint; step interval;
begin
  if not ra_can_edit() then raise exception 'Non autorizzato'; end if;
  if p_outcome is not null and p_outcome not in ('ok', 'issues') then raise exception 'Esito non valido'; end if;
  select * into d from ra_deadlines where id = p_id for update;
  if not found then raise exception 'Scadenza non trovata'; end if;
  if d.status = 'done' then return null; end if;
  if (d.kind = 'control' or d.continuous) and p_outcome = 'issues' and nullif(trim(p_note), '') is null then
    raise exception 'Con esito "con rilievi" le note sono obbligatorie';
  end if;
  update ra_deadlines set status = 'done', outcome = p_outcome, outcome_note = nullif(trim(p_note), '') where id = p_id;
  if d.kind = 'control' or d.continuous then
    perform ra_attestation_append(d, coalesce(p_outcome, 'ok'), p_note, auth.uid(), now(), false);
  end if;
  step := case d.recurrence
    when 'weekly' then interval '1 week' when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
    when 'semiannual' then interval '6 months' when 'yearly' then interval '1 year' else null end;
  if step is not null then
    insert into ra_deadlines (title, due_date, kind, authority, regulation, area, notes, url, assignee, owner_label, recurrence, remind_days, continuous, status, source, created_by)
    values (d.title,
            case when d.continuous and d.recurrence = 'monthly' then (date_trunc('month', d.due_date + interval '1 month') + interval '1 month - 1 day')::date
                 else (d.due_date + step)::date end,
            d.kind, d.authority, d.regulation, d.area, d.notes, d.url, d.assignee, d.owner_label, d.recurrence, d.remind_days, d.continuous, 'open', 'manual', auth.uid())
    returning id into next_id;
  end if;
  return next_id;
end $$;
revoke execute on function ra_complete_deadline(bigint, text, text) from public, anon;
grant execute on function ra_complete_deadline(bigint, text, text) to authenticated;

-- verifica della catena: ricalcola ogni impronta e il collegamento con la precedente
create or replace function ra_verify_attestations() returns table (total bigint, broken bigint, first_broken text, last_hash text)
language sql stable security definer set search_path = public, extensions as $$
  with c as (
    select a.number, a.seq, a.hash, a.prev_hash, ra_attestation_hash(a) as calc,
           coalesce(lag(a.hash) over (order by a.seq), repeat('0', 64)) as expected_prev
    from ra_attestations a
  )
  select count(*), count(*) filter (where hash <> calc or prev_hash <> expected_prev),
         (select number from c where hash <> calc or prev_hash <> expected_prev order by seq limit 1),
         (select hash from c order by seq desc limit 1)
  from c;
$$;
revoke execute on function ra_verify_attestations() from public, anon;
grant execute on function ra_verify_attestations() to authenticated;

-- attestazioni già registrate prima del registro: inserite con i loro dati originali e marcate come tali
do $$
declare d ra_deadlines;
begin
  for d in select * from ra_deadlines where status = 'done' and (kind = 'control' or continuous) and done_by is not null
             and not exists (select 1 from ra_attestations x where x.deadline_id = ra_deadlines.id)
           order by done_at, id loop
    perform ra_attestation_append(d, coalesce(d.outcome, 'ok'), d.outcome_note, d.done_by, d.done_at, true);
  end loop;
end $$;
