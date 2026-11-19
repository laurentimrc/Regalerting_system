-- RegAlert — attività (task) del team: responsabile, priorità, stato, scadenza facoltativa, collegamento ad alert e scadenze.
create table if not exists ra_tasks (
  id           bigint generated always as identity primary key,
  title        text not null check (length(trim(title)) between 1 and 300),
  description  text check (length(description) <= 5000),
  status       text not null default 'todo' check (status in ('todo', 'doing', 'done', 'cancelled')),
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  assignee     uuid references ra_profiles(id) on delete set null,
  due_date     date,
  alert_id     bigint references ra_alerts(id) on delete set null,
  deadline_id  bigint references ra_deadlines(id) on delete set null,
  created_by   uuid references ra_profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  done_at      timestamptz,
  done_by      uuid references ra_profiles(id) on delete set null
);
create index if not exists ra_tasks_open_idx on ra_tasks (status, due_date);
create index if not exists ra_tasks_assignee_idx on ra_tasks (assignee);
create index if not exists ra_tasks_alert_idx on ra_tasks (alert_id);
create index if not exists ra_tasks_deadline_idx on ra_tasks (deadline_id);

-- autore e date gestiti dal server; chi non è analyst/admin può solo cambiare lo stato delle attività assegnate a lui
create or replace function ra_tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by; new.created_at := old.created_at;
    if auth.uid() is not null and not ra_can_edit() then
      if (to_jsonb(new) - 'status' - 'updated_at' - 'done_at' - 'done_by') <> (to_jsonb(old) - 'status' - 'updated_at' - 'done_at' - 'done_by') then
        raise exception 'Puoi solo aggiornare lo stato delle attività assegnate a te';
      end if;
    end if;
  end if;
  new.updated_at := now();
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.done_at := now(); new.done_by := auth.uid();
  elsif new.status <> 'done' then
    new.done_at := null; new.done_by := null;
  end if;
  return new;
end $$;
drop trigger if exists ra_tasks_guard_t on ra_tasks;
create trigger ra_tasks_guard_t before insert or update on ra_tasks for each row execute function ra_tasks_guard();

alter table ra_tasks enable row level security;
drop policy if exists ra_tasks_select on ra_tasks;
create policy ra_tasks_select on ra_tasks for select to authenticated using (ra_is_member());
drop policy if exists ra_tasks_insert on ra_tasks;
create policy ra_tasks_insert on ra_tasks for insert to authenticated with check (ra_can_edit());
drop policy if exists ra_tasks_update on ra_tasks;
create policy ra_tasks_update on ra_tasks for update to authenticated
  using (ra_can_edit() or (ra_is_member() and assignee = auth.uid()))
  with check (ra_can_edit() or (ra_is_member() and assignee = auth.uid()));
drop policy if exists ra_tasks_delete on ra_tasks;
create policy ra_tasks_delete on ra_tasks for delete to authenticated using (ra_can_edit());
revoke all on ra_tasks from anon;
grant select, insert, update, delete on ra_tasks to authenticated;

-- cancellazioni nel registro di sicurezza
create or replace function ra_audit_tasks() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform ra_audit('delete', 'task', old.id::text, jsonb_build_object('title', old.title, 'status', old.status, 'due_date', old.due_date));
  return null;
end $$;
drop trigger if exists ra_audit_tasks_t on ra_tasks;
create trigger ra_audit_tasks_t after delete on ra_tasks for each row execute function ra_audit_tasks();
revoke execute on function ra_tasks_guard(), ra_audit_tasks() from public, anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table ra_tasks;
exception when others then null; end $$;
