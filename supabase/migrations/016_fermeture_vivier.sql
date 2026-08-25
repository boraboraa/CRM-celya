-- ============================================================
-- Celya CRM — fermeture du vivier (25 août 2026)
--
-- Décision de Bora, prise après l'analyse du pour/contre. Le vivier
-- (`owner_id is null`, visible par TOUS les membres) était la dernière brèche
-- d'une cloison par ailleurs étanche, et la seule qui soit *silencieuse* : un
-- clic sur « Non assigné (visible par tous) » dans un formulaire publiait la
-- fiche à toute l'équipe sans le dire.
--
-- Avec deux commerciaux sur deux marchés différents, il n'avait aucun sens
-- métier : une fiche du marché de Bora n'intéresse pas le commercial, et
-- réciproquement. Et la règle « un commercial ne voit que ses prospects
-- assignés » est posée comme non négociable — le vivier en était l'exception
-- permanente.
--
-- Un seul geste ici : retirer `or p_owner is null` de can_see_prospect.
-- Rien ne devient invisible pour autant — l'admin voit tout de toute façon —
-- et le trigger `prospects_set_owner` (migration 015) garantit déjà qu'aucune
-- fiche ne naît sans propriétaire. Constaté avant application : 19 fiches,
-- 0 orpheline. Le geste est réversible : remettre la branche restaure
-- l'ancien comportement à l'identique.
--
-- Répercuté dans le code dans le même geste (règle du projet : la migration
-- doit rester compatible avec le code EN PRODUCTION, donc le code part en
-- premier) :
--   · lib/crm/access.ts        — canSeeProspect / scopeProspects / scopeJoined
--   · supabase/functions/crm-mail — le contrôle d'accès de `send`
--   · components/ProspectForm     — l'option « Non assigné » retirée
--   · components/ImportWizard     — l'option « Personne (vivier partagé) »
--   · app/actions.ts, lib/crm/prospects.ts — « none » ne vaut plus « personne »
--
-- Si l'usage « fichier à se partager » apparaît un jour, il se traitera par
-- une corbeille d'affectation explicite (colonne `pool`), pas par l'absence
-- de propriétaire.
-- ============================================================

create or replace function public.can_see_prospect(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_member()
     and (public.is_admin() or p_owner = auth.uid());
$$;

comment on function public.can_see_prospect(uuid) is
  'admin voit tout, chacun voit ses fiches. Le vivier (owner null) est fermé depuis le 25 août 2026 (migration 016).';

-- Filet : si une fiche orpheline subsistait malgré le trigger de la 015, elle
-- deviendrait invisible à tous sauf à l'admin. On le sait tout de suite plutôt
-- que de le découvrir par une fiche disparue.
do $$
declare n integer;
begin
  select count(*) into n from public.prospects where owner_id is null;
  if n > 0 then
    raise warning 'Fermeture du vivier : % fiche(s) sans propriétaire ne seront plus visibles que par un admin. Assignez-les depuis /prospects.', n;
  end if;
end $$;
