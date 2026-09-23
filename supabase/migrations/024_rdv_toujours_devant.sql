-- ============================================================
-- 024 — Un rendez-vous à venir est TOUJOURS la prochaine action (23 septembre 2026)
--
-- LA RÈGLE DE BORA, en une phrase :
--   « Tant qu'une fiche a un rendez-vous à venir, c'est lui la prochaine
--     action. Toujours. »
--
-- La 022 (et la 023 qui en a repris le calcul) portait une exception : une
-- relance posée après un rendez-vous et datée AVANT lui « passait devant »
-- (le cas « confirmer la veille »). Elle venait d'une mauvaise lecture : la
-- relance d'Alain docteur n'était pas un « confirmer la veille » voulu par
-- Bora, c'est une tâche planifiée de suivi qui l'avait re-datée toute seule le
-- 21/09 — Bora avait déjà confirmé le rendez-vous. L'exception est retirée.
--
-- Ce qui change, et seulement ça : dans `prochaine_action_de`, un rendez-vous
-- vivant qui compte l'emporte sur toute relance, quelle que soit sa date.
--   · Fiche OUVERTE : tout rendez-vous vivant compte — à venir, c'est lui la
--     prochaine action ; passé et non débriefé, il reste « À débriefer »
--     (garde-fou de la 022, à ne pas affaiblir : une relance en retard ne le
--     fait plus basculer en « en retard » au moment où il faut débriefer).
--   · Fiche CLOSE (gagne / perdu) : seul un rendez-vous À VENIR compte (023,
--     inchangé) ; sans lui, la relance la plus proche, même en retard.
--   · Sans rendez-vous qui compte : la relance ouverte la plus proche.
-- Une relance datée avant le rendez-vous RESTE UNE TÂCHE : rien ne la clôt ni
-- ne la déplace ici, elle remonte dans « À appeler » le jour venu (la zone lit
-- `tasks`, pas `next_action_*`). Elle ne remplace simplement plus jamais le
-- rendez-vous sur la fiche ni dans la liste.
--
-- Inchangé : la clôture des relances d'avant à la POSE d'un rendez-vous
-- (trigger `meetings_prochaine_action`, 022) ; `recalc_next_action` et le
-- trigger d'étape (023), qui appellent cette fonction ; la tâche horaire des
-- fiches closes (023) — sur une fiche ouverte, le calcul ne dépend plus de
-- l'heure du tout.
--
-- Les recettes 022 et 023 encodent l'ancienne exception (cas 2 de la 022,
-- cas G4 de la 023) : elles restent des recettes HISTORIQUES de leur
-- migration, pas des tests de non-régression après la 024.
--
-- Migration compatible avec le code en production : aucune colonne ajoutée ni
-- retirée, seules les valeurs de next_action_* changent sur les fiches qui ont
-- à la fois un rendez-vous qui compte et une relance datée avant lui.
-- Réversible : remettre le corps 023 de `prochaine_action_de` et recalculer.
-- ============================================================

-- ---------- 1. La règle ----------
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

  -- Le rendez-vous qui compte : vivant — passé compris sur une fiche ouverte
  -- (il attend son débrief), À VENIR seulement sur une fiche close (023).
  select min(m.starts_at) into v_rdv
    from public.meetings m
   where m.prospect_id = p_prospect and m.kind = 'prospect' and public.rdv_vivant(m.status)
     and (not v_close or m.starts_at > now());

  -- S'il existe, c'est LUI la prochaine action — toujours (024).
  if v_rdv is not null then
    o_at := v_rdv;  o_kind := 'rendez_vous';
    return;
  end if;

  -- Sinon, la relance ouverte la plus proche, y compris en retard, y compris
  -- sur une fiche close : c'est l'utilisateur qui l'a posée.
  select min(t.due_at) into v_rel
    from public.tasks t
   where t.prospect_id = p_prospect and t.status = 'a_faire';

  if v_rel is not null then
    o_at := v_rel;  o_kind := 'relance';
  end if;
end $$;
revoke all on function public.prochaine_action_de(uuid, public.prospect_status)
  from public, anon, authenticated;

comment on column public.prospects.next_action_at is
  'La prochaine action, c''est le prochain rendez-vous de la fiche tant qu''il n''est pas '
  'débriefé ; sinon, sa relance la plus proche. Un rendez-vous à venir est TOUJOURS la '
  'prochaine action : une relance datée avant lui reste une tâche (« À appeler ») mais ne '
  'le remplace jamais (024). Une fiche gagnée ou perdue ne réclame jamais rien : seuls ses '
  'rendez-vous À VENIR et ses relances ouvertes comptent (023). Calculée par '
  'prochaine_action_de, jamais écrite ailleurs.';

-- ---------- 2. Reprise ----------
-- Par la règle, sur TOUTE la base. Aucune relance, aucun rendez-vous, aucune
-- ligne de journal n'est touché : seules les valeurs de next_action_* peuvent
-- changer.
select public.recalc_next_action(p.id) from public.prospects p;
