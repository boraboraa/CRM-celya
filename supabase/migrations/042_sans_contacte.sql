-- 042 — L'étape « Contacté » est retirée (29/10/2026, décision de Bora :
-- « Contacté, ça ne sera jamais une prochaine action »). Données seulement.
--
-- Chaque fiche encore en « Contacté » va dans l'étape que son JOURNAL
-- justifie — la règle de `statusFromFacts` (lib/crm/status.ts), recopiée ici
-- une fois, sans liste d'identifiants écrite à la main :
--   1. un résultat « Suivi par email », ou un RDV débriefé ainsi → suivi_email
--   2. un résultat « À rappeler » / « Intéressé », ou un RDV débriefé
--      « à rappeler »                                            → a_rappeler
--   3. un rendez-vous (activité, ou agenda non annulé)          → rendez_vous
--   4. entre le dernier email (envoyé ou reçu) et la dernière note attestée
--      SANS résultat, le plus récent : email → suivi_email, note → a_rappeler
--   5. rien de tout cela (un barrage, rien au journal)          → a_appeler
-- « Barrage » et « Pas décroché » ne sont jamais un fait d'étape : on n'a pas
-- eu le décideur. Les brouillons ne comptent pas.
--
-- Garde-fous :
--   • la copie d'AVANT est gardée dans `reprise_042` (RLS fermée, aucune
--     policy) — défaire : voir en bas ;
--   • une fiche verrouillée (choix humain) GARDE son verrou ; son motif
--     automatique n'est pas réécrit ;
--   • rien d'autre ne bouge : ni responsable, ni relances, ni rendez-vous, ni
--     journal, ni `updated_at` (« activité récente »), ni la prochaine action.
--     Les déclencheurs de `prospects` sont mis de côté le temps de CETTE
--     transaction (`session_replication_role = replica`) : `touch_updated_at`
--     réécrirait la date d'activité de chaque fiche, et la prochaine action
--     ne dépend que de « fiche close ou non » — toutes les étapes d'arrivée
--     sont ouvertes, comme « Contacté » : elle est identique (la recette le
--     vérifie).
--
-- La valeur reste dans l'enum `prospect_status` (Postgres ne retire pas une
-- valeur d'enum) ; la 043 la REFUSE à l'écriture.
-- À appliquer APRÈS la fusion du code (l'ancien code renverrait un barrage en
-- « Contacté » au premier geste) et APRÈS le redéploiement de `crm-mail`.

create table public.reprise_042 as
select p.id, p.status, p.status_locked, p.status_auto_reason, p.status_auto_at,
       p.updated_at, p.next_action_at, p.next_action_kind, now() as repris_le
  from public.prospects p
 where p.status = 'contacte';

alter table public.reprise_042 add primary key (id);
alter table public.reprise_042 enable row level security;
revoke all on public.reprise_042 from anon, authenticated;
comment on table public.reprise_042 is
  'Copie des fiches en « Contacté » avant la 042 (29/10/2026). RLS fermée. À supprimer une fois validée par Bora.';

create temp table vers_042 on commit drop as
with f as (
  select p.id,
    exists (select 1 from public.activities a
             where a.prospect_id = p.id and not coalesce(a.is_draft, false) and a.outcome = 'suivi_email')
    or exists (select 1 from public.meetings m
                where m.prospect_id = p.id and m.kind = 'prospect' and m.status = 'honore' and m.debrief_issue = 'suivi_email')
      as suivi,
    exists (select 1 from public.activities a
             where a.prospect_id = p.id and not coalesce(a.is_draft, false) and a.outcome in ('rappeler', 'interesse'))
    or exists (select 1 from public.meetings m
                where m.prospect_id = p.id and m.kind = 'prospect' and m.status = 'honore' and m.debrief_issue = 'a_rappeler')
      as rappel,
    exists (select 1 from public.activities a
             where a.prospect_id = p.id and not coalesce(a.is_draft, false) and a.type = 'rendez_vous')
    or exists (select 1 from public.meetings m
                where m.prospect_id = p.id and m.kind = 'prospect' and m.status <> 'annule')
      as rdv,
    greatest(
      (select max(a.occurred_at) from public.activities a
        where a.prospect_id = p.id and not coalesce(a.is_draft, false) and a.type = 'email'),
      (select max(e.received_at) from public.emails e where e.prospect_id = p.id)
    ) as dernier_email,
    (select max(a.occurred_at) from public.activities a
      where a.prospect_id = p.id and not coalesce(a.is_draft, false)
        and a.type = 'note' and coalesce(a.is_exchange, true) and a.outcome is null) as dernier_echange
  from public.prospects p
  where p.status = 'contacte'
)
select f.id,
  case
    when f.suivi then 'suivi_email'
    when f.rappel then 'a_rappeler'
    when f.rdv then 'rendez_vous'
    when f.dernier_email is not null
     and (f.dernier_echange is null or f.dernier_email >= f.dernier_echange) then 'suivi_email'
    when f.dernier_echange is not null then 'a_rappeler'
    else 'a_appeler'
  end::public.prospect_status as vers
from f;

set local session_replication_role = replica;

update public.prospects p
   set status = v.vers,
       status_auto_at = case when coalesce(p.status_locked, false) then p.status_auto_at else now() end,
       status_auto_reason = case when coalesce(p.status_locked, false) then p.status_auto_reason
         else 'étape « Contacté » retirée : ' || case v.vers::text
           when 'a_appeler'   then 'on n''a pas encore eu le décideur'
           when 'a_rappeler'  then 'on a eu la personne, il faut la rappeler'
           when 'suivi_email' then 'la suite se joue par email'
           else 'un rendez-vous est enregistré'
         end end
  from vers_042 v
 where v.id = p.id;

set local session_replication_role = origin;

-- Défaire (avant la 043) :
--   set local session_replication_role = replica;
--   update public.prospects p set status = r.status, status_auto_reason = r.status_auto_reason,
--          status_auto_at = r.status_auto_at from public.reprise_042 r where r.id = p.id;
