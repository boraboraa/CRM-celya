-- ============================================================
-- Celya CRM — probabilité de conclure et valeur pondérée
--
-- Bora veut chiffrer le « pressentiment » de chaque affaire. La valeur
-- pondérée (valeur estimée × probabilité) devient l'indicateur de
-- priorisation : 4 000 € à 50 % passent après 3 000 € à 90 %.
--
-- Migration ADDITIVE : le code déjà en production ignore ces colonnes.
-- ============================================================

alter table public.prospects
  add column if not exists probability smallint;

-- Un pourcentage, et rien d'autre. Contrainte nommée pour qu'une valeur
-- aberrante soit refusée en base, pas seulement dans le formulaire.
do $$ begin
  alter table public.prospects
    add constraint prospects_probability_range
    check (probability is null or (probability >= 0 and probability <= 100));
exception when duplicate_object then null; end $$;

-- Colonne GÉNÉRÉE : jamais désynchronisée de ses deux termes, et triable
-- directement en SQL (PostgREST ne sait pas trier sur une expression).
-- Probabilité non renseignée → pas de valeur pondérée : le CRM n'invente
-- pas un pressentiment que Bora n'a pas exprimé.
alter table public.prospects
  add column if not exists weighted_value numeric(14,2)
    generated always as (
      case
        when value_estimate is not null and probability is not null
          then round(value_estimate * probability / 100.0, 2)
      end
    ) stored;

create index if not exists prospects_weighted_idx
  on public.prospects(weighted_value desc nulls last);
