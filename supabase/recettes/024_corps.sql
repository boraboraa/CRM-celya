-- ============================================================
-- Recette 024 — corps (assertions). NE S'EXÉCUTE PAS SEUL.
--
-- Assemblé par supabase/recettes/024_assembler.sh :
--   1. baseline (même transaction, juste avant la migration) ;
--   2. la migration 024 VERBATIM ;
--   3. ce corps ;
--   4. une exception finale qui porte le rapport ET garantit le rollback.
--
-- La règle : « Tant qu'une fiche a un rendez-vous à venir, c'est lui la
-- prochaine action. Toujours. » Une relance datée avant lui reste une tâche.
-- Dates RELATIVES à now() (figé pour toute la transaction) : la recette se
-- rejoue n'importe quel jour.
--
-- Les recettes 022 (cas 2) et 023 (cas G4) encodent l'ancienne exception
-- « confirmer la veille » : elles sont historiques, ne pas les rejouer comme
-- non-régression après la 024. Le cas 4 ci-dessous est l'inverse assumé du G4.
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
  bora       constant uuid := 'b3fdb505-76b0-4541-84ec-21b330afe58d';
  collins    constant uuid := 'fc088df7-6bd5-4d28-b10a-417483964a9f';
  boetendael constant uuid := 'b9fb9f7b-3125-4603-bbbe-d5d53d3c7573';
  alain      constant uuid := 'ed8c33f1-001a-4336-93a5-04274bbe5cd0';
  zz uuid;
  futur     constant timestamptz := date_trunc('hour', now()) + interval '3 days';
  avant     constant timestamptz := date_trunc('hour', now()) + interval '1 day';
  apres     constant timestamptz := date_trunc('hour', now()) + interval '10 days';
  passe     constant timestamptz := date_trunc('hour', now()) - interval '2 days';
  retard    constant timestamptz := date_trunc('hour', now()) - interval '5 days';
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p5b uuid; p6 uuid; p7 uuid;
  p8 uuid; p9 uuid; p11 uuid; c1 uuid;
  t1 uuid; t4 uuid; t6 uuid; t7 uuid; t9 uuid; t11 uuid; m11 uuid;
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

  -- Seules peuvent changer les fiches qui ont un RDV qui compte ET une relance
  -- ouverte datée avant lui.
  select count(*) into n from public.prospects p join base_prospects b on b.id = p.id
   where (p.next_action_at, p.next_action_kind) is distinct from (b.next_action_at, b.next_action_kind)
     and not exists (
       select 1 from public.meetings m join public.tasks t on t.prospect_id = m.prospect_id
        where m.prospect_id = p.id and m.kind = 'prospect' and public.rdv_vivant(m.status)
          and (p.status not in ('gagne', 'perdu') or m.starts_at > now())
          and t.status = 'a_faire' and t.due_at < m.starts_at);
  perform pg_temp.verifie('reprise : seules des fiches « RDV + relance datée avant » changent', n = 0, n::text);

  select count(*), string_agg(p.company_name, ', ') into n, v_txt
    from public.prospects p join base_prospects b on b.id = p.id
   where (p.next_action_at, p.next_action_kind) is distinct from (b.next_action_at, b.next_action_kind);
  perform pg_temp.info(format('fiches dont la prochaine action change à la reprise : %s (%s)', n, coalesce(v_txt, '—')));

  select min(m.starts_at) into v_at from public.meetings m
   where m.prospect_id = alain and m.kind = 'prospect' and public.rdv_vivant(m.status);
  perform pg_temp.verifie('reprise : Alain docteur → son rendez-vous',
    v_at is not null and pg_temp.na(alain) = 'rendez_vous @ ' || v_at::text, pg_temp.na(alain));

  select id into zz from public.prospects where company_name like 'ZZ Test délivrabilité%';
  perform pg_temp.verifie('reprise : Garage Boetendael et ZZ Test inchangés',
    (select count(*) from public.prospects p join base_prospects b on b.id = p.id
      where p.id in (boetendael, zz)
        and (p.next_action_at, p.next_action_kind) is not distinct from (b.next_action_at, b.next_action_kind)) = 2);

  select count(*) into n from public.prospects p
   where exists (select 1 from public.meetings m
                  where m.prospect_id = p.id and m.kind = 'prospect' and public.rdv_vivant(m.status)
                    and m.starts_at > now())
     and p.next_action_kind is distinct from 'rendez_vous';
  perform pg_temp.verifie('reprise : TOUTE fiche avec un RDV à venir a le RDV pour prochaine action', n = 0, n::text);

  -- ==========================================================================
  -- B. Les objets
  -- ==========================================================================
  select col_description('public.prospects'::regclass,
           (select attnum from pg_attribute where attrelid = 'public.prospects'::regclass and attname = 'next_action_at'))
    into v_txt;
  perform pg_temp.verifie('commentaire de next_action_at : plus d''exception « passe devant »',
    v_txt not like '%passe devant%' and v_txt like '%TOUJOURS%', v_txt);
  select count(*) into n from information_schema.role_routine_grants
   where routine_name = 'prochaine_action_de' and grantee in ('anon', 'authenticated', 'PUBLIC');
  perform pg_temp.verifie('prochaine_action_de : non exécutable par anon / authenticated', n = 0, n::text);
  select count(*) into n from cron.job where jobname = 'prochaine-action-fiches-closes';
  perform pg_temp.verifie('la tâche horaire de la 023 est toujours là, une fois', n = 1, n::text);

  -- ==========================================================================
  -- Fixtures
  -- ==========================================================================
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-024 P1', bora, 'contacte') returning id into p1;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-024 P2', bora, 'contacte') returning id into p2;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-024 P3', bora, 'contacte') returning id into p3;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-024 P4', bora, 'gagne') returning id into p4;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-024 P5', bora, 'gagne') returning id into p5;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-024 P5b', bora, 'perdu') returning id into p5b;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-024 P6', bora, 'rendez_vous') returning id into p6;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-024 P7', bora, 'contacte') returning id into p7;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-024 P8', bora, 'gagne') returning id into p8;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-024 P9', bora, 'contacte') returning id into p9;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-024 P11', bora, 'rendez_vous') returning id into p11;
  insert into public.prospects (company_name, owner_id, status) values ('RECETTE-024 C1', collins, 'rendez_vous') returning id into c1;

  -- ==========================================================================
  -- C. Les cas
  -- ==========================================================================
  -- 1. RDV à venir, PUIS relance datée avant lui : le RDV passe devant.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p1, 'prospect', 'RDV P1', futur, futur + interval '1 hour', bora);
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p1, 'Confirmer la veille', avant, bora, bora) returning id into t1;
  perform pg_temp.verifie('1. RDV à venir + relance datée avant : le RDV est la prochaine action',
    pg_temp.na(p1) = 'rendez_vous @ ' || futur::text, pg_temp.na(p1));
  perform pg_temp.verifie('1. …la relance reste une tâche ouverte, rien n''est clôturé ni tracé',
    (select status from public.tasks where id = t1) = 'a_faire'
    and not exists (select 1 from public.activities where prospect_id = p1 and subject like 'Relance annulée%'));

  -- 2. RDV à venir + relance datée après : le RDV.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p2, 'prospect', 'RDV P2', futur, futur + interval '1 hour', bora);
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p2, 'Suivi après RDV', apres, bora, bora);
  perform pg_temp.verifie('2. RDV à venir + relance datée après : le RDV',
    pg_temp.na(p2) = 'rendez_vous @ ' || futur::text, pg_temp.na(p2));

  -- 3. Relance seule : elle.
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p3, 'Relance seule', avant, bora, bora);
  perform pg_temp.verifie('3. relance seule : elle est la prochaine action',
    pg_temp.na(p3) = 'relance @ ' || avant::text, pg_temp.na(p3));

  -- 4. Fiche close + RDV à venir (installation) + relance datée avant : le RDV
  --    (inverse assumé du cas G4 de la 023). Rien n'est clôturé sur une fiche close.
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p4, 'Confirmer l''installation', avant, bora, bora) returning id into t4;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p4, 'prospect', 'Installation P4', futur, futur + interval '1 hour', bora);
  perform pg_temp.verifie('4. gagné + RDV à venir + relance avant : le RDV, la relance reste ouverte',
    pg_temp.na(p4) = 'rendez_vous @ ' || futur::text
    and (select status from public.tasks where id = t4) = 'a_faire', pg_temp.na(p4));

  -- 5. Fiche close + RDV passé : 023 intacte.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p5, 'prospect', 'RDV P5', passe, passe + interval '1 hour', bora);
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p5, 'Rappeler dans 6 mois', apres, bora, bora);
  perform pg_temp.verifie('5. gagné + RDV passé + relance : la relance (023)',
    pg_temp.na(p5) = 'relance @ ' || apres::text, pg_temp.na(p5));
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p5b, 'prospect', 'RDV P5b', passe, passe + interval '1 hour', bora);
  perform pg_temp.verifie('5. perdu + RDV passé seul : rien (023)', pg_temp.na(p5b) = '∅ @ ∅', pg_temp.na(p5b));

  -- 6. Fiche ouverte, RDV passé non débriefé + relance EN RETARD datée avant :
  --    « À débriefer » reste la prochaine action, jamais « en retard ».
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p6, 'Relance oubliée', retard, bora, bora) returning id into t6;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p6, 'prospect', 'RDV P6', passe, passe + interval '1 hour', bora);
  perform pg_temp.verifie('6. ouverte, RDV passé non débriefé + relance en retard avant : le RDV à débriefer',
    pg_temp.na(p6) = 'rendez_vous @ ' || passe::text
    and (select status from public.tasks where id = t6) = 'a_faire', pg_temp.na(p6));

  -- 7. La mécanique de la 022 tient : relance d'abord, RDV posé ensuite →
  --    la relance est clôturée et tracée.
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p7, 'Relancer P7', avant, bora, bora) returning id into t7;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p7, 'prospect', 'RDV P7', futur, futur + interval '1 hour', bora);
  perform pg_temp.verifie('7. 022 intacte : poser un RDV clôture la relance d''avant et le trace',
    (select status from public.tasks where id = t7) = 'annule'
    and (select count(*) from public.activities where prospect_id = p7 and subject like 'Relance annulée%') = 1
    and pg_temp.na(p7) = 'rendez_vous @ ' || futur::text, pg_temp.na(p7));

  -- 8. Tâche horaire (023) : fiche close au RDV commencé, état périmé posé à
  --    la main → recalculée, et SEULEMENT elle.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p8, 'prospect', 'Installation P8', passe, passe + interval '1 hour', bora);
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p8, 'Suivi P8', apres, bora, bora);
  update public.prospects set next_action_at = passe, next_action_kind = 'rendez_vous' where id = p8;
  n := public.recalc_fiches_closes_echues();
  perform pg_temp.verifie('8. tâche horaire : 1 fiche recalculée, la relance apparaît',
    n = 1 and pg_temp.na(p8) = 'relance @ ' || apres::text, n || ' / ' || pg_temp.na(p8));
  perform pg_temp.verifie('8. …la fiche ouverte au RDV passé n''est pas touchée',
    pg_temp.na(p6) = 'rendez_vous @ ' || passe::text, pg_temp.na(p6));

  -- 9. Changement d'étape : ouverte → gagné avec RDV à venir + relance avant.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p9, 'prospect', 'RDV P9', futur, futur + interval '1 hour', bora);
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p9, 'Relance P9', avant, bora, bora) returning id into t9;
  update public.prospects set status = 'gagne' where id = p9;
  perform pg_temp.verifie('9. ouverte → gagné, RDV à venir + relance avant : toujours le RDV',
    pg_temp.na(p9) = 'rendez_vous @ ' || futur::text, pg_temp.na(p9));

  -- 11. Débrief : le RDV clos, la relance en retard d'avant reprend la main.
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p11, 'Relance P11', retard, bora, bora) returning id into t11;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p11, 'prospect', 'RDV P11', passe, passe + interval '1 hour', bora) returning id into m11;
  perform pg_temp.verifie('11. avant le débrief : le RDV à débriefer',
    pg_temp.na(p11) = 'rendez_vous @ ' || passe::text, pg_temp.na(p11));
  update public.meetings set status = 'honore', debriefed_at = now() where id = m11;
  perform pg_temp.verifie('11. après « Ça s''est fait » : la relance en retard redevient la prochaine action',
    pg_temp.na(p11) = 'relance @ ' || retard::text, pg_temp.na(p11));

  -- ==========================================================================
  -- D. Par le chemin de l'ÉCRAN : Collins pose une relance avant SON RDV
  -- ==========================================================================
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, c1, 'prospect', 'RDV C1', futur, futur + interval '1 hour', collins);
  perform set_config('request.jwt.claims', json_build_object('sub', collins, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (c1, 'Relance de Collins', avant, collins, collins);
  get diagnostics n = row_count;
  execute 'reset role';
  perform pg_temp.verifie('écran (Collins) : poser une relance avant son RDV reste possible (humain)', n = 1, n::text);
  perform pg_temp.verifie('écran (Collins) : la prochaine action reste son RDV',
    pg_temp.na(c1) = 'rendez_vous @ ' || futur::text, pg_temp.na(c1));

  -- ==========================================================================
  -- E. Le refus du connecteur MCP (`planifier_relance`) lit le prochain RDV à
  --    venir par la même requête que `prochainRdvAVenir` (lib/crm/agenda.ts) :
  --    on vérifie ici qu'elle trouve le bon rendez-vous — le message, lui, est
  --    testé en TypeScript (npm run test:prochaine-action, section 10).
  -- ==========================================================================
  select min(m.starts_at) into v_at from public.meetings m
   where m.prospect_id = p1 and m.kind = 'prospect'
     and m.status in ('prevu', 'confirme', 'reporte') and m.starts_at > now();
  perform pg_temp.verifie('MCP : la requête du refus trouve le RDV à venir de P1', v_at = futur, coalesce(v_at::text, 'null'));
  select min(m.starts_at) into v_at from public.meetings m
   where m.prospect_id = p6 and m.kind = 'prospect'
     and m.status in ('prevu', 'confirme', 'reporte') and m.starts_at > now();
  perform pg_temp.verifie('MCP : un RDV passé ne déclenche pas le refus (P6)', v_at is null, coalesce(v_at::text, 'null'));
end $recette$;
