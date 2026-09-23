-- ============================================================
-- Recette 023 — corps (assertions). NE S'EXÉCUTE PAS SEUL.
--
-- Assemblé par supabase/recettes/023_assembler.sh :
--   1. baseline (même transaction, juste avant la migration) ;
--   2. la migration 023 VERBATIM ;
--   3. ce corps ;
--   4. une exception finale qui porte le rapport ET garantit le rollback.
--
-- La règle : « Une fiche gagne ou perdu ne réclame jamais rien. Elle affiche
-- seulement ce que l'utilisateur a lui-même planifié. »
-- Dates RELATIVES à now() (figé pour toute la transaction) : la recette se
-- rejoue n'importe quel jour.
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

-- La prochaine action d'une fiche, en une chaîne comparable.
create function pg_temp.na(p uuid) returns text language sql as $n$
  select coalesce(next_action_kind, '∅') || ' @ ' || coalesce(next_action_at::text, '∅')
    from public.prospects where id = p;
$n$;

do $recette$
declare
  bora      constant uuid := 'b3fdb505-76b0-4541-84ec-21b330afe58d';
  collins   constant uuid := 'fc088df7-6bd5-4d28-b10a-417483964a9f';
  boetendael constant uuid := 'b9fb9f7b-3125-4603-bbbe-d5d53d3c7573';
  alain     constant uuid := 'ed8c33f1-001a-4336-93a5-04274bbe5cd0';
  zz uuid;
  futur     constant timestamptz := date_trunc('hour', now()) + interval '2 days';
  passe     constant timestamptz := date_trunc('hour', now()) - interval '2 days';
  retard    constant timestamptz := date_trunc('hour', now()) - interval '5 days';
  plus_tard constant timestamptz := date_trunc('hour', now()) + interval '10 days';
  g1 uuid; g2 uuid; g3 uuid; g4 uuid; g5 uuid; q1 uuid; q2 uuid; q3 uuid;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; c1 uuid;
  t_g4 uuid; t_q1 uuid;
  n int; n2 int;
  v_at timestamptz; v_kind text; v_txt text;
begin
  -- ==========================================================================
  -- A. Reprise de l'existant (la migration vient de tourner sur la vraie base)
  -- ==========================================================================
  perform pg_temp.verifie('reprise : aucune relance, aucun RDV, aucune ligne de journal touchés',
    (select md5(string_agg(t::text, '|' order by t.id)) from public.tasks t) = (select tasks from base_md5)
    and (select md5(string_agg(m::text, '|' order by m.id)) from public.meetings m) = (select meetings from base_md5)
    and (select md5(string_agg(a::text, '|' order by a.id)) from public.activities a) = (select activities from base_md5));

  select count(*) into n from public.prospects p join base_prospects b on b.id = p.id
   where p.status not in ('gagne', 'perdu')
     and (p.next_action_at, p.next_action_kind) is distinct from (b.next_action_at, b.next_action_kind);
  perform pg_temp.verifie('reprise : AUCUNE fiche ouverte ne change de prochaine action', n = 0, n::text);

  select count(*), string_agg(p.company_name, ', ') into n, v_txt
    from public.prospects p join base_prospects b on b.id = p.id
   where (p.next_action_at, p.next_action_kind) is distinct from (b.next_action_at, b.next_action_kind);
  perform pg_temp.info(format('fiches dont la prochaine action change à la reprise : %s (%s)', n, coalesce(v_txt, '—')));

  select count(*) into n from public.prospects
   where status in ('gagne', 'perdu') and next_action_kind = 'rendez_vous' and next_action_at <= now();
  perform pg_temp.verifie('reprise : plus AUCUNE fiche close ne réclame un débrief', n = 0, n::text);

  perform pg_temp.verifie('reprise : Garage Boetendael (gagné, RDV reporté du 02/09) → plus rien',
    pg_temp.na(boetendael) = '∅ @ ∅', pg_temp.na(boetendael));

  select id into zz from public.prospects where company_name like 'ZZ Test délivrabilité%';
  perform pg_temp.verifie('reprise : ZZ Test (perdu) garde sa relance du 15/09, en retard',
    (select next_action_at = '2026-09-15 07:00+00' and next_action_kind = 'relance'
       from public.prospects where id = zz), pg_temp.na(zz));

  perform pg_temp.verifie('reprise : Alain docteur (ouvert) garde sa relance du 25/09',
    (select next_action_at = '2026-09-25 07:00+00' and next_action_kind = 'relance'
       from public.prospects where id = alain), pg_temp.na(alain));

  -- ==========================================================================
  -- B. Les objets posés
  -- ==========================================================================
  select count(*) into n from pg_trigger
   where tgname = 'prospects_etape_prochaine_action' and tgrelid = 'public.prospects'::regclass
     and (tgtype & 2) = 2;  -- TRIGGER_TYPE_BEFORE
  perform pg_temp.verifie('déclencheur d''étape : BEFORE (pose NEW, n''émet aucun UPDATE — non ré-entrant)', n = 1);
  select count(*) into n from cron.job
   where jobname = 'prochaine-action-fiches-closes' and schedule = '7 * * * *';
  perform pg_temp.verifie('tâche horaire planifiée, une seule fois', n = 1, n::text);
  select count(*) into n from information_schema.role_routine_grants
   where routine_name in ('prochaine_action_de', 'recalc_fiches_closes_echues',
                          'prospects_etape_prochaine_action', 'recalc_next_action')
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  perform pg_temp.verifie('aucune des fonctions n''est exécutable par anon / authenticated', n = 0, n::text);

  -- ==========================================================================
  -- Fixtures
  -- ==========================================================================
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 G1', bora, 'gagne') returning id into g1;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 G2', bora, 'gagne') returning id into g2;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 G3', bora, 'gagne') returning id into g3;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 G4', bora, 'gagne') returning id into g4;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 G5', bora, 'gagne') returning id into g5;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 Q1', bora, 'perdu') returning id into q1;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 Q2', bora, 'perdu') returning id into q2;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 Q3', bora, 'perdu') returning id into q3;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 O1', bora, 'rendez_vous') returning id into o1;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 O2', bora, 'contacte') returning id into o2;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 O3', bora, 'contacte') returning id into o3;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 O4', bora, 'contacte') returning id into o4;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 O5', bora, 'contacte') returning id into o5;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-023 C1', collins, 'rendez_vous') returning id into c1;

  -- ==========================================================================
  -- C. Fiches closes
  -- ==========================================================================
  -- gagne + RDV à venir (installation) : il s'affiche.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, g1, 'prospect', 'Installation G1', futur, futur + interval '1 hour', bora);
  perform pg_temp.verifie('gagne + RDV à venir : il s''affiche',
    pg_temp.na(g1) = 'rendez_vous @ ' || futur::text, pg_temp.na(g1));

  -- gagne + RDV passé non débriefé : rien.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, g2, 'prospect', 'RDV G2', passe, passe + interval '1 hour', bora);
  perform pg_temp.verifie('gagne + RDV passé non débriefé : rien',
    pg_temp.na(g2) = '∅ @ ∅', pg_temp.na(g2));

  -- gagne + RDV passé + relance à venir (« rappeler dans 6 mois ») : la relance.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, g3, 'prospect', 'RDV G3', passe, passe + interval '1 hour', bora);
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (g3, 'Suivi G3', plus_tard, bora, bora);
  perform pg_temp.verifie('gagne + RDV passé + relance planifiée : la relance, pas le débrief',
    pg_temp.na(g3) = 'relance @ ' || plus_tard::text, pg_temp.na(g3));

  -- gagne + relance posée, PUIS RDV d'installation après elle : rien n'est
  -- clôturé sur une fiche close (022), la relance passe devant.
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (g4, 'Confirmer l''installation', futur - interval '1 day', bora, bora) returning id into t_g4;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, g4, 'prospect', 'Installation G4', futur, futur + interval '1 hour', bora);
  perform pg_temp.verifie('gagne + relance puis RDV à venir : la relance n''est pas clôturée et passe devant',
    pg_temp.na(g4) = 'relance @ ' || (futur - interval '1 day')::text
    and (select status from public.tasks where id = t_g4) = 'a_faire', pg_temp.na(g4));

  -- perdu + relance ouverte EN RETARD : elle s'affiche, en retard.
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (q1, 'Rappeler Q1 dans 6 mois', retard, bora, bora) returning id into t_q1;
  perform pg_temp.verifie('perdu + relance ouverte en retard : elle s''affiche',
    pg_temp.na(q1) = 'relance @ ' || retard::text, pg_temp.na(q1));

  -- perdu + RDV passé : rien.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, q2, 'prospect', 'RDV Q2', passe, passe + interval '1 hour', bora);
  perform pg_temp.verifie('perdu + RDV passé : rien', pg_temp.na(q2) = '∅ @ ∅', pg_temp.na(q2));

  -- perdu + RDV REPORTÉ passé (la forme exacte de Boetendael) : rien.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by, status)
  values (bora, q3, 'prospect', 'RDV Q3', passe, passe + interval '1 hour', bora, 'reporte');
  perform pg_temp.verifie('perdu + RDV reporté passé : rien', pg_temp.na(q3) = '∅ @ ∅', pg_temp.na(q3));

  -- ==========================================================================
  -- D. Changement d'étape : recalcul IMMÉDIAT par le déclencheur
  -- ==========================================================================
  -- Fiche ouverte, RDV passé non débriefé : « à débriefer » (022 intacte).
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, o1, 'prospect', 'RDV O1', passe, passe + interval '1 hour', bora);
  perform pg_temp.verifie('ouverte + RDV passé non débriefé : il reste la prochaine action (022 intacte)',
    pg_temp.na(o1) = 'rendez_vous @ ' || passe::text, pg_temp.na(o1));

  -- Ouverte → gagne : plus rien, DANS la même écriture (la ligne renvoyée le dit).
  update public.prospects set status = 'gagne' where id = o1
  returning next_action_kind into v_kind;
  perform pg_temp.verifie('ouverte → gagne : recalcul immédiat, la ligne renvoyée est déjà juste',
    v_kind is null and pg_temp.na(o1) = '∅ @ ∅', pg_temp.na(o1));

  -- Et l'inverse : gagne → contacte, le débrief est de nouveau réclamé.
  update public.prospects set status = 'contacte' where id = o1;
  perform pg_temp.verifie('gagne → ouverte : le RDV passé redevient la prochaine action',
    pg_temp.na(o1) = 'rendez_vous @ ' || passe::text, pg_temp.na(o1));

  -- Ouverte avec relance en retard → perdu : la relance reste.
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (o2, 'Relancer O2', retard, bora, bora);
  update public.prospects set status = 'perdu' where id = o2;
  perform pg_temp.verifie('ouverte + relance en retard → perdu : la relance reste',
    pg_temp.na(o2) = 'relance @ ' || retard::text, pg_temp.na(o2));

  -- Ouverte avec RDV à venir → gagne : le RDV reste.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, o3, 'prospect', 'RDV O3', futur, futur + interval '1 hour', bora);
  update public.prospects set status = 'gagne' where id = o3;
  perform pg_temp.verifie('ouverte + RDV à venir → gagne : le RDV reste',
    pg_temp.na(o3) = 'rendez_vous @ ' || futur::text, pg_temp.na(o3));

  -- Une étape ouverte vers une autre : rien ne change.
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (o4, 'Relancer O4', plus_tard, bora, bora);
  v_txt := pg_temp.na(o4);
  update public.prospects set status = 'proposition' where id = o4;
  perform pg_temp.verifie('contacte → proposition : prochaine action inchangée',
    pg_temp.na(o4) = v_txt and v_txt = 'relance @ ' || plus_tard::text, pg_temp.na(o4));

  -- Personne n'écrit next_action_* à côté de la règle, même dans la même requête.
  update public.prospects set status = 'gagne', next_action_at = futur, next_action_kind = 'relance'
   where id = o5;
  perform pg_temp.verifie('écrire next_action_* avec l''étape : la règle l''emporte',
    pg_temp.na(o5) = '∅ @ ∅', pg_temp.na(o5));

  -- ==========================================================================
  -- E. Le temps qui passe : la tâche horaire
  -- ==========================================================================
  -- G5 simule une fiche close dont le RDV d'installation vient de commencer
  -- SANS qu'aucune ligne n'ait bougé : on pose l'état périmé à la main (même
  -- étape, donc sans déclencheur), puis la tâche passe.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, g5, 'prospect', 'Installation G5', passe, passe + interval '1 hour', bora);
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (g5, 'Suivi G5', plus_tard, bora, bora);
  update public.prospects set next_action_at = passe, next_action_kind = 'rendez_vous' where id = g5;
  perform pg_temp.verifie('(état périmé posé à la main)', pg_temp.na(g5) = 'rendez_vous @ ' || passe::text);
  n := public.recalc_fiches_closes_echues();
  perform pg_temp.verifie('tâche horaire : recalcule la fiche close périmée, et SEULEMENT elle',
    n = 1, n::text);
  perform pg_temp.verifie('tâche horaire : le débrief disparaît, la relance planifiée apparaît',
    pg_temp.na(g5) = 'relance @ ' || plus_tard::text, pg_temp.na(g5));
  perform pg_temp.verifie('tâche horaire : une fiche OUVERTE à RDV passé n''est pas touchée',
    pg_temp.na(o1) = 'rendez_vous @ ' || passe::text, pg_temp.na(o1));

  -- ==========================================================================
  -- F. Par le chemin de l'ÉCRAN : un commercial, RLS active
  -- ==========================================================================
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, c1, 'prospect', 'RDV C1', passe, passe + interval '1 hour', collins);
  -- Une relance posée par l'admin sur sa fiche, assignée à l'admin : le
  -- recalcul doit la voir même si la RLS de Collins la lui cachait.
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (c1, 'Suivi C1 (Bora)', plus_tard, bora, bora);
  perform pg_temp.verifie('(C1 ouverte : relance plus tard, RDV passé → le RDV d''abord)',
    pg_temp.na(c1) = 'rendez_vous @ ' || passe::text, pg_temp.na(c1));

  perform set_config('request.jwt.claims', json_build_object('sub', collins, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.prospects set status = 'gagne' where id = c1;
  get diagnostics n = row_count;
  execute 'reset role';
  perform pg_temp.verifie('écran (Collins) : il passe SA fiche en gagné',  n = 1, n::text);
  perform pg_temp.verifie('écran (Collins) : le débrief disparaît, la relance posée par Bora apparaît',
    pg_temp.na(c1) = 'relance @ ' || plus_tard::text, pg_temp.na(c1));

  perform set_config('request.jwt.claims', json_build_object('sub', collins, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.recalc_fiches_closes_echues();
    n2 := 0;
  exception when insufficient_privilege then
    n2 := 1;
  end;
  execute 'reset role';
  perform pg_temp.verifie('écran (Collins) : il ne peut pas appeler la tâche horaire (42501)', n2 = 1);
end $recette$;
