-- ============================================================
-- Celya CRM — l'interrupteur « travaille en équipe » (19 septembre 2026)
--
-- POURQUOI. Deux commerciaux sont arrivés le 19 septembre, Collins et Nathan,
-- et ils travaillent sur LE MÊME marché. La cloison posée en 016 (« un
-- commercial ne voit que ses prospects assignés ») a été écrite pour Rémi, qui
-- travaille SEUL sur un autre marché — et pour lui elle reste non négociable.
-- Mais appliquée à un binôme, elle produit exactement ce qu'un CRM doit
-- empêcher : ils vont appeler les mêmes sociétés, l'un après l'autre, sans
-- pouvoir le savoir. La règle d'attribution que Bora leur donne (« au premier
-- qui l'enregistre, réservé 90 jours ») est INVÉRIFIABLE par ceux qui doivent
-- la respecter. Un cloisonnement qu'on ne peut pas contrôler n'est pas une
-- sécurité, c'est une collision programmée.
--
-- Ce n'est PAS une table `teams`, et il n'y a pas de concept d'équipe ici :
-- une seule case à cocher par personne, et une règle RÉCIPROQUE. Cochée, elle
-- donne le droit ET expose — personne n'est regardé sans être regardant. Deux
-- porteurs se voient ; un non-porteur reste invisible pour eux et ne voit rien
-- de plus. C'est ce qui permet à Rémi de rester cloisonné DANS LES DEUX SENS
-- sans qu'on ait à écrire une exception à son nom. Le deuxième binôme, le jour
-- où il y en aura un, demandera une vraie notion d'équipe ; celui-ci non.
--
-- L'ADMIN NE PORTE PAS L'INTERRUPTEUR. Bora voit déjà tout par `is_admin()`,
-- et ses 52 fiches ne doivent être exposées à personne. `partage_equipe` exige
-- donc `role = 'commercial'` DES DEUX CÔTÉS : même si la case de l'admin était
-- cochée par erreur ou par SQL direct, ses fiches resteraient invisibles.
--
-- LECTURE PARTAGÉE, ÉCRITURE PERSO — et c'est là qu'est le piège de cette
-- migration. Quatre tables héritent de la cloison par un EXISTS sur
-- `prospects` (activities, tasks, emails) ou par `owner_id` (meetings) :
-- élargir `can_see_prospect` élargit donc AUSSI l'écriture, sans que rien ne
-- le dise. Mesuré en base avant d'écrire ceci, en Rémi, transactions annulées :
--
--   · `activities_insert` (WITH CHECK ... EXISTS(prospects)) est aujourd'hui
--     REFUSÉ (42501) sur une fiche invisible — il ne l'est que parce que la
--     LECTURE est fermée. Sans le rebasage ci-dessous, Collins écrirait des
--     notes et des résultats d'appel sur les fiches de Nathan dès la première
--     seconde ;
--   · `tasks_insert` (WITH CHECK `is_member()` seul) est déjà ACCEPTÉ — Rémi
--     peut poser une relance sur une fiche de Bora qu'il ne voit pas, et le
--     trigger `sync_next_action` déplace le « À faire » de Bora. Trou
--     préexistant, que ce lot rend atteignable depuis l'interface : bouché ici.
--
-- Les cinq expressions d'écriture rebasées plus bas sont ISO-COMPORTEMENT le
-- jour de leur application : `can_see_prospect` vaut déjà « propriétaire » pour
-- un commercial, et les EXISTS explicites reproduisent le filtre que la RLS
-- appliquait implicitement. Elles ne retirent rien à personne — elles refusent
-- seulement de s'élargir avec la lecture.
--
-- ADDITIVE ET COMPATIBLE AVEC LE CODE EN PRODUCTION (règle du projet) : la
-- colonne naît à `false`, donc `partage_equipe` est faux pour tout le monde et
-- rien ne change tant que Bora n'a coché personne. Le code du même lot lit la
-- colonne de façon TOLÉRANTE (voir `lirePorteurs` dans lib/crm/access.ts : un
-- 42703 vaut « personne ne partage »), il peut donc partir avant cette
-- migration comme après.
--
-- RÉVERSIBLE : décocher les cases suffit. Retirer `or partage_equipe(...)` des
-- deux policies restaure 016 à l'identique.
--
-- Répercuté dans le code dans le même geste — `lib/crm/access.ts` EST la
-- cloison pour le connecteur MCP (service_role, RLS contournée). Une policy
-- modifiée sans ce fichier, c'est une fuite par l'assistant de chaque
-- commercial :
--   · lib/crm/access.ts              — voitEquipe, visiblesIds, canEditProspect
--   · lib/crm/perimetre.ts           — un porteur a droit au sélecteur
--   · components/PerimetreSwitcher   — rendu aussi pour un porteur
--   · app/[transport]/route.ts       — les six outils d'écriture vérifient la
--                                      PROPRIÉTÉ, plus seulement la visibilité
--   · app/(app)/prospects/[id]       — la fiche d'un collègue est en lecture seule
-- ============================================================

-- ------------------------------------------------------------
-- 1. La case.
-- ------------------------------------------------------------
alter table public.crm_users
  add column if not exists voit_equipe boolean not null default false;

comment on column public.crm_users.voit_equipe is
  'Travaille en équipe : voit ET est vu par les autres membres cochés. '
  'Réciproque par construction (voir partage_equipe). Réservée aux comptes '
  'commerciaux : un admin voit déjà tout, et ses fiches ne doivent être '
  'exposées à personne.';

-- ------------------------------------------------------------
-- 2. La règle du partage.
-- ------------------------------------------------------------
-- Un seul `exists` à deux recherches de clé primaire : `can_see_prospect` est
-- évaluée PAR LIGNE, et `crm_users` compte cinq lignes. Négligeable à 77
-- fiches, mesurable mais acceptable à 2 000.
--
-- `p_owner is null` ne matche jamais (`lui.id = null`), donc une fiche
-- orpheline reste invisible — le vivier reste fermé (016), et le trigger
-- `prospects_set_owner` (015) garantit de toute façon qu'il n'en naît plus.
create or replace function public.partage_equipe(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.crm_users moi, public.crm_users lui
     where moi.id = auth.uid()
       and lui.id = p_owner
       and moi.is_active and lui.is_active
       and moi.role = 'commercial' and lui.role = 'commercial'
       and moi.voit_equipe and lui.voit_equipe
  );
$$;

comment on function public.partage_equipe(uuid) is
  'Vrai quand L''APPELANT ET LE PROPRIÉTAIRE portent tous deux '
  'crm_users.voit_equipe, sont actifs, et sont commerciaux. Réciproque par '
  'construction : la même expression accorde le droit et expose, personne '
  'n''est regardé sans être regardant. Doit rester en phase avec '
  'lib/crm/access.ts (le connecteur MCP agit en service_role, RLS contournée).';

revoke all on function public.partage_equipe(uuid) from public, anon;
grant execute on function public.partage_equipe(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 3. La LECTURE s'élargit — deux expressions, quatre tables.
-- ------------------------------------------------------------
-- `prospects_select` suit la fonction sans être réécrite ; et avec elle
-- `activities_select`, `tasks_select`, `emails_select` (leur EXISTS sur
-- `prospects` est soumis à la RLS de `prospects` — vérifié empiriquement : en
-- Rémi, 16 activités sur 132 et 3 relances sur 54) ainsi que la vue
-- `prospect_action_state` (`security_invoker`).
--
-- Conséquence assumée : le CORPS des emails des prospects d'un collègue
-- devient lisible. C'est réciproque, et c'est le but (savoir où l'autre en
-- est). Pour le refermer sans toucher au reste : rebaser `emails_select` sur
-- `owns_mailbox(mailbox)` + ses propres fiches.
create or replace function public.can_see_prospect(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_member()
     and (public.is_admin()
          or p_owner = auth.uid()
          or public.partage_equipe(p_owner));
$$;

-- L'agenda. `meetings_visibles` n'est PAS touchée : elle masque déjà le titre,
-- le lieu, les notes et le prospect d'un rendez-vous `kind='perso'` dont on
-- n'est pas propriétaire, pour tout le monde, admin compris. C'est la
-- protection due à un agent commercial indépendant — lire les RDV privés de
-- Rémi serait un élément de requalification.
drop policy if exists meetings_select on public.meetings;
-- `to` omis volontairement : la policy d'origine portait déjà {public},
-- comme les trois autres de `meetings`. `anon` n'a aucun grant sur la table.
create policy meetings_select on public.meetings
  for select using (
    public.is_member()
    and (public.is_admin()
         or owner_id = auth.uid()
         or public.partage_equipe(owner_id))
  );

-- ------------------------------------------------------------
-- 4. L'ÉCRITURE ne bouge pas — cinq policies rebasées sur le PROPRIÉTAIRE.
-- ------------------------------------------------------------
-- Sans ces cinq expressions, « lecture partagée, écriture perso » serait faux
-- dès l'application de la section 3, et de façon silencieuse : rien ne lève,
-- l'écriture passe simplement.

-- La fiche elle-même. Le WITH CHECK valait `is_member()` seul : n'importe quel
-- membre pouvait donc réassigner une fiche à n'importe qui — et une fois la
-- lecture élargie, PRENDRE celle d'un collègue. Resserré ici : on ne sort pas
-- une fiche de son propriétaire sans être admin. (Le champ « Responsable » du
-- formulaire est masqué aux non-admins dans le même lot.)
drop policy if exists prospects_update on public.prospects;
create policy prospects_update on public.prospects
  for update to authenticated using (
    public.is_member() and (public.is_admin() or owner_id = auth.uid())
  ) with check (
    public.is_member() and (public.is_admin() or owner_id = auth.uid())
  );

-- Les relances. Les trois branches d'origine sont conservées telles quelles ;
-- seule la quatrième (l'EXISTS) gagne le filtre de propriété qui l'empêche de
-- s'élargir avec la lecture.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated using (
    public.is_member()
    and (public.is_admin()
         or assignee_id = auth.uid()
         or created_by = auth.uid()
         or exists (select 1 from public.prospects c
                     where c.id = tasks.prospect_id and c.owner_id = auth.uid()))
  ) with check (public.is_member());

-- Le rattachement d'un email. `owns_mailbox` passe devant : ce sont MES
-- messages, arrivés dans MA boîte (migration 015), et c'est ce qui fait vivre
-- l'écran « Non rattachés » d'un commercial.
drop policy if exists emails_update on public.emails;
create policy emails_update on public.emails
  for update to authenticated using (
    public.is_member()
    and (public.is_admin()
         or public.owns_mailbox(mailbox)
         or exists (select 1 from public.prospects c
                     where c.id = emails.prospect_id and c.owner_id = auth.uid()))
  ) with check (public.is_member());

-- Le journal. C'est LA policy que l'élargissement de la lecture aurait ouverte
-- sans bruit : consigner une note, un résultat d'appel ou un rendez-vous sur
-- la fiche d'un collègue. Mesuré refusé (42501) avant cette migration ; il
-- doit le rester après.
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert to authenticated with check (
    public.is_member()
    and (public.is_admin()
         or exists (select 1 from public.prospects c
                     where c.id = activities.prospect_id
                       and c.owner_id = auth.uid()))
  );

-- La relance, à l'insertion. Trou PRÉEXISTANT (WITH CHECK `is_member()` seul,
-- mesuré accepté sur une fiche invisible). La relance LIBRE — sans prospect,
-- « Nouvelle relance » du tableau À faire — reste possible : c'est un
-- pense-bête, il n'écrit sur la fiche de personne.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated with check (
    public.is_member()
    and (public.is_admin()
         or prospect_id is null
         or exists (select 1 from public.prospects c
                     where c.id = tasks.prospect_id and c.owner_id = auth.uid()))
  );

-- ------------------------------------------------------------
-- 5. L'interrupteur ne doit pas être AUTO-SERVI.
-- ------------------------------------------------------------
-- `crm_users_update_self` autorise `update ... where id = auth.uid()`, et ce
-- garde-fou ne protégeait que `role` et `is_active`. Mesuré en Rémi,
-- transaction annulée : la mise à jour d'une colonne non gardée de sa propre
-- ligne est ACCEPTÉE (1 ligne), l'auto-promotion admin REFUSÉE (P0001).
-- Sans la ligne ajoutée ci-dessous, Rémi se coche lui-même et entre dans le
-- partage — dans les deux sens. Une case qui donne un droit se coche par
-- l'admin, jamais par son bénéficiaire.
create or replace function public.guard_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
begin
  if auth.uid() is null then
    return new;                                   -- service_role / SQL direct
  end if;

  select exists (
    select 1 from public.crm_users u
    where u.id = auth.uid() and u.role = 'admin' and u.is_active
  ) into v_is_admin;

  if not v_is_admin then
    if new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.voit_equipe is distinct from old.voit_equipe then
      raise exception 'Modification du role, du statut ou du partage d''equipe reservee aux administrateurs';
    end if;
  end if;

  return new;
end $$;
