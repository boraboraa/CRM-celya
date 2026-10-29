-- 043 — L'étape « Contacté » est REFUSÉE à l'écriture (29/10/2026).
--
-- À appliquer APRÈS la fusion du code qui la retire (branche
-- claude/sans-contacte), APRÈS le redéploiement de `crm-mail` (l'ancienne
-- version faisait passer une fiche en « Contacté » à la première réponse
-- reçue : sa mise à jour aurait échoué, last_contact_at compris) et APRÈS
-- la 042, qui vide l'étape — la contrainte se valide sur toutes les lignes.
-- Tous les écrivains y passent — écran, connecteur MCP (service_role), Janet,
-- crm-mail, SQL direct. Le code lit une valeur restée « contacte » comme
-- « À rappeler » (`normalizeStatus`).
-- Défaire : alter table public.prospects drop constraint prospects_sans_contacte;

alter table public.prospects
  add constraint prospects_sans_contacte check (status <> 'contacte');
