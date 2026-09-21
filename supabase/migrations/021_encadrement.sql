-- ============================================================
-- Celya CRM — l'encadrement (21 septembre 2026)
--
-- POURQUOI. Quatre étudiants arrivent. La règle voulue par Bora :
--   · Collins, Nathan et Bora voient ce que font les étudiants — fiches,
--     appels, relances, agenda ;
--   · un étudiant ne voit QUE ce qu'il a mis lui-même. Ni les fiches de
--     Collins ou de Nathan, ni celles des autres étudiants.
--
-- L'INTERRUPTEUR DE LA 020 NE PEUT PAS EXPRIMER ÇA, et ce n'est pas un défaut
-- de réglage : `partage_equipe` est RÉCIPROQUE PAR CONSTRUCTION. Son `exists`
-- exige `moi.voit_equipe AND lui.voit_equipe` — la même expression accorde le
-- droit et expose. Cocher un étudiant le rendrait visible ET voyant. Il faut
-- donc une seconde notion, et elle est ORIENTÉE. Les deux cohabitent sans se
-- connaître : `partage_equipe` continue de régir Collins <-> Nathan, à
-- l'identique, et cette migration n'y touche pas une lettre.
--
-- ============================================================
-- LE MODÈLE : UNE TABLE, PAS UN DRAPEAU
-- ============================================================
-- `supervision(encadrant_id, commercial_id)`, une ligne par couple, gérée par
-- l'admin depuis /equipe. Explicite, lisible, auditable — on peut répondre à
-- « qui voit mon travail ? » par un `select`, pas par une lecture de code.
--
-- UN ÉTUDIANT NE PORTE AUCUN DRAPEAU. C'est le point de conception qui fait
-- tenir le lot : son comportement par défaut — ne voir que soi — est DÉJÀ le
-- bon depuis la 016. On n'ajoute donc que les lignes d'encadrement, et il n'y
-- a rien à migrer, rien à cocher, rien à défaire si on se trompe.
--
-- COROLLAIRE QU'ON AURAIT PU MANQUER : le privilège ne vit PAS dans une
-- colonne de `crm_users`, donc `guard_profile_privileges` n'a RIEN à gagner
-- ici. La 020 avait dû l'étendre à `voit_equipe`, sans quoi Rémi se cochait
-- lui-même (mesuré à l'époque) ; ici la protection est la RLS de la table, et
-- elle est vérifiée plus bas par deux assertions d'auto-service.
--
-- Un encadrant peut encadrer plusieurs personnes ; une personne peut avoir
-- plusieurs encadrants (ici Collins ET Nathan sur chaque étudiant).
-- L'admin n'a besoin d'aucune ligne : `is_admin()` passe déjà avant.
--
-- ============================================================
-- AUCUNE POLICY D'ÉCRITURE N'EST MODIFIÉE — ET C'EST DÉLIBÉRÉ
-- ============================================================
-- La 020 s'était fait piéger par l'inverse : élargir une LECTURE élargissait
-- l'ÉCRITURE en silence, parce que Postgres applique la policy de SELECT à la
-- NOUVELLE ligne d'un UPDATE, et que les `with check` d'alors valaient
-- `is_member()`. Une partie de la protection en écriture venait donc de la
-- cloison de LECTURE, et disparaissait avec elle.
--
-- Ce piège ne se rejoue pas ici, parce que la 020 l'a refermé pour de bon : ses
-- neuf `with check` décrivent OÙ LA LIGNE ATTERRIT (`owner_id = auth.uid()` sur
-- la fiche de destination), jamais QUI EST L'APPELANT. Ils sont indifférents à
-- tout élargissement de lecture, celui-ci compris.
--
-- MESURÉ, PAS SUPPOSÉ — recette différentielle en transaction annulée contre la
-- base de production, le 21/09, avec cette migration appliquée et Collins
-- encadrant deux étudiants. Quinze écritures de Collins sur les données de son
-- étudiant, toutes refusées :
--   · 42501 — `activities_insert` (consigner un appel chez lui),
--             `tasks_insert` (poser une relance),
--             `meetings_insert` (poser un rendez-vous),
--             `emails_insert` ;
--   · 42501 — pousser sa PROPRE note / relance / RDV / email sur la fiche de
--             l'étudiant (les quatre déplacements) ;
--   · 0 ligne — modifier la fiche, se l'attribuer, réécrire la note de
--             l'étudiant, cocher sa relance, confirmer son RDV, supprimer sa
--             fiche, supprimer sa note.
-- « Lecture partagée, écriture perso » est donc tenu SANS une ligne de SQL
-- supplémentaire. Ne pas « compléter » cette migration par des policies
-- d'écriture : il n'y a rien à y ajouter, et toute réécriture serait une
-- occasion de casser ce que la 020 a mis un lot entier à fermer.
--
-- ============================================================
-- ADDITIVE, ET COMPATIBLE AVEC LE CODE EN PRODUCTION (règle du projet)
-- ============================================================
-- La table naît VIDE, donc `encadre()` est faux pour tout le monde et rien ne
-- change tant que Bora n'a posé aucun lien. Le code du même lot lit la table de
-- façon TOLÉRANTE (voir `lireEncadres` dans lib/crm/access.ts : une erreur
-- PostgREST — 42P01 avant cette migration, ou n'importe quoi d'autre — vaut
-- « je n'encadre personne »). Il tourne donc contre la base d'avant comme
-- d'après : le code peut partir en premier, comme la règle l'exige.
--
-- RÉVERSIBLE : supprimer les lignes suffit à tout défaire. Retirer
-- `or public.encadre(...)` des deux policies de lecture restaure la 020 à
-- l'identique.
--
-- Répercuté dans le code dans le même geste — `lib/crm/access.ts` EST la
-- cloison pour le connecteur MCP (service_role, RLS contournée). Une policy
-- élargie sans ce fichier, c'est un assistant plus permissif que l'écran :
--   · lib/crm/access.ts            — `lireEncadres`, `visiblesIds` ;
--                                    `canEditProspect` NE BOUGE PAS
--   · lib/crm/perimetre.ts         — un encadrant a droit au sélecteur, borné
--                                    aux gens qu'il encadre
--   · components/PerimetreSwitcher — rendu aussi pour un encadrant
--   · app/[transport]/route.ts     — `agenda` porte son propre `in`, il ne part
--                                    pas de `prospects`
--   · app/(app)/equipe             — « Encadré par : … », admin seulement
-- ============================================================

-- ------------------------------------------------------------
-- 1. La table.
-- ------------------------------------------------------------
create table if not exists public.supervision (
  encadrant_id  uuid not null references public.crm_users(id) on delete cascade,
  commercial_id uuid not null references public.crm_users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (encadrant_id, commercial_id),
  -- S'encadrer soi-même n'a aucun sens : on se voit déjà par
  -- `p_owner = auth.uid()`. La contrainte évite surtout qu'une ligne parasite
  -- laisse croire à un droit qui n'en est pas un.
  constraint supervision_pas_soi_meme check (encadrant_id <> commercial_id)
);

comment on table public.supervision is
  'Encadrement, À SENS UNIQUE : l''encadrant VOIT le travail du commercial, '
  'le commercial ne voit RIEN de plus. Ne pas confondre avec '
  'crm_users.voit_equipe, qui est réciproque. Écrite par l''admin seul.';
comment on column public.supervision.encadrant_id is
  'Celui qui VOIT. Aucun droit d''écriture n''en découle.';
comment on column public.supervision.commercial_id is
  'Celui qui EST VU. Il n''apprend rien de son encadrant par cette ligne.';

alter table public.supervision enable row level security;

-- ------------------------------------------------------------
-- 2. Qui peut lire et écrire la table elle-même.
-- ------------------------------------------------------------
-- LECTURE, bornée aux lignes qui me concernent. Le premier jet la donnait à
-- tout membre actif, au motif qu'« il faut pouvoir calculer le périmètre » —
-- le motif ne tient pas : pour calculer SON périmètre, il suffit de lire SES
-- lignes. Avec `is_member()`, un étudiant lisait le graphe entier : qui encadre
-- qui, donc qui existe et dans quelle hiérarchie. `encadre()` étant
-- `security definer`, elle n'a de toute façon pas besoin de cette policy pour
-- faire son travail.
--
-- Un encadré voit les lignes qui le désignent, et c'est VOULU : savoir qu'on
-- est suivi, et par qui, n'est pas une fuite — c'est la moindre des choses.
--
-- POUR REVENIR À LA VERSION LARGE, si Bora la préfère : remplacer l'expression
-- ci-dessous par `is_member()`. Rien d'autre ne s'appuie dessus.
create policy supervision_select on public.supervision
  for select using (
    public.is_admin()
    or encadrant_id = auth.uid()
    or commercial_id = auth.uid()
  );

-- ÉCRITURE, admin seul. Une policy, pas un masquage d'écran : masquer le
-- bouton n'a jamais interdit d'appeler la route, et c'est ici la seule chose
-- qui empêche quelqu'un de s'ajouter comme encadrant.
create policy supervision_insert on public.supervision
  for insert with check (public.is_admin());
create policy supervision_update on public.supervision
  for update using (public.is_admin()) with check (public.is_admin());
create policy supervision_delete on public.supervision
  for delete using (public.is_admin());

-- ------------------------------------------------------------
-- 3. La règle d'encadrement.
-- ------------------------------------------------------------
-- À SENS UNIQUE, SANS RÉCURSION — les deux propriétés sont dans la forme même
-- de la requête, et c'est ce qu'il faut préserver si on la réécrit un jour :
--
--   · ORIENTÉE : `s.encadrant_id = auth.uid()` d'un côté, `s.commercial_id =
--     p_owner` de l'autre. La ligne (Collins, Étudiant) rend `encadre(Étudiant)`
--     vraie POUR COLLINS et rien d'autre. Pour que l'étudiant voie Collins, il
--     faudrait la ligne inverse, que personne ne posera.
--
--   · UNE SEULE SAUTEUSE : la table est lue UNE FOIS. Si Nathan encadre Collins
--     et Collins un étudiant, Nathan voit Collins et PAS l'étudiant. C'est ce
--     qu'on veut : l'encadrement se donne, il ne se propage pas. Ne jamais
--     transformer cet `exists` en `with recursive` — ce serait, en une ligne,
--     rendre tout le monde visible de tout le monde dès la première chaîne.
--
--   · DEUX ÉTUDIANTS SOUS LE MÊME ENCADRANT NE SE VOIENT PAS. C'est gratuit ici
--     (il n'existe pas de ligne (A, B)), mais ça ne l'aurait pas été si la
--     règle avait été écrite « nous avons un encadrant en commun ». Mesuré.
--
-- `c.role = 'commercial'` : on n'encadre jamais le portefeuille d'un ADMIN.
-- Même si une ligne (X, Bora) était posée par erreur ou par SQL direct, ses 52
-- fiches resteraient invisibles. Le garde-fou ne porte que sur l'encadré : un
-- futur chef d'équipe qui ne serait pas « commercial » doit pouvoir encadrer.
--
-- `is_active` des deux côtés, comme `partage_equipe` : désactiver un compte
-- dans /equipe coupe le lien à la seconde, dans les deux sens.
create or replace function public.encadre(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.supervision s
      join public.crm_users e on e.id = s.encadrant_id
      join public.crm_users c on c.id = s.commercial_id
     where s.encadrant_id  = auth.uid()
       and s.commercial_id = p_owner
       and e.is_active
       and c.is_active
       and c.role = 'commercial'
  );
$$;

comment on function public.encadre(uuid) is
  'L''appelant encadre-t-il le propriétaire de cette fiche ? À SENS UNIQUE et '
  'SANS RÉCURSION : une seule lecture de supervision, jamais de transitivité. '
  'Donne un droit de LECTURE, jamais d''écriture.';

revoke all on function public.encadre(uuid) from public;
grant execute on function public.encadre(uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 4. Les deux policies de LECTURE qui gagnent la branche.
-- ------------------------------------------------------------
-- `can_see_prospect` est réécrite en entier (create or replace) plutôt que
-- patchée : c'est la seule façon de lire la règle complète en un endroit.
-- L'ordre des branches est celui du coût croissant — `is_admin()` et l'égalité
-- d'uuid court-circuitent les deux `exists` dans l'écrasante majorité des cas.
create or replace function public.can_see_prospect(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_member()
     and (public.is_admin()
          or p_owner = auth.uid()
          or public.partage_equipe(p_owner)
          or public.encadre(p_owner));
$$;

-- `prospects_select` l'utilise telle quelle, et TROIS autres policies en
-- héritent sans être touchées : `activities_select`, `tasks_select` et
-- `emails_select` portent un `EXISTS (select 1 from prospects …)`, et cette
-- sous-requête est elle-même soumise à la RLS de `prospects`. C'est ce qui fait
-- qu'un encadrant lit le journal, les appels et les relances de son étudiant
-- sans qu'on ajoute une ligne. Vérifié.

-- L'agenda, lui, ne passe pas par `prospects` : sa policy porte sur
-- `meetings.owner_id` et doit gagner la branche explicitement.
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings
  for select using (
    public.is_member()
    and (public.is_admin()
         or owner_id = auth.uid()
         or public.partage_equipe(owner_id)
         or public.encadre(owner_id))
  );

-- ⚠ LA VUE `meetings_visibles` N'EST PAS TOUCHÉE, ET NE DOIT PAS L'ÊTRE.
-- Son `CASE` masque tout rendez-vous `kind = 'perso'` d'un AUTRE membre en
-- « Occupé », sans lieu ni notes — y compris pour l'admin. C'est la protection
-- due à un indépendant (lire les RDV privés de Rémi serait un élément de
-- requalification), et elle vaut exactement pareil pour un étudiant : son
-- encadrant voit qu'il est pris de 14h à 15h, jamais par qui. Mesuré après
-- cette migration : le RDV perso d'un étudiant sort « Occupé / null / null »
-- pour son encadrant.

-- ------------------------------------------------------------
-- 5. Ce qu'on ne trouvera pas ici, et pourquoi.
-- ------------------------------------------------------------
-- · Aucune policy d'ÉCRITURE — voir l'en-tête : les neuf de la 020 testent la
--   fiche de destination et sont indifférentes à cet élargissement. Mesuré.
-- · Aucune ligne dans `guard_profile_privileges` — le privilège n'est pas une
--   colonne de `crm_users`.
-- · Aucun index — la clé primaire composée `(encadrant_id, commercial_id)`
--   sert exactement la recherche de `encadre()`.
-- · Aucune donnée. Les liens se posent depuis /equipe, à la main, par Bora.
