-- 040 — L'étape « Proposition » est REFUSÉE à l'écriture (29/10/2026).
--
-- À appliquer APRÈS la fusion du code qui la retire (branche
-- claude/sans-proposition) : l'ancien code proposait encore la colonne
-- « Proposition » du pipeline, un dépôt y aurait échoué (23514).
-- La 039 a déjà vidé l'étape : la contrainte se valide sur toutes les lignes.
-- Tous les écrivains y passent — écran, connecteur MCP (service_role), Janet,
-- SQL direct. Le code lit une valeur restée « proposition » comme
-- « À rappeler » (`normalizeStatus`).
-- Défaire : alter table public.prospects drop constraint prospects_sans_proposition;

alter table public.prospects
  add constraint prospects_sans_proposition check (status <> 'proposition');
