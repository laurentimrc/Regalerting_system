-- RegAlert — permessi minimi sulle funzioni e blocco degli utenti anonimi.
revoke execute on function ra_alerts_audit() from public, anon, authenticated;
revoke execute on function ra_guard_role_change() from public, anon, authenticated;
revoke execute on function ra_handle_new_user() from public, anon, authenticated;
revoke execute on function ra_alerts_before_update() from public, anon, authenticated;

revoke execute on function ra_current_role() from public, anon;
revoke execute on function ra_is_member() from public, anon;
revoke execute on function ra_can_edit() from public, anon;
revoke execute on function ra_is_admin() from public, anon;
grant execute on function ra_current_role(), ra_is_member(), ra_can_edit(), ra_is_admin() to authenticated, service_role;

create or replace function ra_join() returns void
language sql security definer set search_path = public as $$
  insert into ra_profiles (id, email, full_name, role)
  select u.id, u.email, coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1)), 'pending'
  from auth.users u
  where u.id = auth.uid() and u.email is not null and not coalesce(u.is_anonymous, false)
  on conflict (id) do nothing;
$$;
revoke execute on function ra_join() from public, anon;
grant execute on function ra_join() to authenticated;

create or replace function ra_current_role() returns ra_role
language sql stable security definer set search_path = public as $$
  select case when coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then 'pending'::ra_role
              else coalesce((select role from ra_profiles where id = auth.uid()), 'pending'::ra_role) end;
$$;
