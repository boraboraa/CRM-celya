-- 045 — Les vrais « intéressés » (05/11/2026, décision de Bora).
--
-- « Intéressé » est le SEUL résultat qui compte dans « intéressés ».
-- « À rappeler » (la personne a dit de rappeler à un autre moment) reste une
-- RÉPONSE — on a eu quelqu'un —, jamais un intéressé. Avant : intéressés =
-- intéressé + rappeler, et le classement du Sales Trophy affichait 55
-- intéressés pour UN vrai « Intéressé » depuis le 2/11.
--
-- Le corps est celui de la 033 (celui qui tourne en production, relu le
-- 05/11), à une ligne près (repérée « 045 ») et au commentaire près.
-- `create or replace` garde SECURITY DEFINER, `search_path = ''` et les
-- droits (service_role seul) — la recette 045 le vérifie au moteur.
-- `classement_equipe` et `compteurs_de` appellent `compteurs_pour` : ils
-- suivent sans être touchés.
-- Recopie TypeScript : lib/crm/compteurs.ts (INTERESSES) ; même jeu de cas :
-- lib/crm/compteurs.cas.json (test:objectifs et recette 045).
-- Les compteurs se calculent à la volée : l'historique se corrige seul.
--
-- Défaire : rejouer la section 3 de la 033.

create or replace function public.compteurs_pour(p_users uuid[], p_debut date, p_fin date)
returns table (
  user_id uuid,
  appels integer,
  reponses integer,
  interesses integer,
  rdv integer,
  essais integer,
  numeros integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with bornes as (
    select (p_debut::timestamp at time zone 'Europe/Brussels') as d,
           (p_fin::timestamp at time zone 'Europe/Brussels') as f
  ),
  u as (select unnest(p_users) as id),
  a as (
    select a.author_id as id,
           count(*) as appels,
           -- 033 : suivi_email
           count(*) filter (where a.outcome in ('rappeler', 'interesse', 'suivi_email', 'refus')) as reponses,
           -- 045 : « Intéressé » seul — « À rappeler » est une réponse, jamais un intéressé
           count(*) filter (where a.outcome = 'interesse') as interesses
      from public.activities a, bornes b
     where a.author_id = any(p_users)
       and not coalesce(a.is_draft, false)
       and a.outcome is not null
       and a.meeting_id is null
       and a.occurred_at >= b.d and a.occurred_at < b.f
     group by a.author_id
  ),
  m as (
    select coalesce(m.created_by, m.owner_id) as id, count(*) as rdv
      from public.meetings m, bornes b
     where coalesce(m.created_by, m.owner_id) = any(p_users)
       and m.kind = 'prospect'
       and m.status <> 'annule'
       and m.created_at >= b.d and m.created_at < b.f
     group by 1
  ),
  e as (
    select p.owner_id as id, count(*) as essais
      from public.prospects p, bornes b
     where p.owner_id = any(p_users)
       and p.essai_gratuit_at >= b.d and p.essai_gratuit_at < b.f
     group by 1
  ),
  n as (
    select p.created_by as id, count(*) as numeros
      from public.prospects p, bornes b
     where p.created_by = any(p_users)
       and p.created_at >= b.d and p.created_at < b.f
     group by 1
  )
  select u.id,
         coalesce(a.appels, 0)::int,
         coalesce(a.reponses, 0)::int,
         coalesce(a.interesses, 0)::int,
         coalesce(m.rdv, 0)::int,
         coalesce(e.essais, 0)::int,
         coalesce(n.numeros, 0)::int
    from u
    left join a on a.id = u.id
    left join m on m.id = u.id
    left join e on e.id = u.id
    left join n on n.id = u.id;
$$;

comment on function public.compteurs_pour(uuid[], date, date) is
  'La règle de comptage (031, 033, 045) — appels, réponses (rappeler · intéressé · suivi par email · refus), intéressés (« Intéressé » SEUL, 045), RDV, essais, numéros sur [début, fin) en dates de Bruxelles. Recopie : lib/crm/compteurs.ts. Service_role seul.';
