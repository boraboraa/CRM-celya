-- ============================================================
-- 025 — Janet appelle depuis le CRM (8 octobre 2026)
--
-- Janet, l'IA vocale de Celya, fait la prospection téléphonique de l'admin :
-- elle appelle les fiches une par une, se présente comme une IA, qualifie, et
-- pose le rendez-vous. Ce qu'elle obtient atterrit sur la fiche comme si son
-- PROPRIÉTAIRE l'avait fait (journal, étape par les faits, agenda, relances).
-- ADMIN SEUL : chaque table ci-dessous n'a qu'une policy, `is_admin()`.
--
-- Le moteur (voir CLAUDE.md, « Appels IA ») :
--   · pg_cron réveille `/api/appels-ia/tick` (Next) chaque minute ;
--   · Next décide (règles pures de lib/appelsIa/), réserve UNE ligne et réveille
--     l'edge function `appels-ia-annexe`, qui crée l'appel chez OpenAI (GPT-Live,
--     SIP Telnyx), tient la connexion annexe, relaie les outils vers Next ;
--   · en fin d'appel, Next classe, écrit sur la fiche et lance le suivant.
--
-- Ce que la BASE garantit, et que le code ne peut pas oublier :
--   1. UN SEUL appel en cours à la fois — index unique partiel sur `appels_ia`.
--      Un 23505 à la prise n'est pas une erreur : un autre appel tient la ligne.
--   2. UNE SEULE ligne vivante de file par fiche — index unique partiel.
--   3. Le mode test se FIGE à la mise en file (`appels_ia_file.mode_test`) et à
--      la prise (`appels_ia_prendre` ne prend qu'une ligne du mode demandé).
--      Couper le mode test ne transforme pas une file de test en vrais appels.
--   4. L'INSCRIPTION AUTOMATIQUE vit ici, dans un trigger : le connecteur MCP
--      écrit en service_role sans passer par les écrans, et quatre chemins
--      créent des fiches. Même leçon que `prospects_set_owner` (015). Le trigger
--      n'échoue JAMAIS l'insertion d'une fiche : il avale sa propre erreur.
--   5. Le juge du numéro (`appels_ia_numero`) : format national accepté, jamais
--      090x / 070 / 077 / 078, un fixe liégeois en 04 (8 chiffres) est valide.
--      Recopié en TypeScript (lib/appelsIa/numeros.ts) : UN SEUL jeu de cas
--      (lib/appelsIa/numeros.cas.json), joué par le test TS ET par la recette.
--   6. Les secrets (clé OpenAI, identifiant et mot de passe SIP) dans le Vault,
--      posés par l'admin, relus par le seul service_role (l'annexe).
--
-- Additive : aucune table existante n'est modifiée, rien n'est supprimé. Le seul
-- ajout sur une table existante est un trigger AFTER sur `prospects`, inerte
-- tant que `inscription_auto` est faux (sa valeur à la naissance).
-- Réversible : couper `actif` et `inscription_auto` arrête tout ; retirer le
-- trigger `prospects_appels_ia_inscription` et `cron.unschedule('appels-ia-tick')`
-- rend la base à son état du 23/09.
-- ============================================================

-- ---------- 1. Le juge du numéro ----------
-- Renvoie le numéro au format E.164 (+32…), ou NULL s'il ne doit pas être
-- composé. Numéro national significatif : 8 chiffres (fixes, 0800) ou
-- 9 chiffres pour les mobiles (45 à 49). Pas d'appel hors Belgique.
create or replace function public.appels_ia_numero(p_brut text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v text := coalesce(p_brut, '');
  n text;
begin
  -- Séparateurs tolérés : blancs (y compris insécables), points, tirets,
  -- barres obliques, parenthèses.
  v := regexp_replace(v, '[[:space:].\-/()\u00a0\u202f]', '', 'g');
  if v ~ '^\+32' then
    n := substr(v, 4);
  elsif v ~ '^0032' then
    n := substr(v, 5);
  elsif v ~ '^0[1-9]' then
    n := substr(v, 2);
  else
    return null;
  end if;
  -- « +32 (0)81 … » : le zéro de liaison après l'indicatif.
  if n ~ '^0' then
    n := substr(n, 2);
  end if;
  if n !~ '^[0-9]+$' then
    return null;
  end if;
  if length(n) = 9 then
    -- Seuls les mobiles ont 9 chiffres.
    if n !~ '^4[5-9]' then
      return null;
    end if;
  elsif length(n) = 8 then
    -- Surtaxés (090x), 070, 077, 078 : jamais. Un 04 à 8 chiffres est un
    -- fixe liégeois, pas un mobile : valide.
    if n ~ '^(90|70|77|78)' then
      return null;
    end if;
  else
    return null;
  end if;
  return '+32' || n;
end $$;

comment on function public.appels_ia_numero(text) is
  'Numéro belge appelable par Janet, en E.164 — ou NULL. Miroir : lib/appelsIa/numeros.ts, mêmes cas (numeros.cas.json).';

-- ---------- 2. Les tables ----------

-- 2.1 Les réglages : une seule ligne.
create table public.appels_ia_reglages (
  id                   smallint primary key default 1 check (id = 1),
  -- L'interrupteur général. Né coupé.
  actif                boolean not null default false,
  -- Le mode test. Né MIS : tant qu'il l'est, tout appel part vers le GSM de
  -- test et rien n'est écrit sur les fiches.
  mode_test            boolean not null default true,
  gsm_test             text check (gsm_test is null or gsm_test ~ '^\+[1-9][0-9]{7,14}$'),
  -- Le numéro présenté (le 0480). Vide : le moteur refuse de composer.
  numero_appelant      text check (numero_appelant is null or numero_appelant ~ '^\+[1-9][0-9]{7,14}$'),
  trunk_url            text not null default 'sips:sip.telnyx.com:5061'
                       check (trunk_url ~ '^sips:[a-z0-9.-]+(:[0-9]{2,5})?(;transport=tcp)?$'),
  -- L'adresse de l'app (le tick et l'annexe l'appellent).
  url_app              text not null default 'https://celya-accounting-app.vercel.app'
                       check (url_app ~ '^https://[a-z0-9.-]+$'),
  -- La fenêtre d'appel, heure de Bruxelles, du lundi au vendredi (fériés exclus
  -- par le code : lib/appelsIa/calendrier.ts).
  fenetre_debut        time not null default '09:30',
  fenetre_fin          time not null default '17:30',
  -- Les plafonds, toujours SOUS les limites du compte Telnyx saisies à côté.
  plafond_heure        smallint not null default 8  check (plafond_heure between 1 and 60),
  plafond_jour         smallint not null default 40 check (plafond_jour between 1 and 1000),
  limite_compte_heure  smallint not null default 10 check (limite_compte_heure between 1 and 1000),
  limite_compte_jour   smallint not null default 100 check (limite_compte_jour between 1 and 10000),
  -- La durée d'un appel. 330 s au plus : l'annexe vit dans une edge function
  -- dont le worker est coupé à 400 s (organisation Supabase en plan Pro).
  duree_max_s          smallint not null default 330 check (duree_max_s between 60 and 330),
  sonnerie_max_s       smallint not null default 45  check (sonnerie_max_s between 15 and 120),
  voix                 text not null default 'gleam' check (voix ~ '^[a-z]{2,20}$'),
  modele               text not null default 'gpt-live-1' check (modele ~ '^[a-z0-9.-]{3,60}$'),
  modele_delegation    text not null default 'gpt-5.6-luna' check (modele_delegation ~ '^[a-z0-9.-]{3,60}$'),
  -- L'inscription automatique. Née fausse. Elle inscrit les fiches de l'admin
  -- qui l'a allumée (`inscription_auto_par`), jamais celles des autres.
  inscription_auto     boolean not null default false,
  inscription_auto_par uuid references public.crm_users(id),
  -- Posée par le moteur sur une panne de NOTRE côté (clé refusée, SIP sortant
  -- non activé…) : plus rien ne part tant que l'admin ne l'a pas levée.
  pause_cause          text,
  pause_at             timestamptz,
  maj_par              uuid references public.crm_users(id),
  updated_at           timestamptz not null default now(),
  check (fenetre_debut < fenetre_fin),
  check (plafond_heure <= limite_compte_heure),
  check (plafond_jour <= limite_compte_jour),
  check (not inscription_auto or inscription_auto_par is not null)
);

-- 2.2 Les campagnes. Deux campagnes « système » : l'inscription automatique et
-- les appels lancés depuis une fiche ; elles ne se terminent pas (pause seule).
create table public.appels_ia_campagnes (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null check (length(btrim(nom)) between 1 and 120),
  statut      text not null default 'active' check (statut in ('active', 'pause', 'terminee')),
  systeme     text unique check (systeme in ('auto', 'fiche')),
  cree_par    uuid not null references public.crm_users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (systeme is null or statut <> 'terminee')
);

-- 2.3 La file : UNE ligne par cycle d'appels d'une fiche (3 essais au plus).
create table public.appels_ia_file (
  id            uuid primary key default gen_random_uuid(),
  campagne_id   uuid not null references public.appels_ia_campagnes(id) on delete cascade,
  prospect_id   uuid not null references public.prospects(id) on delete cascade,
  -- Figé à la mise en file. Jamais réécrit.
  mode_test     boolean not null,
  statut        text not null default 'en_attente'
                check (statut in ('en_attente', 'en_cours', 'termine', 'arrete')),
  -- Les essais RÉELLEMENT faits (une panne de notre côté n'en compte pas).
  essais        smallint not null default 0 check (essais between 0 and 3),
  pas_avant     timestamptz not null default now(),
  priorite      smallint not null default 0,
  origine       text not null check (origine in ('auto', 'rattrapage', 'manuel', 'mcp', 'fiche')),
  inscrit_par   uuid not null references public.crm_users(id),
  cycle_debut   timestamptz,
  fin_motif     text,
  fin_at        timestamptz,
  derniere_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index appels_ia_file_une_vivante
  on public.appels_ia_file (prospect_id)
  where statut in ('en_attente', 'en_cours');
create index appels_ia_file_a_composer
  on public.appels_ia_file (priorite desc, pas_avant)
  where statut = 'en_attente';

-- 2.4 Les appels : une ligne par numérotation.
create table public.appels_ia (
  id               uuid primary key default gen_random_uuid(),
  file_id          uuid references public.appels_ia_file(id) on delete set null,
  campagne_id      uuid references public.appels_ia_campagnes(id) on delete set null,
  prospect_id      uuid references public.prospects(id) on delete set null,
  -- Le propriétaire de la fiche à la prise : c'est en son nom qu'on écrit.
  proprietaire_id  uuid references public.crm_users(id),
  lance_par        uuid references public.crm_users(id),
  essai            smallint not null default 1 check (essai between 1 and 3),
  -- Figé à la prise, depuis la ligne de file.
  mode_test        boolean not null,
  -- Le numéro RÉELLEMENT composé, posé avant de composer : c'est lui que
  -- l'opposition vise, pas le numéro actuel de la fiche.
  numero_compose   text not null check (numero_compose ~ '^\+[1-9][0-9]{7,14}$'),
  statut           text not null default 'reserve'
                   check (statut in ('reserve', 'composition', 'sonnerie', 'en_ligne', 'termine', 'echec')),
  session_id       text,
  -- Le corps de session préparé par Next (instructions, outils). JAMAIS de secret.
  session_prete    jsonb,
  classement       text check (classement in ('repondu_humain', 'repondeur', 'standard_ivr', 'sans_reponse', 'occupe_echec')),
  resultat         text check (resultat in ('sans_reponse', 'barrage', 'rappeler', 'interesse', 'refus')),
  declaration      jsonb,
  fin_motif_janet  text,
  resume           text,
  interlocuteur    text,
  transcription    jsonb,
  evenements       jsonb,
  outils           jsonb,
  raison_fermeture text,
  raccroche_par    text,
  decroche_at      timestamptz,
  fin_at           timestamptz,
  duree_s          integer,
  facture_s        integer,
  age_worker_s     integer,
  -- Le jeton de fin : posé par Next AVANT d'écrire la fin (une seule écriture,
  -- même si l'annexe renvoie son rapport). Plus de 5 min : écrivain mort, repris.
  fin_prise_at     timestamptz,
  -- 'nous' : panne de notre côté (l'essai ne compte pas, la ligne repart) ;
  -- 'neutre' : fin illisible (rien n'est écrit au journal, rien n'est deviné).
  erreur_cote      text check (erreur_cote in ('nous', 'neutre')),
  erreur_code      text,
  erreur_message   text,
  activite_id      uuid references public.activities(id) on delete set null,
  meeting_id       uuid references public.meetings(id) on delete set null,
  relance_id       uuid references public.tasks(id) on delete set null,
  opposition       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- UN SEUL appel en cours, garanti en base.
create unique index appels_ia_un_seul_en_cours
  on public.appels_ia ((true))
  where statut in ('reserve', 'composition', 'sonnerie', 'en_ligne');
create index appels_ia_par_fiche on public.appels_ia (prospect_id, created_at desc);
create index appels_ia_recents   on public.appels_ia (created_at desc);
create index appels_ia_rdv       on public.appels_ia (meeting_id) where meeting_id is not null;

-- 2.5 La liste d'opposition : le numéro composé, en E.164.
create table public.appels_ia_opposition (
  numero      text primary key check (numero ~ '^\+[1-9][0-9]{7,14}$'),
  motif       text,
  source      text not null check (source in ('appel', 'manuel', 'mcp')),
  appel_id    uuid references public.appels_ia(id) on delete set null,
  prospect_id uuid references public.prospects(id) on delete set null,
  cree_par    uuid references public.crm_users(id),
  created_at  timestamptz not null default now()
);

-- 2.6 Le brief d'appel : un par fiche. Chaque information porte sa source et
-- sa date (forme dans lib/appelsIa/brief.ts). `appris` s'allonge après chaque
-- appel, d'une ligne déterministe tirée de `noter_resultat`.
create table public.appels_ia_briefs (
  prospect_id uuid primary key references public.prospects(id) on delete cascade,
  contenu     jsonb not null default '{}'::jsonb check (jsonb_typeof(contenu) = 'object'),
  appris      jsonb not null default '[]'::jsonb check (jsonb_typeof(appris) = 'array'),
  etat        text not null default 'a_preparer' check (etat in ('a_preparer', 'pret', 'minimal')),
  prepare_at  timestamptz,
  essais_ia   smallint not null default 0,
  maj_par     uuid references public.crm_users(id),
  updated_at  timestamptz not null default now()
);

-- 2.7 Les scripts par secteur. Les règles intouchables (IA annoncée dans la
-- première phrase, jamais de prix…) ne sont PAS ici : elles vivent dans le
-- code (lib/appelsIa/instructions.ts), qu'un script vide ne peut pas retirer.
create table public.appels_ia_scripts (
  secteur      text primary key check (secteur in ('garage', 'restaurant', 'cabinet', 'autre')),
  accueil      text not null default '',
  presentation text not null default '',
  objectif     text not null default '',
  questions    text not null default '',
  objections   text not null default '',
  maj_par      uuid references public.crm_users(id),
  updated_at   timestamptz not null default now()
);

create trigger appels_ia_reglages_touch  before update on public.appels_ia_reglages  for each row execute function public.touch_updated_at();
create trigger appels_ia_campagnes_touch before update on public.appels_ia_campagnes for each row execute function public.touch_updated_at();
create trigger appels_ia_file_touch      before update on public.appels_ia_file      for each row execute function public.touch_updated_at();
create trigger appels_ia_touch           before update on public.appels_ia           for each row execute function public.touch_updated_at();
create trigger appels_ia_briefs_touch    before update on public.appels_ia_briefs    for each row execute function public.touch_updated_at();
create trigger appels_ia_scripts_touch   before update on public.appels_ia_scripts   for each row execute function public.touch_updated_at();

-- ---------- 3. Admin seul ----------
alter table public.appels_ia_reglages   enable row level security;
alter table public.appels_ia_campagnes  enable row level security;
alter table public.appels_ia_file       enable row level security;
alter table public.appels_ia            enable row level security;
alter table public.appels_ia_opposition enable row level security;
alter table public.appels_ia_briefs     enable row level security;
alter table public.appels_ia_scripts    enable row level security;

create policy appels_ia_reglages_admin   on public.appels_ia_reglages   for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy appels_ia_campagnes_admin  on public.appels_ia_campagnes  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy appels_ia_file_admin       on public.appels_ia_file       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy appels_ia_admin            on public.appels_ia            for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy appels_ia_opposition_admin on public.appels_ia_opposition for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy appels_ia_briefs_admin     on public.appels_ia_briefs     for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy appels_ia_scripts_admin    on public.appels_ia_scripts    for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.appels_ia_reglages, public.appels_ia_campagnes, public.appels_ia_file,
              public.appels_ia, public.appels_ia_opposition, public.appels_ia_briefs,
              public.appels_ia_scripts
  from public, anon;

-- ---------- 4. La règle d'inscription, écrite une fois ----------

-- Les deux campagnes système, créées à la demande.
create or replace function public.appels_ia_campagne_systeme(p_systeme text, p_par uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  if p_systeme is null or p_systeme not in ('auto', 'fiche') then
    raise exception 'Campagne système inconnue.' using errcode = '22023';
  end if;
  select id into v_id from public.appels_ia_campagnes where systeme = p_systeme;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.appels_ia_campagnes (nom, systeme, cree_par)
  values (case p_systeme when 'auto' then 'Inscription automatique' else 'Appels depuis une fiche' end,
          p_systeme, p_par)
  on conflict (systeme) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.appels_ia_campagnes where systeme = p_systeme;
  end if;
  return v_id;
end $$;

-- Pourquoi une fiche ne peut pas entrer dans la file — ou NULL si elle peut.
-- `p_auto` : inscription automatique ou rattrapage (règles de la section 3 du
-- cahier : fiche DE L'ADMIN qui a allumé, « À appeler », jamais passée par un
-- cycle du même mode). Sinon : inscription À LA MAIN (n'importe quelle fiche
-- ouverte, décision explicite de l'admin).
create or replace function public.appels_ia_refus_inscription(
  p_prospect uuid, p_auto boolean, p_admin uuid, p_mode_test boolean)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  p record;
  v_num text;
begin
  select id, owner_id, status, phone into p from public.prospects where id = p_prospect;
  if not found then
    return 'Fiche introuvable.';
  end if;
  if p.status in ('gagne', 'perdu') then
    return 'Fiche gagnée ou perdue : Janet ne l''appelle jamais.';
  end if;
  if p_auto then
    if not exists (select 1 from public.crm_users u
                    where u.id = p_admin and u.is_active and u.role = 'admin') then
      return 'L''inscription automatique n''a pas d''administrateur actif.';
    end if;
    if p.owner_id is distinct from p_admin then
      return 'Ce n''est pas une fiche de l''administrateur : elle s''ajoute à la main.';
    end if;
    if p.status <> 'a_appeler' then
      return 'La fiche n''est plus « À appeler ».';
    end if;
    if exists (select 1 from public.appels_ia_file f
                where f.prospect_id = p.id and f.mode_test = p_mode_test) then
      return 'Janet a déjà fait un cycle d''appels sur cette fiche.';
    end if;
  end if;
  v_num := public.appels_ia_numero(p.phone);
  if v_num is null then
    return 'Pas de numéro belge appelable sur la fiche.';
  end if;
  if exists (select 1 from public.appels_ia_opposition o where o.numero = v_num) then
    return 'Ce numéro est sur la liste d''opposition.';
  end if;
  if exists (select 1 from public.meetings m
              where m.prospect_id = p.id and m.kind = 'prospect'
                and public.rdv_vivant(m.status) and m.starts_at > now()) then
    return 'Un rendez-vous est déjà prévu avec cette fiche.';
  end if;
  if exists (select 1 from public.appels_ia_file f
              where f.prospect_id = p.id and f.statut in ('en_attente', 'en_cours')) then
    return 'La fiche est déjà dans la file.';
  end if;
  return null;
end $$;

-- 4.1 L'inscription automatique. AFTER INSERT (et AFTER UPDATE OF phone pour
-- une fiche qui n'a jamais été dans la file, quand son numéro DEVIENT
-- appelable : un numéro ajouté ou corrigé après coup).
-- `pas_avant` = +5 min : le temps que le brief se prépare.
create or replace function public.appels_ia_inscription_auto()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.appels_ia_reglages;
  v_camp uuid;
begin
  begin
    select * into r from public.appels_ia_reglages where id = 1;
    if not found or not r.inscription_auto or r.inscription_auto_par is null then
      return null;
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.appels_ia_file f where f.prospect_id = new.id) then
      return null;
    end if;
    -- Le formulaire « Modifier la fiche » (updateProspectAction) réécrit `phone`
    -- à CHAQUE enregistrement, même inchangé. Sans ce test, ré-enregistrer une
    -- fiche déjà appelable avant l'allumage l'inscrirait : un rattrapage
    -- silencieux. Celles-là passent par `appels_ia_rattrapage`, compté d'abord.
    if tg_op = 'UPDATE' and (public.appels_ia_numero(old.phone) is not null
                             or public.appels_ia_numero(new.phone) is null) then
      return null;
    end if;
    if public.appels_ia_refus_inscription(new.id, true, r.inscription_auto_par, r.mode_test) is not null then
      return null;
    end if;
    v_camp := public.appels_ia_campagne_systeme('auto', r.inscription_auto_par);
    insert into public.appels_ia_file (campagne_id, prospect_id, mode_test, pas_avant, origine, inscrit_par)
    values (v_camp, new.id, r.mode_test, now() + interval '5 minutes', 'auto', r.inscription_auto_par)
    on conflict do nothing;
    insert into public.appels_ia_briefs (prospect_id) values (new.id) on conflict do nothing;
  exception when others then
    -- Une fiche se crée TOUJOURS : l'inscription n'est qu'un à-côté.
    raise warning 'appels_ia_inscription_auto(%) : % [%]', new.id, sqlerrm, sqlstate;
  end;
  return null;
end $$;

create trigger prospects_appels_ia_inscription
  after insert or update of phone on public.prospects
  for each row execute function public.appels_ia_inscription_auto();

-- 4.2 Le rattrapage : les fiches déjà « À appeler » de l'admin qui appelle.
-- Pas de rattrapage silencieux : sans `p_confirmer`, on COMPTE seulement.
create or replace function public.appels_ia_rattrapage(p_confirmer boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  r public.appels_ia_reglages;
  v_camp uuid;
  v_n integer := 0;
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  select * into r from public.appels_ia_reglages where id = 1;
  for v_id in
    select p.id from public.prospects p
     where p.owner_id = auth.uid() and p.status = 'a_appeler'
     order by p.created_at, p.id
  loop
    if public.appels_ia_refus_inscription(v_id, true, auth.uid(), r.mode_test) is null then
      v_n := v_n + 1;
      if p_confirmer then
        v_camp := coalesce(v_camp, public.appels_ia_campagne_systeme('auto', auth.uid()));
        insert into public.appels_ia_file (campagne_id, prospect_id, mode_test, pas_avant, origine, inscrit_par)
        values (v_camp, v_id, r.mode_test, now() + interval '5 minutes', 'rattrapage', auth.uid())
        on conflict do nothing;
        insert into public.appels_ia_briefs (prospect_id) values (v_id) on conflict do nothing;
      end if;
    end if;
  end loop;
  return v_n;
end $$;

-- 4.3 L'inscription à la main (bouton de la fiche, outil MCP, écran Appels IA).
-- Renvoie NULL si la fiche est entrée dans la file, sinon la raison du refus.
-- Admin seul : sous une session, l'appelant doit être admin et agit en son
-- nom ; sous service_role (connecteur MCP, qui vérifie l'admin en code),
-- `p_par` dit qui inscrit.
create or replace function public.appels_ia_inscrire(
  p_prospect uuid, p_campagne uuid, p_origine text, p_par uuid,
  p_priorite smallint default 0, p_pas_avant timestamptz default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  r public.appels_ia_reglages;
  v_par uuid := coalesce(auth.uid(), p_par);
  v_refus text;
  v_camp record;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  if v_par is null or not exists (select 1 from public.crm_users u
                                   where u.id = v_par and u.is_active and u.role = 'admin') then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  if p_origine not in ('manuel', 'mcp', 'fiche') then
    raise exception 'Origine inconnue.' using errcode = '22023';
  end if;
  select * into r from public.appels_ia_reglages where id = 1;
  select id, statut into v_camp from public.appels_ia_campagnes where id = p_campagne;
  if not found then
    return 'Campagne introuvable.';
  end if;
  if v_camp.statut = 'terminee' then
    return 'Cette campagne est terminée.';
  end if;
  v_refus := public.appels_ia_refus_inscription(p_prospect, false, v_par, r.mode_test);
  if v_refus is not null then
    return v_refus;
  end if;
  insert into public.appels_ia_file (campagne_id, prospect_id, mode_test, pas_avant, priorite, origine, inscrit_par)
  values (p_campagne, p_prospect, r.mode_test, coalesce(p_pas_avant, now()), coalesce(p_priorite, 0), p_origine, v_par);
  insert into public.appels_ia_briefs (prospect_id) values (p_prospect) on conflict do nothing;
  return null;
exception when unique_violation then
  return 'La fiche est déjà dans la file.';
end $$;

-- 4.4 La prise : une ligne de file DU MODE DEMANDÉ devient un appel réservé.
-- L'insertion dans `appels_ia` heurte l'index « un seul en cours » si un autre
-- appel tient la ligne : le 23505 remonte tel quel, l'appelant s'arrête.
create or replace function public.appels_ia_prendre(
  p_file uuid, p_numero text, p_mode_test boolean, p_lance_par uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f record;
  v_owner uuid;
  v_appel uuid;
begin
  select * into f from public.appels_ia_file
   where id = p_file and statut = 'en_attente' and mode_test = p_mode_test
   for update skip locked;
  if not found then
    return null;
  end if;
  select owner_id into v_owner from public.prospects where id = f.prospect_id;
  insert into public.appels_ia (file_id, campagne_id, prospect_id, proprietaire_id, lance_par,
                                essai, mode_test, numero_compose, statut)
  values (f.id, f.campagne_id, f.prospect_id, v_owner, coalesce(p_lance_par, f.inscrit_par),
          least(f.essais + 1, 3), f.mode_test, p_numero, 'reserve')
  returning id into v_appel;
  update public.appels_ia_file
     set statut = 'en_cours', cycle_debut = coalesce(cycle_debut, now())
   where id = f.id;
  return v_appel;
end $$;

-- 4.5 L'appel de test, hors file : toujours en mode test, même verrou.
create or replace function public.appels_ia_prendre_test(
  p_prospect uuid, p_numero text, p_lance_par uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_appel uuid;
begin
  if p_prospect is not null then
    select owner_id into v_owner from public.prospects where id = p_prospect;
  end if;
  insert into public.appels_ia (prospect_id, proprietaire_id, lance_par, essai, mode_test, numero_compose, statut)
  values (p_prospect, v_owner, p_lance_par, 1, true, p_numero, 'reserve')
  returning id into v_appel;
  return v_appel;
end $$;

-- Les fonctions internes (règle, trigger, prise) ne sont pas appelables par un
-- client : la règle se lit par `appels_ia_inscrire`, qui la porte.
revoke all on function public.appels_ia_campagne_systeme(text, uuid) from public, anon;
revoke all on function public.appels_ia_refus_inscription(uuid, boolean, uuid, boolean) from public, anon, authenticated;
revoke all on function public.appels_ia_inscription_auto() from public, anon, authenticated;
revoke all on function public.appels_ia_rattrapage(boolean) from public, anon;
revoke all on function public.appels_ia_inscrire(uuid, uuid, text, uuid, smallint, timestamptz) from public, anon;
revoke all on function public.appels_ia_prendre(uuid, text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.appels_ia_prendre_test(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.appels_ia_campagne_systeme(text, uuid) to authenticated, service_role;
grant execute on function public.appels_ia_refus_inscription(uuid, boolean, uuid, boolean) to service_role;
grant execute on function public.appels_ia_rattrapage(boolean) to authenticated;
grant execute on function public.appels_ia_inscrire(uuid, uuid, text, uuid, smallint, timestamptz) to authenticated, service_role;
grant execute on function public.appels_ia_prendre(uuid, text, boolean, uuid) to service_role;
grant execute on function public.appels_ia_prendre_test(uuid, text, uuid) to service_role;

-- ---------- 5. Les secrets ----------
-- Le secret interne : pg_cron → Next (en-tête), Next ↔ annexe (HMAC).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'appels_ia_secret_interne') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'appels_ia_secret_interne',
      'Appels IA — secret partagé : tick pg_cron → Next, Next ↔ annexe (HMAC)'
    );
  end if;
end $$;

-- Poser un secret : admin seul, liste blanche. La valeur ne ressort jamais.
create or replace function public.appels_ia_poser_secret(p_nom text, p_valeur text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_nom text := 'appels_ia_' || coalesce(p_nom, '');
  v_val text := btrim(coalesce(p_valeur, ''));
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;
  if p_nom is null or p_nom not in ('openai_api_key', 'sip_identifiant', 'sip_mot_de_passe') then
    raise exception 'Secret inconnu.' using errcode = '22023';
  end if;
  if length(v_val) = 0 or length(v_val) > 4096 then
    raise exception 'Valeur vide ou trop longue.' using errcode = '22023';
  end if;
  select id into v_id from vault.secrets where name = v_nom;
  if v_id is null then
    perform vault.create_secret(v_val, v_nom, 'Appels IA — ' || p_nom);
  else
    perform vault.update_secret(v_id, v_val);
  end if;
end $$;

-- Quels secrets sont posés, et quand — jamais leur valeur.
create or replace function public.appels_ia_secrets_poses()
returns table (nom text, pose_le timestamptz)
language sql stable security definer set search_path = public as $$
  select substr(s.name, 11), s.updated_at
    from vault.secrets s
   where public.is_admin()
     and s.name in ('appels_ia_openai_api_key', 'appels_ia_sip_identifiant', 'appels_ia_sip_mot_de_passe');
$$;

-- Relire un secret : service_role seul (l'annexe, et Next pour le secret interne).
create or replace function public.appels_ia_secret(p_nom text)
returns text language sql stable security definer set search_path = public as $$
  select d.decrypted_secret
    from vault.decrypted_secrets d
   where p_nom in ('openai_api_key', 'sip_identifiant', 'sip_mot_de_passe', 'secret_interne')
     and d.name = 'appels_ia_' || p_nom;
$$;

revoke all on function public.appels_ia_poser_secret(text, text) from public, anon;
revoke all on function public.appels_ia_secrets_poses() from public, anon;
revoke all on function public.appels_ia_secret(text) from public, anon, authenticated;
grant execute on function public.appels_ia_poser_secret(text, text) to authenticated;
grant execute on function public.appels_ia_secrets_poses() to authenticated;
grant execute on function public.appels_ia_secret(text) to service_role;

-- ---------- 6. Les données de départ ----------
insert into public.appels_ia_reglages (id) values (1) on conflict (id) do nothing;

insert into public.appels_ia_scripts (secteur, accueil, presentation, objectif, questions, objections) values
('garage',
 'Demandez le gérant ou le chef d''atelier. Si on vous passe quelqu''un d''autre, demandez quand le joindre.',
 'Celya a créé une réceptionniste téléphonique pour les garages : quand l''équipe est sous une voiture, elle décroche, prend les rendez-vous d''entretien et note les demandes de devis.',
 'Obtenir une démonstration de 30 minutes avec le gérant, par téléphone ou en visio, dans les dix jours ouvrés.',
 'Combien d''appels ratez-vous quand l''atelier tourne ? Qui décroche quand vous êtes occupé ? Comment prenez-vous les rendez-vous aujourd''hui ?',
 '« J''ai déjà quelqu''un à l''accueil » : la réceptionniste prend le relais quand la ligne est occupée, pendant la pause et après la fermeture. « Les clients n''aiment pas les robots » : c''est pour ça que je me présente comme une IA — vous jugerez pendant la démo.'),
('restaurant',
 'Demandez le patron ou le responsable de salle. Pendant le service, proposez de rappeler et demandez le meilleur moment.',
 'Celya a créé une réceptionniste téléphonique pour les restaurants : pendant le coup de feu, elle prend les réservations et répond aux questions (horaires, accès, allergènes).',
 'Obtenir une démonstration de 30 minutes avec le patron, en dehors du service, dans les dix jours ouvrés.',
 'Combien d''appels manquez-vous pendant le service ? Comment prenez-vous les réservations aujourd''hui ? Qui répond quand vous êtes fermés ?',
 '« On a déjà la réservation en ligne » : beaucoup de clients appellent quand même, et la réceptionniste répond à ceux-là. « Pas le temps » : la démo dure 30 minutes, au moment qui vous arrange.'),
('cabinet',
 'Demandez le praticien titulaire ou la personne qui gère le secrétariat.',
 'Celya a créé une réceptionniste téléphonique pour les cabinets : quand le secrétariat est en ligne ou absent, elle répond, prend les rendez-vous et repère les urgences pour vous les signaler.',
 'Obtenir une démonstration de 30 minutes avec le titulaire, dans les dix jours ouvrés.',
 'Que se passe-t-il quand le secrétariat est déjà au téléphone ? Combien d''appels arrivent en dehors des heures d''ouverture ? Comment les rendez-vous sont-ils pris aujourd''hui ?',
 '« J''ai une secrétaire » : la réceptionniste la soulage aux heures de pointe et prend le relais le soir. « La confidentialité » : la démo est le bon moment pour en parler en détail.'),
('autre',
 'Demandez le responsable ou la personne qui s''occupe de l''accueil téléphonique.',
 'Celya a créé une réceptionniste téléphonique pour les petites entreprises : quand personne ne peut décrocher, elle répond, prend les rendez-vous et les messages.',
 'Obtenir une démonstration de 30 minutes avec le responsable, dans les dix jours ouvrés.',
 'Combien d''appels ratez-vous quand vous êtes occupé ? Qui répond aujourd''hui quand vous ne pouvez pas ? Que deviennent les appels du soir ?',
 '« Ça ne nous concerne pas » : demandez combien d''appels arrivent quand personne n''est disponible. « Envoyez-moi un mail » : proposez plutôt 30 minutes de démo, plus parlantes qu''un mail.')
on conflict (secteur) do nothing;

-- ---------- 7. Le réveil, chaque minute ----------
-- N'appelle Next que s'il y a quelque chose à faire : moteur allumé, appel en
-- cours (le filet des appels bloqués), ou brief à préparer.
select cron.schedule(
  'appels-ia-tick',
  '* * * * *',
  $cron$
  select net.http_post(
    url := r.url_app || '/api/appels-ia/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-appels-ia-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'appels_ia_secret_interne')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  from public.appels_ia_reglages r
  where r.id = 1
    and (r.actif
         or exists (select 1 from public.appels_ia a
                     where a.statut in ('reserve', 'composition', 'sonnerie', 'en_ligne'))
         or exists (select 1 from public.appels_ia_briefs b where b.etat = 'a_preparer'));
  $cron$
);

comment on table public.appels_ia_file is
  'La file de Janet : une ligne par cycle d''appels d''une fiche (3 essais au plus). Mode test figé à la mise en file. Une seule ligne vivante par fiche.';
comment on table public.appels_ia is
  'Les appels de Janet : une ligne par numérotation. UN SEUL en cours (index unique partiel). Numéro composé figé avant de composer.';
