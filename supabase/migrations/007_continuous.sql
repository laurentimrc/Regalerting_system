-- RegAlert — presidi continuativi con attestazione periodica ed esito dei controlli.
alter table ra_deadlines add column if not exists continuous boolean not null default false;  -- presidio continuativo: la scadenza è l'attestazione periodica
alter table ra_deadlines add column if not exists outcome text check (outcome in ('ok', 'issues'));  -- esito al completamento
alter table ra_deadlines add column if not exists outcome_note text;

drop function if exists ra_complete_deadline(bigint);
create or replace function ra_complete_deadline(p_id bigint, p_outcome text default null, p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare d ra_deadlines; next_id bigint; step interval;
begin
  if not ra_can_edit() then raise exception 'Non autorizzato'; end if;
  if p_outcome is not null and p_outcome not in ('ok', 'issues') then raise exception 'Esito non valido'; end if;
  select * into d from ra_deadlines where id = p_id for update;
  if not found then raise exception 'Scadenza non trovata'; end if;
  if d.status = 'done' then return null; end if;
  update ra_deadlines set status = 'done', outcome = p_outcome, outcome_note = nullif(trim(p_note), '') where id = p_id;
  step := case d.recurrence
    when 'weekly' then interval '1 week' when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
    when 'semiannual' then interval '6 months' when 'yearly' then interval '1 year' else null end;
  if step is not null then
    insert into ra_deadlines (title, due_date, kind, authority, regulation, area, notes, url, assignee, owner_label, recurrence, remind_days, continuous, status, source, created_by)
    values (d.title,
            -- le attestazioni mensili cadono sempre a fine mese
            case when d.continuous and d.recurrence = 'monthly' then (date_trunc('month', d.due_date + interval '1 month') + interval '1 month - 1 day')::date
                 else (d.due_date + step)::date end,
            d.kind, d.authority, d.regulation, d.area, d.notes, d.url, d.assignee, d.owner_label, d.recurrence, d.remind_days, d.continuous, 'open', 'manual', auth.uid())
    returning id into next_id;
  end if;
  return next_id;
end $$;
revoke execute on function ra_complete_deadline(bigint, text, text) from public, anon;
grant execute on function ra_complete_deadline(bigint, text, text) to authenticated;
