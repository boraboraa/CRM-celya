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
-- La règle : poser (ou déplacer) un RDV CLÔTURE les relances ouvertes de la
-- fiche qui tombent avant lui, À CET INSTANT, avec une ligne au journal.
-- Les cas portent les MÊMES noms que lib/crm/prochaineAction.test.ts.
-- Dates de rendez-vous fixes (octobre 2026) : à rejouer avant le 1er octobre
-- 2026, ou à décaler.
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

create function pg_temp.info(p text) returns void language sql as $i$
  select set_config('recette.log', coalesce(current_setting('recette.log', true), '') || E'\n  info  ' || p, true);
$i$;

do $recette$
declare
  bora    constant uuid := 'b3fdb505-76b0-4541-84ec-21b330afe58d';
  collins constant uuid := 'fc088df7-6bd5-4d28-b10a-417483964a9f';
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p5b uuid; p6 uuid; p7 uuid; p8 uuid; p8b uuid;
  p9 uuid; p10 uuid; p11 uuid; p12 uuid; p13 uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; m5b uuid; m9 uuid; m11 uuid; m12 uuid; m13 uuid;
  t1 uuid; t1b uuid; t2a uuid; t2b uuid; t2c uuid; t3 uuid; t7 uuid; t8 uuid; t9 uuid; t10 uuid;
  t11 uuid; t11b uuid; t12 uuid; t13 uuid;
  r public.tasks;
  n int; n2 int;
  v_at timestamptz; v_kind text; v_txt text;
  vieux constant timestamptz := now() - interval '3 days';
  lundi_5 constant timestamptz := '2026-10-05 10:00+00';   -- lundi 12h Bruxelles
begin
  -- ==========================================================================
  -- A. Reprise de l'existant (la migration vient de tourner sur la vraie base)
  -- ==========================================================================
  select count(*) into n from public.tasks t join base_tasks b on b.id = t.id
   where t.due_at is distinct from b.due_at or t.status is distinct from b.status;
  perform pg_temp.verifie('reprise : AUCUNE relance touchée (la règle vaut à la pose, pas rétroactivement)', n = 0, n::text);
  select count(*) into n from public.activities;
  perform pg_temp.verifie('reprise : aucune ligne de journal ajoutée', n = (select c from base_counts), n::text);

  select count(*) into n from public.prospects p join base_prospects b on b.id = p.id
   where p.next_action_at is distinct from b.next_action_at;
  select count(*) into n2 from public.prospects p join base_prospects b on b.id = p.id
   where p.next_action_at is distinct from b.next_action_at
     and not exists (select 1 from public.meetings m
                      where m.prospect_id = p.id and m.kind = 'prospect' and public.rdv_vivant(m.status));
  perform pg_temp.verifie('reprise : seules des fiches à RDV vivant changent de next_action_at',
    n2 = 0, format('%s changées, dont %s sans RDV vivant', n, n2));
  perform pg_temp.info('fiches dont next_action_at change à la reprise : ' || n);

  select count(*) into n from public.prospects where (next_action_at is null) <> (next_action_kind is null);
  perform pg_temp.verifie('reprise : next_action_kind posé partout où next_action_at l''est', n = 0, n::text);

  select next_action_at, next_action_kind into v_at, v_kind
    from public.prospects where id = 'ed8c33f1-001a-4336-93a5-04274bbe5cd0';
  perform pg_temp.info('Alain docteur : ' || coalesce(v_at::text, 'null') || ' / ' || coalesce(v_kind, 'null'));
  perform pg_temp.verifie('reprise : Alain docteur garde sa relance du 25/09 (posée APRÈS le RDV), le RDV ensuite',
    v_at = '2026-09-25 07:00+00' and v_kind = 'relance');
  select next_action_at, next_action_kind into v_at, v_kind
    from public.prospects where id = 'b9fb9f7b-3125-4603-bbbe-d5d53d3c7573';
  perform pg_temp.info('Garage Boetendael : ' || coalesce(v_at::text, 'null') || ' / ' || coalesce(v_kind, 'null'));

  -- ==========================================================================
  -- B. Le libellé du journal
  -- ==========================================================================
  perform pg_temp.verifie('libellé : 10:00 UTC le 28/09 → « 28/09 à 12h »',
    public.jour_heure_court('2026-09-28 10:00+00') = '28/09 à 12h', public.jour_heure_court('2026-09-28 10:00+00'));
  perform pg_temp.verifie('libellé : les minutes → « 28/09 à 14h30 »',
    public.jour_heure_court('2026-09-28 12:30+00') = '28/09 à 14h30');
  perform pg_temp.verifie('libellé : en hiver → « 01/12 à 11h »',
    public.jour_heure_court('2026-12-01 10:00+00') = '01/12 à 11h');
  perform pg_temp.verifie('libellé : minuit Bruxelles → « 05/10 à 0h » (jamais « à h »)',
    public.jour_heure_court('2026-10-04 22:00+00') = '05/10 à 0h', public.jour_heure_court('2026-10-04 22:00+00'));

  -- ==========================================================================
  -- Fixtures
  -- ==========================================================================
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P1', bora, 'contacte') returning id into p1;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P2', bora, 'contacte') returning id into p2;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P3', bora, 'contacte') returning id into p3;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-022 P4', bora, 'contacte') returning id into p4;
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
  -- 1. rdv_pose_relance_avant_cloturee
  -- ==========================================================================
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p1, 'Relancer P1', '2026-09-25 07:00+00', bora, bora, vieux, vieux) returning id into t1;
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p1, 'Relance tardive P1', '2026-10-20 07:00+00', bora, bora, vieux, vieux) returning id into t1b;
  select next_action_kind into v_kind from public.prospects where id = p1;
  perform pg_temp.verifie('1. avant le RDV : la relance est la prochaine action', v_kind = 'relance');

  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p1, 'prospect', 'RDV P1', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m1;

  select * into r from public.tasks where id = t1;
  perform pg_temp.verifie('1. rdv_pose_relance_avant_cloturee : la relance d''avant est CLÔTURÉE (annule)',
    r.status = 'annule' and r.due_at = '2026-09-25 07:00+00', r.status::text);
  select count(*), max(subject), max(body) into n, v_txt, v_kind
    from public.activities where prospect_id = p1 and subject like 'Relance annulée%';
  perform pg_temp.verifie('1. …une ligne au journal l''atteste',
    n = 1 and v_txt = 'Relance annulée : rendez-vous posé le 05/10 à 12h', format('%s ligne(s) : %s', n, v_txt));
  perform pg_temp.verifie('1. …elle nomme la relance et sa date',
    v_kind = '« Relancer P1 » (prévue le 25/09 à 9h) : le rendez-vous devient la prochaine action ; la suite se décidera au débrief.', v_kind);
  select count(*) into n from public.activities
   where prospect_id = p1 and subject like 'Relance annulée%' and (is_exchange or is_draft or type <> 'note' or author_id <> bora);
  perform pg_temp.verifie('1. …note interne (pas un échange, pas un brouillon), signée de qui a posé le RDV', n = 0);
  select * into r from public.tasks where id = t1b;
  perform pg_temp.verifie('1. la relance APRÈS le RDV n''est pas touchée', r.status = 'a_faire' and r.due_at = '2026-10-20 07:00+00');
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p1;
  perform pg_temp.verifie('1. next_action_at vaut le RDV', v_at = lundi_5 and v_kind = 'rendez_vous', v_at || ' / ' || v_kind);

  -- ==========================================================================
  -- 2. relance_posee_apres_le_rdv_non_touchee
  -- ==========================================================================
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p9, 'prospect', 'RDV P9', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m9;
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p9, 'Confirmer le RDV', '2026-10-04 07:00+00', bora, bora) returning id into t9;
  select * into r from public.tasks where id = t9;
  perform pg_temp.verifie('2. relance_posee_apres_le_rdv_non_touchee : ouverte, à sa date',
    r.status = 'a_faire' and r.due_at = '2026-10-04 07:00+00');
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p9;
  perform pg_temp.verifie('2. …c''est ELLE la prochaine action (le RDV ensuite)',
    v_at = '2026-10-04 07:00+00' and v_kind = 'relance', v_at || ' / ' || v_kind);
  -- Un geste sur le RDV qui ne le déplace pas (confirmation) ne la touche pas.
  update public.meetings set status = 'confirme' where id = m9;
  select * into r from public.tasks where id = t9;
  perform pg_temp.verifie('2. …confirmer le RDV ne la touche pas non plus', r.status = 'a_faire');
  select count(*) into n from public.activities where prospect_id = p9 and subject like 'Relance annulée%';
  perform pg_temp.verifie('2. …et rien au journal', n = 0);

  -- ==========================================================================
  -- 3. rdv_passe_non_debriefe
  -- ==========================================================================
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p5, 'prospect', 'RDV P5', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', bora)
  returning id into m5;
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p5;
  perform pg_temp.verifie('3. rdv_passe_non_debriefe : la fiche garde le RDV (passé) comme prochaine action',
    v_kind = 'rendez_vous' and v_at < now(), coalesce(v_at::text, 'null') || ' / ' || coalesce(v_kind, 'null'));
  select count(*) into n from public.tasks t where t.prospect_id = p5 and t.status = 'a_faire';
  perform pg_temp.verifie('3. …zone « À appeler » : rien ne la réclame', n = 0);
  select count(*) into n from public.meetings_visibles m
   where m.prospect_id = p5 and m.ends_at < now() and m.status in ('prevu','confirme','reporte') and m.debriefed_at is null;
  perform pg_temp.verifie('3. …zone « à débriefer » : elle y est', n = 1);
  -- RDV posé dans le passé (saisi après coup) : il ne clôture rien.
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p5b, 'Relancer P5b', now() - interval '5 days', bora, bora, vieux, vieux) returning id into t10;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by, status)
  values (bora, p5b, 'prospect', 'RDV P5b', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', bora, 'reporte')
  returning id into m5b;
  select status::text into v_txt from public.tasks where id = t10;
  perform pg_temp.verifie('3. un RDV saisi dans le passé ne clôture rien', v_txt = 'a_faire');
  select count(*) into n from public.meetings_visibles m
   where m.id = m5b and m.ends_at < now() and m.status in ('prevu','confirme','reporte') and m.debriefed_at is null;
  select count(*) into n2 from public.meetings_visibles m
   where m.id = m5b and m.ends_at < now() and m.status in ('prevu','confirme') and m.debriefed_at is null;
  perform pg_temp.verifie('3. RDV REPORTÉ puis passé : dans « à débriefer » (l''ancien filtre le perdait)',
    n = 1 and n2 = 0, format('nouveau=%s ancien=%s', n, n2));

  -- ==========================================================================
  -- 4. rdv_deplace_plus_tard_relance_cloturee
  -- ==========================================================================
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p2, 'prospect', 'RDV P2', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m2;
  -- Posées APRÈS le RDV : la veille (04/10), une après (08/10), une loin (20/10).
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p2, 'Confirmer la veille', '2026-10-04 07:00+00', bora, bora) returning id into t2a;
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p2, 'Relance du 08', '2026-10-08 07:00+00', bora, bora) returning id into t2b;
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p2, 'Relance du 20', '2026-10-20 07:00+00', bora, bora) returning id into t2c;
  -- Déplacé au vendredi 09/10 : 04/10 et 08/10 tombent désormais avant.
  update public.meetings set starts_at = '2026-10-09 10:00+00', ends_at = '2026-10-09 11:00+00', status = 'reporte'
   where id = m2;
  select count(*) into n from public.tasks where id in (t2a, t2b) and status = 'annule';
  perform pg_temp.verifie('4. rdv_deplace_plus_tard_relance_cloturee : celles qui tombent désormais avant sont clôturées',
    n = 2, n || '/2');
  select status::text into v_txt from public.tasks where id = t2c;
  perform pg_temp.verifie('4. …celle qui reste après lui n''est pas touchée', v_txt = 'a_faire');
  select count(*), max(subject) into n, v_txt from public.activities where prospect_id = p2 and subject like 'Relance annulée%';
  perform pg_temp.verifie('4. …une ligne au journal par relance, qui dit « déplacé »',
    n = 2 and v_txt = 'Relance annulée : rendez-vous déplacé au 09/10 à 12h', format('%s : %s', n, v_txt));
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p2;
  perform pg_temp.verifie('4. …la fiche suit le RDV déplacé', v_at = '2026-10-09 10:00+00' and v_kind = 'rendez_vous');
  -- Déplacé plus TÔT : rien de neuf ne tombe avant, rien n'est clôturé.
  update public.meetings set starts_at = '2026-10-07 10:00+00', ends_at = '2026-10-07 11:00+00' where id = m2;
  select status::text into v_txt from public.tasks where id = t2c;
  perform pg_temp.verifie('4. déplacé plus tôt : la relance du 20 reste ouverte', v_txt = 'a_faire');

  -- ==========================================================================
  -- 5. rdv_annule_sans_suite — le cas que le filet couvrait
  -- ==========================================================================
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p3, 'Relancer P3', '2026-09-30 07:00+00', bora, bora, vieux, vieux) returning id into t3;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p3, 'prospect', 'RDV P3', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m3;
  update public.meetings set status = 'annule', debriefed_at = now() where id = m3;
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p3;
  select count(*) into n from public.tasks where prospect_id = p3 and status = 'a_faire';
  perform pg_temp.verifie('5. rdv_annule_sans_suite : la fiche n''a PLUS de prochaine action (ni relance, ni RDV)',
    v_at is null and v_kind is null and n = 0, format('%s / %s / %s ouvertes', v_at, v_kind, n));
  select status::text into v_txt from public.prospects where id = p3;
  perform pg_temp.verifie('5. …l''étape ne recule pas (le trigger n''y touche pas)', v_txt = 'contacte');
  -- Même chose « Ça s'est fait » sans suite.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p4, 'prospect', 'RDV P4', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m4;
  update public.meetings set status = 'honore', debriefed_at = now() where id = m4;
  select next_action_at into v_at from public.prospects where id = p4;
  perform pg_temp.verifie('5. honoré sans suite : pas de prochaine action non plus', v_at is null);

  -- ==========================================================================
  -- 6. plusieurs_rdv_le_plus_proche
  -- ==========================================================================
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p6, 'prospect', 'RDV P6 loin', '2026-10-12 10:00+00', '2026-10-12 11:00+00', bora);
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p6, 'prospect', 'RDV P6 proche', lundi_5, lundi_5 + interval '1 hour', bora);
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p6;
  perform pg_temp.verifie('6. plusieurs_rdv_le_plus_proche : c''est le 05/10 qui compte', v_at = lundi_5 and v_kind = 'rendez_vous');

  -- ==========================================================================
  -- 7. rdv_perso_hors_regle
  -- ==========================================================================
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p7, 'Relancer P7', '2026-10-01 07:00+00', bora, bora, vieux, vieux) returning id into t7;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, null, 'perso', 'Perso', lundi_5, lundi_5 + interval '1 hour', bora);
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p7, 'perso', 'Perso sur fiche', lundi_5, lundi_5 + interval '1 hour', bora);
  select status::text into v_txt from public.tasks where id = t7;
  select next_action_kind into v_kind from public.prospects where id = p7;
  perform pg_temp.verifie('7. rdv_perso_hors_regle : rien clôturé, la fiche reste sur sa relance',
    v_txt = 'a_faire' and v_kind = 'relance');

  -- ==========================================================================
  -- 8. fiche_gagnee_ou_perdue
  -- ==========================================================================
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p8, 'Relancer P8', '2026-10-01 07:00+00', bora, bora, vieux, vieux) returning id into t8;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p8, 'prospect', 'RDV client gagné', lundi_5, lundi_5 + interval '1 hour', bora);
  select status::text into v_txt from public.tasks where id = t8;
  select count(*) into n from public.activities where prospect_id = p8;
  perform pg_temp.verifie('8. fiche_gagnee_ou_perdue : gagné, rien clôturé ni tracé', v_txt = 'a_faire' and n = 0);
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p8b, 'prospect', 'RDV perdu', lundi_5, lundi_5 + interval '1 hour', bora);
  select count(*) into n from public.activities where prospect_id = p8b;
  perform pg_temp.verifie('8. …perdu, rien tracé', n = 0);

  -- ==========================================================================
  -- BOUT EN BOUT : poser → UNE action ; débriefer + suite → UNE action
  -- ==========================================================================
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by, created_at, updated_at)
  values (p11, 'Relancer P11', '2026-09-25 07:00+00', bora, bora, vieux, vieux) returning id into t11;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p11, 'prospect', 'RDV P11', lundi_5, lundi_5 + interval '1 hour', bora) returning id into m11;
  select count(*) into n from public.tasks where prospect_id = p11 and status = 'a_faire';
  select next_action_kind into v_kind from public.prospects where id = p11;
  perform pg_temp.verifie('bout en bout : RDV posé → aucune relance ouverte, la prochaine action est le RDV',
    n = 0 and v_kind = 'rendez_vous');
  -- Débrief « Ça s'est fait » + « +3 j » : ce que fait cloturerRendezVous.
  update public.meetings set status = 'honore', debriefed_at = now() where id = m11;
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p11, 'Relancer P11', '2026-10-08 07:00+00', bora, bora) returning id into t11b;
  select count(*) into n from public.tasks where prospect_id = p11 and status = 'a_faire';
  select next_action_at, next_action_kind into v_at, v_kind from public.prospects where id = p11;
  perform pg_temp.verifie('bout en bout : débriefé → UNE prochaine action, la suite choisie',
    n = 1 and v_at = '2026-10-08 07:00+00' and v_kind = 'relance', format('%s ouvertes, %s / %s', n, v_at, v_kind));

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
  select count(*) into n from public.activities where prospect_id = p12 and subject like 'Relance annulée%';
  execute 'reset role';
  select status::text into v_txt from public.tasks where id = t12;
  perform pg_temp.verifie('écran (Bora, RLS) : la relance est clôturée', v_txt = 'annule');
  perform pg_temp.verifie('écran (Bora, RLS) : il lit la ligne de journal', n = 1);

  perform set_config('request.jwt.claims', json_build_object('sub', collins, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p13, 'prospect', 'RDV P13', lundi_5, lundi_5 + interval '1 hour', collins) returning id into m13;
  select count(*) into n from public.activities where prospect_id = p13 and subject like 'Relance annulée%' and author_id = collins;
  select count(*) into n2 from public.activities where prospect_id = p12;
  execute 'reset role';
  select status::text into v_txt from public.tasks where id = t13;
  perform pg_temp.verifie('écran (Collins, commercial) : SA relance est clôturée, la trace est signée de lui',
    v_txt = 'annule' and n = 1);
  perform pg_temp.verifie('écran (Collins) : le journal de la fiche de Bora reste invisible', n2 = 0);
end $recette$;
