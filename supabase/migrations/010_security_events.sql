-- RegAlert — eventi di sessione ed esportazioni nel registro di sicurezza; ultimo accesso e MFA nell'elenco del team.
-- Il progetto non conserva il log di Supabase Auth in tabella: gli accessi li registra la dashboard.
drop function if exists ra_login_history(int);

create or replace function ra_log_event(p_action text, p_details jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from ra_profiles where id = auth.uid()) then return; end if;
  if p_action not in ('login', 'logout', 'idle_logout', 'mfa_verified', 'mfa_failed', 'password_changed', 'password_reset_requested',
                      'export_register_pdf', 'export_register_csv', 'export_attestation_pdf', 'export_alerts_csv', 'export_ics') then
    raise exception 'Evento non previsto';
  end if;
  if length(coalesce(p_details, '{}'::jsonb)::text) > 2000 then p_details := jsonb_build_object('note', 'dettagli troppo lunghi, omessi'); end if;
  -- limite di sicurezza contro gli abusi: al massimo 60 eventi al minuto per utente
  if (select count(*) from ra_audit_log where actor = auth.uid() and at > now() - interval '1 minute') >= 60 then return; end if;
  perform ra_audit(p_action, 'session', auth.uid()::text, coalesce(p_details, '{}'::jsonb) - 'actor' - 'aal');
end $$;
revoke execute on function ra_log_event(text, jsonb) from public, anon;
grant execute on function ra_log_event(text, jsonb) to authenticated;

drop function if exists ra_team_mfa();
create or replace function ra_team_security() returns table (user_id uuid, has_mfa boolean, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select p.id,
         exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified'),
         case when ra_is_admin() then u.last_sign_in_at end
  from ra_profiles p join auth.users u on u.id = p.id
  where ra_is_member();
$$;
revoke execute on function ra_team_security() from public, anon;
grant execute on function ra_team_security() to authenticated;
