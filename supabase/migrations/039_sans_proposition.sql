-- 039 — L'étape « Proposition » est retirée (29/10/2026, décision de Bora :
-- « un de trop, c'est trop chargé »). Données seulement.
--
-- Deux fiches y étaient (New Auto Torino, Wondercar car Overijs), toutes deux
-- posées à la main (verrouillées) : elles passent en « À rappeler » — on
-- attend leur retour, donc on les rappelle (choix de Bora). Le verrou reste :
-- c'est toujours une décision humaine. Rien d'autre ne bouge : aucune fiche
-- n'avait `proposal_sent_at`, aucun RDV n'était débriefé « proposition ».
--
-- La valeur reste dans l'enum `prospect_status` (Postgres ne retire pas une
-- valeur d'enum) ; la 040 la REFUSE à l'écriture, après la fusion du code.
-- Défaire : remettre ces deux id en 'proposition' (avant la 040).

update public.prospects
   set status = 'a_rappeler',
       status_locked = true,
       status_locked_at = coalesce(status_locked_at, now()),
       status_auto_reason = null,
       status_auto_at = null
 where status = 'proposition';
