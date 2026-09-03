-- ============================================================
-- 019 — Le RÉSULTAT d'appel, et le texte qui va avec
--
-- Mesuré en base le 02/09/2026 : `activities.outcome` n'était renseigné que
-- sur 2 lignes sur 85, et 49 activités sur 85 n'avaient aucun `subject`. La
-- cause était dans l'interface — consigner « il n'a pas répondu » demandait
-- cinq décisions dans QuickNote (type · nature · case proposition · étape ·
-- date). Après un appel, personne ne les prend.
--
-- Et même bien rempli, rien ne remontait aux cartes : la vue
-- `prospect_action_state` ne portait que `last_kind` et `last_at`, jamais le
-- texte ni le résultat — une carte ne pouvait afficher que « note · il y a
-- 2 jours ».
--
-- Migration ADDITIVE : une contrainte de vocabulaire, et trois colonnes de
-- plus sur la vue. Rien n'est renommé ni supprimé, aucune valeur n'est
-- convertie, et le code en production continue de lire les colonnes qu'il
-- connaît (elles n'ont pas bougé de place).
-- ============================================================

-- ------------------------------------------------------------
-- Le vocabulaire des résultats — tiré des notes RÉELLES de Bora
-- (« pas de réponse », « à rappeler », « la gérante vous rappellera »,
-- « responsable indisponible », « pas intéressé »).
--
-- `outcome` reste en text (2 lignes portent déjà 'sans_reponse') : on BORNE,
-- on ne convertit pas. Un enum aurait exigé un cast et rendu tout ajout de
-- valeur coûteux ; une contrainte se relit et s'élargit en une ligne.
-- ------------------------------------------------------------
alter table public.activities
  drop constraint if exists activities_outcome_connu;

alter table public.activities
  add constraint activities_outcome_connu
  check (outcome is null or outcome in
    ('sans_reponse','barrage','rappeler','interesse','refus'));

-- ------------------------------------------------------------
-- La vue « dernière action » — définition de 012 reprise À L'IDENTIQUE, plus
-- le résultat, le texte, et le nombre d'appels sans réponse d'affilée.
--
-- ⚠ security_invoker : SANS cette option, la vue lirait avec les droits de
-- son PROPRIÉTAIRE et la dernière note de CHAQUE fiche serait servie à tous
-- les membres. `create or replace view` ne conserve PAS ce qui n'est pas
-- réécrit : l'option est donc restatée explicitement, et vérifiée en base
-- juste après l'application (pg_class.reloptions).
--
-- ⚠ Les trois colonnes nouvelles sont EN FIN DE LISTE, et ce n'est pas un
-- choix esthétique : `create or replace view` refuse de renommer ou de
-- réordonner une colonne existante (42P16, « cannot change name of view
-- column »). Les insérer au milieu obligerait à DROP la vue — donc à perdre
-- ses droits et à casser le code en production le temps du déploiement.
-- Même règle que `mail_account_status` en 015 : on AJOUTE à la fin.
-- ------------------------------------------------------------
create or replace view public.prospect_action_state
with (security_invoker = on) as
select
  p.id as prospect_id,
  ev.kind as last_kind,
  ev.at   as last_at,
  sortants.last_email_sent_at,
  entrants.last_reply_at,
  -- Le résultat de la dernière action (sans_reponse, barrage, rappeler,
  -- interesse, refus) — null pour un email ou une note sans résultat.
  ev.outcome as last_outcome,
  -- Ce qui s'est dit, en un mot : le sujet s'il existe, sinon le début du
  -- corps. C'est LUI que la carte affiche — « bosse déjà avec un concurrent »
  -- vaut mille fois « note · il y a 2 jours ».
  ev.texte   as last_text,
  -- Combien d'appels sans réponse D'AFFILÉE depuis le dernier échange réel.
  -- C'est l'information qui dit « arrête d'appeler celui-là ». Calculée ici
  -- et non côté application : les écrans qui affichent la dernière action
  -- (liste, pipeline, tableau de bord) ne chargent PAS les activités — la
  -- porter dans la vue, c'est zéro requête de plus pour tout le monde, et
  -- une seule définition de la règle.
  coalesce(sans_rep.n, 0)::int as last_no_answer_streak
from public.prospects p
left join lateral (
  select kind, at, outcome, texte
  from (
    select
      case
        when a.type = 'rendez_vous'         then 'rendez_vous'
        when a.type = 'email'               then 'email_sortant'
        when a.is_exchange                  then 'echange'
        when a.outcome = 'sans_reponse'     then 'appel_sans_reponse'
        else 'note_interne'
      end as kind,
      a.occurred_at as at,
      a.outcome as outcome,
      coalesce(nullif(trim(a.subject), ''), left(a.body, 140)) as texte
    from public.activities a
    where a.prospect_id = p.id
      and not a.is_draft
    union all
    select
      case when e.direction = 'entrant'
           then 'email_entrant' else 'email_sortant' end,
      e.received_at,
      null::text,
      coalesce(nullif(trim(e.subject), ''), left(e.body_text, 140))
    from public.emails e
    where e.prospect_id = p.id
  ) events
  order by at desc
  limit 1
) ev on true
left join lateral (
  -- Les 'sans_reponse' postérieurs au dernier événement qui atteste d'un
  -- contact réel (échange attesté, email dans un sens ou l'autre,
  -- rendez-vous). Un vrai échange remet le compteur à zéro — c'est bien
  -- « d'affilée » qu'on compte, pas un total.
  select count(*) as n
  from public.activities a
  where a.prospect_id = p.id
    and not a.is_draft
    and a.outcome = 'sans_reponse'
    and a.occurred_at > coalesce((
      select max(reel.at) from (
        select a2.occurred_at as at
        from public.activities a2
        where a2.prospect_id = p.id
          and not a2.is_draft
          and (a2.is_exchange or a2.type in ('email', 'rendez_vous'))
        union all
        select e2.received_at
        from public.emails e2
        where e2.prospect_id = p.id
      ) reel
    ), '-infinity'::timestamptz)
) sans_rep on true
left join lateral (
  select max(e.received_at) as last_email_sent_at
  from public.emails e
  where e.prospect_id = p.id and e.direction = 'sortant'
) sortants on true
left join lateral (
  select max(e.received_at) as last_reply_at
  from public.emails e
  where e.prospect_id = p.id and e.direction = 'entrant'
) entrants on true;

comment on view public.prospect_action_state is
  'Dernière action par prospect (canal + résultat + texte + date), appels sans '
  'réponse consécutifs, dernier mail envoyé, dernière réponse. last_kind = '
  'email_sortant sans réponse plus récente ⇒ « en attente de réponse ». Vue '
  'security_invoker : la RLS des tables de base s''applique.';

-- Inchangé depuis 012, restaté parce qu'un `create or replace` sur une vue
-- conserve ses droits mais qu'on ne veut pas dépendre de ce détail.
revoke all on public.prospect_action_state from public, anon;
grant select on public.prospect_action_state to authenticated;

-- Les résultats se lisent par prospect et par date : c'est le tri du compteur
-- « (3e fois) » et de la chronologie.
create index if not exists activities_prospect_outcome_idx
  on public.activities (prospect_id, occurred_at desc)
  where outcome is not null;
