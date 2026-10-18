-- ============================================================
-- 028 — Une relance se pose sur une FICHE (18 octobre 2026)
--
-- Deux relances sans fiche (`prospect_id` nul) traînaient en retard depuis le
-- 27/09 — « Relancer vivier d'oie pour le rdv lundi à 10h », « Garage vivier
-- d'oie lundi à 10h » — sans lien vers la fiche ni bouton « Résultat » : le
-- pense-bête libre du tableau de bord fabriquait des relances orphelines. Il
-- est retiré de l'écran (décision de Bora, 18/10) ; le connecteur MCP
-- (`planifier_relance`) exigeait déjà une fiche.
--
-- La base le garantit désormais pour tout écrivain : une relance OUVERTE
-- (`a_faire`) a une fiche. Une relance close (faite, annulée) sans fiche reste
-- acceptée — c'est ce qui permet de CLORE les deux existantes sans erreur.
--
-- NOT VALID : les deux lignes existantes ne sont pas vérifiées (Bora s'en
-- occupe : les rattacher à la fiche, les cocher ou les supprimer). Toute
-- NOUVELLE ligne, et toute modification d'une ligne, l'est. ⚠ Tant qu'elles
-- sont ouvertes et sans fiche, les RE-DATER sera refusé (23514) : les
-- rattacher, les cocher ou les supprimer, oui.
--
-- La policy `tasks_insert` (020) gardait la relance libre (`prospect_id is
-- null`) : elle n'est pas touchée — c'est cette contrainte qui ferme la porte,
-- pour tout le monde, service_role compris.
--
-- Migration ADDITIVE ; indépendante de 025, 026, 027. Réversible :
-- `alter table public.tasks drop constraint tasks_ouverte_sur_fiche`.
-- ============================================================

alter table public.tasks
  add constraint tasks_ouverte_sur_fiche
  check (prospect_id is not null or status <> 'a_faire') not valid;

comment on constraint tasks_ouverte_sur_fiche on public.tasks is
  'Une relance ouverte se pose sur une fiche (028, 18/10/2026). NOT VALID : les relances '
  'orphelines d''avant ne sont pas vérifiées, mais ne peuvent plus être re-datées tant '
  'qu''elles sont ouvertes — les rattacher, les cocher ou les supprimer.';
