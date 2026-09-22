-- ============================================================
-- 022 — Une fiche n'a jamais qu'UNE prochaine action (22 septembre 2026)
--
-- Deux systèmes prétendaient chacun dire « la prochaine action » : les
-- relances (`tasks`) et l'agenda (`meetings`). Un seul écrivait dans la fiche :
-- `prospects.next_action_at` était recalculé par le trigger `sync_next_action`
-- sur `tasks`, JAMAIS sur `meetings`. L'agenda (017) a été ajouté comme un
-- objet à part et la fiche n'a jamais été rebranchée dessus — une fiche en
-- « Rendez-vous » le 28/09 pouvait réclamer un appel « en retard » le 25/09,
-- puis, le RDV passé, remonter en retard au lieu de demander son débrief.
--
-- LA RÈGLE, en une phrase (elle est aussi en COMMENT sur la colonne) :
--   « La prochaine action, c'est le prochain rendez-vous de la fiche tant
--     qu'il n'est pas débriefé ; sinon, sa relance la plus proche. »
--
-- ET UNE SEULE MÉCANIQUE (décision de Bora, 22/09) : après un rendez-vous, une
-- relance n'a plus de sens — tout dépend de ce qu'il a donné, et c'est le
-- débrief qui décide de la suite. Donc, AU MOMENT où un rendez-vous est posé
-- (ou déplacé) sur une fiche, les relances ouvertes qui tombent AVANT lui sont
-- CLÔTURÉES (`annule`) — pas reportées, pas mises en sommeil — et chacune
-- laisse une ligne au journal (« Relance annulée : rendez-vous posé le 28/09 à
-- 12h ») : rien ne disparaît en silence.
--
-- La règle ne regarde que les relances qui existent À CET INSTANT : une
-- relance posée ensuite (« confirmer la veille ») n'est jamais touchée, par
-- construction, sans comparaison d'horodatages. Elle passe alors devant le
-- rendez-vous : la fiche dit la relance, puis le RDV.
--
-- Ce qui empêche une fiche de disparaître quand on oublie de débriefer : un
-- rendez-vous PASSÉ et non débriefé reste la prochaine action (`rendez_vous`),
-- affiché « À débriefer », jamais « en retard ».
--
-- Pourquoi en SQL : le connecteur MCP écrit en service_role sans passer par
-- les écrans. Une règle dans les server actions serait contournée par le
-- premier chemin oublié ; une règle à l'affichage laisserait la donnée fausse.
-- Le CHOIX humain (la suite d'un débrief) reste en TypeScript.
--
-- Migration ADDITIVE : une colonne nullable, des fonctions, des triggers. Le
-- code déjà en production ignore la colonne et lit next_action_at comme avant.
-- Le code du même lot, lui, EXIGE `next_action_kind` : migration d'abord,
-- déploiement ensuite (même ordre que 018).
-- ============================================================

-- ---------- 1. Colonne ----------
alter table public.prospects
  add column if not exists next_action_kind text;
alter table public.prospects
  drop constraint if exists prospects_next_action_kind_connu;
alter table public.prospects
  add constraint prospects_next_action_kind_connu
  check (next_action_kind is null or next_action_kind in ('rendez_vous', 'relance'));

comment on column public.prospects.next_action_at is
  'La prochaine action, c''est le prochain rendez-vous de la fiche tant qu''il n''est pas '
  'débriefé ; sinon, sa relance la plus proche (une relance posée après le rendez-vous et '
  'tombant avant lui passe devant). Tenue par recalc_next_action (022), jamais écrite ailleurs.';
comment on column public.prospects.next_action_kind is
  '''rendez_vous'' ou ''relance'' : ce que désigne next_action_at. Un rendez-vous passé '
  'et non débriefé reste ''rendez_vous'' — « à débriefer », jamais « en retard ».';

-- ---------- 2. Fonctions d'appui ----------

-- Un rendez-vous est VIVANT tant qu'il n'est ni honoré ni annulé — y compris
-- passé (il attend alors son débrief) et y compris reporté.
create or replace function public.rdv_vivant(p_status public.meeting_status)
returns boolean language sql immutable set search_path = public as $$
  select p_status in ('prevu', 'confirme', 'reporte');
$$;

-- LA définition de la prochaine action. Seul écrivain de next_action_at et
-- next_action_kind. N'écrit que si quelque chose change.
create or replace function public.recalc_next_action(p_prospect uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rdv timestamptz;
  v_rel timestamptz;
  v_at  timestamptz;
  v_kind text;
begin
  if p_prospect is null then return; end if;

  select min(m.starts_at) into v_rdv
    from public.meetings m
   where m.prospect_id = p_prospect and m.kind = 'prospect' and public.rdv_vivant(m.status);

  select min(t.due_at) into v_rel
    from public.tasks t
   where t.prospect_id = p_prospect and t.status = 'a_faire';

  -- La relance ne passe devant que si elle tombe STRICTEMENT avant le RDV —
  -- ce ne peut être qu'une relance posée après lui (« confirmer la veille ») :
  -- celles qui existaient ont été clôturées à sa pose.
  if v_rel is not null and (v_rdv is null or v_rel < v_rdv) then
    v_at := v_rel;  v_kind := 'relance';
  elsif v_rdv is not null then
    v_at := v_rdv;  v_kind := 'rendez_vous';
  end if;

  update public.prospects p
     set next_action_at = v_at, next_action_kind = v_kind
   where p.id = p_prospect
     and (p.next_action_at, p.next_action_kind) is distinct from (v_at, v_kind);
end $$;
revoke all on function public.recalc_next_action(uuid) from public, anon, authenticated;

-- « 28/09 à 12h » / « 28/09 à 12h30 », heure de Bruxelles — pour le journal.
create or replace function public.jour_heure_court(p_ts timestamptz)
returns text language sql stable set search_path = public as $$
  select to_char(p_ts at time zone 'Europe/Brussels', 'DD/MM') || ' à '
      || to_char(p_ts at time zone 'Europe/Brussels', 'FMHH24')
      || 'h'
      || case when to_char(p_ts at time zone 'Europe/Brussels', 'MI') = '00' then ''
              else to_char(p_ts at time zone 'Europe/Brussels', 'MI') end;
$$;

-- ---------- 3. Trigger sur tasks : recalcul ----------
-- L'ancienne ET la nouvelle fiche (une relance déplacée d'une fiche à l'autre
-- laissait l'ancienne avec une date morte).
create or replace function public.sync_next_action()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'DELETE' then
    perform public.recalc_next_action(new.prospect_id);
  end if;
  if tg_op <> 'INSERT' and old.prospect_id is distinct from new.prospect_id then
    perform public.recalc_next_action(old.prospect_id);
  end if;
  if tg_op = 'DELETE' then
    perform public.recalc_next_action(old.prospect_id);
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.sync_next_action() from public, anon, authenticated;
-- Le trigger tasks_sync_next_action (001) pointe déjà sur cette fonction.

-- ---------- 4. Trigger sur meetings : clôture + recalcul ----------
create or replace function public.meetings_prochaine_action()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_etape public.prospect_status;
  v_pose  boolean;
  v_quand text;
begin
  -- Poser / déplacer un RDV (fiche, vivant, à venir) : les relances ouvertes
  -- qui tombent AVANT lui, À CET INSTANT, sont clôturées et tracées.
  if tg_op in ('INSERT', 'UPDATE')
     and new.kind = 'prospect' and new.prospect_id is not null
     and public.rdv_vivant(new.status) and new.starts_at > now() then
    v_pose := tg_op = 'INSERT'
           or new.starts_at is distinct from old.starts_at
           or new.prospect_id is distinct from old.prospect_id
           or not public.rdv_vivant(old.status);
    if v_pose then
      select p.status into v_etape from public.prospects p where p.id = new.prospect_id;
      -- Gagné / perdu : on ne touche à rien.
      if v_etape is not null and v_etape not in ('gagne', 'perdu') then
        v_quand := case when tg_op = 'INSERT' then 'rendez-vous posé le '
                        else 'rendez-vous déplacé au ' end
                   || public.jour_heure_court(new.starts_at);

        with closes as (
          update public.tasks t
             set status = 'annule'
           where t.prospect_id = new.prospect_id
             and t.status = 'a_faire'
             and t.due_at < new.starts_at
          returning t.title, t.due_at
        )
        insert into public.activities
          (prospect_id, author_id, type, subject, body, occurred_at, is_draft, is_exchange)
        select new.prospect_id,
               coalesce(new.created_by, new.owner_id),
               'note',
               'Relance annulée : ' || v_quand,
               '« ' || c.title || ' » (prévue le ' || public.jour_heure_court(c.due_at)
                 || ') : le rendez-vous devient la prochaine action ; la suite se décidera au débrief.',
               now(),
               false,
               false
          from closes c;
      end if;
    end if;
  end if;

  -- Recalcul, toujours (pose, report, débrief, annulation, suppression).
  if tg_op <> 'DELETE' then
    perform public.recalc_next_action(new.prospect_id);
  end if;
  if tg_op = 'DELETE' or old.prospect_id is distinct from new.prospect_id then
    perform public.recalc_next_action(old.prospect_id);
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.meetings_prochaine_action() from public, anon, authenticated;

drop trigger if exists meetings_prochaine_action on public.meetings;
create trigger meetings_prochaine_action
  after insert or update or delete on public.meetings
  for each row execute function public.meetings_prochaine_action();

-- ---------- 5. Reprise de l'existant ----------
-- AUCUNE relance n'est clôturée : la règle se déclenche à la POSE d'un
-- rendez-vous, et les rendez-vous existants ont été posés avant elle. Clôturer
-- rétroactivement frapperait précisément les relances posées en connaissant le
-- RDV — c'est le cas du seul candidat du 22/09 (Alain docteur : relance
-- re-datée au 25/09 le 21/09 pour « confirmer la veille », RDV posé le 19/09).
-- On ne fait que recalculer, par la règle, sur TOUTE la base au moment où la
-- migration s'applique (leçon de la 017 : pas d'identifiant écrit à la main).
select public.recalc_next_action(p.id) from public.prospects p;
