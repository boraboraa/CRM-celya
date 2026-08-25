-- ============================================================
-- Celya CRM — ouvrir le CRM à un commercial (25 août 2026)
--
-- Bora recrute son premier commercial, qui travaille un marché différent avec
-- son propre fichier. La cloison entre les deux fichiers existait déjà
-- (can_see_prospect) ; cette migration bouche les trous AUTOUR d'elle :
--
--   1. owner_id ne peut plus rester NULL      — la cloison ne dépend plus de
--                                                la discipline du code appelant
--   2. un membre voit les emails non rattachés DE SA PROPRE BOÎTE
--   3. chacun voit l'état de SA boîte          — plus seulement l'admin
--   4. un agrégat unique pour le panel admin   — refus explicite hors admin
--
-- Toutes additives : rien n'est retiré, aucune politique existante n'est
-- relâchée, et le code déjà en production continue de fonctionner tel quel
-- (règle « ordre migration ↔ déploiement », voir CLAUDE.md).
-- ============================================================

-- ------------------------------------------------------------------
-- 1. Le propriétaire d'une fiche, garanti EN BASE
-- ------------------------------------------------------------------
-- prospects.owner_id n'avait ni DEFAULT ni trigger : c'est l'applicatif qui
-- le renseignait. Un import, un formulaire, un appel MCP ou un futur bout de
-- code finit toujours par l'oublier — et la fiche tombe alors dans le vivier
-- (owner_id null), donc visible par TOUS les commerciaux. C'était précisément
-- le cas de `importer_prospects` du connecteur MCP, qui passait null.
--
-- Une cloison étanche ne peut pas dépendre de la discipline du code appelant.
--
-- Deux cas, dans cet ordre :
--   · insertion authentifiée (interface, RLS)  → auth.uid()
--   · insertion service_role (MCP, edge, SQL)  → propriétaire de secours,
--     décidé par Bora : le compte admin.
-- Et si aucun admin actif n'existe, on LÈVE plutôt que de créer une orpheline
-- silencieuse : mieux vaut un refus lisible qu'une fiche que tout le monde voit.

create or replace function public.prospects_set_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_fallback uuid;
begin
  if new.owner_id is null then
    new.owner_id := auth.uid();
  end if;

  if new.owner_id is null then
    select id into v_fallback
      from public.crm_users
     where role = 'admin' and is_active
     order by created_at
     limit 1;

    if v_fallback is null then
      raise exception
        'Aucun propriétaire pour cette fiche : ni session authentifiée, ni compte admin actif de secours.'
        using errcode = '23502';
    end if;
    new.owner_id := v_fallback;
  end if;

  return new;
end $$;

comment on function public.prospects_set_owner() is
  'Garantit prospects.owner_id : auth.uid(), sinon le premier admin actif. Jamais NULL, jamais silencieux.';

drop trigger if exists prospects_set_owner on public.prospects;
create trigger prospects_set_owner
  before insert on public.prospects
  for each row execute function public.prospects_set_owner();

-- ------------------------------------------------------------------
-- 2. Les emails non rattachés de SA PROPRE boîte
-- ------------------------------------------------------------------
-- emails_select ne laissait passer un message non rattaché (prospect_id null)
-- que pour l'admin : l'EXISTS sur prospects est faux quand prospect_id est
-- null. L'écran « Non rattachés » d'un commercial serait donc vide en
-- permanence — alors que ce sont SES emails, arrivés dans SA boîte.
--
-- Le rapprochement se fait sur emails.mailbox ↔ email_accounts.user_id.
-- email_accounts a la RLS activée SANS aucune policy (volontaire : elle porte
-- credentials_secret_id, la référence Vault) — une sous-requête directe depuis
-- une policy y serait donc bloquée. D'où cette fonction security definer, qui
-- ne renvoie qu'un booléen sur SA PROPRE boîte et aucun secret. Même motif
-- que mail_account_status.

create or replace function public.owns_mailbox(p_mailbox text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_mailbox is not null and exists (
    select 1
      from public.email_accounts a
     where a.user_id = auth.uid()
       and lower(a.email_address) = lower(p_mailbox)
  );
$$;

comment on function public.owns_mailbox(text) is
  'La boîte passée en paramètre appartient-elle à l''appelant ? Booléen seul, aucun secret exposé.';

revoke all on function public.owns_mailbox(text) from public, anon;
grant execute on function public.owns_mailbox(text) to authenticated;

-- Ajout d'une branche, aucune n'est retirée : admin et propriétaire de la
-- fiche gardent exactement les mêmes droits qu'avant.
drop policy if exists emails_select on public.emails;
create policy emails_select on public.emails
  for select to authenticated
  using (
    public.is_member() and (
      public.is_admin()
      or exists (select 1 from public.prospects c where c.id = emails.prospect_id)
      or public.owns_mailbox(emails.mailbox)
    )
  );

-- Le pendant en écriture : sans lui, le commercial VERRAIT ses messages non
-- rattachés sans pouvoir les rattacher ni les trier (le geste même de l'écran).
drop policy if exists emails_update on public.emails;
create policy emails_update on public.emails
  for update to authenticated
  using (
    public.is_member() and (
      public.is_admin()
      or exists (select 1 from public.prospects c where c.id = emails.prospect_id)
      or public.owns_mailbox(emails.mailbox)
    )
  )
  with check (public.is_member());

-- emails_delete reste réservé à l'admin : inchangé, volontairement.

-- ------------------------------------------------------------------
-- 3. L'état de SA boîte, pour chacun
-- ------------------------------------------------------------------
-- mail_account_status() était réservée à l'admin et renvoyait toutes les
-- boîtes. Le commercial connectant désormais la sienne, il doit en voir
-- l'état — et rien de plus. L'admin, lui, garde la vue complète (c'est ce que
-- lit /reglages-email et le panel d'équipe).
--
-- `user_id` et `is_mine` sont ajoutés en fin de liste : les colonnes déjà
-- lues par le code en production gardent leur nom et leur type.

drop function if exists public.mail_account_status();
create function public.mail_account_status()
returns table (
  email_address   text,
  smtp_host       text,
  imap_host       text,
  last_sync_at    timestamptz,
  sync_error      text,
  has_credentials boolean,
  user_id         uuid,
  is_mine         boolean
) language sql stable security definer set search_path = public as $$
  select a.email_address, a.smtp_host, a.imap_host, a.last_sync_at,
         a.sync_error, a.credentials_secret_id is not null,
         a.user_id, a.user_id = auth.uid()
    from public.email_accounts a
   where public.is_member()
     and (public.is_admin() or a.user_id = auth.uid())
   order by a.created_at;
$$;

revoke all on function public.mail_account_status() from public, anon;
grant execute on function public.mail_account_status() to authenticated;

-- ------------------------------------------------------------------
-- 4. Le panel admin — un seul agrégat, un refus explicite
-- ------------------------------------------------------------------
-- Bora veut un écran qui dise, pour chaque compte : qui c'est, si sa
-- configuration est complète, et ce qu'il produit. Tout existe déjà en base ;
-- ce qui manquait, c'est de le lire d'un coup.
--
-- L'accès est contrôlé ICI, en base, pas en masquant un lien : un non-admin
-- qui appelle la RPC directement reçoit 42501, pas une liste vide (une liste
-- vide se confond avec « aucun compte » — un refus doit se voir).
--
-- p_since borne les compteurs d'ACTIVITÉ (7 j / 30 j / null = tout).
-- Les relances EN RETARD n'en dépendent pas, et c'est délibéré : le retard est
-- un état, pas un événement de la période. C'est la métrique qui dit si le
-- pipeline fuit — les compteurs d'appels et de mails, eux, flattent l'activité.

create or replace function public.admin_team_overview(p_since timestamptz default null)
returns table (
  user_id                 uuid,
  email                   text,
  full_name               text,
  role                    text,
  is_active               boolean,
  must_change_password    boolean,
  created_at              timestamptz,
  last_sign_in_at         timestamptz,
  mailbox                 text,
  mailbox_last_sync_at    timestamptz,
  mailbox_error           text,
  mailbox_has_credentials boolean,
  mcp_connected           boolean,
  mcp_last_token_at       timestamptz,
  prospects_total         bigint,
  prospects_actifs        bigint,
  notes                   bigint,
  appels_sans_reponse     bigint,
  emails_envoyes          bigint,
  reponses_recues         bigint,
  rdv                     bigint,
  relances_faites         bigint,
  relances_en_retard      bigint,
  derniere_action         timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = '42501';
  end if;

  return query
  select
    u.id,
    u.email,
    u.full_name,
    u.role::text,
    u.is_active,
    u.must_change_password,
    u.created_at,
    au.last_sign_in_at,
    a.email_address,
    a.last_sync_at,
    a.sync_error,
    a.credentials_secret_id is not null,
    exists (
      select 1 from public.mcp_oauth_tokens t
       where t.user_id = u.id and not t.revoked and t.expires_at > now()
    ),
    (select max(t.created_at) from public.mcp_oauth_tokens t
      where t.user_id = u.id and not t.revoked),

    (select count(*) from public.prospects p where p.owner_id = u.id),
    (select count(*) from public.prospects p
      where p.owner_id = u.id and p.status not in ('gagne','perdu')),

    -- Une note consignée : un compte rendu, pas un appel resté sans réponse
    -- (compté à part juste en dessous) et pas un brouillon.
    (select count(*) from public.activities v
      where v.author_id = u.id and v.type = 'note' and not v.is_draft
        and v.outcome is distinct from 'sans_reponse'
        and (p_since is null or v.occurred_at >= p_since)),

    (select count(*) from public.activities v
      where v.author_id = u.id and v.outcome = 'sans_reponse' and not v.is_draft
        and (p_since is null or v.occurred_at >= p_since)),

    (select count(*) from public.activities v
      where v.author_id = u.id and v.type = 'email' and not v.is_draft
        and (p_since is null or v.occurred_at >= p_since)),

    -- Les réponses reçues ne portent pas d'auteur (elles sont ingérées) :
    -- on les rattache par la PROPRIÉTÉ de la fiche, ce qui est le sens utile —
    -- « combien de prospects à moi ont répondu ».
    (select count(*) from public.emails e
       join public.prospects p on p.id = e.prospect_id
      where p.owner_id = u.id and e.direction = 'entrant'
        and (p_since is null or e.received_at >= p_since)),

    (select count(*) from public.activities v
      where v.author_id = u.id and v.type = 'rendez_vous' and not v.is_draft
        and (p_since is null or v.occurred_at >= p_since)),

    (select count(*) from public.tasks k
      where k.assignee_id = u.id and k.status = 'fait'
        and (p_since is null or coalesce(k.completed_at, k.updated_at) >= p_since)),

    -- Hors période, volontairement : un retard est un état.
    (select count(*) from public.tasks k
      where k.assignee_id = u.id and k.status = 'a_faire' and k.due_at < now()),

    greatest(
      (select max(v.occurred_at) from public.activities v
        where v.author_id = u.id and not v.is_draft),
      (select max(k.completed_at) from public.tasks k where k.assignee_id = u.id)
    )
  from public.crm_users u
  left join auth.users au on au.id = u.id
  left join public.email_accounts a on a.user_id = u.id
  order by u.created_at;
end $$;

comment on function public.admin_team_overview(timestamptz) is
  'Panel admin : par compte, état de la configuration (boîte, MCP) et activité depuis p_since. Lève 42501 hors admin.';

revoke all on function public.admin_team_overview(timestamptz) from public, anon;
grant execute on function public.admin_team_overview(timestamptz) to authenticated;
