-- ============================================================
-- 012 — Dernière action par prospect (canal + résultat + date)
--
-- Le besoin (7 août) : distinguer d'un coup d'œil les prospects APPELÉS de
-- ceux SUIVIS PAR MAIL. La carte affiche désormais la dernière action
-- (« Mail envoyé, il y a 2 j », « Appelé, pas de réponse, il y a 3 j »)
-- et « À faire » sépare trois états : à appeler / en attente de réponse /
-- réponses reçues.
--
-- Migration ADDITIVE : une vue et un index — rien n'est renommé ni supprimé,
-- le code en production n'en sait rien et continue de fonctionner.
--
-- NB : le résultat d'appel s'écrit dans activities.outcome (colonne de 001,
-- jamais utilisée jusqu'ici) — valeur 'sans_reponse' quand Bora note
-- « Appelé, pas de réponse ». Aucune colonne nouvelle n'est nécessaire.
-- ============================================================

-- Lecture des emails par prospect (il n'existait qu'un index global de tri).
create index if not exists emails_prospect_received_idx
  on public.emails (prospect_id, received_at desc);

-- ------------------------------------------------------------
-- La vue « dernière action » : par prospect, le dernier événement réel du
-- journal (activités hors brouillon + emails), le dernier mail envoyé et la
-- dernière réponse reçue. Les brouillons n'y comptent JAMAIS (même règle que
-- la chronologie et readProspectFacts).
--
-- security_invoker : la vue lit avec les droits du lecteur — la RLS de
-- prospects / activities / emails s'applique, un commercial n'y voit que
-- ses fiches. C'est l'invariant du projet : la sécurité est en base.
-- ------------------------------------------------------------
create or replace view public.prospect_action_state
with (security_invoker = on) as
select
  p.id as prospect_id,
  ev.kind as last_kind,
  ev.at   as last_at,
  sortants.last_email_sent_at,
  entrants.last_reply_at
from public.prospects p
left join lateral (
  select kind, at
  from (
    select
      case
        when a.type = 'rendez_vous'         then 'rendez_vous'
        when a.type = 'email'               then 'email_sortant'
        when a.is_exchange                  then 'echange'
        when a.outcome = 'sans_reponse'     then 'appel_sans_reponse'
        else 'note_interne'
      end as kind,
      a.occurred_at as at
    from public.activities a
    where a.prospect_id = p.id
      and not a.is_draft
    union all
    select
      case when e.direction = 'entrant'
           then 'email_entrant' else 'email_sortant' end,
      e.received_at
    from public.emails e
    where e.prospect_id = p.id
  ) events
  order by at desc
  limit 1
) ev on true
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
  'Dernière action par prospect (canal + date), dernier mail envoyé, dernière '
  'réponse. last_kind = email_sortant sans réponse plus récente ⇒ « en attente '
  'de réponse ». Vue security_invoker : la RLS des tables de base s''applique.';

-- Le rôle anon n'a aucun droit sur les données CRM ; authenticated lit à
-- travers sa RLS (un commercial ne voit que ses fiches).
revoke all on public.prospect_action_state from public, anon;
grant select on public.prospect_action_state to authenticated;

-- ------------------------------------------------------------
-- Correction UNIQUE des fiches déjà emailées sous l'ancienne cadence.
--
-- L'ancien envoi laissait la relance existante OUVERTE (elle n'était créée
-- que « si aucune n'existait ») : des fiches en attente de réponse
-- s'affichaient « en retard » dès le lendemain. On re-date ces relances à
-- l'envoi + 5 jours (09:00 Bruxelles) — uniquement si le dernier événement
-- est bien un mail sortant resté sans réponse, jamais une tâche « RDV … »,
-- et on ne fait que REPOUSSER (une échéance déjà plus lointaine, posée à la
-- main, est conservée).
-- ------------------------------------------------------------
with dernier_envoi as (
  select prospect_id, max(received_at) as sent_at
  from public.emails
  where direction = 'sortant' and prospect_id is not null
  group by prospect_id
),
sans_reponse as (
  select d.prospect_id, d.sent_at
  from dernier_envoi d
  where not exists (
    select 1 from public.emails r
    where r.prospect_id = d.prospect_id
      and r.direction = 'entrant'
      and r.received_at > d.sent_at
  )
)
update public.tasks t
   set due_at = (((s.sent_at + interval '5 days')
                   at time zone 'Europe/Brussels')::date + time '09:00')
                 at time zone 'Europe/Brussels',
       title  = case when t.title like 'Relancer %'
                     then 'Relancer ' || p.company_name || ' si pas de réponse'
                     else t.title end
  from sans_reponse s
  join public.prospects p on p.id = s.prospect_id
 where t.prospect_id = s.prospect_id
   and t.status = 'a_faire'
   and t.title not like 'RDV%'
   and t.due_at < (((s.sent_at + interval '5 days')
                     at time zone 'Europe/Brussels')::date + time '09:00')
                   at time zone 'Europe/Brussels';
