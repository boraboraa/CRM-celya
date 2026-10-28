-- 035 — Supprimer une fiche supprime ses rendez-vous (28/10/2026).
--
-- Décision de Bora : quand une fiche est supprimée, ses rendez-vous partent
-- avec elle — plus de rendez-vous « fantôme », rattaché à rien, dans l'agenda.
-- Jusqu'ici `meetings.prospect_id` était ON DELETE SET NULL : le RDV restait,
-- sans fiche, et la zone « Aujourd'hui » ou l'agenda l'affichaient encore.
--
-- La règle vit dans la clé étrangère, donc pour TOUS les écrivains (écran,
-- connecteur MCP, SQL direct). Un RDV personnel n'a pas de fiche
-- (prospect_id nul) : il n'est jamais touché.
--
-- Ce qui suit la fiche, pour mémoire : activities, tasks, appels_ia_file,
-- appels_ia_briefs → supprimés (déjà) ; meetings → supprimés (ici) ;
-- emails, appels_ia, appels_ia_opposition → gardés, détachés (prospect_id nul :
-- un mail reste une trace, l'opposition porte le NUMÉRO composé).
--
-- Compatible avec le code en production (aucune colonne) ; réversible :
--   alter table public.meetings drop constraint meetings_prospect_id_fkey;
--   alter table public.meetings add constraint meetings_prospect_id_fkey
--     foreign key (prospect_id) references public.prospects(id) on delete set null;

alter table public.meetings drop constraint meetings_prospect_id_fkey;
alter table public.meetings add constraint meetings_prospect_id_fkey
  foreign key (prospect_id) references public.prospects(id) on delete cascade;
