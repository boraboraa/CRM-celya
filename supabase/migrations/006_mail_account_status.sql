-- L'admin doit voir l'état de la boîte (dernière relève, erreur) sans que la
-- table email_accounts soit lisible par le rôle authenticated : RPC dédiée
-- qui n'expose jamais les credentials.
create or replace function public.mail_account_status()
returns table (
  email_address   text,
  smtp_host       text,
  imap_host       text,
  last_sync_at    timestamptz,
  sync_error      text,
  has_credentials boolean
) language sql stable security definer set search_path = public as $$
  select a.email_address, a.smtp_host, a.imap_host, a.last_sync_at,
         a.sync_error, a.credentials_secret_id is not null
    from public.email_accounts a
   where public.is_admin();
$$;

revoke all on function public.mail_account_status() from public, anon;
grant execute on function public.mail_account_status() to authenticated;
