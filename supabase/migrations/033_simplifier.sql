-- ============================================================
-- 033 — Simplifier après la mise en ligne (27 octobre 2026, soir)
--
-- APRÈS la 032 (la valeur d'enum `suivi_email` doit exister et être validée).
-- Additive : deux contraintes élargies, deux fonctions réécrites, un trigger.
-- Une seule écriture de données, la reprise de la section 4 : mesurée le 27/10
-- au soir, UNE fiche (100% MOTO, en essai depuis le 12/10) et UN rendez-vous
-- (le 29/09), plus sa ligne de journal.
--
-- Sections, une par fonctionnalité du lot :
--   1. Le résultat d'appel « Suivi par email »
--   2. Deux issues de débrief : « Suivi par email », « Pas décroché »
--   3. Les compteurs : « Suivi par email » est une réponse
--   4. Une fiche qui passe en essai gratuit ne réclame plus de débrief
--
-- Rien ici ne touche à la cloison de lecture ni aux policies d'écriture.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Le résultat d'appel « Suivi par email »
--
-- On a eu quelqu'un, qui demande l'information par mail : c'est une RÉPONSE
-- (section 3), un échange attesté (comme tous les résultats sauf
-- « Pas décroché » — `sans_reponse`, dont seul le libellé change à l'écran), et
-- le FAIT qui fait avancer la fiche en « Suivi par email » (032 ; la règle des
-- faits vit dans lib/crm/status.ts). La contrainte de la 019 est réécrite à
-- l'identique, plus cette valeur.
-- ------------------------------------------------------------

alter table public.activities
  drop constraint if exists activities_outcome_connu;
alter table public.activities
  add constraint activities_outcome_connu
  check (outcome is null or outcome in
    ('sans_reponse', 'barrage', 'rappeler', 'interesse', 'suivi_email', 'refus'));


-- ------------------------------------------------------------
-- 2. Deux issues de débrief
--
--   suivi_email    le RDV a eu lieu, la personne veut l'info par mail : RDV
--                  tenu, une relance à la date choisie, l'étape suit le fait
--                  → « Suivi par email » ;
--   pas_decroche   un RDV téléphonique où personne n'a décroché : il n'a PAS
--                  eu lieu → RDV ANNULÉ (décision de Bora, 27/10), la ligne de
--                  journal porte « pas de réponse », une relance est proposée,
--                  jamais exigée. « Reporter » reste pour quand une nouvelle
--                  date est connue.
--
-- La règle vit dans lib/crm/debrief.ts (`effetsDebrief`). La contrainte de la
-- 031 est réécrite à l'identique, plus ces deux valeurs.
-- ------------------------------------------------------------

alter table public.meetings
  drop constraint if exists meetings_debrief_issue_connue;
alter table public.meetings
  add constraint meetings_debrief_issue_connue
  check (debrief_issue is null or debrief_issue in
    ('a_rappeler', 'suivi_email', 'proposition', 'essai', 'signe', 'pas_interesse',
     'pas_decroche', 'suite_posee', 'remplace'));

-- Le débrief IMPLICITE (027) apprend la nouvelle valeur : un « Suivi par
-- email » posé après un rendez-vous passé non débriefé le clôt, comme un
-- « À rappeler » — avec l'issue `suivi_email`, pour que l'étape suive le bon
-- fait. Le corps est celui de la 027, à deux lignes près (repérées « 033 »).
-- Sa recopie lisible : `issueImplicite` (lib/crm/debrief.ts).
create or replace function public.activities_debrief_implicite()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_etape public.prospect_status;
  v_rdv   record;
  v_issue text;
begin
  if new.prospect_id is null or new.is_draft or new.meeting_id is not null
     or new.type = 'rendez_vous' then
    return new;
  end if;
  -- Ne pas avoir eu la personne ne prouve pas que le rendez-vous a eu lieu :
  -- « Pas de réponse » et « Barrage » ne ferment rien. Écartés AVANT le test
  -- d'échange — un barrage est un échange attesté.
  if coalesce(new.outcome in ('sans_reponse', 'barrage'), false) then
    return new;
  end if;
  -- Une action humaine qui atteste d'une suite : échange, résultat d'appel
  -- (rappeler, interesse, suivi_email, refus), email envoyé. Une note de
  -- repérage ne ferme rien. ⚠ `outcome in (…)` vaut NULL quand outcome est
  -- NULL, et `not NULL` n'est pas vrai : sans le coalesce, une note de
  -- repérage fermait le RDV.
  if not (coalesce(new.is_exchange, false)
          -- 033 : suivi_email
          or coalesce(new.outcome in ('rappeler', 'interesse', 'suivi_email', 'refus'), false)
          or new.type = 'email') then
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

  v_issue := case
               when new.outcome in ('rappeler', 'interesse') then 'a_rappeler'
               when new.outcome = 'suivi_email' then 'suivi_email'  -- 033
               when new.outcome = 'refus' then 'pas_interesse'
               else 'suite_posee'
             end;

  update public.meetings
     set status = 'honore',
         debriefed_at = now(),
         debrief_issue = v_issue
   where id = v_rdv.id;

  -- « Pas intéressé » après le rendez-vous : la même conséquence que le
  -- débrief explicite — Perdu, verrouillé (une décision humaine : c'est
  -- l'humain qui a tapé le résultat), relances ouvertes annulées. La raison
  -- est déjà sur la fiche (lost_reason, posée par le résultat d'appel).
  if v_issue = 'pas_interesse' then
    update public.prospects
       set status = 'perdu',
           status_locked = true,
           status_locked_at = now(),
           status_auto_reason = null,
           status_auto_at = null
     where id = new.prospect_id;
    update public.tasks
       set status = 'annule'
     where prospect_id = new.prospect_id and status = 'a_faire';
  end if;

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
    case when v_issue = 'pas_interesse'
      then 'Un « Pas intéressé » a été posé après le rendez-vous du '
        || public.jour_heure_court(v_rdv.starts_at)
        || ' : il est considéré comme tenu, la fiche passe en Perdu et ses relances ouvertes sont annulées.'
      else 'Une suite a été posée sur la fiche après le rendez-vous du '
        || public.jour_heure_court(v_rdv.starts_at)
        || ' : il est considéré comme tenu. La relance redevient la prochaine action.'
    end,
    new.occurred_at - interval '1 millisecond',
    false,
    false,
    v_rdv.id
  );
  return new;
end $$;
revoke all on function public.activities_debrief_implicite() from public, anon, authenticated;


-- ------------------------------------------------------------
-- 3. Les compteurs — « Suivi par email » est une réponse
--
-- On a eu le décideur, qui demande l'info par mail : une RÉPONSE (décision de
-- Bora, 27/10). Pas un « intéressé » — on ne sait pas encore. « Pas décroché »
-- (`sans_reponse`) reste un appel sans réponse. Le corps est celui de la 031,
-- à une ligne près (repérée « 033 »). Recopie : lib/crm/compteurs.ts, même jeu
-- de cas (compteurs.cas.json). `create or replace` garde les droits de la 031
-- (service_role seul).
-- ------------------------------------------------------------

create or replace function public.compteurs_pour(p_users uuid[], p_debut date, p_fin date)
returns table (
  user_id uuid,
  appels integer,
  reponses integer,
  interesses integer,
  rdv integer,
  essais integer,
  numeros integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with bornes as (
    select (p_debut::timestamp at time zone 'Europe/Brussels') as d,
           (p_fin::timestamp at time zone 'Europe/Brussels') as f
  ),
  u as (select unnest(p_users) as id),
  a as (
    select a.author_id as id,
           count(*) as appels,
           -- 033 : suivi_email
           count(*) filter (where a.outcome in ('rappeler', 'interesse', 'suivi_email', 'refus')) as reponses,
           count(*) filter (where a.outcome in ('interesse', 'rappeler')) as interesses
      from public.activities a, bornes b
     where a.author_id = any(p_users)
       and not coalesce(a.is_draft, false)
       and a.outcome is not null
       and a.meeting_id is null
       and a.occurred_at >= b.d and a.occurred_at < b.f
     group by a.author_id
  ),
  m as (
    select coalesce(m.created_by, m.owner_id) as id, count(*) as rdv
      from public.meetings m, bornes b
     where coalesce(m.created_by, m.owner_id) = any(p_users)
       and m.kind = 'prospect'
       and m.status <> 'annule'
       and m.created_at >= b.d and m.created_at < b.f
     group by 1
  ),
  e as (
    select p.owner_id as id, count(*) as essais
      from public.prospects p, bornes b
     where p.owner_id = any(p_users)
       and p.essai_gratuit_at >= b.d and p.essai_gratuit_at < b.f
     group by 1
  ),
  n as (
    select p.created_by as id, count(*) as numeros
      from public.prospects p, bornes b
     where p.created_by = any(p_users)
       and p.created_at >= b.d and p.created_at < b.f
     group by 1
  )
  select u.id,
         coalesce(a.appels, 0)::int,
         coalesce(a.reponses, 0)::int,
         coalesce(a.interesses, 0)::int,
         coalesce(m.rdv, 0)::int,
         coalesce(e.essais, 0)::int,
         coalesce(n.numeros, 0)::int
    from u
    left join a on a.id = u.id
    left join m on m.id = u.id
    left join e on e.id = u.id
    left join n on n.id = u.id;
$$;

comment on function public.compteurs_pour(uuid[], date, date) is
  'La règle de comptage (031, 033) — appels, réponses (rappeler · intéressé · suivi par email · refus), intéressés, RDV, essais, numéros sur [début, fin) en dates de Bruxelles. Recopie : lib/crm/compteurs.ts. Service_role seul.';
