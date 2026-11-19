-- RegAlert — registra anche l'esportazione del registro delle politiche.
create or replace function ra_log_event(p_action text, p_details jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from ra_profiles where id = auth.uid()) then return; end if;
  if p_action not in ('login', 'logout', 'idle_logout', 'mfa_verified', 'mfa_failed', 'password_changed', 'password_reset_requested',
                      'export_register_pdf', 'export_register_csv', 'export_attestation_pdf', 'export_alerts_csv', 'export_ics', 'export_policies_csv') then
    raise exception 'Evento non previsto';
  end if;
  if length(coalesce(p_details, '{}'::jsonb)::text) > 2000 then p_details := jsonb_build_object('note', 'dettagli troppo lunghi, omessi'); end if;
  -- limite di sicurezza contro gli abusi: al massimo 60 eventi al minuto per utente
  if (select count(*) from ra_audit_log where actor = auth.uid() and at > now() - interval '1 minute') >= 60 then return; end if;
  perform ra_audit(p_action, 'session', auth.uid()::text, coalesce(p_details, '{}'::jsonb) - 'actor' - 'aal');
end $$;
revoke execute on function ra_log_event(text, jsonb) from public, anon;
grant execute on function ra_log_event(text, jsonb) to authenticated;
