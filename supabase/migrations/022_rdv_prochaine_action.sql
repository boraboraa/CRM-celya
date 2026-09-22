-- ============================================================
-- 022 — Une fiche n'a jamais qu'UNE prochaine action (22 septembre 2026)
--
-- Deux systèmes prétendaient chacun dire « la prochaine action » : les
-- relances (`tasks`) et l'agenda (`meetings`). Un seul écrivait dans la fiche :
-- `prospects.next_action_at` était recalculé par le trigger `sync_next_action`
-- sur `tasks`, JAMAIS sur `meetings`. L'agenda (017) a été ajouté comme un
-- objet à part et la fiche n'a jamais été rebranchée dessus — une fiche en
-- « Rendez-vous » le 28/09 pouvait réclamer un appel « en retard » le 25/09,
-- puis, le RDV passé, remonter en retard au lieu de demander son débrief.
--
-- LA RÈGLE, en une phrase (elle est aussi en COMMENT sur la colonne) :
--   « La prochaine action, c'est le prochain rendez-vous de la fiche tant
--     qu'il n'est pas débriefé ; sinon, sa relance la plus proche. »
-- Avec une exception voulue (décision de Bora, 22/09) : une relance posée
-- SCIEMMENT avant un rendez-vous — « confirmer la veille » — passe devant lui.
--
-- Pourquoi en SQL : le connecteur MCP écrit en service_role sans passer par
-- les écrans, et quatre chemins créent des relances (saveExchangeCore, cadence
-- email, planifier_relance, SQL direct). Une règle dans les server actions
-- serait contournée par le premier oublié ; une règle à l'affichage laisserait
-- la donnée fausse. Le CHOIX humain (la suite d'un débrief) reste en
-- TypeScript (`cloturerRendezVous`), seul endroit où il existe.
--
-- Le cycle :
--   1. POSER (ou DÉPLACER) un RDV reporte les relances ouvertes qui tombaient
--      AVANT lui et qui EXISTAIENT déjà — posées sans le connaître — au premier
--      jour ouvré qui suit le RDV, 09:00 Bruxelles. Elles deviennent son FILET
--      (`tasks.meeting_id`). Une relance posée ou re-datée APRÈS que le RDV
--      existe n'est JAMAIS reportée : « si je la pose en sachant, je la veux ».
--   2. Le filet DORT tant que son RDV est vivant (prévu / confirmé / reporté) :
--      hors de next_action_at, hors de « À faire », hors du compte des retards.
--   3. DÉPLACER le RDV : le filet suit.
--   4. CLORE le RDV (honoré / annulé, par n'importe quel chemin) : le filet se
--      RÉVEILLE au premier jour ouvré suivant, 09:00 — la fiche ne disparaît
--      jamais de partout. Le débrief, s'il choisit une suite, le re-date ou
--      l'annule ensuite (TypeScript).
--   5. Un geste humain qui re-date le filet le détache : ce n'est plus un filet,
--      c'est une relance voulue.
--   Fiche gagnée ou perdue : aucun filet posé ni déplacé.
--   RDV perso : pas de fiche, hors règle.
--
-- Migration ADDITIVE : deux colonnes nullables, des fonctions, des triggers.
-- Le code déjà en production ignore les colonnes et lit next_action_at comme
-- avant. Le code du même lot, lui, EXIGE les colonnes : migration d'abord,
-- déploiement ensuite (même ordre que 018).
-- ============================================================

-- ---------- 1. Colonnes ----------
alter table public.tasks
  add column if not exists meeting_id uuid references public.meetings(id) on delete set null;
create index if not exists tasks_meeting_id_idx on public.tasks (meeting_id) where meeting_id is not null;

comment on column public.tasks.meeting_id is
  'FILET : la relance a été reportée après ce rendez-vous (022). Elle dort tant que le '
  'rendez-vous est vivant, se réveille à sa clôture. Remis à null par tout re-datage humain.';

alter table public.prospects
  add column if not exists next_action_kind text;
alter table public.prospects
  drop constraint if exists prospects_next_action_kind_connu;
alter table public.prospects
  add constraint prospects_next_action_kind_connu
  check (next_action_kind is null or next_action_kind in ('rendez_vous', 'relance'));

comment on column public.prospects.next_action_at is
  'La prochaine action, c''est le prochain rendez-vous de la fiche tant qu''il n''est pas '
  'débriefé ; sinon, sa relance la plus proche — sauf relance posée sciemment avant le '
  'rendez-vous (« confirmer la veille »), qui passe devant. Tenue par recalc_next_action (022).';
comment on column public.prospects.next_action_kind is
  '''rendez_vous'' ou ''relance'' : ce que désigne next_action_at. Un rendez-vous passé '
  'et non débriefé reste ''rendez_vous'' — « à débriefer », jamais « en retard ».';

-- ---------- 2. Fonctions d'appui ----------

-- Premier jour ouvré (lundi–vendredi) APRÈS le jour de `p_ts` (heure de
-- Bruxelles), à 09:00 Bruxelles. Le jour du RDV appartient au RDV et à son
-- débrief ; 09:00 est l'heure de toute relance posée « à la journée ».
create or replace function public.premier_jour_ouvre_apres(p_ts timestamptz)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  d date := (p_ts at time zone 'Europe/Brussels')::date + 1;
begin
  while extract(isodow from d) > 5 loop
    d := d + 1;
  end loop;
  return (d + time '09:00') at time zone 'Europe/Brussels';
end $$;

-- Un rendez-vous est VIVANT tant qu'il n'est ni honoré ni annulé — y compris
-- passé (il attend alors son débrief) et y compris reporté.
create or replace function public.rdv_vivant(p_status public.meeting_status)
returns boolean language sql immutable set search_path = public as $$
  select p_status in ('prevu', 'confirme', 'reporte');
$$;

-- Une relance DORT quand elle est le filet d'un rendez-vous encore vivant.
-- Champ calculé PostgREST (`select=…,en_sommeil` / `en_sommeil=is.false`).
-- security definer : il lit meetings sans RLS, mais ne renvoie qu'un booléen
-- sur une relance que l'appelant voit déjà.
create or replace function public.en_sommeil(t public.tasks)
returns boolean language sql stable security definer set search_path = public as $$
  select t.meeting_id is not null and exists (
    select 1 from public.meetings m
     where m.id = t.meeting_id and public.rdv_vivant(m.status)
  );
$$;
revoke all on function public.en_sommeil(public.tasks) from public, anon;
grant execute on function public.en_sommeil(public.tasks) to authenticated, service_role;

-- LA définition de la prochaine action. Seul écrivain de next_action_at et
-- next_action_kind. N'écrit que si quelque chose change (pas de bruit sur
-- updated_at).
create or replace function public.recalc_next_action(p_prospect uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rdv timestamptz;
  v_rel timestamptz;
  v_at  timestamptz;
  v_kind text;
begin
  if p_prospect is null then return; end if;

  select min(m.starts_at) into v_rdv
    from public.meetings m
   where m.prospect_id = p_prospect and m.kind = 'prospect' and public.rdv_vivant(m.status);

  select min(t.due_at) into v_rel
    from public.tasks t
   where t.prospect_id = p_prospect and t.status = 'a_faire' and not public.en_sommeil(t);

  -- La relance ne passe devant que si elle tombe STRICTEMENT avant le RDV
  -- (la relance « confirmer la veille », posée en connaissance de cause).
  if v_rel is not null and (v_rdv is null or v_rel < v_rdv) then
    v_at := v_rel;  v_kind := 'relance';
  elsif v_rdv is not null then
    v_at := v_rdv;  v_kind := 'rendez_vous';
  end if;

  update public.prospects p
     set next_action_at = v_at, next_action_kind = v_kind
   where p.id = p_prospect
     and (p.next_action_at, p.next_action_kind) is distinct from (v_at, v_kind);
end $$;
revoke all on function public.recalc_next_action(uuid) from public, anon, authenticated;

-- ---------- 3. Triggers sur tasks ----------

-- Recalcul — l'ancienne ET la nouvelle fiche (une relance déplacée d'une fiche
-- à l'autre laissait l'ancienne avec une date morte).
create or replace function public.sync_next_action()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'DELETE' then
    perform public.recalc_next_action(new.prospect_id);
  end if;
  if tg_op <> 'INSERT' and old.prospect_id is distinct from new.prospect_id then
    perform public.recalc_next_action(old.prospect_id);
  end if;
  if tg_op = 'DELETE' then
    perform public.recalc_next_action(old.prospect_id);
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.sync_next_action() from public, anon, authenticated;
-- Le trigger tasks_sync_next_action (001) pointe déjà sur cette fonction.

-- Un re-datage HUMAIN détache le filet : la relance devient voulue. Seul le
-- trigger de meetings pose le drapeau transactionnel `celya.report_rdv` pour
-- re-dater un filet sans le détacher.
create or replace function public.tasks_detache_filet()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.meeting_id is not null
     and (new.due_at is distinct from old.due_at or new.prospect_id is distinct from old.prospect_id)
     and coalesce(current_setting('celya.report_rdv', true), '') <> 'on' then
    new.meeting_id := null;
  end if;
  return new;
end $$;
drop trigger if exists tasks_detache_filet on public.tasks;
create trigger tasks_detache_filet before update on public.tasks
  for each row execute function public.tasks_detache_filet();

-- ---------- 4. Trigger sur meetings ----------
create or replace function public.meetings_prochaine_action()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_etape public.prospect_status;
  v_filet timestamptz;
  v_repose boolean;
begin
  -- 1. Poser / déplacer : le RDV (fiche, à venir, vivant) prend la main.
  if tg_op in ('INSERT', 'UPDATE')
     and new.kind = 'prospect' and new.prospect_id is not null
     and public.rdv_vivant(new.status) and new.starts_at > now() then
    v_repose := tg_op = 'INSERT'
             or new.starts_at is distinct from old.starts_at
             or new.prospect_id is distinct from old.prospect_id
             or not public.rdv_vivant(old.status);
    if v_repose then
      select p.status into v_etape from public.prospects p where p.id = new.prospect_id;
      if v_etape is not null and v_etape not in ('gagne', 'perdu') then
        v_filet := public.premier_jour_ouvre_apres(new.starts_at);
        perform set_config('celya.report_rdv', 'on', true);

        -- Le filet SUIT son rendez-vous.
        update public.tasks t
           set due_at = v_filet
         where t.meeting_id = new.id and t.status = 'a_faire'
           and t.due_at is distinct from v_filet;

        -- Les relances qui tombaient AVANT lui et qui EXISTAIENT déjà —
        -- dernière main posée avant la création du RDV. Une relance posée ou
        -- re-datée en connaissant le RDV (updated_at >= created_at) est voulue.
        update public.tasks t
           set due_at = v_filet, meeting_id = new.id
         where t.prospect_id = new.prospect_id
           and t.status = 'a_faire'
           and t.due_at < new.starts_at
           and t.updated_at < new.created_at
           and not public.en_sommeil(t);

        perform set_config('celya.report_rdv', 'off', true);
      end if;
    end if;
  end if;

  -- 2. Clôture (honoré / annulé), par n'importe quel chemin : le filet se
  --    réveille au premier jour ouvré suivant. Il garde son meeting_id (trace,
  --    et poignée pour le débrief qui choisit la suite).
  if tg_op = 'UPDATE' and public.rdv_vivant(old.status) and not public.rdv_vivant(new.status) then
    perform set_config('celya.report_rdv', 'on', true);
    update public.tasks t
       set due_at = public.premier_jour_ouvre_apres(now())
     where t.meeting_id = new.id and t.status = 'a_faire';
    perform set_config('celya.report_rdv', 'off', true);
  end if;

  -- 3. Recalcul, toujours.
  if tg_op <> 'DELETE' then
    perform public.recalc_next_action(new.prospect_id);
  end if;
  if tg_op = 'DELETE' or old.prospect_id is distinct from new.prospect_id then
    perform public.recalc_next_action(old.prospect_id);
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.meetings_prochaine_action() from public, anon, authenticated;

drop trigger if exists meetings_prochaine_action on public.meetings;
create trigger meetings_prochaine_action
  after insert or update or delete on public.meetings
  for each row execute function public.meetings_prochaine_action();

-- ---------- 5. /equipe : un filet qui dort n'est pas « en retard » ----------
-- Seule la colonne relances_en_retard change (`and not en_sommeil(k)`) ; corps
-- repris de la production du 22/09, signature identique (droits conservés).
create or replace function public.admin_team_overview(p_since timestamp with time zone default null::timestamp with time zone)
 returns table(user_id uuid, email text, full_name text, role text, is_active boolean, must_change_password boolean, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, mailbox text, mailbox_last_sync_at timestamp with time zone, mailbox_error text, mailbox_has_credentials boolean, mcp_connected boolean, mcp_last_token_at timestamp with time zone, prospects_total bigint, prospects_actifs bigint, notes bigint, appels_sans_reponse bigint, emails_envoyes bigint, reponses_recues bigint, rdv bigint, relances_faites bigint, relances_en_retard bigint, derniere_action timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
    (select count(*) from public.tasks k
      where k.assignee_id = u.id and k.status = 'a_faire' and k.due_at < now()
        and not public.en_sommeil(k)),
    greatest(
      (select max(v.occurred_at) from public.activities v
        where v.author_id = u.id and not v.is_draft),
      (select max(k.completed_at) from public.tasks k where k.assignee_id = u.id)
    )
  from public.crm_users u
  left join auth.users au on au.id = u.id
  left join public.email_accounts a on a.user_id = u.id
  order by u.created_at;
end $function$;

-- ---------- 6. Reprise de l'existant ----------
-- PAS d'identifiant écrit à la main : la règle est rejouée sur toute la base,
-- au moment où la migration s'applique (leçon de la 017 — une ligne créée
-- entre la spec et la livraison avait été manquée). Pour chaque fiche, le RDV
-- vivant à venir le plus proche ; mêmes critères que le trigger.
select set_config('celya.report_rdv', 'on', true);

update public.tasks t
   set due_at = public.premier_jour_ouvre_apres(m.starts_at),
       meeting_id = m.id
  from (
    select distinct on (mm.prospect_id) mm.id, mm.prospect_id, mm.starts_at, mm.created_at
      from public.meetings mm
      join public.prospects pp on pp.id = mm.prospect_id
     where mm.kind = 'prospect' and public.rdv_vivant(mm.status)
       and mm.starts_at > now()
       and pp.status not in ('gagne', 'perdu')
     order by mm.prospect_id, mm.starts_at
  ) m
 where t.prospect_id = m.prospect_id
   and t.status = 'a_faire'
   and t.meeting_id is null
   and t.due_at < m.starts_at
   and t.updated_at < m.created_at;

select set_config('celya.report_rdv', 'off', true);

-- Toutes les fiches : next_action_at et next_action_kind selon la règle.
select public.recalc_next_action(p.id) from public.prospects p;
