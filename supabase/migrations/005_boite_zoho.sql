-- ============================================================
-- Celya CRM — boîte Zoho dans les deux sens (phase C)
-- 1. email_accounts : compte SMTP/IMAP, credentials dans Vault
-- 2. emails : colonnes de tri des réponses entrantes
-- 3. RPC Vault réservées à service_role (edge function crm-mail)
-- 4. Relève toutes les 5 minutes : pg_cron + pg_net → crm-mail
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- 1. Comptes mail ----------
create table if not exists public.email_accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.crm_users(id) on delete cascade,
  email_address         text not null unique,
  smtp_host             text not null default 'smtppro.zoho.com',
  imap_host             text not null default 'imappro.zoho.com',
  -- Référence vers vault.secrets : le mot de passe d'application n'est jamais
  -- stocké en clair, ni lisible par anon / authenticated.
  credentials_secret_id uuid,
  last_sync_at          timestamptz,
  sync_cursor           jsonb not null default '{}'::jsonb,
  sync_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

drop trigger if exists email_accounts_touch on public.email_accounts;
create trigger email_accounts_touch before update on public.email_accounts
  for each row execute function public.touch_updated_at();

-- RLS fermée : aucune policy → seul service_role (edge function) y accède.
alter table public.email_accounts enable row level security;

-- ---------- 2. Tri des réponses ----------
alter table public.emails
  add column if not exists triage text not null default 'a_traiter'
    check (triage in ('a_traiter','accepte','ignore')),
  add column if not exists intent text
    check (intent in ('interesse','demande_info','pas_interesse',
                      'rappel_plus_tard','absence','hors_sujet')),
  add column if not exists intent_confidence numeric(3,2),
  add column if not exists intent_summary text,
  add column if not exists proposed_due_at timestamptz;

create index if not exists emails_triage_idx
  on public.emails (received_at desc)
  where direction = 'entrant' and triage = 'a_traiter';

-- ---------- 3. Accès Vault, réservé à service_role ----------
create or replace function public.mail_store_credentials(p_email text, p_password text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text := 'crm_mail:' || lower(trim(p_email));
  v_id   uuid;
begin
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    v_id := vault.create_secret(p_password, v_name,
                                'Mot de passe application boîte ' || lower(trim(p_email)));
  else
    perform vault.update_secret(v_id, p_password);
  end if;
  return v_id;
end $$;

create or replace function public.mail_get_credentials(p_secret_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_secret_id;
$$;

create or replace function public.mail_get_secret(p_name text)
returns text language sql stable security definer set search_path = public as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name;
$$;

revoke all on function public.mail_store_credentials(text, text) from public, anon, authenticated;
revoke all on function public.mail_get_credentials(uuid)        from public, anon, authenticated;
revoke all on function public.mail_get_secret(text)             from public, anon, authenticated;
grant execute on function public.mail_store_credentials(text, text) to service_role;
grant execute on function public.mail_get_credentials(uuid)         to service_role;
grant execute on function public.mail_get_secret(text)              to service_role;

-- Secret partagé pg_cron → crm-mail (généré une fois).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'crm_mail_cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(24), 'hex'),
                                'crm_mail_cron_secret',
                                'Secret de la relève planifiée crm-mail');
  end if;
end $$;

-- ---------- 4. Relève toutes les 5 minutes ----------
-- Le mode IDLE d'IMAP exigerait une connexion permanente, impossible sur
-- Vercel : on relève par tâche planifiée. pg_net appelle l'edge function
-- crm-mail avec le secret du Vault ; sans compte configuré l'appel est un no-op.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'crm-mail-sync') then
    perform cron.schedule(
      'crm-mail-sync',
      '*/5 * * * *',
      $job$
      select net.http_post(
        url := 'https://wyqgbihwkfvzxlzoxvvf.supabase.co/functions/v1/crm-mail',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret',
          (select decrypted_secret from vault.decrypted_secrets
            where name = 'crm_mail_cron_secret')
        ),
        body := jsonb_build_object('action', 'sync'),
        timeout_milliseconds := 45000
      );
      $job$
    );
  end if;
end $$;
