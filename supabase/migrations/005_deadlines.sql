-- RegAlert — scadenziario: scadenze normative, di segnalazione, consultazioni e scadenze interne.
do $$ begin
  create type ra_deadline_kind as enum ('regulatory', 'reporting', 'consultation', 'internal');
exception when duplicate_object then null; end $$;

create table if not exists ra_deadlines (
  id           bigint generated always as identity primary key,
  title        text not null,
  due_date     date not null,
  kind         ra_deadline_kind not null default 'regulatory',
  authority    text,
  regulation   text,                                   -- es. MiCAR art. 72, DORA, D.Lgs. 231/2007
  notes        text,
  url          text,
  alert_id     bigint references ra_alerts(id) on delete set null,
  assignee     uuid references ra_profiles(id) on delete set null,
  recurrence   text not null default 'none' check (recurrence in ('none', 'monthly', 'quarterly', 'yearly')),
  remind_days  int not null default 7 check (remind_days between 0 and 90),
  status       text not null default 'open' check (status in ('proposed', 'open', 'done')),
  source       text not null default 'manual' check (source in ('manual', 'ai')),
  done_at      timestamptz,
  done_by      uuid references ra_profiles(id) on delete set null,
  created_by   uuid references ra_profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists ra_deadlines_due_idx on ra_deadlines (status, due_date);
create index if not exists ra_deadlines_alert_idx on ra_deadlines (alert_id);
-- una sola proposta AI per data e alert
create unique index if not exists ra_deadlines_ai_uniq on ra_deadlines (alert_id, due_date) where source = 'ai';

create or replace function ra_deadlines_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'done' and old.status <> 'done' then
    new.done_at := now(); new.done_by := auth.uid();
  elsif new.status <> 'done' then
    new.done_at := null; new.done_by := null;
  end if;
  return new;
end $$;
drop trigger if exists ra_deadlines_bu on ra_deadlines;
create trigger ra_deadlines_bu before update on ra_deadlines for each row execute function ra_deadlines_touch();
revoke execute on function ra_deadlines_touch() from public, anon, authenticated;

alter table ra_deadlines enable row level security;
drop policy if exists ra_deadlines_select on ra_deadlines;
create policy ra_deadlines_select on ra_deadlines for select to authenticated using (ra_is_member());
drop policy if exists ra_deadlines_write on ra_deadlines;
create policy ra_deadlines_write on ra_deadlines for all to authenticated using (ra_can_edit()) with check (ra_can_edit());
revoke all on ra_deadlines from anon;

-- Completa una scadenza; se è ricorrente crea la successiva. Restituisce l'id della nuova occorrenza (o null).
create or replace function ra_complete_deadline(p_id bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare d ra_deadlines; next_id bigint; step interval;
begin
  if not ra_can_edit() then raise exception 'Non autorizzato'; end if;
  select * into d from ra_deadlines where id = p_id for update;
  if not found then raise exception 'Scadenza non trovata'; end if;
  if d.status = 'done' then return null; end if;
  update ra_deadlines set status = 'done' where id = p_id;
  step := case d.recurrence when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' when 'yearly' then interval '1 year' else null end;
  if step is not null then
    insert into ra_deadlines (title, due_date, kind, authority, regulation, notes, url, assignee, recurrence, remind_days, status, source, created_by)
    values (d.title, (d.due_date + step)::date, d.kind, d.authority, d.regulation, d.notes, d.url, d.assignee, d.recurrence, d.remind_days, 'open', 'manual', auth.uid())
    returning id into next_id;
  end if;
  return next_id;
end $$;
revoke execute on function ra_complete_deadline(bigint) from public, anon;
grant execute on function ra_complete_deadline(bigint) to authenticated;

do $$ begin
  alter publication supabase_realtime add table ra_deadlines;
exception when others then null; end $$;
