-- 029 — Appels IA : simuler l'inscription d'une sélection de fiches.
--
-- L'assistant « Nouvelle campagne » de l'écran Appels IA dit, AVANT de lancer,
-- combien de fiches cochées Janet pourra appeler, et pourquoi chacune des
-- autres est écartée (pas de numéro belge appelable, opposition, rendez-vous à
-- venir, déjà dans la file, gagnée / perdue).
--
-- La règle existe déjà, une seule fois : `appels_ia_refus_inscription`
-- (migration 025), celle qu'appliquent `appels_ia_inscrire`, le bouton de la
-- fiche et l'outil MCP. Mais elle n'est exécutable QUE par le service_role —
-- elle ne vérifie pas l'appelant, et l'ouvrir à `authenticated` laisserait un
-- commercial sonder l'existence de n'importe quelle fiche. D'où cette
-- enveloppe : admin vérifié, lecture seule, la règle appelée telle quelle,
-- jamais recopiée. Le code Next n'a pas à toucher au service_role pour ça.
--
-- Inscription « à la main » (`p_auto` faux) : la même que celle que fera le
-- lancement (`appels_ia_inscrire`). Le mode test ne joue que pour
-- l'inscription automatique ; il est passé pour être fidèle à l'appel réel.
--
-- ADDITIVE : une fonction neuve, aucune table, aucune policy, aucune donnée.
-- Le code du même lot la lit de façon TOLÉRANTE (absente → l'assistant dit
-- que la vérification est indisponible et ne lance rien). Réversible :
-- supprimer la fonction.

create or replace function public.appels_ia_simuler_inscription(p_prospects uuid[])
returns table (prospect_id uuid, refus text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_mode boolean;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_prospects, 1), 0) > 1000 then
    raise exception 'Trop de fiches d''un coup (1 000 au plus).' using errcode = '22023';
  end if;
  select r.mode_test into v_mode from public.appels_ia_reglages r where r.id = 1;
  return query
    select x.id, public.appels_ia_refus_inscription(x.id, false, auth.uid(), coalesce(v_mode, true))
      from unnest(coalesce(p_prospects, '{}'::uuid[])) with ordinality as x(id, rang)
     order by x.rang;
end $$;

comment on function public.appels_ia_simuler_inscription(uuid[]) is
  'Appels IA — pour chaque fiche, la raison pour laquelle elle n''entrerait pas dans la file (NULL : elle entrerait). Admin seul, lecture seule. La règle : appels_ia_refus_inscription (025).';

revoke all on function public.appels_ia_simuler_inscription(uuid[]) from public, anon;
grant execute on function public.appels_ia_simuler_inscription(uuid[]) to authenticated;
