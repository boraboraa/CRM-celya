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
