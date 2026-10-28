-- ============================================================
-- Recette 033 — corps (assertions). NE S'EXÉCUTE PAS SEUL.
--
-- Assemblé par supabase/recettes/033_assembler.sh :
--   1. baseline (même transaction, juste avant la migration) ;
--   2. la migration 033 VERBATIM ;
--   3. ce corps ;
--   4. une exception finale qui porte le rapport ET garantit le rollback.
--
-- Comptes RÉELS (27/10/2026) : Bora (admin), Collins (encadre les quatre
-- étudiants), Nathan (responsable de 100% MOTO), Hakim (étudiant).
-- Toutes les fiches de sonde s'appellent « ZZ Recette 033 … ».
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

create function pg_temp.etre(p_qui uuid) returns void language plpgsql as $e$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_qui, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $e$;
create function pg_temp.redevenir() returns void language plpgsql as $r$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $r$;

create function pg_temp.etat(p_sql text) returns text language plpgsql as $s$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $s$;

create function pg_temp.lignes(p_sql text) returns int language plpgsql as $l$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
exception when others then
  return -1;
end $l$;

do $recette$
declare
  bora    constant uuid := 'b3fdb505-76b0-4541-84ec-21b330afe58d';
  collins constant uuid := 'fc088df7-6bd5-4d28-b10a-417483964a9f';
  nathan  constant uuid := 'f9d07f3f-daea-46b8-ae6c-b9380444be4b';
  hakim   constant uuid := 'afa7eb3d-b3cd-45d9-bac7-ae437757e0c9';
  f uuid; f2 uuid; f3 uuid; f4 uuid;
  m_recent uuid; m_vieux uuid; m_futur uuid; m uuid; m2 uuid; m_bora uuid;
  moto uuid; moto_rdv uuid; moto_essai timestamptz;
  v text; n int;
  avant jsonb; apres jsonb;
  lundi date := (date_trunc('week', (now() at time zone 'Europe/Brussels')))::date;
begin
  -- ==========================================================================
  -- 4. La REPRISE (jouée par la migration) — mesurée AVANT toute sonde
  -- ==========================================================================
  select p.id, p.essai_gratuit_at into moto, moto_essai
    from public.prospects p where p.company_name = '100% MOTO' and p.status::text = 'essai_gratuit';
  select b.id into moto_rdv from base_meetings b
   where b.prospect_id = moto and b.debriefed_at is null and b.status::text in ('prevu', 'confirme', 'reporte')
   order by b.id limit 1;
  perform pg_temp.info('100% MOTO : fiche ' || coalesce(moto::text, '∅') || ', RDV en attente ' || coalesce(moto_rdv::text, '∅'));
  select count(*) into n
    from public.meetings mm join base_meetings b on b.id = mm.id
   where (mm.status, mm.debrief_issue) is distinct from (b.status, b.debrief_issue);
  perform pg_temp.verifie('reprise : UN seul rendez-vous a changé', n = 1, n::text);
  perform pg_temp.verifie('reprise : c''est celui de 100% MOTO, clos honore / essai',
    (select (status::text, debrief_issue, debriefed_at is not null) = ('honore', 'essai', true)
       from public.meetings where id = moto_rdv));
  perform pg_temp.verifie('reprise : UNE ligne au journal, rattachée au RDV, datée de l''entrée en essai',
    (select count(*) from public.activities a
      where a.prospect_id = moto and a.meeting_id = moto_rdv and a.occurred_at = moto_essai
        and a.subject like '% clos : fiche passée en essai gratuit') = 1);
  perform pg_temp.verifie('reprise : une seule ligne de journal créée, toutes fiches confondues',
    (select count(*) from public.activities) = (select act_n from base_md5) + 1);
  perform pg_temp.verifie('reprise : 100% MOTO ne réclame plus son débrief (prochaine action ≠ RDV commencé)',
    (select not (coalesce(next_action_kind, '') = 'rendez_vous' and next_action_at <= now())
       from public.prospects where id = moto));
  perform pg_temp.verifie('reprise : aucune relance touchée',
    (select md5(string_agg(t::text, '|' order by t.id)) from public.tasks t) = (select tasks from base_md5));
  perform pg_temp.verifie('reprise : aucune autre colonne d''aucune fiche',
    (select md5(string_agg((to_jsonb(p) - 'next_action_at' - 'next_action_kind' - 'updated_at' - 'last_contact_at')::text, '|' order by p.id))
       from public.prospects p) = (select prospects from base_md5));

  -- ==========================================================================
  -- 1–2. Les contraintes
  -- ==========================================================================
  insert into public.prospects (company_name, owner_id, created_by)
    values ('ZZ Recette 033 Contraintes', hakim, hakim) returning id into f;
  v := pg_temp.etat(format($$insert into public.activities (prospect_id, author_id, type, subject, outcome, is_exchange)
                             values (%L, %L, 'note', 'ZZ Recette 033', 'suivi_email', true)$$, f, hakim));
  perform pg_temp.verifie('résultat d''appel : « suivi_email » accepté', v = 'OK', v);
  v := pg_temp.etat(format($$insert into public.activities (prospect_id, author_id, type, subject, outcome)
                             values (%L, %L, 'note', 'ZZ Recette 033', 'pas_decroche')$$, f, hakim));
  perform pg_temp.verifie('résultat d''appel : une valeur inconnue refusée (23514) — « Pas décroché » reste sans_reponse', v = '23514', v);
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, status, created_by)
    values (hakim, f, 'prospect', 'ZZ Recette 033 issue', now() - interval '30 days', now() - interval '30 days' + interval '1 hour', 'annule', hakim)
    returning id into m;
  perform pg_temp.verifie('débrief : les issues « suivi_email » et « pas_decroche » acceptées',
    pg_temp.etat(format($$update public.meetings set debrief_issue = 'suivi_email' where id = %L$$, m)) = 'OK'
    and pg_temp.etat(format($$update public.meetings set debrief_issue = 'pas_decroche' where id = %L$$, m)) = 'OK');
  v := pg_temp.etat(format($$update public.meetings set debrief_issue = 'peut_etre' where id = %L$$, m));
  perform pg_temp.verifie('débrief : une issue inconnue refusée (23514)', v = '23514', v);

  -- ==========================================================================
  -- 3. Les compteurs — « Suivi par email » est une réponse
  -- ==========================================================================
  select to_jsonb(x) - 'user_id' into avant from public.compteurs_pour(array[hakim], lundi, lundi + 7) x;
  insert into public.activities (prospect_id, author_id, type, subject, outcome, is_exchange, occurred_at)
    values (f, hakim, 'note', 'ZZ Recette 033 a', 'suivi_email', true, now()),
           (f, hakim, 'note', 'ZZ Recette 033 b', 'sans_reponse', false, now());
  select to_jsonb(x) - 'user_id' into apres from public.compteurs_pour(array[hakim], lundi, lundi + 7) x;
  -- (la ligne « suivi_email » des contraintes, plus haut, est déjà dans « avant »)
  perform pg_temp.verifie('compteurs : suivi par email = un appel ET une réponse, pas un intéressé ; pas décroché = un appel seul',
    (apres->>'appels')::int - (avant->>'appels')::int = 2
    and (apres->>'reponses')::int - (avant->>'reponses')::int = 1
    and (apres->>'interesses')::int - (avant->>'interesses')::int = 0,
    avant::text || ' → ' || apres::text);

  -- ==========================================================================
  -- 2bis. Le débrief IMPLICITE apprend « Suivi par email »
  -- ==========================================================================
  insert into public.prospects (company_name, owner_id, created_by)
    values ('ZZ Recette 033 Implicite', hakim, hakim) returning id into f2;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, status, created_by)
    values (hakim, f2, 'prospect', 'ZZ Recette 033 RDV', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'prevu', hakim)
    returning id into m;
  insert into public.activities (prospect_id, author_id, type, subject, outcome, is_exchange, occurred_at)
    values (f2, hakim, 'note', 'ZZ Recette 033 pas décroché', 'sans_reponse', false, now());
  perform pg_temp.verifie('implicite : « Pas décroché » après le RDV ne ferme RIEN',
    (select status::text from public.meetings where id = m) = 'prevu');
  insert into public.activities (prospect_id, author_id, type, subject, outcome, is_exchange, occurred_at)
    values (f2, hakim, 'note', 'ZZ Recette 033 veut un mail', 'suivi_email', true, now());
  perform pg_temp.verifie('implicite : « Suivi par email » après le RDV le clôt — honore / suivi_email',
    (select (status::text, debrief_issue) = ('honore', 'suivi_email') from public.meetings where id = m));
  perform pg_temp.verifie('implicite : une ligne au journal, rattachée au RDV',
    (select count(*) from public.activities where prospect_id = f2 and meeting_id = m) = 1);

  -- ==========================================================================
  -- 4. Passer en essai gratuit clôt le RDV en attente — JAMAIS un RDV à venir
  -- ==========================================================================
  insert into public.prospects (company_name, owner_id, created_by, status)
    values ('ZZ Recette 033 Essai', hakim, hakim, 'contacte') returning id into f3;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, status, created_by)
    values (hakim, f3, 'prospect', 'ZZ Recette 033 vieux', now() - interval '10 days', now() - interval '10 days' + interval '1 hour', 'annule', hakim)
    returning id into m_vieux;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, status, created_by)
    values (hakim, f3, 'prospect', 'ZZ Recette 033 récent', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'annule', hakim)
    returning id into m_recent;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, status, created_by)
    values (hakim, f3, 'prospect', 'ZZ Recette 033 futur', now() + interval '5 days', now() + interval '5 days' + interval '1 hour', 'prevu', hakim)
    returning id into m_futur;
  -- Les deux RDV passés, ranimés en attente APRÈS leur pose (comme la 027 :
  -- aucun DDL, aucun trigger coupé — la pose d'un RDV aurait remplacé l'autre).
  update public.meetings set status = 'prevu' where id in (m_vieux, m_recent);

  perform pg_temp.etre(hakim);
  update public.prospects set status = 'essai_gratuit' where id = f3;
  perform pg_temp.redevenir();
  perform pg_temp.verifie('essai : le RDV en attente le plus RÉCENT est clos honore / essai',
    (select (status::text, debrief_issue) = ('honore', 'essai') from public.meetings where id = m_recent));
  perform pg_temp.verifie('essai : le plus ancien est clos « remplacé » (027), jamais « tenu »',
    (select (status::text, debrief_issue) = ('annule', 'remplace') from public.meetings where id = m_vieux));
  perform pg_temp.verifie('essai : le RDV À VENIR n''est pas touché',
    (select status::text = 'prevu' and debriefed_at is null from public.meetings where id = m_futur));
  perform pg_temp.verifie('essai : UNE ligne « clos : fiche passée en essai gratuit », signée de qui a changé l''étape',
    (select count(*) from public.activities
      where prospect_id = f3 and meeting_id = m_recent and author_id = hakim
        and subject like '% clos : fiche passée en essai gratuit') = 1);
  perform pg_temp.verifie('essai : la prochaine action est le RDV à venir',
    (select (next_action_kind, next_action_at) = ('rendez_vous', (select starts_at from public.meetings where id = m_futur))
       from public.prospects where id = f3));
  select count(*) into n from public.activities where prospect_id = f3;
  update public.prospects set notes = 'ZZ Recette 033' where id = f3;
  update public.prospects set status = 'essai_gratuit' where id = f3;
  perform pg_temp.verifie('essai : RESTER en essai ne clôt rien de plus',
    (select count(*) from public.activities where prospect_id = f3) = n);

  -- Le débrief explicite « Essai gratuit démarré » : le RDV est clos AVANT
  -- l'étape (cloturerRendezVous) — le trigger ne trouve rien, aucun doublon.
  insert into public.prospects (company_name, owner_id, created_by, status)
    values ('ZZ Recette 033 Débrief', hakim, hakim, 'rendez_vous') returning id into f4;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, status, created_by)
    values (hakim, f4, 'prospect', 'ZZ Recette 033 débrief', now() - interval '1 day', now() - interval '1 day' + interval '1 hour', 'prevu', hakim)
    returning id into m2;
  update public.meetings set status = 'honore', debriefed_at = now(), debrief_issue = 'essai' where id = m2;
  update public.prospects set status = 'essai_gratuit' where id = f4;
  perform pg_temp.verifie('essai : après un débrief explicite, aucune ligne « clos » en double',
    (select count(*) from public.activities where prospect_id = f4 and subject like '% clos : fiche passée en essai gratuit') = 0);

  -- Le RDV posé par BORA sur la fiche d'Hakim : Hakim le ferme en passant
  -- SA fiche en essai (security definer) ; Collins, son encadrant, ne peut
  -- pas changer l'étape — donc ne ferme rien.
  insert into public.prospects (company_name, owner_id, created_by, status)
    values ('ZZ Recette 033 Bora', hakim, hakim, 'contacte') returning id into f;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, status, created_by)
    values (bora, f, 'prospect', 'ZZ Recette 033 posé par Bora', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'prevu', bora)
    returning id into m_bora;
  perform pg_temp.etre(collins);
  n := pg_temp.lignes(format($$update public.prospects set status = 'essai_gratuit' where id = %L$$, f));
  perform pg_temp.redevenir();
  perform pg_temp.verifie('essai : l''encadrant ne change pas l''étape (0 ligne) — le RDV reste en attente',
    n = 0 and (select status::text from public.meetings where id = m_bora) = 'prevu', n::text);
  perform pg_temp.etre(hakim);
  update public.prospects set status = 'essai_gratuit' where id = f;
  perform pg_temp.redevenir();
  perform pg_temp.verifie('essai : le RDV posé par Bora est clos quand Hakim passe SA fiche en essai',
    (select (status::text, debrief_issue) = ('honore', 'essai') from public.meetings where id = m_bora));

  -- Les droits : la fonction du trigger n'est exécutable par personne.
  perform pg_temp.verifie('essai : prospects_essai_clot_rdv n''est pas exécutable par authenticated ni anon',
    not has_function_privilege('authenticated', 'public.prospects_essai_clot_rdv()', 'execute')
    and not has_function_privilege('anon', 'public.prospects_essai_clot_rdv()', 'execute'));
  perform pg_temp.verifie('compteurs_pour : toujours fermée aux membres (droits de la 031 conservés)',
    not has_function_privilege('authenticated', 'public.compteurs_pour(uuid[], date, date)', 'execute'));
end $recette$;
