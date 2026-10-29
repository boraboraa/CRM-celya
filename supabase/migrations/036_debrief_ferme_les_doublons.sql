-- 036 — Débriefer un rendez-vous ferme TOUS les autres RDV passés de la fiche
-- (29/10/2026, décision de Bora).
--
-- API CAR 3000 avait deux RDV en attente, le 26/09 et le 28/09 (un doublon
-- posé fin septembre). Bora a débriefé celui du 26/09 (« intéressé — à
-- rappeler », relance demain 11h) : l'étape et la relance ont suivi, mais la
-- fiche disait toujours « À débriefer · 28/09 » — la 027 ne fermait, au
-- passage en « honore », QUE les RDV plus ANCIENS que celui qu'on débriefe.
-- Le 28/09, plus récent, restait la prochaine action et cachait la relance.
-- Même doublon chez Nice Cars (29/09, 06/10) et Garage Vivier d'oie (24/09,
-- 25/09).
--
-- La règle devient : un RDV qui passe en « honore » (débrief explicite,
-- débrief implicite, essai gratuit — 027/033) ferme TOUS les autres RDV de
-- prospect de la fiche DÉJÀ COMMENCÉS et non débriefés, plus anciens OU plus
-- récents. Ils passent en `annule` / `remplace`, avec une ligne au journal —
-- jamais `honore` : rien ne dit qu'ils ont eu lieu (027). Inchangé : un RDV À
-- VENIR n'est jamais touché ; une annulation ne remplace rien ; fiche gagnée
-- ou perdue : rien.
--
-- Recopie TS : `rdvFermesParDebrief` (lib/crm/debrief.ts, test:debrief).
-- Recette : supabase/recettes/036.sql.
--
-- Une fonction réécrite, aucune colonne, aucun trigger créé ni supprimé : le
-- trigger `meetings_rdv_remplaces` (027) appelle déjà cette fonction.
-- Réversible : remettre le corps de la 027.
--
-- Reprise UNE fois : API CAR 3000, déjà débriefé le 29/10 via son RDV du
-- 26/09 — son RDV du 28/09 est fermé de la même façon (ligne au journal
-- comprise), datée de l'instant du débrief pour que la « dernière action » de
-- la fiche reste « Intéressé — … ». Nice Cars et Vivier d'oie se régleront au
-- prochain débrief.
--
-- APPLIQUÉE le 29/10 (recette 036.sql : 11 OK, 0 faute). La version en ligne
-- datait la ligne de reprise à now() ; corrigée à la main juste après
-- (occurred_at = debriefed_at du RDV du 26/09), ce que fait ce fichier.

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
  -- implicite, essai gratuit). Une annulation ne remplace rien.
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
       and m.starts_at <= now()                  -- jamais un RDV à venir
       -- 036 : plus de « tenu : les plus anciens seulement » — tous les RDV
       -- commencés en attente, plus anciens ou plus récents.
    returning m.id, m.starts_at
  )
  insert into public.activities
    (prospect_id, author_id, type, subject, body, occurred_at, is_draft, is_exchange, meeting_id)
  select new.prospect_id,
         v_auteur,
         'note',
         case when v_tenu and not v_pose
           then 'RDV du ' || to_char(r.starts_at at time zone 'Europe/Brussels', 'DD/MM')
                || ' clos par le débrief du RDV du '
                || to_char(new.starts_at at time zone 'Europe/Brussels', 'DD/MM')
           else 'RDV du ' || to_char(r.starts_at at time zone 'Europe/Brussels', 'DD/MM')
                || ' remplacé par le RDV du ' || public.jour_heure_court(new.starts_at)
         end,
         case when v_tenu and not v_pose
           then 'Le rendez-vous du ' || public.jour_heure_court(r.starts_at)
                || ' n''a pas été débriefé ; il est clos par le débrief du rendez-vous du '
                || public.jour_heure_court(new.starts_at) || '.'
           else 'Le rendez-vous du ' || public.jour_heure_court(r.starts_at)
                || ' n''a pas été débriefé ; il est clos, remplacé par celui du '
                || public.jour_heure_court(new.starts_at) || '.'
         end,
         now(),
         false,
         false,
         r.id
    from remplaces r;

  return new;
end $$;
revoke all on function public.meetings_rdv_remplaces() from public, anon, authenticated;

-- ---------- Reprise : API CAR 3000 ----------
-- Son RDV du 26/09 est débriefé (honore, 29/10) ; celui du 28/09 attend
-- encore. On le ferme comme le ferait la règle ci-dessus. Sans effet si la
-- fiche n'est plus dans cet état (rejouable, ne touche rien d'autre).
with fiche as (
  select p.id
    from public.prospects p
   where p.company_name = 'API CAR 3000'
     and p.status not in ('gagne', 'perdu')
), tenu as (
  select m.id, m.prospect_id, m.starts_at, m.owner_id, m.created_by, m.debriefed_at
    from public.meetings m join fiche f on f.id = m.prospect_id
   where m.kind = 'prospect' and m.status = 'honore' and m.debriefed_at is not null
   order by m.debriefed_at desc
   limit 1
), remplaces as (
  update public.meetings m
     set status = 'annule', debriefed_at = now(), debrief_issue = 'remplace'
    from tenu t
   where m.prospect_id = t.prospect_id
     and m.id <> t.id
     and m.kind = 'prospect'
     and public.rdv_vivant(m.status)
     and m.debriefed_at is null
     and m.starts_at <= now()
  returning m.id, m.starts_at, t.prospect_id, t.starts_at as tenu_at, t.debriefed_at,
            coalesce(t.created_by, t.owner_id) as auteur
)
insert into public.activities
  (prospect_id, author_id, type, subject, body, occurred_at, is_draft, is_exchange, meeting_id)
select r.prospect_id, r.auteur, 'note',
       'RDV du ' || to_char(r.starts_at at time zone 'Europe/Brussels', 'DD/MM')
         || ' clos par le débrief du RDV du ' || to_char(r.tenu_at at time zone 'Europe/Brussels', 'DD/MM'),
       'Le rendez-vous du ' || public.jour_heure_court(r.starts_at)
         || ' n''a pas été débriefé ; il est clos par le débrief du rendez-vous du '
         || public.jour_heure_court(r.tenu_at) || '.',
       r.debriefed_at, false, false, r.id   -- daté du débrief : la « dernière action » reste celle de Bora
  from remplaces r;
