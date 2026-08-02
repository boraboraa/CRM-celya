-- ============================================================
-- Celya CRM — schéma de base
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Types ----------
do $$ begin
  create type public.user_role as enum ('admin','commercial');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.client_status as enum
    ('nouveau','contacte','qualifie','proposition','negociation','gagne','perdu');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.activity_type as enum
    ('appel','email','note','reunion','whatsapp','linkedin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum ('a_faire','fait','annule');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.email_direction as enum ('entrant','sortant');
exception when duplicate_object then null; end $$;

-- ---------- Profils ----------
create table if not exists public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  email                 text not null,
  full_name             text,
  role                  public.user_role not null default 'commercial',
  is_active             boolean not null default false,
  must_change_password  boolean not null default false,
  phone                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------- Clients / prospects ----------
create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  company_name    text not null,
  contact_name    text,
  email           text,
  phone           text,
  website         text,
  sector          text,
  city            text,
  country         text default 'Belgique',
  status          public.client_status not null default 'nouveau',
  source          text,
  value_estimate  numeric(12,2),
  currency        text not null default 'EUR',
  owner_id        uuid references public.profiles(id) on delete set null,
  tags            text[] not null default '{}',
  notes           text,
  next_action_at  timestamptz,
  last_contact_at timestamptz,
  lost_reason     text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists clients_owner_idx       on public.clients(owner_id);
create index if not exists clients_status_idx      on public.clients(status);
create index if not exists clients_next_action_idx on public.clients(next_action_at);
create index if not exists clients_email_idx       on public.clients(lower(email));
create index if not exists clients_updated_idx     on public.clients(updated_at desc);

-- ---------- Activités (appels, notes, réunions...) ----------
create table if not exists public.activities (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  author_id    uuid references public.profiles(id) on delete set null,
  type         public.activity_type not null default 'note',
  subject      text,
  body         text,
  outcome      text,
  duration_min integer,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists activities_client_idx on public.activities(client_id, occurred_at desc);
create index if not exists activities_author_idx on public.activities(author_id, occurred_at desc);

-- ---------- Relances / tâches ----------
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.clients(id) on delete cascade,
  title        text not null,
  details      text,
  due_at       timestamptz not null default (now() + interval '1 day'),
  status       public.task_status not null default 'a_faire',
  priority     smallint not null default 2,           -- 1 haute · 2 normale · 3 basse
  assignee_id  uuid references public.profiles(id) on delete set null,
  created_by   uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists tasks_due_idx      on public.tasks(due_at) where status = 'a_faire';
create index if not exists tasks_assignee_idx on public.tasks(assignee_id, status);
create index if not exists tasks_client_idx   on public.tasks(client_id);

-- ---------- Emails (phase 2) ----------
create table if not exists public.emails (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references public.clients(id) on delete set null,
  direction   public.email_direction not null default 'entrant',
  from_name   text,
  from_email  text not null,
  to_email    text,
  cc          text,
  subject     text,
  body_text   text,
  body_html   text,
  message_id  text unique,
  in_reply_to text,
  thread_key  text,
  mailbox     text,
  received_at timestamptz not null default now(),
  is_read     boolean not null default false,
  raw         jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists emails_client_idx    on public.emails(client_id, received_at desc);
create index if not exists emails_unmatched_idx on public.emails(received_at desc) where client_id is null;
create index if not exists emails_from_idx      on public.emails(lower(from_email));

-- ============================================================
-- Fonctions & triggers
-- ============================================================

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- Le tout premier compte créé devient automatiquement admin actif.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.profiles;

  insert into public.profiles (id, email, full_name, role, is_active, must_change_password)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when v_count = 0 then 'admin'::public.user_role
         else coalesce(nullif(new.raw_user_meta_data->>'role','')::public.user_role, 'commercial'::public.user_role) end,
    case when v_count = 0 then true
         else coalesce((new.raw_user_meta_data->>'is_active')::boolean, false) end,
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, false)
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Empêche un non-admin de changer son propre rôle ou de s'auto-activer.
create or replace function public.guard_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
begin
  if auth.uid() is null then
    return new;                                    -- service_role / SQL direct
  end if;

  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.is_active
  ) into v_is_admin;

  if not v_is_admin then
    if new.role is distinct from old.role
       or new.is_active is distinct from old.is_active then
      raise exception 'Modification du rôle ou du statut réservée aux administrateurs';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- Met à jour la date de dernier contact du client à chaque activité.
create or replace function public.bump_last_contact()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.clients
     set last_contact_at = greatest(coalesce(last_contact_at, new.occurred_at), new.occurred_at)
   where id = new.client_id;
  return new;
end $$;

drop trigger if exists activities_bump on public.activities;
create trigger activities_bump after insert on public.activities
  for each row execute function public.bump_last_contact();

-- Synchronise clients.next_action_at avec la prochaine relance ouverte.
create or replace function public.sync_next_action()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
begin
  v_client := coalesce(new.client_id, old.client_id);
  if v_client is not null then
    update public.clients c
       set next_action_at = (
             select min(t.due_at) from public.tasks t
              where t.client_id = v_client and t.status = 'a_faire'
           )
     where c.id = v_client;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists tasks_sync_next_action on public.tasks;
create trigger tasks_sync_next_action after insert or update or delete on public.tasks
  for each row execute function public.sync_next_action();

-- Horodate la complétion d'une relance.
create or replace function public.stamp_task_completion()
returns trigger language plpgsql as $$
begin
  if new.status = 'fait' and (old.status is distinct from 'fait') then
    new.completed_at = now();
  elsif new.status <> 'fait' then
    new.completed_at = null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_stamp on public.tasks;
create trigger tasks_stamp before update on public.tasks
  for each row execute function public.stamp_task_completion();
