-- RegAlert — le funzioni dei trigger non sono richiamabili via API.
revoke execute on function ra_audit_deadlines(), ra_audit_mfa(), ra_audit_profiles(), ra_audit_settings(), ra_audit_sources(), ra_audit_immutable(), ra_check_source_url(), ra_guard_role_change() from public, anon, authenticated;
