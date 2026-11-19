-- RegAlert — attività unite allo scadenziario: un solo elenco, un solo modulo.
-- Il tipo "internal" diventa "Attività" (etichetta nella dashboard): ha priorità, stato "in corso" e data facoltativa.
alter table ra_deadlines add column if not exists priority text not null default 'medium';
do $$ begin
  alter table ra_deadlines add constraint ra_deadlines_priority_chk check (priority in ('low', 'medium', 'high', 'critical'));
exception when duplicate_object then null; end $$;
alter table ra_deadlines add column if not exists in_progress boolean not null default false;
alter table ra_deadlines alter column due_date drop not null;
do $$ begin
  alter table ra_deadlines add constraint ra_deadlines_date_chk check (due_date is not null or (kind = 'internal' and status <> 'proposed' and recurrence = 'none' and not continuous));
exception when duplicate_object then null; end $$;

-- completamento: anche chi è assegnatario (es. un viewer) può chiudere le proprie voci
drop function if exists ra_complete_deadline(bigint, text, text);
create or replace function ra_complete_deadline(p_id bigint, p_outcome text default null, p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare d ra_deadlines; next_id bigint; step interval;
begin
  if p_outcome is not null and p_outcome not in ('ok', 'issues') then raise exception 'Esito non valido'; end if;
  select * into d from ra_deadlines where id = p_id for update;
  if not found then raise exception 'Scadenza non trovata'; end if;
  -- analyst e admin; chiunque del team per le voci assegnate a lui
  if not (ra_can_edit() or (ra_is_member() and coalesce(d.assignee = auth.uid(), false))) then raise exception 'Non autorizzato'; end if;
  if d.status = 'done' then return null; end if;
  if (d.kind = 'control' or d.continuous) and p_outcome = 'issues' and nullif(trim(p_note), '') is null then
    raise exception 'Con esito "con rilievi" le note sono obbligatorie';
  end if;
  update ra_deadlines set status = 'done', in_progress = false, outcome = p_outcome, outcome_note = nullif(trim(p_note), '') where id = p_id;
  if d.kind = 'control' or d.continuous then
    perform ra_attestation_append(d, coalesce(p_outcome, 'ok'), p_note, auth.uid(), now(), false);
  end if;
  step := case d.recurrence
    when 'weekly' then interval '1 week' when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
    when 'semiannual' then interval '6 months' when 'yearly' then interval '1 year' else null end;
  if step is not null and d.due_date is not null then
    insert into ra_deadlines (title, due_date, kind, authority, regulation, area, notes, url, assignee, owner_label, recurrence, remind_days, continuous, priority, status, source, created_by)
    values (d.title,
            case when d.continuous and d.recurrence = 'monthly' then (date_trunc('month', d.due_date + interval '1 month') + interval '1 month - 1 day')::date
                 else (d.due_date + step)::date end,
            d.kind, d.authority, d.regulation, d.area, d.notes, d.url, d.assignee, d.owner_label, d.recurrence, d.remind_days, d.continuous, d.priority, 'open', 'manual', auth.uid())
    returning id into next_id;
  end if;
  return next_id;
end $$;
revoke execute on function ra_complete_deadline(bigint, text, text) from public, anon;
grant execute on function ra_complete_deadline(bigint, text, text) to authenticated;

-- "in corso": per analyst/admin e per l'assegnatario
create or replace function ra_set_in_progress(p_id bigint, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d ra_deadlines;
begin
  select * into d from ra_deadlines where id = p_id;
  if not found then raise exception 'Voce non trovata'; end if;
  if not (ra_can_edit() or (ra_is_member() and coalesce(d.assignee = auth.uid(), false))) then raise exception 'Non autorizzato'; end if;
  if d.status <> 'open' then raise exception 'La voce non è aperta'; end if;
  update ra_deadlines set in_progress = coalesce(p_on, false) where id = p_id;
end $$;
revoke execute on function ra_set_in_progress(bigint, boolean) from public, anon;
grant execute on function ra_set_in_progress(bigint, boolean) to authenticated;

-- la tabella separata delle attività non serve più (era vuota)
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'ra_tasks') then
    if exists (select 1 from ra_tasks) then raise exception 'ra_tasks contiene dati: migrarli prima'; end if;
    begin alter publication supabase_realtime drop table ra_tasks; exception when others then null; end;
    drop table ra_tasks;
  end if;
end $$;
drop function if exists ra_tasks_guard();
drop function if exists ra_audit_tasks();
