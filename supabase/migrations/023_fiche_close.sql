-- ============================================================
-- 023 — Une fiche close ne réclame jamais rien (23 septembre 2026)
--
-- LA RÈGLE, en une phrase :
--   « Une fiche gagne ou perdu ne réclame jamais rien. Elle affiche seulement
--     ce que l'utilisateur a lui-même planifié. »
--
-- Ce que le système RÉCLAME, c'est le débrief d'un rendez-vous passé : sur une
-- fiche close, il disparaît. Ce que l'utilisateur a PLANIFIÉ — un rendez-vous
-- à venir (installation, formation, onboarding) et une relance ouverte
-- (« rappeler dans 6 mois ») — reste visible exactement comme sur une fiche
-- ouverte, y compris en retard. `perdu` sert aussi de vivier (l'enum n'a pas
-- d'étape « à rappeler plus tard ») : supprimer ses relances effacerait des
-- rappels volontaires.
--
-- Le défaut corrigé : la 022 ne regardait pas l'étape. Garage Boetendael,
-- gagné, affichait en permanence « À débriefer — RDV du 02/09 ».
--
-- Trois pièces :
--   1. `prochaine_action_de(fiche, étape)` — LA règle, écrite une seule fois,
--      avec la seule différence de la 023 : sur une fiche close, un rendez-vous
--      qui a commencé ne compte plus. `recalc_next_action` la lit ; rien d'autre
--      ne change dans la règle de la 022.
--   2. Un trigger BEFORE UPDATE OF status : changer l'étape recalcule dans la
--      MÊME écriture (il pose NEW.next_action_*). Il n'émet aucun UPDATE, donc
--      il ne peut pas se ré-entrer. Avant lui, rien ne recalculait au
--      changement d'étape : l'ancienne valeur survivait.
--   3. Une tâche horaire (pg_cron, comme la relève mail) : « a commencé »
--      dépend de l'HEURE, et la base ne recalcule qu'à un événement. Un RDV
--      d'installation à venir sur une fiche gagnée deviendra passé sans
--      qu'aucune ligne ne bouge ; la tâche recalcule ces fiches-là, et
--      seulement elles. Entre deux passages, l'affichage applique la même règle
--      (`lireProchaineAction`, lib/crm/prochaineAction.ts).
--
-- Migration compatible avec le code déjà en production (celui de la 022) :
-- aucune colonne ajoutée ni retirée, seules les valeurs de next_action_* des
-- fiches closes changent. Réversible : remettre le corps 022 de
-- `recalc_next_action`, supprimer le trigger et la tâche planifiée.
-- ============================================================

-- ---------- 1. La règle, une seule fois ----------
create or replace function public.prochaine_action_de(
  p_prospect uuid,
  p_statut   public.prospect_status,
  out o_at   timestamptz,
  out o_kind text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_close boolean := coalesce(p_statut in ('gagne', 'perdu'), false);
  v_rdv   timestamptz;
  v_rel   timestamptz;
begin
  if p_prospect is null then return; end if;

  -- Un rendez-vous vivant compte — passé compris, il attend alors son débrief.
  -- Sauf sur une fiche CLOSE : là, seul un rendez-vous À VENIR compte (le
  -- débrief est ce que le système réclame ; une fiche close ne réclame rien).
  select min(m.starts_at) into v_rdv
    from public.meetings m
   where m.prospect_id = p_prospect and m.kind = 'prospect' and public.rdv_vivant(m.status)
     and (not v_close or m.starts_at > now());

  -- Une relance ouverte compte toujours, y compris en retard, y compris sur
  -- une fiche close : c'est l'utilisateur qui l'a posée.
  select min(t.due_at) into v_rel
    from public.tasks t
   where t.prospect_id = p_prospect and t.status = 'a_faire';

  if v_rel is not null and (v_rdv is null or v_rel < v_rdv) then
    o_at := v_rel;  o_kind := 'relance';
  elsif v_rdv is not null then
    o_at := v_rdv;  o_kind := 'rendez_vous';
  end if;
end $$;
revoke all on function public.prochaine_action_de(uuid, public.prospect_status)
  from public, anon, authenticated;

-- Seul écrivain de next_action_* hors changement d'étape (voir 2). Même
-- signature, mêmes appelants (triggers tasks et meetings de la 022).
create or replace function public.recalc_next_action(p_prospect uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_statut public.prospect_status;
  v_at     timestamptz;
  v_kind   text;
begin
  if p_prospect is null then return; end if;
  select p.status into v_statut from public.prospects p where p.id = p_prospect;
  if not found then return; end if;

  select d.o_at, d.o_kind into v_at, v_kind
    from public.prochaine_action_de(p_prospect, v_statut) d;

  update public.prospects p
     set next_action_at = v_at, next_action_kind = v_kind
   where p.id = p_prospect
     and (p.next_action_at, p.next_action_kind) is distinct from (v_at, v_kind);
end $$;
revoke all on function public.recalc_next_action(uuid) from public, anon, authenticated;

comment on column public.prospects.next_action_at is
  'La prochaine action, c''est le prochain rendez-vous de la fiche tant qu''il n''est pas '
  'débriefé ; sinon, sa relance la plus proche (une relance posée après le rendez-vous et '
  'tombant avant lui passe devant). Une fiche gagnée ou perdue ne réclame jamais rien : '
  'seuls ses rendez-vous À VENIR et ses relances ouvertes comptent (023). Calculée par '
  'prochaine_action_de, jamais écrite ailleurs.';

-- ---------- 2. Changer l'étape recalcule, dans la même écriture ----------
-- BEFORE et non AFTER : il pose NEW.next_action_* au lieu d'émettre un UPDATE,
-- donc il ne se ré-entre pas, et la ligne renvoyée à l'appelant (PostgREST
-- `return=representation`) est déjà juste. Security definer : il doit voir
-- TOUTES les relances et tous les RDV de la fiche, pas seulement ceux que la
-- RLS montre à celui qui change l'étape.
create or replace function public.prospects_etape_prochaine_action()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select d.o_at, d.o_kind into new.next_action_at, new.next_action_kind
    from public.prochaine_action_de(new.id, new.status) d;
  return new;
end $$;
revoke all on function public.prospects_etape_prochaine_action() from public, anon, authenticated;

drop trigger if exists prospects_etape_prochaine_action on public.prospects;
create trigger prospects_etape_prochaine_action
  before update of status on public.prospects
  for each row
  when (old.status is distinct from new.status)
  execute function public.prospects_etape_prochaine_action();

-- ---------- 3. Le temps qui passe, sur les fiches closes ----------
-- Seules les fiches closes dont la prochaine action est un RDV qui a commencé :
-- sur une fiche ouverte, un RDV passé RESTE la prochaine action (« à
-- débriefer ») — il n'y a rien à recalculer. Renvoie le nombre de fiches
-- recalculées.
create or replace function public.recalc_fiches_closes_echues()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer := 0;
  r record;
begin
  for r in
    select p.id from public.prospects p
     where p.status in ('gagne', 'perdu')
       and p.next_action_kind = 'rendez_vous'
       and p.next_action_at <= now()
  loop
    perform public.recalc_next_action(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.recalc_fiches_closes_echues() from public, anon, authenticated;

-- Toutes les heures, à la 7e minute (hors de l'heure pile). Même nom = même
-- tâche : rejouer la migration ne la duplique pas.
select cron.schedule(
  'prochaine-action-fiches-closes',
  '7 * * * *',
  $cron$select public.recalc_fiches_closes_echues()$cron$
);

-- ---------- 4. Reprise ----------
-- Par la règle, sur TOUTE la base (pas d'identifiant écrit à la main). Aucune
-- relance ni aucun rendez-vous n'est touché : seules les valeurs de
-- next_action_* des fiches closes peuvent changer.
select public.recalc_next_action(p.id) from public.prospects p;
