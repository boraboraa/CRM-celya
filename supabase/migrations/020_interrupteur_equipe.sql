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
-- ============================================================
-- CE QUI PROTÈGE L'ÉCRITURE AUJOURD'HUI — ET QUE CETTE MIGRATION RETIRE
-- ============================================================
-- C'est le point le moins évident de tout le lot, et la raison pour laquelle
-- les policies d'écriture ci-dessous sont si bavardes. À lire AVANT de les
-- « simplifier ».
--
-- POSTGRES APPLIQUE LA POLICY DE **SELECT** À LA **NOUVELLE** LIGNE D'UN
-- UPDATE. On ne peut pas écrire une ligne qu'on ne pourrait plus voir. Donc,
-- aujourd'hui, `emails_update` et `activities_update` refusent qu'un
-- commercial déplace une de SES lignes vers la fiche d'un collègue — non pas
-- grâce à leur `with check` (qui vaut `is_member()`, et passe), mais parce que
-- la nouvelle ligne deviendrait invisible pour lui.
--
-- Mesuré en transactions annulées contre la base de production, le 19/09 :
--   · en Rémi, `update emails set prospect_id = <fiche de Bora>` → REFUSÉ
--     42501 « new row violates row-level security policy » ;
--   · `update emails set prospect_id = <sa propre fiche>` (même valeur) →
--     ACCEPTÉ, 1 ligne. Le `with check` n'est donc pas en cause ;
--   · en donnant une boîte à Rémi (`owns_mailbox` vrai), les DEUX passent —
--     la nouvelle ligne redevient visible par la branche « ma boîte » ;
--   · TEST DÉCISIF : en desserrant le `using` d'`emails_update` à
--     `is_member()` SEUL, et en laissant `emails_select` intact → TOUJOURS
--     REFUSÉ. C'est donc bien `emails_select`, la policy de LECTURE, qui
--     garde la nouvelle ligne.
--
-- ET C'EST EXACTEMENT CETTE PROTECTION QUE LA SECTION 3 RETIRE. En élargissant
-- `can_see_prospect`, elle rend visibles les fiches du binôme : la nouvelle
-- ligne devient légitime, et le `with check` à `is_member()` — qui n'a jamais
-- rien filtré — reste seul en face. Vérifié, toujours en transaction annulée,
-- avec la section 3 appliquée et Collins/Nathan cochés : SIX écritures de
-- Collins sur une fiche de Nathan passaient, dont quatre déplacements de
-- lignes (`tasks`, `activities`, `meetings`, `emails`) et deux insertions
-- (`emails`, `meetings`).
--
-- LA LEÇON, écrite une fois pour toutes : **un `with check` doit décrire OÙ LA
-- LIGNE ATTERRIT, jamais QUI JE SUIS.** Recopier le `using` dans le
-- `with check` ne ferme rien — après le déplacement, `assignee_id`,
-- `author_id`, `owner_id` ou `owns_mailbox(mailbox)` valent toujours « moi ».
-- Chaque `with check` ci-dessous teste donc la FICHE DE DESTINATION, avec la
-- même expression que l'`insert` de sa table. Et cette expression est écrite en
-- clair, sans s'appuyer sur la policy de lecture, précisément parce que la
-- lecture a le droit de s'élargir un jour de plus.
--
-- ============================================================
-- DÉCISION PRODUIT DU 19 SEPTEMBRE — la visibilité des emails
-- ============================================================
-- Élargir `can_see_prospect` rend lisible, entre porteurs, le CORPS des emails
-- échangés avec les prospects du binôme (`emails_select` hérite de la cloison
-- par un EXISTS sur `prospects`). Ce n'est pas un effet de bord : la question a
-- été posée, et **Bora a choisi de GARDER l'élargissement**. C'est réciproque,
-- et c'est le but du lot — savoir où l'autre en est, pas seulement qu'il est
-- passé.
--
-- Pour le refermer un jour sans toucher au reste : rebaser `emails_select` sur
-- `public.owns_mailbox(mailbox)` + ses propres fiches. La chronologie de la
-- fiche continuerait de montrer QU'UN mail est parti (l'activité `type='email'`
-- vit dans `activities`, pas dans `emails`) ; seul le contenu disparaîtrait.
--
-- ============================================================
-- ADDITIVE ET COMPATIBLE AVEC LE CODE EN PRODUCTION (règle du projet) : la
-- colonne naît à `false`, donc `partage_equipe` est faux pour tout le monde et
-- rien ne change tant que Bora n'a coché personne. Le code du même lot lit la
-- colonne de façon TOLÉRANTE (voir `lirePorteurs` dans lib/crm/access.ts : un
-- 42703 vaut « personne ne partage »), il peut donc partir avant cette
-- migration comme après.
--
-- ISO-COMPORTEMENT le jour de l'application. Mesuré avant d'écrire : 0 tâche
-- assignée à un autre que le propriétaire de la fiche, 0 tâche sans assigné,
-- 0 tâche libre, 0 tâche créée par un autre, 0 email rattaché à une fiche
-- non-Bora, 0 activité écrite par un autre que le propriétaire. Aucune des
-- expressions ci-dessous ne retire un droit exercé aujourd'hui.
--
-- RÉVERSIBLE : décocher les cases suffit. Retirer `or partage_equipe(...)` des
-- deux policies de lecture restaure 016 à l'identique.
--
-- Répercuté dans le code dans le même geste — `lib/crm/access.ts` EST la
-- cloison pour le connecteur MCP (service_role, RLS contournée). Une policy
-- modifiée sans ce fichier, c'est une fuite par l'assistant de chaque
-- commercial :
--   · lib/crm/access.ts              — voitEquipe, visiblesIds, canEditProspect
--   · lib/crm/perimetre.ts           — un porteur a droit au sélecteur
--   · components/PerimetreSwitcher   — rendu aussi pour un porteur
--   · app/[transport]/route.ts       — les six outils d'écriture vérifient la
--                                      PROPRIÉTÉ ; et `supprimer_activite`,
--                                      qui part d'un id d'ACTIVITÉ et non de
--                                      prospect, la vérifie à la main
--   · app/(app)/prospects/[id]       — la fiche d'un collègue est en lecture seule
--   · app/(app)/agenda, /emails      — les deux listes de prospects qui
--                                      alimentent une écriture sont bornées au
--                                      propriétaire : la RLS ne peut plus s'en
--                                      charger, puisqu'elle laisse LIRE plus
--                                      large que ce qu'on peut ÉCRIRE
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
-- Voir « DÉCISION PRODUIT » en tête pour les emails, et « CE QUI PROTÈGE
-- L'ÉCRITURE AUJOURD'HUI » pour ce que cet élargissement retire au passage.
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
--
-- `to` omis volontairement : la policy d'origine portait déjà {public},
-- comme les trois autres de `meetings`. `anon` n'a aucun grant sur la table.
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings
  for select using (
    public.is_member()
    and (public.is_admin()
         or owner_id = auth.uid()
         or public.partage_equipe(owner_id))
  );

-- ------------------------------------------------------------
-- 4. L'ÉCRITURE ne bouge pas — NEUF policies rebasées sur le PROPRIÉTAIRE.
-- ------------------------------------------------------------
-- Deux familles, et il faut les deux :
--
--   · le `using` dit ce que j'ai le droit de TOUCHER (mes lignes) ;
--   · le `with check` dit OÙ la ligne a le droit d'ATTERRIR (mes fiches).
--
-- Sans la seconde, on ne peut pas modifier les lignes du collègue mais on peut
-- lui POUSSER les siennes — et c'est aussi une écriture sur sa fiche : la
-- relance déplace son « À faire », l'activité entre dans sa chronologie, le
-- rendez-vous apparaît sur sa fiche, l'email entre dans son fil.

-- La fiche elle-même. Le WITH CHECK valait `is_member()` seul : n'importe quel
-- membre pouvait donc réassigner une fiche à n'importe qui — et une fois la
-- lecture élargie, PRENDRE celle d'un collègue. (Le champ « Responsable » du
-- formulaire est masqué aux non-admins dans le même lot. Reste ouvert et
-- assumé, comme avant ce lot : à la CRÉATION, un commercial peut encore
-- attribuer une fiche neuve à un collègue — donner n'est pas prendre.)
drop policy if exists prospects_update on public.prospects;
create policy prospects_update on public.prospects
  for update to authenticated using (
    public.is_member() and (public.is_admin() or owner_id = auth.uid())
  ) with check (
    public.is_member() and (public.is_admin() or owner_id = auth.uid())
  );

-- Les relances. Les quatre branches du `using` sont conservées telles quelles ;
-- c'est le `with check` qui change de nature — il ne répète plus « je suis
-- membre », il exige que la fiche visée soit la mienne. Mesuré ouvert
-- AUJOURD'HUI, avant même l'interrupteur : `tasks_select` laisse passer la
-- nouvelle ligne parce qu'`assignee_id` vaut toujours moi.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated using (
    public.is_member()
    and (public.is_admin()
         or assignee_id = auth.uid()
         or created_by = auth.uid()
         or exists (select 1 from public.prospects c
                     where c.id = tasks.prospect_id and c.owner_id = auth.uid()))
  ) with check (
    public.is_member()
    and (public.is_admin()
         or prospect_id is null
         or exists (select 1 from public.prospects c
                     where c.id = tasks.prospect_id and c.owner_id = auth.uid()))
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

-- Le rattachement d'un email. `owns_mailbox` reste dans le `using` : ce sont
-- MES messages, arrivés dans MA boîte (migration 015), et c'est ce qui fait
-- vivre l'écran « Non rattachés ». Il n'est PAS dans le `with check` : « ce
-- message est à moi » ne dit rien de « cette fiche est à moi », et l'y mettre
-- rouvrirait le rattachement au journal d'un collègue. Le cas `prospect_id is
-- null` garde le détachement possible — et `emails_select` fait que la ligne
-- détachée ne reste visible que pour le propriétaire de la boîte, ou l'admin.
drop policy if exists emails_update on public.emails;
create policy emails_update on public.emails
  for update to authenticated using (
    public.is_member()
    and (public.is_admin()
         or public.owns_mailbox(mailbox)
         or exists (select 1 from public.prospects c
                     where c.id = emails.prospect_id and c.owner_id = auth.uid()))
  ) with check (
    public.is_member()
    and (public.is_admin()
         or prospect_id is null
         or exists (select 1 from public.prospects c
                     where c.id = emails.prospect_id and c.owner_id = auth.uid()))
  );

-- L'email, à l'insertion. `is_member()` seul aujourd'hui — et c'est du code
-- MORT, vérifié : aucun chemin applicatif n'insère dans `emails`. La relève
-- IMAP et l'envoi vivent dans l'edge function `crm-mail`, qui agit en
-- `service_role` (`createClient(SUPABASE_URL, SERVICE_KEY)`), donc RLS
-- contournée — resserrer ici ne peut pas casser la boîte de réception. Du code
-- mort, mais chargé : il suffirait d'un futur chemin sous JWT utilisateur pour
-- qu'il serve à écrire dans le fil d'un collègue.
drop policy if exists emails_insert on public.emails;
create policy emails_insert on public.emails
  for insert to authenticated with check (
    public.is_member()
    and (public.is_admin()
         or prospect_id is null
         or exists (select 1 from public.prospects c
                     where c.id = emails.prospect_id and c.owner_id = auth.uid()))
  );

-- Le journal, à l'insertion. C'est LA policy que l'élargissement de la lecture
-- aurait ouverte sans bruit : consigner une note, un résultat d'appel ou un
-- rendez-vous sur la fiche d'un collègue. Mesuré refusé (42501) avant cette
-- migration ; il doit le rester après.
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert to authenticated with check (
    public.is_member()
    and (public.is_admin()
         or exists (select 1 from public.prospects c
                     where c.id = activities.prospect_id
                       and c.owner_id = auth.uid()))
  );

-- Le journal, à la modification. Le `using` (`author_id = auth.uid()`) reste :
-- on corrige ses propres entrées. Le `with check` empêche de les DÉPLACER chez
-- un collègue. `activities.prospect_id` est `NOT NULL` : pas de cas libre ici,
-- une entrée de journal appartient toujours à une fiche.
drop policy if exists activities_update on public.activities;
create policy activities_update on public.activities
  for update to authenticated using (
    public.is_admin() or author_id = auth.uid()
  ) with check (
    public.is_member()
    and (public.is_admin()
         or exists (select 1 from public.prospects c
                     where c.id = activities.prospect_id
                       and c.owner_id = auth.uid()))
  );

-- L'agenda, à l'insertion. Mesuré ouvert, et ATTEIGNABLE DEPUIS L'INTERFACE :
-- `/agenda` proposait toutes les fiches que la RLS laisse voir, donc celles du
-- binôme dès la case cochée. La liste est bornée dans le même lot, mais un
-- garde-fou se pose là où l'on ÉCRIT, pas seulement là où l'on propose.
-- `prospect_id is null` = le rendez-vous PERSONNEL, qui n'a pas de fiche.
drop policy if exists meetings_insert on public.meetings;
create policy meetings_insert on public.meetings
  for insert with check (
    public.is_member()
    and (public.is_admin()
         or (owner_id = auth.uid()
             and (prospect_id is null
                  or exists (select 1 from public.prospects c
                              where c.id = meetings.prospect_id
                                and c.owner_id = auth.uid()))))
  );

-- L'agenda, à la modification. Mesuré ouvert aujourd'hui : `meetings_select`
-- laisse passer la nouvelle ligne parce qu'`owner_id` vaut toujours moi. Le
-- report et le débrief (`deplacerRendezVous`, `cloturerRendezVous`) ne touchent
-- ni `owner_id` ni `prospect_id` : ils passent.
drop policy if exists meetings_update on public.meetings;
create policy meetings_update on public.meetings
  for update using (
    public.is_admin() or owner_id = auth.uid()
  ) with check (
    public.is_member()
    and (public.is_admin()
         or (owner_id = auth.uid()
             and (prospect_id is null
                  or exists (select 1 from public.prospects c
                              where c.id = meetings.prospect_id
                                and c.owner_id = auth.uid()))))
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
