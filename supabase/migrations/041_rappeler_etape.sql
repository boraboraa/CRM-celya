-- 041 — Le résultat d'appel « À rappeler » fait entrer la fiche dans l'étape
-- « À rappeler » (29/10/2026, retour de Bora : « dans le pipeline c'est dans
-- Contacté, mais la carte dit À rappeler »). Données seulement.
--
-- La règle vit en TypeScript (`factsFromRows`, lib/crm/status.ts) : un
-- résultat `rappeler` est désormais un FAIT, comme un débrief « intéressé, à
-- rappeler ». Elle s'applique au prochain événement de chaque fiche ; cette
-- reprise l'applique UNE fois aux fiches qui l'attendent déjà, avec les mêmes
-- garde-fous : jamais une fiche verrouillée (choix humain), jamais en
-- arrière (seulement depuis À appeler / Contacté / Rendez-vous), jamais une
-- fiche gagnée, perdue, en essai ou en suivi par email. Le motif est celui
-- que le code écrirait (« la personne a demandé à être rappelée le 29 oct.
-- 2026 », date du DERNIER résultat « À rappeler », en heure de Bruxelles).
-- Défaire : status = 'contacte' sur ces fiches (status_auto_reason le dit).

with derniers as (
  select a.prospect_id, max(a.occurred_at) as at
    from public.activities a
   where a.outcome = 'rappeler' and coalesce(a.is_draft, false) = false
   group by a.prospect_id
)
update public.prospects p
   set status = 'a_rappeler',
       status_auto_at = now(),
       status_auto_reason = 'la personne a demandé à être rappelée le '
         || to_char(d.at at time zone 'Europe/Brussels', 'DD') || ' '
         || (array['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'])
              [extract(month from d.at at time zone 'Europe/Brussels')::int]
         || ' ' || to_char(d.at at time zone 'Europe/Brussels', 'YYYY')
  from derniers d
 where d.prospect_id = p.id
   and coalesce(p.status_locked, false) = false
   and p.status in ('a_appeler', 'contacte', 'rendez_vous');
