-- ============================================================
-- Recette 022 — corps (assertions). NE S'EXÉCUTE PAS SEUL.
--
-- Assemblé par supabase/recettes/022_assembler.sh :
--   1. baseline (même transaction, juste avant la migration) ;
--   2. la migration 022 VERBATIM ;
--   3. ce corps ;
--   4. une exception finale qui porte le rapport ET garantit le rollback.
-- Rien n'est jamais validé : la production ressort intacte (revérifiée à part).
--
-- Les cas portent les MÊMES noms que lib/crm/prochaineAction.test.ts.
-- Les dates de rendez-vous sont fixes (octobre / novembre 2026) : à rejouer
-- avant le 1er octobre 2026, ou à décaler.
-- ============================================================

create function pg_temp.verifie(p_nom text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $v$
begin
  if coalesce(p_ok, false) then
    perform set_config('recette.ok', (coalesce(nullif(current_setting('recette.ok', true), ''), '0')::int + 1)::text, true);
    perform set_config('recette.log', coalesce(current_setting('recette.log', true), '') || E'\n OK    ' || p_nom, true);
  else
    perform set_config('recette.ko', (coalesce(nullif(current_setting('recette.ko', true), ''), '0')::int + 1)::text, true);
    perform set_config('recette.log', coalesce(current_setting('recette.log', true), '') || E'\n FAUTE ' || p_nom || coalesce(' — ' || p_detail, ''), true);
  end if;
end $v$;

do $recette$
declare
  bora    constant uuid := 'b3fdb505-76b0-4541-84ec-21b330afe58d';
  collins constant uuid := 'fc088df7-6bd5-4d28-b10a-417483964a9f';
  p1 uuid; p2 uuid; p3 uuid; p5 uuid; p5b uuid; p6 uuid; p7 uuid; p8 uuid; p8b uuid;
  p9 uuid; p10 uuid; p11 uuid; p12 uuid; p13 uuid;
  m1 uuid; m2 uuid; m3 uuid; m5 uuid; m5b uuid; m6a uuid; m6b uuid; m7 uuid; m8 uuid; m8b uuid;
  m9 uuid; m10 uuid; m11 uuid; m12 uuid; m13 uuid;
  t1 uuid; t2 uuid; t3 uuid; t5 uuid; t5b uuid; t6 uuid; t7 uuid; t8 uuid; t9 uuid; t9b uuid;
  t10 uuid; t11 uuid; t12 uuid; t13 uuid;
  r public.tasks;
  n int; n2 int;
  v_at timestamptz; v_kind text; v_bool boolean;
  vieux constant timestamptz := now() - interval '3 days';   -- posée AVANT le RDV
  lundi_5   constant timestamptz := '2026-10-05 10:00+00';   -- lundi 12h Bruxelles
  mardi_6_9h constant timestamptz := '2026-10-06 07:00+00';  -- mardi 09:00 Bruxelles
begin
  -- ==========================================================================
  -- A. Reprise de l'existant (la migration vient de tourner sur la vraie base)
  -- ==========================================================================
  select count(*) into n from public.prospects p join base_prospects b on b.id = p.id
   where p.next_action_at is distinct from b.next_action_at;
  select count(*) into n2 from public.prospects p join base_prospects b on b.id = p.id
   where p.next_action_at is distinct from b.next_action_at
     and not exists (select 1 from public.meetings m
                      where m.prospect_id = p.id and m.kind = 'prospect' and public.rdv_vivant(m.status));
  perform pg_temp.verifie('reprise : seules des fiches à RDV vivant changent de next_action_at',
    n2 = 0, format('%s fiches changées, dont %s sans RDV vivant', n, n2));
  perform set_config('recette.log', current_setting('recette.log', true)
    || E'\n  info  fiches dont next_action_at change à la reprise : ' || n, true);

  select count(*) into n from public.tasks t join base_tasks b on b.id = t.id
   where t.due_at is distinct from b.due_at or t.status is distinct from b.status;
  perform set_config('recette.log', current_setting('recette.log', true)
    || E'\n  info  relances re-datées par la reprise : ' || n, true);

  -- L'invariant sur TOUTE la base : aucune relance posée sans connaître le RDV
  -- ne tombe encore avant un RDV vivant à venir (hors gagné / perdu).
  select count(*) into n
    from public.tasks t
    join public.meetings m on m.prospect_id = t.prospect_id and m.kind = 'prospect'
                          and public.rdv_vivant(m.status) and m.starts_at > now()
    join public.prospects p on p.id = t.prospect_id and p.status not in ('gagne','perdu')
   where t.status = 'a_faire' and not public.en_sommeil(t)
     and t.due_at < m.starts_at and t.updated_at < m.created_at;
  perform pg_temp.verifie('reprise : invariant tenu sur toute la base', n = 0, n || ' relance(s) en conflit');

  select count(*) into n from public.prospects
   where (next_action_at is null) <> (next_action_kind is null);
  perform pg_temp.verifie('reprise : next_action_kind posé partout où next_action_at l''est', n = 0, n::text);

  -- Alain docteur : sa relance du 25 a été re-datée le 21/09, APRÈS la pose
  -- du RDV (19/09) — une relance « posée en connaissant le RDV » : la règle
  -- validée (arbitrage 3) ne la reporte PAS.
  select next_action_at, next_action_kind into v_at, v_kind
    from public.prospects where id = 'ed8c33f1-001a-4336-93a5-04274bbe5cd0';
  perform set_config('recette.log', current_setting('recette.log', true)
    || E'\n  info  Alain docteur après reprise : ' || coalesce(v_at::text, 'null') || ' / ' || coalesce(v_kind, 'null'), true);
  -- Garage Boetendael : gagné, RDV reporté du 02/09 jamais débriefé.
  select next_action_at, next_action_kind into v_at, v_kind
    from public.prospects where id = 'b9fb9f7b-3125-4603-bbbe-d5d53d3c7573';
  perform set_config('recette.log', current_setting('recette.log', true)
    || E'\n  info  Garage Boetendael après reprise : ' || coalesce(v_at::text, 'null') || ' / ' || coalesce(v_kind, 'null'), true);

  -- ==========================================================================
  -- B. Le calendrier
  -- ==========================================================================
  perform pg_temp.verifie('jour ouvré : RDV lundi 05/10 → mardi 06/10 09:00 Bruxelles',
    public.premier_jour_ouvre_apres(lundi_5) = mardi_6_9h);
  perform pg_temp.verifie('jour ouvré : RDV vendredi 09/10 → lundi 12/10 09:00',
    public.premier_jour_ouvre_apres('2026-10-09 10:00+00') = '2026-10-12 07:00+00');
  perform pg_temp.verifie('jour ouvré : samedi → lundi',
    public.premier_jour_ouvre_apres('2026-10-10 10:00+00') = '2026-10-12 07:00+00');
  perform pg_temp.verifie('jour ouvré : en hiver, 09:00 = 08:00 UTC',
    public.premier_jour_ouvre_apres('2026-11-06 10:00+00') = '2026-11-09 08:00+00');
  perform pg_temp.verifie('jour ouvré : RDV à 23h30 Bruxelles, compte le jour de Bruxelles',
    public.premier_jour_ouvre_apres('2026-10-05 21:30+00') = mardi_6_9h);

  -- ==========================================================================
  -- Fixtures : des fiches à Bora, étape « contacte »
  -- ==========================================================================
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P1', bora, 'contacte') returning id into p1;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P2', bora, 'contacte') returning id into p2;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P3', bora, 'contacte') returning id into p3;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P5', bora, 'rendez_vous') returning id into p5;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P5b', bora, 'rendez_vous') returning id into p5b;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P6', bora, 'contacte') returning id into p6;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P7', bora, 'contacte') returning id into p7;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P8', bora, 'gagne') returning id into p8;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P8b', bora, 'perdu') returning id into p8b;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P9', bora, 'contacte') returning id into p9;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P10', bora, 'contacte') returning id into p10;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P11', bora, 'contacte') returning id into p11;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P12', bora, 'contacte') returning id into p12;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P13', collins, 'contacte') returning id into p13;

  -- ==========================================================================
  -- 1. rdv_pose_relance_avant_reportee
  -- ==========================================================================
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p1, 'Relancer P1', '2026-10-01 07:00+00', bora, bora, vieux, vieux) returning id into t1;
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p1;
  perform pg_temp.verifie('1. avant le RDV : la relance est la prochaine action',
    v_at = '2026-10-01 07:00+00' and v_kind = 'relance', v_at || ' / ' || v_kind);

  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p1, 'prospect', 'RDV P1', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m1;

  select * into r from public.tasks where id = t1;
  perform pg_temp.verifie('1. rdv_pose_relance_avant_reportee : reportée au mardi 06/10 09:00',
    r.due_at = mardi_6_9h, r.due_at::text);
  perform pg_temp.verifie('1. …devenue le FILET du RDV', r.meeting_id = m1);
  perform pg_temp.verifie('1. …pas supprimée : toujours ouverte', r.status = 'a_faire');
  perform pg_temp.verifie('1. …elle dort', public.en_sommeil(r));
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p1;
  perform pg_temp.verifie('1. la fiche : RDV le 05/10, type rendez_vous',
    v_at = lundi_5 and v_kind = 'rendez_vous', v_at || ' / ' || v_kind);

  -- ==========================================================================
  -- 2. rdv_pose_relance_apres_intacte
  -- ==========================================================================
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p2, 'Relancer P2', '2026-10-20 07:00+00', bora, bora, vieux, vieux) returning id into t2;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p2, 'prospect', 'RDV P2', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m2;
  select * into r from public.tasks where id = t2;
  perform pg_temp.verifie('2. rdv_pose_relance_apres_intacte : date inchangée',
    r.due_at = '2026-10-20 07:00+00', r.due_at::text);
  perform pg_temp.verifie('2. …pas un filet', r.meeting_id is null);
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p2;
  perform pg_temp.verifie('2. la fiche : le RDV passe devant', v_at = lundi_5 and v_kind = 'rendez_vous');

  -- ==========================================================================
  -- 3. rdv_reporte_filet_suit
  -- ==========================================================================
  update public.meetings set starts_at = '2026-10-09 10:00+00', ends_at = '2026-10-09 11:00+00', status = 'reporte'
   where id = m1;
  select * into r from public.tasks where id = t1;
  perform pg_temp.verifie('3. rdv_reporte_filet_suit : RDV au vendredi 09/10 → filet au lundi 12/10',
    r.due_at = '2026-10-12 07:00+00', r.due_at::text);
  perform pg_temp.verifie('3. …toujours son filet, toujours endormi', r.meeting_id = m1 and public.en_sommeil(r));
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p1;
  perform pg_temp.verifie('3. la fiche suit le RDV reporté', v_at = '2026-10-09 10:00+00' and v_kind = 'rendez_vous');

  -- Reporter AU-DELÀ d'une relance qui existait avant le RDV : elle tombe
  -- maintenant avant lui, elle est reportée à son tour.
  update public.meetings set starts_at = '2026-10-22 10:00+00', ends_at = '2026-10-22 11:00+00', status = 'reporte'
   where id = m2;
  select * into r from public.tasks where id = t2;
  perform pg_temp.verifie('3. report au-delà d''une relance pré-existante : elle devient filet (ven. 23/10)',
    r.due_at = '2026-10-23 07:00+00' and r.meeting_id = m2, r.due_at || ' / ' || coalesce(r.meeting_id::text, 'null'));

  -- ==========================================================================
  -- 4. rdv_annule_filet_reveille (+ honoré sans suite)
  -- ==========================================================================
  update public.meetings set status = 'annule', debriefed_at = now() where id = m1;
  select * into r from public.tasks where id = t1;
  perform pg_temp.verifie('4. rdv_annule_filet_reveille : réveillé au premier jour ouvré',
    r.due_at = public.premier_jour_ouvre_apres(now()) and r.status = 'a_faire', r.due_at::text);
  perform pg_temp.verifie('4. …éveillé, garde la trace de son RDV', not public.en_sommeil(r) and r.meeting_id = m1);
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p1;
  perform pg_temp.verifie('4. la fiche repart sur sa relance', v_at = r.due_at and v_kind = 'relance');
  select status into v_kind from public.prospects where id = p1;
  perform pg_temp.verifie('4. l''étape ne recule pas (le trigger n''y touche pas)', v_kind = 'contacte');

  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p3, 'Relancer P3', '2026-10-02 07:00+00', bora, bora, vieux, vieux) returning id into t3;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p3, 'prospect', 'RDV P3', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m3;
  update public.meetings set status = 'honore', debriefed_at = now() where id = m3;
  select * into r from public.tasks where id = t3;
  perform pg_temp.verifie('4. honoré sans suite : le filet se réveille aussi (« Ça s''est fait » à UN tap)',
    r.due_at = public.premier_jour_ouvre_apres(now()) and not public.en_sommeil(r));

  -- ==========================================================================
  -- 5. rdv_passe_non_debriefe
  -- ==========================================================================
  -- État d'une fiche le surlendemain d'un RDV non débriefé : RDV passé
  -- « prévu », filet échu. (On ne voyage pas dans le temps : on pose l'état.)
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p5, 'prospect', 'RDV P5', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', bora)
  returning id into m5;
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, meeting_id)
  values (p5, 'Relancer P5', now() - interval '1 day', bora, bora, m5) returning id into t5;
  select * into r from public.tasks where id = t5;
  perform pg_temp.verifie('5. rdv_passe_non_debriefe : le filet échu DORT', public.en_sommeil(r));
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p5;
  perform pg_temp.verifie('5. la fiche : type rendez_vous (à débriefer), pas relance en retard',
    v_kind = 'rendez_vous' and v_at < now(), v_at || ' / ' || v_kind);
  -- La requête EXACTE de la zone 1 du tableau de bord (en retard).
  select count(*) into n from public.tasks t
   where t.prospect_id = p5 and t.status = 'a_faire' and not public.en_sommeil(t) and t.due_at < now();
  perform pg_temp.verifie('5. zone « À appeler » : n''y figure PAS', n = 0);
  -- La requête EXACTE de la zone « Rendez-vous à débriefer » (corrigée).
  select count(*) into n from public.meetings_visibles m
   where m.prospect_id = p5 and m.ends_at < now() and m.status in ('prevu','confirme','reporte') and m.debriefed_at is null;
  perform pg_temp.verifie('5. zone « à débriefer » : y figure', n = 1);

  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by, status)
  values (bora, p5b, 'prospect', 'RDV P5b', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', bora, 'reporte')
  returning id into m5b;
  select count(*) into n from public.meetings_visibles m
   where m.id = m5b and m.ends_at < now() and m.status in ('prevu','confirme','reporte') and m.debriefed_at is null;
  select count(*) into n2 from public.meetings_visibles m
   where m.id = m5b and m.ends_at < now() and m.status in ('prevu','confirme') and m.debriefed_at is null;
  perform pg_temp.verifie('5. RDV REPORTÉ puis passé : dans « à débriefer » (l''ancien filtre le perdait)',
    n = 1 and n2 = 0, format('nouveau=%s ancien=%s', n, n2));

  -- ==========================================================================
  -- 6. plusieurs_rdv_le_plus_proche
  -- ==========================================================================
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p6, 'Relancer P6', '2026-10-01 07:00+00', bora, bora, vieux, vieux) returning id into t6;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p6, 'prospect', 'RDV P6 loin', '2026-10-12 10:00+00', '2026-10-12 11:00+00', bora) returning id into m6a;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p6, 'prospect', 'RDV P6 proche', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m6b;
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p6;
  perform pg_temp.verifie('6. plusieurs_rdv_le_plus_proche : c''est le 05/10 qui compte',
    v_at = lundi_5 and v_kind = 'rendez_vous', v_at::text);
  select count(*) into n from public.tasks t where t.prospect_id = p6 and t.status = 'a_faire' and not public.en_sommeil(t);
  perform pg_temp.verifie('6. …aucune relance éveillée ne le concurrence', n = 0);
  update public.meetings set status = 'honore', debriefed_at = now() where id = m6b;
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p6;
  perform pg_temp.verifie('6. le proche débriefé : le suivant prend la main', v_at = '2026-10-12 10:00+00' and v_kind = 'rendez_vous');

  -- ==========================================================================
  -- 7. rdv_perso_hors_regle
  -- ==========================================================================
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p7, 'Relancer P7', '2026-10-01 07:00+00', bora, bora, vieux, vieux) returning id into t7;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, null, 'perso', 'Perso', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m7;
  -- Un « perso » qui porterait quand même une fiche (l'interface n'en crée pas).
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p7, 'perso', 'Perso sur fiche', lundi_5, lundi_5 + interval '1 hour', bora);
  select * into r from public.tasks where id = t7;
  perform pg_temp.verifie('7. rdv_perso_hors_regle : la relance ne bouge pas', r.due_at = '2026-10-01 07:00+00' and r.meeting_id is null);
  select next_action_kind into v_kind from public.prospects where id = p7;
  perform pg_temp.verifie('7. …la fiche reste sur sa relance', v_kind = 'relance');

  -- ==========================================================================
  -- 8. fiche_gagnee_ou_perdue
  -- ==========================================================================
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p8, 'Relancer P8', '2026-10-01 07:00+00', bora, bora, vieux, vieux) returning id into t8;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p8, 'prospect', 'RDV client gagné', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m8;
  select * into r from public.tasks where id = t8;
  perform pg_temp.verifie('8. fiche_gagnee_ou_perdue : aucun filet posé (gagné)', r.due_at = '2026-10-01 07:00+00' and r.meeting_id is null);
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p8b, 'prospect', 'RDV perdu', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m8b;
  update public.meetings set starts_at = '2026-10-07 10:00+00', ends_at = '2026-10-07 11:00+00' where id = m8b;
  select count(*) into n from public.tasks where prospect_id = p8b;
  perform pg_temp.verifie('8. …perdu : aucune relance créée, même au report', n = 0);
  update public.meetings set status = 'annule', debriefed_at = now() where id = m8b;
  select count(*) into n from public.tasks where prospect_id = p8b;
  perform pg_temp.verifie('8. …ni à la clôture', n = 0);

  -- ==========================================================================
  -- 9. relance_posee_apres_le_rdv_non_reportee (arbitrage 3 de Bora)
  -- ==========================================================================
  -- Le RDV existe depuis deux jours ; hier, on a posé « confirmer la veille ».
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by, created_at)
  values (bora, p9, 'prospect', 'RDV P9', lundi_5, lundi_5 + interval '1 hour', bora, now() - interval '2 days')
  returning id into m9;
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p9, 'Confirmer le RDV', '2026-10-04 07:00+00', bora, bora, now() - interval '1 day', now() - interval '1 day')
  returning id into t9;
  select * into r from public.tasks where id = t9;
  perform pg_temp.verifie('9. relance_posee_apres_le_rdv_non_reportee : pas reportée',
    r.due_at = '2026-10-04 07:00+00' and r.meeting_id is null);
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p9;
  perform pg_temp.verifie('9. …la fiche affiche CETTE relance comme prochaine action (le RDV ensuite)',
    v_at = '2026-10-04 07:00+00' and v_kind = 'relance', v_at || ' / ' || v_kind);
  -- Même quand on DÉPLACE ensuite le RDV : elle a été posée en le connaissant.
  update public.meetings set starts_at = '2026-10-07 10:00+00', ends_at = '2026-10-07 11:00+00', status = 'reporte' where id = m9;
  select * into r from public.tasks where id = t9;
  perform pg_temp.verifie('9. …ni quand le RDV est déplacé', r.due_at = '2026-10-04 07:00+00' and r.meeting_id is null);
  -- Contrôle NÉGATIF sur la même fiche : une relance posée AVANT le RDV, elle,
  -- est bien reportée quand on le déplace — le test demande un vrai changement.
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p9, 'Ancienne relance P9', '2026-10-10 07:00+00', bora, bora, now() - interval '5 days', now() - interval '5 days')
  returning id into t9b;
  update public.meetings set starts_at = '2026-10-14 10:00+00', ends_at = '2026-10-14 11:00+00' where id = m9;
  select * into r from public.tasks where id = t9b;
  perform pg_temp.verifie('9. contrôle : la relance d''AVANT le RDV est, elle, reportée (jeu. 15/10)',
    r.due_at = '2026-10-15 07:00+00' and r.meeting_id = m9, r.due_at::text);
  select * into r from public.tasks where id = t9;
  perform pg_temp.verifie('9. …et « confirmer la veille » toujours intacte', r.due_at = '2026-10-04 07:00+00' and r.meeting_id is null);

  -- ==========================================================================
  -- 10. Un re-datage HUMAIN détache le filet
  -- ==========================================================================
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p10, 'Relancer P10', '2026-10-01 07:00+00', bora, bora, vieux, vieux) returning id into t10;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p10, 'prospect', 'RDV P10', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m10;
  update public.tasks set due_at = '2026-10-03 07:00+00' where id = t10;
  select * into r from public.tasks where id = t10;
  perform pg_temp.verifie('10. re-datée à la main : ce n''est plus un filet', r.meeting_id is null and not public.en_sommeil(r));
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p10;
  perform pg_temp.verifie('10. …elle passe devant le RDV, voulue', v_at = '2026-10-03 07:00+00' and v_kind = 'relance');
  perform pg_temp.verifie('10. le drapeau de report ne fuit pas hors du trigger',
    coalesce(current_setting('celya.report_rdv', true), '') <> 'on');

  -- ==========================================================================
  -- BOUT EN BOUT : poser, vérifier UNE action, débriefer, vérifier UNE action
  -- ==========================================================================
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p11, 'Relancer P11', '2026-10-01 07:00+00', bora, bora, vieux, vieux) returning id into t11;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p11, 'prospect', 'RDV P11', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m11;
  select count(*) into n from public.tasks t
   where t.prospect_id = p11 and t.status = 'a_faire' and not public.en_sommeil(t) and t.due_at < lundi_5;
  select next_action_kind into v_kind from public.prospects where id = p11;
  perform pg_temp.verifie('bout en bout : RDV posé → UNE prochaine action, le RDV', n = 0 and v_kind = 'rendez_vous');
  -- Le débrief « Ça s'est fait » + « +3 j » : ce que fait cloturerRendezVous.
  update public.meetings set status = 'honore', debriefed_at = now() where id = m11;
  update public.tasks set due_at = '2026-10-08 07:00+00' where id = t11;   -- la suite choisie
  select count(*) into n from public.tasks t where t.prospect_id = p11 and t.status = 'a_faire' and not public.en_sommeil(t);
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p11;
  perform pg_temp.verifie('bout en bout : débriefé → UNE prochaine action, la suite choisie',
    n = 1 and v_at = '2026-10-08 07:00+00' and v_kind = 'relance', format('%s ouvertes, %s / %s', n, v_at, v_kind));
  perform pg_temp.verifie('bout en bout : la suite est une relance voulue, plus un filet',
    (select meeting_id is null from public.tasks where id = t11));

  -- ==========================================================================
  -- C. Par le chemin de l'ÉCRAN : client authentifié, RLS active
  -- ==========================================================================
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p12, 'Relancer P12', '2026-10-01 07:00+00', bora, bora, vieux, vieux) returning id into t12;
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p13, 'Relancer P13', '2026-10-01 07:00+00', collins, collins, vieux, vieux) returning id into t13;

  perform set_config('request.jwt.claims', json_build_object('sub', bora, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p12, 'prospect', 'RDV P12', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m12;
  select public.en_sommeil(t) into v_bool from public.tasks t where t.id = t12;
  execute 'reset role';
  select * into r from public.tasks where id = t12;
  perform pg_temp.verifie('écran (Bora, RLS) : le RDV reporte la relance', r.due_at = mardi_6_9h and r.meeting_id = m12);
  perform pg_temp.verifie('écran (Bora, RLS) : en_sommeil lisible par authenticated', v_bool);

  perform set_config('request.jwt.claims', json_build_object('sub', collins, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p13, 'prospect', 'RDV P13', lundi_5, lundi_5 + interval '1 hour', collins) returning id into m13;
  -- Collins ne voit pas la relance de P12 (fiche de Bora) : en_sommeil n'ouvre rien.
  select count(*) into n from public.tasks t where t.id = t12;
  execute 'reset role';
  select * into r from public.tasks where id = t13;
  perform pg_temp.verifie('écran (Collins, commercial) : le RDV sur SA fiche reporte SA relance', r.due_at = mardi_6_9h and r.meeting_id = m13);
  perform pg_temp.verifie('écran (Collins) : la relance de Bora reste invisible', n = 0);

  -- /equipe : un filet échu qui dort n'est pas « en retard » (P5).
  perform set_config('request.jwt.claims', json_build_object('sub', bora, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select o.relances_en_retard into n from public.admin_team_overview(null) o where o.user_id = bora;
  execute 'reset role';
  select count(*) into n2 from public.tasks k where k.assignee_id = bora and k.status = 'a_faire' and k.due_at < now();
  perform pg_temp.verifie('/equipe : les filets endormis (dont P5) ne comptent pas en retard',
    n = (select count(*) from public.tasks k where k.assignee_id = bora and k.status = 'a_faire'
          and k.due_at < now() and not public.en_sommeil(k))
    and n2 - n >= 1, format('compté %s, brut %s', n, n2));
end $recette$;
