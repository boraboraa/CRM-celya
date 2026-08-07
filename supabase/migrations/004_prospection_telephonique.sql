-- ============================================================
-- Celya CRM — le carnet de clients devient un poste d'appels
-- 1. clients → prospects (table, contraintes, index, politiques)
-- 2. Statuts alignés sur le trajet d'un démarchage téléphonique
-- 3. Cadence d'appels : call_attempts, last_outcome, last_call_slot
-- ============================================================

-- ---------- 1. Renommages ----------
alter table public.clients rename to prospects;

alter table public.activities rename column client_id to prospect_id;
alter table public.tasks      rename column client_id to prospect_id;
alter table public.emails     rename column client_id to prospect_id;

alter table public.prospects  rename constraint clients_pkey            to prospects_pkey;
alter table public.prospects  rename constraint clients_owner_id_fkey   to prospects_owner_id_fkey;
alter table public.prospects  rename constraint clients_created_by_fkey to prospects_created_by_fkey;
alter table public.activities rename constraint activities_client_id_fkey to activities_prospect_id_fkey;
alter table public.tasks      rename constraint tasks_client_id_fkey      to tasks_prospect_id_fkey;
alter table public.emails     rename constraint emails_client_id_fkey     to emails_prospect_id_fkey;

alter index public.clients_owner_idx       rename to prospects_owner_idx;
alter index public.clients_status_idx      rename to prospects_status_idx;
alter index public.clients_next_action_idx rename to prospects_next_action_idx;
alter index public.clients_email_idx       rename to prospects_email_idx;
alter index public.clients_updated_idx     rename to prospects_updated_idx;
alter index public.activities_client_idx   rename to activities_prospect_idx;
alter index public.tasks_client_idx        rename to tasks_prospect_idx;
alter index public.emails_client_idx       rename to emails_prospect_idx;

-- ---------- 2. Nouveaux statuts ----------
-- nouveau → a_appeler · contacte → contact_etabli · qualifie → rdv ·
-- negociation → proposition · le reste inchangé.
create type public.prospect_status as enum
  ('a_appeler','sans_reponse','contact_etabli','rappel_programme',
   'rdv','proposition','gagne','perdu');

alter table public.prospects alter column status drop default;
alter table public.prospects alter column status type public.prospect_status
  using (case status::text
           when 'nouveau'     then 'a_appeler'
           when 'contacte'    then 'contact_etabli'
           when 'qualifie'    then 'rdv'
           when 'negociation' then 'proposition'
           else status::text
         end)::public.prospect_status;
alter table public.prospects alter column status set default 'a_appeler';

drop type public.client_status;

-- ---------- 3. Cadence d'appels ----------
alter table public.prospects
  add column call_attempts  integer not null default 0,
  add column last_outcome   text,
  add column last_call_slot text
    check (last_call_slot in ('matin','midi','apres_midi','fin_journee'));

-- ---------- 4. Fonctions qui référençaient clients / client_id ----------
-- (le corps des fonctions est stocké en texte : le rename ne les suit pas)
create or replace function public.can_see_prospect(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_member()
     and (public.is_admin() or p_owner = auth.uid() or p_owner is null);
$$;
revoke all on function public.can_see_prospect(uuid) from public, anon;
grant execute on function public.can_see_prospect(uuid) to authenticated;

create or replace function public.bump_last_contact()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.prospects
     set last_contact_at = greatest(coalesce(last_contact_at, new.occurred_at), new.occurred_at)
   where id = new.prospect_id;
  return new;
end $$;

create or replace function public.sync_next_action()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prospect uuid;
begin
  v_prospect := coalesce(new.prospect_id, old.prospect_id);
  if v_prospect is not null then
    update public.prospects p
       set next_action_at = (
             select min(t.due_at) from public.tasks t
              where t.prospect_id = v_prospect and t.status = 'a_faire'
           )
     where p.id = v_prospect;
  end if;
  return coalesce(new, old);
end $$;

-- ---------- 5. Politiques RLS de prospects, renommées ----------
drop policy if exists clients_select on public.prospects;
drop policy if exists clients_insert on public.prospects;
drop policy if exists clients_update on public.prospects;
drop policy if exists clients_delete on public.prospects;

create policy prospects_select on public.prospects
  for select to authenticated
  using (public.can_see_prospect(owner_id));

create policy prospects_insert on public.prospects
  for insert to authenticated
  with check (public.is_member());

create policy prospects_update on public.prospects
  for update to authenticated
  using (public.can_see_prospect(owner_id))
  with check (public.is_member());

create policy prospects_delete on public.prospects
  for delete to authenticated
  using (public.is_admin() or owner_id = auth.uid());

-- Plus rien ne dépend de l'ancienne fonction.
drop function public.can_see_client(uuid);
