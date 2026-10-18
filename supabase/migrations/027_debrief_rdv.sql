-- ============================================================
-- 027 — Débriefer là où on travaille (18 octobre 2026)
--
-- Constat du 18/10 : 15 rendez-vous depuis le début, 0 débriefé. 14 passés
-- et toujours « prévu » / « reporté », 10 fiches bloquées en « Rendez-vous »
-- avec « RDV passé, à débriefer » pour prochaine action. Les commerciaux
-- travaillent depuis la fiche : ils notent, rappellent, posent une relance —
-- et le rendez-vous ne se ferme jamais (Carrosserie carsystem : RDV tenu le
-- 29/09, appels les 14 et 15/10, relance au 22/10 masquée derrière
-- « À débriefer »).
--
-- LA RÈGLE 022/024 CHANGE (décision de Bora, 18/10) :
--   « Un rendez-vous passé non débriefé reste la prochaine action — TANT QUE
--     RIEN N'EST POSÉ APRÈS LUI. »
--
-- Trois pièces :
--
-- 1. L'ISSUE du débrief (meetings.debrief_issue) : intéressé à rappeler,
--    proposition, signé, pas intéressé — posée par le débrief explicite
--    (lib/crm/agenda.ts, cloturerRendezVous). C'est elle que lit la règle
--    d'étape « À rappeler » (lib/crm/status.ts, migration 026).
--
-- 2. Le DÉBRIEF IMPLICITE (trigger sur activities, et SEULEMENT sur
--    activities) : une action humaine posée sur la fiche APRÈS le début du
--    rendez-vous — échange attesté, résultat d'appel, email envoyé — le clôt
--    en « honore », avec une ligne au journal. La relance redevient la
--    prochaine action (recalcul par le trigger de la 022).
--    · PAS de trigger sur tasks, et c'est voulu : le suivi CRM automatique
--      re-date des relances tout seul (Alain docteur, 21/09) — il fermerait
--      des rendez-vous que personne n'a tenus. Une relance seule ne ferme rien.
--    · Exclus : brouillon, note de repérage (is_exchange faux sans résultat),
--      activité « rendez_vous » (elle accompagne la POSE d'un rendez-vous),
--      note rattachée à un rendez-vous (meeting_id : compte rendu de débrief,
--      report — c'est le débrief explicite qui parle), fiche gagnée / perdue,
--      rendez-vous à venir, rendez-vous personnel.
--    · « honore » ne vient QUE d'ici ou du débrief explicite : d'une action
--      humaine posée après le rendez-vous.
--    · Un résultat « À rappeler » ou « Intéressé » posé après le rendez-vous
--      vaut l'issue « intéressé, à rappeler » ; tout le reste vaut « suite
--      posée ».
--
-- 3. UN SEUL rendez-vous en attente par fiche (trigger sur meetings) :
--    · poser ou reporter un rendez-vous clôt tout AUTRE rendez-vous passé non
--      débriefé de la fiche en « annule », note « remplacé par le RDV du … »
--      (jamais « honore » : rien ne dit qu'il a eu lieu) ;
--    · un rendez-vous qui passe en « honore » clôt de même les rendez-vous en
--      attente plus ANCIENS que lui (les doublons de Nice Cars, Garage des
--      Cultivateurs, API CAR 3000, Garage Vivier d'oie) ;
--    · un rendez-vous À VENIR n'est jamais touché.
--
-- Rattrapage : AUCUN. Les 14 rendez-vous en souffrance ne sont pas clôturés
-- rétroactivement — la règle vaut à l'événement. Ils remontent en tête de
-- « À faire » (code), avec les mêmes boutons d'issue que la fiche.
--
-- Pourquoi en SQL : tous les écrivains passent par là — l'écran, le
-- connecteur MCP (service_role), l'email envoyé par l'edge function crm-mail
-- (sans la toucher) et, le jour venu, les appels IA (sans toucher
-- lib/appelsIa). Une règle dans les server actions serait contournée par le
-- premier chemin oublié.
--
-- Fonctions `security definer`, bornées aux rendez-vous de la fiche de la
-- ligne déclenchante : la note de Nathan doit pouvoir clore un RDV que Bora a
-- posé sur sa fiche (meetings_update est réservé au propriétaire du RDV), et
-- l'insertion de la note a déjà passé la RLS de sa fiche.
--
-- PRÉREQUIS : la 026 (la règle d'étape TypeScript lit 'a_rappeler').
-- Migration ADDITIVE : deux colonnes nullables, des fonctions, deux triggers.
-- Le code en production ignore les colonnes. Indépendante de la 025.
-- Réversible : supprimer les deux triggers ; les colonnes peuvent rester.
-- ============================================================

-- ---------- 1. Colonnes ----------
alter table public.meetings
  add column if not exists debrief_issue text;
alter table public.meetings
  drop constraint if exists meetings_debrief_issue_connue;
alter table public.meetings
  add constraint meetings_debrief_issue_connue
  check (debrief_issue is null or debrief_issue in
    ('a_rappeler', 'proposition', 'signe', 'pas_interesse', 'suite_posee', 'remplace'));

comment on column public.meetings.debrief_issue is
  'Ce qu''a donné le rendez-vous. Débrief explicite : a_rappeler (intéressé, à rappeler), '
  'proposition, signe, pas_interesse. Débrief implicite (027) : suite_posee, ou a_rappeler '
  'si le résultat d''appel posé après lui était « À rappeler » / « Intéressé ». remplace : '
  'clos par un rendez-vous plus récent sur la même fiche (statut annule). Null : clos sans '
  'issue dite (ancien débrief, annulation).';

alter table public.activities
  add column if not exists meeting_id uuid references public.meetings(id) on delete set null;
create index if not exists activities_meeting_id_idx
  on public.activities (meeting_id) where meeting_id is not null;

comment on column public.activities.meeting_id is
  'Le rendez-vous dont parle cette ligne (compte rendu de débrief, report, clôture '
  'automatique). Une ligne rattachée à un rendez-vous ne déclenche jamais le débrief '
  'implicite (027) : c''est le rendez-vous lui-même qui parle.';

-- ---------- 2. Le débrief implicite ----------
create or replace function public.activities_debrief_implicite()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_etape public.prospect_status;
  v_rdv   record;
begin
  if new.prospect_id is null or new.is_draft or new.meeting_id is not null
     or new.type = 'rendez_vous' then
    return new;
  end if;
  -- Une action humaine qui atteste d'une suite : échange, résultat d'appel,
  -- email envoyé. Une note de repérage ne ferme rien.
  if not (new.is_exchange or new.outcome is not null or new.type = 'email') then
    return new;
  end if;

  select p.status into v_etape from public.prospects p where p.id = new.prospect_id;
  if v_etape is null or v_etape in ('gagne', 'perdu') then
    return new;
  end if;

  -- Le rendez-vous en attente le plus récent, commencé avant l'action. Les
  -- plus anciens sont clos « remplacés » par le trigger de meetings, dans la
  -- foulée.
  select m.id, m.starts_at into v_rdv
    from public.meetings m
   where m.prospect_id = new.prospect_id
     and m.kind = 'prospect'
     and public.rdv_vivant(m.status)
     and m.debriefed_at is null
     and m.starts_at <= new.occurred_at
     and m.starts_at <= now()
   order by m.starts_at desc
   limit 1;
  if v_rdv.id is null then
    return new;
  end if;

  update public.meetings
     set status = 'honore',
         debriefed_at = now(),
         debrief_issue = case when new.outcome in ('rappeler', 'interesse')
                              then 'a_rappeler' else 'suite_posee' end
   where id = v_rdv.id;

  -- Une milliseconde AVANT l'action : dans la chronologie, le rendez-vous se
  -- clôt puis la suite arrive — et la « dernière action » de la carte reste
  -- celle de l'humain.
  insert into public.activities
    (prospect_id, author_id, type, subject, body, occurred_at, is_draft, is_exchange, meeting_id)
  values (
    new.prospect_id,
    new.author_id,
    'note',
    'RDV du ' || to_char(v_rdv.starts_at at time zone 'Europe/Brussels', 'DD/MM')
      || ' marqué comme tenu (suite posée le '
      || to_char(new.occurred_at at time zone 'Europe/Brussels', 'DD/MM') || ')',
    'Une suite a été posée sur la fiche après le rendez-vous du '
      || public.jour_heure_court(v_rdv.starts_at)
      || ' : il est considéré comme tenu. La relance redevient la prochaine action.',
    new.occurred_at - interval '1 millisecond',
    false,
    false,
    v_rdv.id
  );
  return new;
end $$;
revoke all on function public.activities_debrief_implicite() from public, anon, authenticated;

drop trigger if exists activities_debrief_implicite on public.activities;
create trigger activities_debrief_implicite
  after insert on public.activities
  for each row execute function public.activities_debrief_implicite();

-- ---------- 3. Un seul rendez-vous en attente par fiche ----------
create or replace function public.meetings_rdv_remplaces()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_etape  public.prospect_status;
  v_pose   boolean;
  v_tenu   boolean;
  v_auteur uuid;
begin
  if new.kind <> 'prospect' or new.prospect_id is null then
    return new;
  end if;

  -- Poser / reporter : un rendez-vous vivant qui naît ou change de date.
  v_pose := public.rdv_vivant(new.status)
        and (tg_op = 'INSERT'
             or new.starts_at is distinct from old.starts_at
             or new.prospect_id is distinct from old.prospect_id);
  -- Tenu : un rendez-vous qui passe en « honore » (débrief explicite ou
  -- implicite). Une annulation ne remplace rien.
  v_tenu := tg_op = 'UPDATE' and new.status = 'honore' and public.rdv_vivant(old.status);

  if not (v_pose or v_tenu) then
    return new;
  end if;

  select p.status into v_etape from public.prospects p where p.id = new.prospect_id;
  if v_etape is null or v_etape in ('gagne', 'perdu') then
    return new;
  end if;

  v_auteur := coalesce(auth.uid(), new.created_by, new.owner_id);

  with remplaces as (
    update public.meetings m
       set status = 'annule',
           debriefed_at = now(),
           debrief_issue = 'remplace'
     where m.prospect_id = new.prospect_id
       and m.id <> new.id
       and m.kind = 'prospect'
       and public.rdv_vivant(m.status)
       and m.debriefed_at is null
       and m.starts_at <= now()                               -- jamais un RDV à venir
       and (v_pose or m.starts_at < new.starts_at)            -- tenu : les plus anciens seulement
    returning m.id, m.starts_at
  )
  insert into public.activities
    (prospect_id, author_id, type, subject, body, occurred_at, is_draft, is_exchange, meeting_id)
  select new.prospect_id,
         v_auteur,
         'note',
         'RDV du ' || to_char(r.starts_at at time zone 'Europe/Brussels', 'DD/MM')
           || ' remplacé par le RDV du ' || public.jour_heure_court(new.starts_at),
         'Le rendez-vous du ' || public.jour_heure_court(r.starts_at)
           || ' n''a pas été débriefé ; il est clos, remplacé par celui du '
           || public.jour_heure_court(new.starts_at) || '.',
         now(),
         false,
         false,
         r.id
    from remplaces r;

  return new;
end $$;
revoke all on function public.meetings_rdv_remplaces() from public, anon, authenticated;

drop trigger if exists meetings_rdv_remplaces on public.meetings;
create trigger meetings_rdv_remplaces
  after insert or update on public.meetings
  for each row execute function public.meetings_rdv_remplaces();

comment on column public.prospects.next_action_at is
  'La prochaine action, c''est le prochain rendez-vous de la fiche tant qu''il n''est pas '
  'débriefé ; sinon, sa relance la plus proche. Un rendez-vous à venir est TOUJOURS la '
  'prochaine action : une relance datée avant lui reste une tâche (« À appeler ») mais ne '
  'le remplace jamais (024). Un rendez-vous passé le reste TANT QUE RIEN N''EST POSÉ APRÈS '
  'LUI : un échange, un résultat d''appel ou un email le clôt (027). Une fiche gagnée ou '
  'perdue ne réclame jamais rien : seuls ses rendez-vous À VENIR et ses relances ouvertes '
  'comptent (023). Calculée par prochaine_action_de, jamais écrite ailleurs.';
