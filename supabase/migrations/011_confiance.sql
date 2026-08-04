-- 011 — Confiance commerciale estimée par l'IA (Chaud / Tiède / Froid).
--
-- Remplace, à l'écran, la probabilité saisie à la main et les montants sur
-- les cartes. Les colonnes probability / weighted_value RESTENT en base
-- (rien de destructif) — seule l'interface cesse de les afficher/exiger.
--
-- confidence_level  : 'chaud' | 'tiede' | 'froid' | null (= « à évaluer »).
--                     null est un état honnête : IA indisponible ou pas assez
--                     d'éléments — jamais un faux niveau.
-- confidence_reason : la raison courte, en clair (« réponse positive reçue »,
--                     « sans réponse depuis 12 jours »).
-- confidence_locked : Bora a corrigé le niveau à la main — l'IA ne réécrit
--                     plus rien (même logique que status_locked).
-- confidence_at     : date du dernier calcul / de la dernière correction.
--
-- Migration additive : applicable avant le déploiement du code, le code en
-- production ignore ces colonnes.

alter table public.prospects
  add column if not exists confidence_level text
    constraint prospects_confidence_level_check
    check (confidence_level is null or confidence_level in ('chaud', 'tiede', 'froid')),
  add column if not exists confidence_reason text,
  add column if not exists confidence_locked boolean not null default false,
  add column if not exists confidence_at timestamptz;
