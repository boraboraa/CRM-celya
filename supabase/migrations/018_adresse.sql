-- =====================================================================
-- 018 — L'adresse du prospect (01/09/2026)
--
-- Les commerciaux se repèrent avec Google Maps. Il leur manquait
-- simplement un endroit où COLLER un lien Maps (ou taper une adresse)
-- et le retrouver en un bouton cliquable.
--
-- UN SEUL champ, libre : une adresse OU un lien Maps collé. C'est
-- lib/crm/maps.ts qui distingue les deux — pas l'utilisateur, et surtout
-- pas deux colonnes dont personne ne saurait laquelle remplir.
-- `meetings.location` existe déjà et joue le même rôle pour un
-- rendez-vous ponctuel : même helper, même affichage.
--
-- ADDITIVE, donc applicable avant le déploiement du code : une colonne
-- que le code en production ignore ne casse rien.
--
-- Aucune modification de RLS : `prospects` cloisonne déjà par
-- propriétaire, et l'adresse suit la fiche. Rien à configurer par
-- compte — c'est l'avantage de ne pas passer par une API authentifiée.
-- =====================================================================

alter table public.prospects add column if not exists address text;

comment on column public.prospects.address is
  'Adresse libre OU lien Google Maps collé. UN SEUL champ : lib/crm/maps.ts distingue les deux.';
