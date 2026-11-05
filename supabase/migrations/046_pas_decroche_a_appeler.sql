-- 046 — « Pas décroché » renvoie en « À appeler » (05/11/2026, décision de
-- Bora). Données seulement.
--
-- La règle vit en TypeScript (`factsFromRows` / `statusFromFacts`,
-- lib/crm/status.ts) : un appel sans réponse (« Pas décroché », ancien
-- « Barrage ») n'est plus un fait d'étape. « À appeler » = jamais appelée OU
-- uniquement des « Pas décroché ». Une fiche qui a eu un vrai échange (« À
-- rappeler », « Intéressé », note attestée, RDV débriefé « à rappeler »,
-- email, rendez-vous) GARDE son étape, même si un « Pas décroché » suit
-- (point A, tranché par Bora le 05/11 : « non »).
--
-- L'auto-classification ne recule jamais : les fiches que l'ancienne règle
-- (31/10) a mises en « À rappeler » à cause d'un « Pas décroché » y
-- resteraient. Cette reprise les remet UNE fois en « À appeler ».
--
-- Qui bouge — tout à la fois :
--   • étape « À rappeler », NON verrouillée (un choix humain ne se touche pas) ;
--   • au moins un « Pas décroché » / ancien « Barrage » au journal ;
--   • AUCUN fait qui justifie une autre étape (la règle de statusFromFacts,
--     recopiée ici une fois, comme dans la 042) : ni « Suivi par email »,
--     ni « À rappeler » / « Intéressé », ni RDV débriefé, ni rendez-vous
--     (activité ou agenda non annulé), ni email, ni note attestée sans
--     résultat. Les brouillons ne comptent pas.
-- Jamais une fiche perdue, gagnée, en essai, en suivi par email, en RDV.
--
-- Garde-fous (ceux de la 042) :
--   • la copie d'AVANT est gardée dans `reprise_046` (RLS fermée, aucune
--     policy) — défaire : voir en bas ;
--   • rien d'autre ne bouge : ni responsable, ni relances, ni rendez-vous, ni
--     journal, ni `updated_at` (« activité récente »), ni la prochaine action
--     (elle ne dépend que de « fiche close ou non », et « À appeler » est
--     ouverte comme « À rappeler » — la recette le vérifie). Les
--     déclencheurs de `prospects` sont mis de côté le temps de CETTE
--     transaction (`session_replication_role = replica`) ;
--   • le motif stocké dit la vérité : « appelée, sans réponse » (l'écran
--     relit des faits « appelée le 05/11, sans réponse »).
--
-- À appliquer APRÈS la fusion du code (l'ancien code remettrait la fiche en
-- « À rappeler » au premier « Pas décroché ») et APRÈS la 042.

create temp table vers_046 on commit drop as
select p.id
  from public.prospects p
 where p.status = 'a_rappeler'
   and not coalesce(p.status_locked, false)
   and exists (select 1 from public.activities a
                where a.prospect_id = p.id and not coalesce(a.is_draft, false)
                  and a.outcome in ('sans_reponse', 'barrage'))
   and not exists (select 1 from public.activities a
                    where a.prospect_id = p.id and not coalesce(a.is_draft, false)
                      and (a.outcome in ('suivi_email', 'rappeler', 'interesse')
                           or a.type in ('rendez_vous', 'email')
                           or (a.type = 'note' and coalesce(a.is_exchange, true) and a.outcome is null)))
   and not exists (select 1 from public.meetings m
                    where m.prospect_id = p.id and m.kind = 'prospect' and m.status <> 'annule')
   and not exists (select 1 from public.emails e where e.prospect_id = p.id);

create table public.reprise_046 as
select p.id, p.status, p.status_locked, p.status_auto_reason, p.status_auto_at,
       p.updated_at, p.next_action_at, p.next_action_kind, now() as repris_le
  from public.prospects p
 where p.id in (select id from vers_046);

alter table public.reprise_046 add primary key (id);
alter table public.reprise_046 enable row level security;
revoke all on public.reprise_046 from anon, authenticated;
comment on table public.reprise_046 is
  'Copie des fiches remises en « À appeler » par la 046 (« Pas décroché » n''est plus un fait d''étape, 05/11), avant le déplacement. RLS fermée. À supprimer une fois validée par Bora.';

set local session_replication_role = replica;

update public.prospects p
   set status = 'a_appeler',
       status_auto_at = now(),
       status_auto_reason = 'appelée, sans réponse'
  from vers_046 v
 where v.id = p.id;

set local session_replication_role = origin;

-- Défaire :
--   set local session_replication_role = replica;
--   update public.prospects p set status = r.status, status_auto_reason = r.status_auto_reason,
--          status_auto_at = r.status_auto_at from public.reprise_046 r where r.id = p.id;
