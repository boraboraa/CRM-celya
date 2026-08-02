-- ============================================================
-- Celya CRM — sécurité au niveau ligne (RLS)
-- admin      : voit et gère tout
-- commercial : voit ses clients assignés + le vivier non assigné
-- inactif    : ne voit rien tant que l'admin ne l'a pas activé
-- ============================================================

-- ---------- Helpers (security definer : ne re-déclenchent pas la RLS) ----------

create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.is_active
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.is_active and p.role = 'admin'
  );
$$;

create or replace function public.can_see_client(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_member()
     and (public.is_admin() or p_owner = auth.uid() or p_owner is null);
$$;

grant execute on function public.is_member()               to authenticated;
grant execute on function public.is_admin()                to authenticated;
grant execute on function public.can_see_client(uuid)      to authenticated;

-- ---------- Activation ----------
alter table public.profiles   enable row level security;
alter table public.clients    enable row level security;
alter table public.activities enable row level security;
alter table public.tasks      enable row level security;
alter table public.emails     enable row level security;

-- ---------- profiles ----------
drop policy if exists profiles_select      on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists profiles_delete_admin on public.profiles;

-- Tout membre actif voit l'annuaire de l'équipe ; un compte non encore
-- activé peut au moins lire sa propre fiche (pour afficher « en attente »).
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_member());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());          -- le trigger bloque role / is_active

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (public.is_admin() and id <> auth.uid());

-- ---------- clients ----------
drop policy if exists clients_select on public.clients;
drop policy if exists clients_insert on public.clients;
drop policy if exists clients_update on public.clients;
drop policy if exists clients_delete on public.clients;

create policy clients_select on public.clients
  for select to authenticated
  using (public.can_see_client(owner_id));

create policy clients_insert on public.clients
  for insert to authenticated
  with check (public.is_member());

create policy clients_update on public.clients
  for update to authenticated
  using (public.can_see_client(owner_id))
  with check (public.is_member());

create policy clients_delete on public.clients
  for delete to authenticated
  using (public.is_admin() or owner_id = auth.uid());

-- ---------- activities ----------
drop policy if exists activities_select on public.activities;
drop policy if exists activities_insert on public.activities;
drop policy if exists activities_update on public.activities;
drop policy if exists activities_delete on public.activities;

create policy activities_select on public.activities
  for select to authenticated
  using (exists (select 1 from public.clients c where c.id = activities.client_id));

create policy activities_insert on public.activities
  for insert to authenticated
  with check (
    public.is_member()
    and exists (select 1 from public.clients c where c.id = activities.client_id)
  );

create policy activities_update on public.activities
  for update to authenticated
  using (public.is_admin() or author_id = auth.uid())
  with check (public.is_member());

create policy activities_delete on public.activities
  for delete to authenticated
  using (public.is_admin() or author_id = auth.uid());

-- ---------- tasks ----------
drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists tasks_delete on public.tasks;

create policy tasks_select on public.tasks
  for select to authenticated
  using (
    public.is_member() and (
      public.is_admin()
      or assignee_id = auth.uid()
      or created_by  = auth.uid()
      or exists (select 1 from public.clients c where c.id = tasks.client_id)
    )
  );

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.is_member());

create policy tasks_update on public.tasks
  for update to authenticated
  using (
    public.is_member() and (
      public.is_admin()
      or assignee_id = auth.uid()
      or created_by  = auth.uid()
      or exists (select 1 from public.clients c where c.id = tasks.client_id)
    )
  )
  with check (public.is_member());

create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.is_admin() or created_by = auth.uid() or assignee_id = auth.uid());

-- ---------- emails ----------
-- L'ingestion se fait via edge function en service_role (hors RLS).
-- Les emails non rattachés à un client ne sont visibles que par l'admin.
drop policy if exists emails_select on public.emails;
drop policy if exists emails_insert on public.emails;
drop policy if exists emails_update on public.emails;
drop policy if exists emails_delete on public.emails;

create policy emails_select on public.emails
  for select to authenticated
  using (
    public.is_member() and (
      public.is_admin()
      or exists (select 1 from public.clients c where c.id = emails.client_id)
    )
  );

create policy emails_insert on public.emails
  for insert to authenticated
  with check (public.is_member());

create policy emails_update on public.emails
  for update to authenticated
  using (
    public.is_member() and (
      public.is_admin()
      or exists (select 1 from public.clients c where c.id = emails.client_id)
    )
  )
  with check (public.is_member());

create policy emails_delete on public.emails
  for delete to authenticated
  using (public.is_admin());
