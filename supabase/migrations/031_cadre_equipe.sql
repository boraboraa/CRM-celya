-- ============================================================
-- 031 — Le cadre de l'équipe de vente (27 octobre 2026)
--
-- Pour le démarrage des quatre étudiants du Sales Trophy, le lundi 2 novembre.
-- APRÈS la 030 (la valeur d'enum `essai_gratuit` doit exister et être validée).
-- Additive : des colonnes neuves, une table, des fonctions, des triggers.
-- Une seule écriture de données : la normalisation des secteurs (section 1),
-- 44 fiches mesurées le 27/10 en transaction annulée.
--
-- Sections, une par fonctionnalité du lot :
--   1. Secteurs : une liste fixe, normalisée par trigger
--   2. Essai gratuit : la date d'entrée, l'issue de débrief
--   3. Doublons : « déjà suivie dans l'équipe », sans nommer personne
--   4. L'étoile
--   5. L'attribution : seul l'admin crée une fiche au nom d'un autre
--   6. Objectifs : la semaine et la période
--   7. Compteurs et classement
--
-- Rien ici ne touche à la cloison de lecture (can_see_prospect, encadre,
-- partage_equipe) : les nouvelles lectures transversales passent par des
-- fonctions `security definer` qui ne renvoient que des booléens ou des
-- compteurs, jamais une ligne de fiche.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Secteurs — une liste fixe
--
-- `prospects.sector` était du texte libre : « garage », « Garage », « Garage
-- automobile », « Garage / Carrosserie », « Carrosserie »… cinq orthographes
-- d'un même métier, aucun filtre ni compteur possible. La règle est écrite
-- DEUX fois — ici et dans lib/crm/secteurs.ts — parce que le trigger doit
-- aussi ranger ce qu'écrivent le service_role (MCP, Janet) et le SQL direct.
-- Les deux copies jouent le MÊME jeu de cas (lib/crm/secteurs.cas.json, injecté
-- par la recette). Toute évolution se fait des deux côtés.
--
-- Pas de contrainte CHECK : elle ferait échouer un écrivain ancien (code
-- encore en production, edge function) au lieu de ranger sa valeur. Le
-- trigger range ; un texte inconnu devient « Autre », un vide reste null.
-- ------------------------------------------------------------

create or replace function public.normaliser_secteur(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- Minuscules, sans accents (la MÊME table que texteSecteur côté TS),
  -- espaces resserrés, un espace de garde à la fin (« immo », « cafe »).
  t text;
  libelles text[] := array[
    'Garage / carrosserie', 'Syndic de copropriété', 'Agence immobilière',
    'Vétérinaire', 'Cabinet dentaire', 'Centre médical / maison médicale',
    'Kiné / paramédical', 'Opticien / audioprothésiste', 'Chauffagiste / plombier',
    'Institut de beauté', 'Auto-école', 'Infirmier à domicile',
    'Courtier en assurances', 'Restaurant / HoReCa', 'Autre'];
  l text;
begin
  if p is null then return null; end if;
  t := btrim(regexp_replace(
         translate(lower(p), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'),
         '\s+', ' ', 'g'));
  if t = '' then return null; end if;
  t := t || ' ';

  -- Un libellé de la liste, à la casse et aux accents près : lui-même.
  foreach l in array libelles loop
    if btrim(regexp_replace(translate(lower(l), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), '\s+', ' ', 'g')) || ' ' = t then
      return l;
    end if;
  end loop;

  -- Les règles, dans l'ORDRE de REGLES_SECTEUR (la première gagne) :
  -- auto-école avant le garage, paramédical avant médical, syndic avant
  -- immobilier.
  if t ~ '(auto-ecole|auto ecole|autoecole|ecole de conduite|rijschool)' then return 'Auto-école'; end if;
  if t ~ '(garage|carross|mecani|pneu|depann|concession|automobile|car wash|carwash)' then return 'Garage / carrosserie'; end if;
  if t ~ '(syndic|copropri)' then return 'Syndic de copropriété'; end if;
  if t ~ '(immobili|immo )' then return 'Agence immobilière'; end if;
  if t ~ '(veterin|veto)' then return 'Vétérinaire'; end if;
  if t ~ '(dentist|dentaire|orthodont)' then return 'Cabinet dentaire'; end if;
  if t ~ '(kine|physio|osteo|logoped|podolog|paramedic|ergotherap)' then return 'Kiné / paramédical'; end if;
  if t ~ '(infirmi|soins a domicile)' then return 'Infirmier à domicile'; end if;
  if t ~ '(maison medicale|centre medical|polyclinique|medecin|generaliste|medical)' then return 'Centre médical / maison médicale'; end if;
  if t ~ '(optic|audioprot|audition|auditif|lunett)' then return 'Opticien / audioprothésiste'; end if;
  if t ~ '(chauffag|plomb|sanitaire|chaudiere|hvac)' then return 'Chauffagiste / plombier'; end if;
  if t ~ '(beaute|esthetic|onglerie|manucure|epilation)' then return 'Institut de beauté'; end if;
  if t ~ '(assuranc|courtier)' then return 'Courtier en assurances'; end if;
  if t ~ '(restaura|horeca|brasserie|bistro|pizzeria|traiteur|friterie|snack|taverne|cafe )' then return 'Restaurant / HoReCa'; end if;
  return 'Autre';
end;
$$;

comment on function public.normaliser_secteur(text) is
  'Range un secteur saisi dans la liste fixe (031). Recopie de normaliserSecteur (lib/crm/secteurs.ts), même jeu de cas (secteurs.cas.json).';

create or replace function public.prospects_normaliser_secteur()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.sector := public.normaliser_secteur(new.sector);
  return new;
end;
$$;

create trigger prospects_normaliser_secteur
  before insert or update of sector on public.prospects
  for each row execute function public.prospects_normaliser_secteur();

-- La reprise : les valeurs existantes, par la même règle. Seules les lignes qui
-- CHANGENT sont écrites (44 le 27/10 : Garage 10, garage 7, Carrosserie 4,
-- Garage automobile 2, Garage / Carrosserie 1, Dentiste 9, Courtier
-- assurances 4, Chauffage / sanitaire 4, Chauffagiste 3). Effet de bord
-- assumé : `updated_at` de ces fiches avance (tri « récent » de la liste).
-- Aucun autre trigger ne regarde `sector`.
update public.prospects
   set sector = public.normaliser_secteur(sector)
 where sector is distinct from public.normaliser_secteur(sector);

-- ------------------------------------------------------------
-- 2. Essai gratuit — la date d'entrée, l'issue de débrief
--
-- `essai_gratuit_at` : quand la fiche est passée en « Essai gratuit » (030).
-- C'est elle que comptent les objectifs et le classement (« essais de la
-- semaine », « depuis le 2 novembre »). Posée à CHAQUE entrée dans l'étape,
-- jamais effacée : une fiche qui passe ensuite en Gagné garde la date de son
-- essai (c'est bien un essai démarré cette semaine-là).
--
-- Posée par un trigger BEFORE, pas par le code : l'étape change depuis l'écran
-- (clic, glisser-déposer, débrief), le connecteur MCP (service_role) et le SQL
-- direct. Même forme que `prospects_etape_prochaine_action` (023) : on écrit
-- NEW, aucun UPDATE ré-entrant. La comparaison se fait en TEXTE : la fonction
-- ne dépend pas de l'instant où la valeur d'enum a été validée.
-- ------------------------------------------------------------

alter table public.prospects
  add column if not exists essai_gratuit_at timestamptz;

comment on column public.prospects.essai_gratuit_at is
  'Dernière entrée dans l''étape « Essai gratuit » (030/031), posée par le trigger prospects_essai_gratuit_at. Compte les essais de la semaine et de la période.';

create or replace function public.prospects_essai_gratuit_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status::text = 'essai_gratuit'
     and (tg_op = 'INSERT' or old.status::text is distinct from 'essai_gratuit') then
    new.essai_gratuit_at := now();
  end if;
  return new;
end;
$$;

create trigger prospects_essai_gratuit_at
  before insert or update of status on public.prospects
  for each row execute function public.prospects_essai_gratuit_at();

create index if not exists prospects_essai_gratuit_at_idx
  on public.prospects (owner_id, essai_gratuit_at)
  where essai_gratuit_at is not null;

-- L'issue de débrief « Essai gratuit démarré » (lib/crm/debrief.ts, `essai`) :
-- le RDV est tenu, la fiche passe en essai, verrouillée — comme « Signé »
-- passe en Gagné. La contrainte de la 027 est réécrite à l'identique, plus
-- cette valeur.
alter table public.meetings
  drop constraint if exists meetings_debrief_issue_connue;
alter table public.meetings
  add constraint meetings_debrief_issue_connue
  check (debrief_issue is null or debrief_issue in
    ('a_rappeler', 'proposition', 'essai', 'signe', 'pas_interesse', 'suite_posee', 'remplace'));

-- ------------------------------------------------------------
-- 3. Doublons — « déjà suivie dans l'équipe », sans nommer personne
--
-- Deux étudiants qui importent le même cabinet depuis Google Maps : la liste
-- n'a presque jamais d'e-mail, et l'import ne dédoublonnait que sur l'e-mail.
-- Et quand il l'aurait fait sur le téléphone, la RLS l'en aurait empêché :
-- un étudiant ne VOIT pas les fiches d'un autre étudiant, donc il ne peut
-- pas savoir qu'elles existent. C'est voulu (la cloison), mais la règle
-- d'attribution — « au premier qui l'enregistre » — devient invérifiable.
--
-- D'où une lecture transversale, ÉTROITE : pour chaque entrée (téléphone,
-- société), des BOOLÉENS. L'identifiant de la fiche n'est rendu que si c'est
-- la mienne ; le responsable, qu'à l'admin. Rien d'autre ne sort : ni nom,
-- ni étape, ni contact. Un étudiant peut sonder « ce cabinet est-il suivi ? »
-- — c'est exactement le service rendu, et rien de plus.
--
-- Les clés sont la recopie de lib/crm/doublons.ts (cleTelephone,
-- cleSociete), même jeu de cas (doublons.cas.json). La comparaison est
-- EXACTE sur la clé — pas de « contient », qui rapprocherait tout « garage »
-- de chaque « Garage Dupont » de la base.
--
-- Deux portes, une seule règle (même forme que la 029) :
--   doublons_equipe_pour(viewer, …)  service_role seul — le connecteur MCP,
--                                    qui passe l'identité du porteur du jeton ;
--   doublons_equipe(…)               un membre actif connecté, pour lui-même.
-- ------------------------------------------------------------

create or replace function public.cle_telephone(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '\D', '', 'g');
  if left(d, 2) = '00' then d := substr(d, 3); end if;
  if left(d, 2) = '32' and length(d) in (10, 11) then d := substr(d, 3); end if;
  if left(d, 1) = '0' then d := substr(d, 2); end if;
  return case when length(d) >= 8 then d else null end;
end;
$$;

create or replace function public.cle_societe(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare t text;
begin
  if p is null then return null; end if;
  t := translate(lower(p), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy');
  -- Deux passes, comme côté TS.
  t := regexp_replace(t, '(^|[^a-z0-9])(srl|sprl|sa|bv|bvba|nv|asbl|vzw|sc|scs|snc|gmbh)(?=$|[^a-z0-9])', '\1', 'g');
  t := regexp_replace(t, '(^|[^a-z0-9])(srl|sprl|sa|bv|bvba|nv|asbl|vzw|sc|scs|snc|gmbh)(?=$|[^a-z0-9])', '\1', 'g');
  t := regexp_replace(t, '[^a-z0-9]', '', 'g');
  return case when length(t) > 3 then t else null end;
end;
$$;

comment on function public.cle_telephone(text) is
  'Numéro national significatif (031) — recopie de cleTelephone (lib/crm/doublons.ts), jeu de cas doublons.cas.json.';
comment on function public.cle_societe(text) is
  'Nom de société sans accents ni forme juridique (031) — recopie de cleSociete (lib/crm/doublons.ts), jeu de cas doublons.cas.json.';

create or replace function public.doublons_equipe_pour(
  p_viewer uuid,
  p_telephones text[],
  p_societes text[]
)
returns table (
  idx int,
  par_telephone boolean,
  par_societe boolean,
  a_moi boolean,
  fiche_id uuid,
  proprietaire uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
-- (Les colonnes de RETURNS TABLE — idx… — portent le nom des colonnes des CTE.)
declare
  v_admin boolean;
  n int := greatest(coalesce(array_length(p_telephones, 1), 0), coalesce(array_length(p_societes, 1), 0));
begin
  -- Le lecteur doit être un membre ACTIF : un compte désactivé n'apprend rien.
  select u.role = 'admin' into v_admin
    from public.crm_users u
   where u.id = p_viewer and u.is_active;
  if v_admin is null then
    raise exception 'doublons_equipe : compte inconnu ou inactif' using errcode = '42501';
  end if;
  if n > 200 then
    raise exception 'doublons_equipe : 200 entrées au plus par appel' using errcode = '22023';
  end if;

  return query
  with entrees as (
    select i as idx,
           public.cle_telephone(p_telephones[i]) as kt,
           public.cle_societe(p_societes[i]) as ks
      from generate_series(1, n) as i
  ),
  fiches as (
    select p.id, p.owner_id,
           public.cle_telephone(p.phone) as kt,
           public.cle_societe(p.company_name) as ks
      from public.prospects p
  ),
  touches as (
    select e.idx, f.id, f.owner_id,
           (e.kt is not null and e.kt = f.kt) as par_tel,
           (e.ks is not null and e.ks = f.ks) as par_nom
      from entrees e
      join fiches f on (e.kt is not null and e.kt = f.kt) or (e.ks is not null and e.ks = f.ks)
  )
  select e.idx,
         coalesce(bool_or(t.par_tel), false),
         coalesce(bool_or(t.par_nom), false),
         coalesce(bool_or(t.owner_id = p_viewer), false),
         -- La fiche, seulement si c'est la MIENNE (la plus ancienne des miennes).
         (array_agg(t.id order by t.id) filter (where t.owner_id = p_viewer))[1],
         -- Le responsable, seulement pour l'ADMIN.
         case when v_admin then (array_agg(t.owner_id order by t.id) filter (where t.id is not null))[1] end
    from entrees e
    left join touches t on t.idx = e.idx
   group by e.idx
   order by e.idx;
end;
$$;

comment on function public.doublons_equipe_pour(uuid, text[], text[]) is
  'Doublons d''équipe (031) : des booléens par entrée, l''id d''une fiche seulement si elle est au lecteur, le responsable seulement pour l''admin. Service_role seul (connecteur MCP).';

create or replace function public.doublons_equipe(p_telephones text[], p_societes text[])
returns table (
  idx int,
  par_telephone boolean,
  par_societe boolean,
  a_moi boolean,
  fiche_id uuid,
  proprietaire uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.doublons_equipe_pour(auth.uid(), p_telephones, p_societes);
$$;

comment on function public.doublons_equipe(text[], text[]) is
  'Doublons d''équipe pour le compte connecté (031) — enveloppe de doublons_equipe_pour(auth.uid(), …).';

revoke all on function public.doublons_equipe_pour(uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.doublons_equipe_pour(uuid, text[], text[]) to service_role;
revoke all on function public.doublons_equipe(text[], text[]) from public, anon;
grant execute on function public.doublons_equipe(text[], text[]) to authenticated;

-- ------------------------------------------------------------
-- 4. L'étoile
--
-- Les fiches qu'un commercial juge les plus chaudes, il les étoile : elles
-- passent en tête de sa liste et de chaque zone de « À faire ». Une date
-- plutôt qu'un booléen : « étoilée depuis » se lit, et l'ordre entre deux
-- étoilées reste stable.
--
-- AUCUNE policy nouvelle : l'étoile s'écrit par `prospects_update`, dont le
-- WITH CHECK teste la fiche (propriétaire ou admin). Un encadrant VOIT
-- l'étoile de son étudiant (lecture élargie par `encadre`, 021) et ne peut
-- pas la poser ni la retirer — vérifié par la recette.
-- ------------------------------------------------------------

alter table public.prospects
  add column if not exists starred_at timestamptz;

comment on column public.prospects.starred_at is
  'Étoilée par son responsable (031) — en tête de la liste et de « À faire ». null = pas d''étoile.';

-- ------------------------------------------------------------
-- 5. L'attribution — seul l'admin donne une fiche
--
-- `prospects_insert` n'exigeait que `is_member()` : un commercial pouvait
-- créer une fiche AU NOM d'un autre (owner_id fourni par l'appelant). Le
-- trou existait depuis le début ; il comptait peu tant que personne n'avait
-- de raison de le faire. Avec quatre étudiants en compétition et la règle
-- « au premier qui l'enregistre », il devient le moyen de pousser une fiche
-- dans le portefeuille d'un autre — ou de contourner le doublon d'équipe.
--
-- Le WITH CHECK décrit OÙ la ligne atterrit (la leçon de la 020) : chez moi,
-- ou n'importe où pour l'admin. `prospects_set_owner` (BEFORE INSERT, 015)
-- remplit un owner_id nul par `auth.uid()` AVANT ce contrôle : les insertions
-- qui ne précisent rien passent comme avant. Le service_role (MCP, Janet)
-- n'est pas soumis à la RLS ; le connecteur pose lui-même le porteur du jeton.
-- ------------------------------------------------------------

drop policy if exists prospects_insert on public.prospects;
create policy prospects_insert on public.prospects
  for insert to authenticated
  with check (public.is_member() and (public.is_admin() or owner_id = auth.uid()));

-- Réattribuer des fiches : l'admin seul, en un geste, tracé au journal.
--   - la fiche change de responsable ;
--   - ses relances OUVERTES suivent (sinon le nouveau responsable ne pourrait
--     pas les cocher, et « À faire » les montrerait à l'ancien) ;
--   - ses rendez-vous À VENIR suivent (décision de Bora, 27/10) ; les passés
--     restent à l'ancien — c'est lui qui les a tenus, c'est à lui de les
--     débriefer… ou au nouveau, qui le peut aussi par le débrief implicite ;
--   - une ligne au journal : « Fiche attribuée à Hakim (par Bora) ».
-- `security invoker` : la RLS de l'admin s'applique, et la fonction revérifie
-- le rôle elle-même (42501) — masquer un bouton n'a jamais interdit un appel.
-- Rien ne bouge sur une fiche qui est déjà au bon responsable.
create or replace function public.attribuer_prospects(p_ids uuid[], p_owner uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_nom   text;
  v_par   text;
  v_n     integer := 0;
  r       record;
begin
  if not public.is_admin() then
    raise exception 'Seul l''administrateur attribue une fiche' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(u.full_name), ''), u.email) into v_nom
    from public.crm_users u where u.id = p_owner and u.is_active;
  if v_nom is null then
    raise exception 'Responsable inconnu ou inactif' using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(u.full_name), ''), u.email) into v_par
    from public.crm_users u where u.id = auth.uid();

  for r in
    select p.id, p.owner_id
      from public.prospects p
     where p.id = any(p_ids) and p.owner_id is distinct from p_owner
  loop
    update public.prospects set owner_id = p_owner where id = r.id;
    update public.tasks set assignee_id = p_owner
     where prospect_id = r.id and status = 'a_faire';
    update public.meetings set owner_id = p_owner
     where prospect_id = r.id and kind = 'prospect'
       and starts_at > now() and status in ('prevu', 'confirme', 'reporte');
    insert into public.activities
      (prospect_id, author_id, type, subject, body, occurred_at, is_draft, is_exchange)
    values
      (r.id, auth.uid(), 'note',
       'Fiche attribuée à ' || v_nom || coalesce(' (par ' || v_par || ')', ''),
       'Ses relances ouvertes et ses rendez-vous à venir suivent le nouveau responsable.',
       now(), false, false);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

comment on function public.attribuer_prospects(uuid[], uuid) is
  'Réattribution par l''admin (031) : la fiche, ses relances ouvertes, ses RDV à venir ; une ligne au journal. Renvoie le nombre de fiches qui ont changé.';

revoke all on function public.attribuer_prospects(uuid[], uuid) from public, anon;
grant execute on function public.attribuer_prospects(uuid[], uuid) to authenticated;
