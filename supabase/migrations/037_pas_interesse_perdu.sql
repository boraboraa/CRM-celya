-- 037 — « Pas intéressé » = Perdu : la reprise (29/10/2026, décision de Bora).
--
-- Depuis le 29/10, le résultat d'appel « Pas intéressé » fait passer la fiche
-- en « Perdu » (écran et connecteur MCP — app/actions.ts, lib/crm/perdues.ts),
-- et les fiches perdues ne s'affichent plus par défaut (liste, « À faire »).
-- Les fiches dont le DERNIER résultat est déjà « Pas intéressé » sont restées
-- à leur étape (4 le 29/10, toutes « Contacté », sans relance ouverte) : on
-- leur applique la règle une fois, comme un humain l'aurait fait — étape
-- verrouillée, relances ouvertes annulées (aucune aujourd'hui). La raison est
-- déjà dans `lost_reason`.
--
-- Aucune colonne, aucune fonction : données seulement. Rejouable (une fiche
-- déjà perdue n'est plus visée). Gagnées jamais touchées.
-- Défaire : remettre status = 'contacte', status_locked = false sur ces fiches.

with visees as (
  select p.id
    from public.prospects p
    join public.prospect_action_state s on s.prospect_id = p.id
   where s.last_outcome = 'refus'
     and p.status not in ('perdu', 'gagne')
), relances as (
  update public.tasks t
     set status = 'annule'
    from visees v
   where t.prospect_id = v.id and t.status = 'a_faire'
  returning t.id
)
update public.prospects p
   set status = 'perdu',
       status_locked = true,
       status_locked_at = now(),
       status_auto_reason = null,
       status_auto_at = null,
       lost_reason = coalesce(nullif(trim(p.lost_reason), ''), 'Pas intéressé')
  from visees v
 where p.id = v.id;
