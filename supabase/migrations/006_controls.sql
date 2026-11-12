-- RegAlert — calendario dei controlli nello scadenziario.
alter type ra_deadline_kind add value if not exists 'control';

alter table ra_deadlines add column if not exists area text;            -- es. AML, MiCAR, Market abuse
alter table ra_deadlines add column if not exists owner_label text;     -- responsabile non presente nel team (es. "Funzione Risk")
alter table ra_deadlines add column if not exists import_batch text;    -- lotto di importazione, per annullarlo in blocco
create index if not exists ra_deadlines_batch_idx on ra_deadlines (import_batch);

alter table ra_deadlines drop constraint if exists ra_deadlines_recurrence_check;
alter table ra_deadlines add constraint ra_deadlines_recurrence_check
  check (recurrence in ('none', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'));

create or replace function ra_complete_deadline(p_id bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare d ra_deadlines; next_id bigint; step interval;
begin
  if not ra_can_edit() then raise exception 'Non autorizzato'; end if;
  select * into d from ra_deadlines where id = p_id for update;
  if not found then raise exception 'Scadenza non trovata'; end if;
  if d.status = 'done' then return null; end if;
  update ra_deadlines set status = 'done' where id = p_id;
  step := case d.recurrence
    when 'weekly' then interval '1 week' when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
    when 'semiannual' then interval '6 months' when 'yearly' then interval '1 year' else null end;
  if step is not null then
    insert into ra_deadlines (title, due_date, kind, authority, regulation, area, notes, url, assignee, owner_label, recurrence, remind_days, status, source, created_by)
    values (d.title, (d.due_date + step)::date, d.kind, d.authority, d.regulation, d.area, d.notes, d.url, d.assignee, d.owner_label, d.recurrence, d.remind_days, 'open', 'manual', auth.uid())
    returning id into next_id;
  end if;
  return next_id;
end $$;
revoke execute on function ra_complete_deadline(bigint) from public, anon;
grant execute on function ra_complete_deadline(bigint) to authenticated;
