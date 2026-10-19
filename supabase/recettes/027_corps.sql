-- ============================================================
-- Recette 027 — corps (assertions). NE S'EXÉCUTE PAS SEUL.
--
-- Assemblé par supabase/recettes/027_assembler.sh :
--   1. baseline (même transaction, juste avant la migration) ;
--   2. la migration 027 VERBATIM ;
--   3. ce corps ;
--   4. une exception finale qui porte le rapport ET garantit le rollback.
--
-- La règle : « Un rendez-vous passé non débriefé reste la prochaine action —
-- tant que rien n'est posé après lui. » Seule une ACTIVITÉ humaine (échange
-- attesté, résultat d'appel « À rappeler » / « Intéressé » / « Pas
-- intéressé », email envoyé) le clôt ; une relance seule ne ferme rien (le
-- suivi automatique re-date des relances tout seul), ni un « Pas de réponse »
-- ou un « Barrage » (ne pas avoir eu la personne ne prouve pas que le RDV a eu
-- lieu — décision du 19/10). « Pas intéressé » vaut l'issue pas_interesse :
-- fiche en Perdu, verrouillée, relances annulées.
-- Et un seul rendez-vous en attente par fiche.
--
-- Ne dépend pas de la 026 : aucune assertion n'emploie 'a_rappeler' (la règle
-- d'étape est en TypeScript, testée par npm run test:debrief).
-- Dates RELATIVES à now() (figé pour toute la transaction).
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

-- L'état d'un rendez-vous, en une chaîne comparable.
create function pg_temp.rdv(p uuid) returns text language sql as $r$
  select status::text || '/' || coalesce(debrief_issue, '∅') || '/' || (debriefed_at is not null)::text
    from public.meetings where id = p;
$r$;

do $recette$
declare
  bora    constant uuid := 'b3fdb505-76b0-4541-84ec-21b330afe58d';
  collins constant uuid := 'fc088df7-6bd5-4d28-b10a-417483964a9f';
  remi    constant uuid := '640f3e05-d9da-4fdc-a0eb-553a3afa00d6';
  h       constant timestamptz := date_trunc('hour', now());
  passe   constant timestamptz := h - interval '19 days';
  passe2  constant timestamptz := h - interval '12 days';
  futur   constant timestamptz := h + interval '3 days';
  relance constant timestamptz := h + interval '4 days';
  p uuid[] := '{}';
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; m6 uuid; m7 uuid; m8 uuid; m9 uuid;
  m10 uuid; m11 uuid; m12a uuid; m12b uuid; m13a uuid; m13b uuid; m13c uuid;
  m14a uuid; m14b uuid; m14c uuid; m15a uuid; m15b uuid; m16a uuid; m16b uuid;
  m17 uuid; m19 uuid; m20 uuid; mperso uuid; mcs uuid;
  -- Pas de variable nommée comme un alias de requête (t, a, m) : 42702.
  pid uuid; tid uuid; i int; n int; v_err text;
begin
  -- ==========================================================================
  -- A. Reprise : la migration ne touche AUCUNE donnée
  -- ==========================================================================
  perform pg_temp.verifie('reprise : aucune relance, aucun RDV, aucune ligne de journal touchés',
    (select md5(string_agg(t::text, '|' order by t.id)) from public.tasks t) = (select tasks from base_md5)
    and (select md5(string_agg(row(m.id, m.owner_id, m.prospect_id, m.kind, m.title, m.starts_at, m.ends_at,
                                   m.location, m.notes, m.status, m.debriefed_at, m.created_by)::text, '|' order by m.id))
           from public.meetings m) = (select meetings from base_md5)
    and (select md5(string_agg(row(a.id, a.prospect_id, a.author_id, a.type, a.subject, a.body, a.outcome,
                                   a.occurred_at, a.is_draft, a.is_exchange)::text, '|' order by a.id))
           from public.activities a) = (select activities from base_md5)
    and (select count(*) from public.meetings where debrief_issue is not null) = 0
    and (select count(*) from public.activities where meeting_id is not null) = 0);
  select count(*) into n from public.prospects pr join base_prospects b on b.id = pr.id
   where (pr.status, pr.next_action_at, pr.next_action_kind) is distinct from (b.status, b.next_action_at, b.next_action_kind);
  perform pg_temp.verifie('reprise : aucune fiche ne change (ni étape, ni prochaine action)', n = 0, n::text);
  select count(*) into n from public.meetings
   where kind = 'prospect' and public.rdv_vivant(status) and starts_at < now() and debriefed_at is null;
  perform pg_temp.info(format('RDV de prospects en attente de débrief, laissés tels quels (aucun rattrapage) : %s', n));

  -- ==========================================================================
  -- B. Les objets
  -- ==========================================================================
  perform pg_temp.verifie('colonnes meetings.debrief_issue et activities.meeting_id présentes',
    (select count(*) from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'meetings' and column_name = 'debrief_issue')
          or (table_name = 'activities' and column_name = 'meeting_id'))) = 2);
  perform pg_temp.verifie('triggers : un sur activities, un sur meetings — AUCUN sur tasks',
    (select count(*) from pg_trigger where not tgisinternal and tgname = 'activities_debrief_implicite'
       and tgrelid = 'public.activities'::regclass) = 1
    and (select count(*) from pg_trigger where not tgisinternal and tgname = 'meetings_rdv_remplaces'
       and tgrelid = 'public.meetings'::regclass) = 1
    and (select count(*) from pg_trigger tg join pg_proc pr on pr.oid = tg.tgfoid
          where tg.tgrelid = 'public.tasks'::regclass and not tg.tgisinternal
            and pr.proname in ('activities_debrief_implicite', 'meetings_rdv_remplaces')) = 0);
  select count(*) into n from information_schema.role_routine_grants
   where routine_name in ('activities_debrief_implicite', 'meetings_rdv_remplaces')
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  perform pg_temp.verifie('fonctions non exécutables par anon / authenticated', n = 0, n::text);
  begin
    insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, debrief_issue)
    values (bora, null, 'perso', 'x', h, h + interval '1 hour', 'nimporte');
    perform pg_temp.verifie('une issue inconnue est refusée', false);
  exception when check_violation then
    perform pg_temp.verifie('une issue inconnue est refusée (23514)', true);
  end;

  -- ==========================================================================
  -- Fixtures : 20 fiches de Collins, ouvertes, en « Rendez-vous »
  -- ==========================================================================
  for i in 1..20 loop
    insert into public.prospects (company_name, owner_id, status)
    values ('RECETTE-027 P' || i, collins, 'rendez_vous') returning id into pid;
    p := p || pid;
  end loop;

  -- ==========================================================================
  -- C. Le débrief implicite — les gestes qui ferment (chemin ÉCRAN : Collins,
  --    client authentifié, RLS active)
  -- ==========================================================================
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[1], 'prospect', 'RDV P1', passe, passe + interval '1 hour', collins) returning id into m1;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[2], 'prospect', 'RDV P2', passe, passe + interval '1 hour', collins) returning id into m2;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[3], 'prospect', 'RDV P3', passe, passe + interval '1 hour', collins) returning id into m3;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[4], 'prospect', 'RDV P4', passe, passe + interval '1 hour', collins) returning id into m4;
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p[1], 'Relancer P1', relance, collins, collins);
  perform pg_temp.verifie('avant : RDV passé + relance → « à débriefer »',
    pg_temp.na(p[1]) = 'rendez_vous @ ' || passe::text, pg_temp.na(p[1]));

  perform set_config('request.jwt.claims', json_build_object('sub', collins, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- 1. Note attestée
  insert into public.activities (prospect_id, author_id, type, subject, occurred_at, is_exchange)
  values (p[1], collins, 'note', 'Il est partant, à revoir', now(), true);
  -- 2. Résultat d'appel « À rappeler »
  insert into public.activities (prospect_id, author_id, type, outcome, occurred_at, is_exchange)
  values (p[2], collins, 'note', 'rappeler', now(), true);
  -- 3. Résultat d'appel « Pas de réponse » : ne prouve pas que le RDV a eu lieu
  insert into public.activities (prospect_id, author_id, type, outcome, occurred_at, is_exchange)
  values (p[3], collins, 'note', 'sans_reponse', now(), false);
  -- 4. Email envoyé (comme l'écrit crm-mail : type email, is_exchange par défaut)
  insert into public.activities (prospect_id, author_id, type, subject, occurred_at)
  values (p[4], collins, 'email', 'Suite à notre rendez-vous', now());
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.verifie('1. note attestée après le RDV → honore / suite_posee',
    pg_temp.rdv(m1) = 'honore/suite_posee/true', pg_temp.rdv(m1));
  perform pg_temp.verifie('1. …la relance redevient la prochaine action',
    pg_temp.na(p[1]) = 'relance @ ' || relance::text, pg_temp.na(p[1]));
  perform pg_temp.verifie('1. …une ligne au journal, rattachée au RDV, signée de Collins, juste AVANT la note',
    (select count(*) from public.activities
      where prospect_id = p[1] and meeting_id = m1 and author_id = collins
        and subject like 'RDV du % marqué comme tenu (suite posée le %)'
        and not is_exchange
        and occurred_at < (select occurred_at from public.activities where prospect_id = p[1] and subject = 'Il est partant, à revoir')) = 1);
  perform pg_temp.verifie('1. …la dernière action de la carte reste celle de l''humain',
    (select last_text from public.prospect_action_state where prospect_id = p[1]) = 'Il est partant, à revoir');
  perform pg_temp.verifie('2. résultat « À rappeler » → honore / a_rappeler',
    pg_temp.rdv(m2) = 'honore/a_rappeler/true', pg_temp.rdv(m2));
  perform pg_temp.verifie('2. …la carte dit toujours « À rappeler »',
    (select last_outcome from public.prospect_action_state where prospect_id = p[2]) = 'rappeler');
  perform pg_temp.verifie('3. résultat « Pas de réponse » : le RDV reste EN ATTENTE',
    pg_temp.rdv(m3) = 'prevu/∅/false', pg_temp.rdv(m3));
  perform pg_temp.verifie('3. …et la fiche dit toujours « à débriefer »',
    pg_temp.na(p[3]) = 'rendez_vous @ ' || passe::text, pg_temp.na(p[3]));
  perform pg_temp.verifie('4. email envoyé → honore',
    pg_temp.rdv(m4) = 'honore/suite_posee/true', pg_temp.rdv(m4));
  perform pg_temp.verifie('2. sans relance, la fiche n''a plus de prochaine action',
    pg_temp.na(p[2]) = '∅ @ ∅', pg_temp.na(p[2]));

  -- 3b. Résultat d'appel « Barrage » (un échange attesté — on a eu le
  --     standard) : ne prouve pas non plus que le RDV a eu lieu.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[19], 'prospect', 'RDV P19', passe, passe + interval '1 hour', collins) returning id into m19;
  perform set_config('request.jwt.claims', json_build_object('sub', collins, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.activities (prospect_id, author_id, type, outcome, subject, occurred_at, is_exchange)
  values (p[19], collins, 'note', 'barrage', 'La secrétaire filtre', now(), true);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.verifie('3b. résultat « Barrage » (échange attesté) : le RDV reste EN ATTENTE',
    pg_temp.rdv(m19) = 'prevu/∅/false', pg_temp.rdv(m19));

  -- 3c. Résultat d'appel « Pas intéressé » après le RDV : issue pas_interesse,
  --     fiche en Perdu VERROUILLÉE, relances annulées — comme le débrief
  --     explicite. La raison, ResultatAppel l'exige et saveExchangeCore la
  --     pose sur la fiche AVANT d'écrire l'activité : on rejoue cet ordre.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[20], 'prospect', 'RDV P20', passe, passe + interval '1 hour', collins) returning id into m20;
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p[20], 'Relancer P20', relance, collins, collins) returning id into tid;
  perform set_config('request.jwt.claims', json_build_object('sub', collins, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.prospects set lost_reason = 'Bosse déjà avec un concurrent' where id = p[20];
  insert into public.activities (prospect_id, author_id, type, outcome, subject, occurred_at, is_exchange)
  values (p[20], collins, 'note', 'refus', 'Bosse déjà avec un concurrent', now(), true);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.verifie('3c. « Pas intéressé » après le RDV → honore / pas_interesse',
    pg_temp.rdv(m20) = 'honore/pas_interesse/true', pg_temp.rdv(m20));
  perform pg_temp.verifie('3c. …la fiche passe en Perdu, VERROUILLÉE',
    (select status::text || '/' || status_locked::text from public.prospects where id = p[20]) = 'perdu/true',
    (select status::text || '/' || status_locked::text from public.prospects where id = p[20]));
  perform pg_temp.verifie('3c. …la raison posée par le résultat d''appel est gardée',
    (select lost_reason from public.prospects where id = p[20]) = 'Bosse déjà avec un concurrent');
  perform pg_temp.verifie('3c. …ses relances ouvertes sont annulées, plus rien à faire',
    (select status::text from public.tasks where id = tid) = 'annule' and pg_temp.na(p[20]) = '∅ @ ∅',
    (select status::text from public.tasks where id = tid) || ' ' || pg_temp.na(p[20]));
  perform pg_temp.verifie('3c. …la ligne au journal dit que la fiche passe en Perdu',
    (select count(*) from public.activities where prospect_id = p[20] and meeting_id = m20
       and body like '%la fiche passe en Perdu%') = 1);

  -- 5. Chemin MCP / crm-mail : service_role (RLS contournée)
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[5], 'prospect', 'RDV P5', passe, passe + interval '1 hour', collins) returning id into m5;
  execute 'set local role service_role';
  insert into public.activities (prospect_id, author_id, type, outcome, occurred_at, is_exchange)
  values (p[5], collins, 'note', 'interesse', now(), true);
  execute 'reset role';
  perform pg_temp.verifie('5. service_role (MCP) : résultat « Intéressé » → honore / a_rappeler',
    pg_temp.rdv(m5) = 'honore/a_rappeler/true', pg_temp.rdv(m5));

  -- ==========================================================================
  -- D. Ce qui ne ferme RIEN
  -- ==========================================================================
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[6], 'prospect', 'RDV P6', passe, passe + interval '1 hour', collins) returning id into m6;
  -- 6a. Une relance posée seule
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p[6], 'Relancer P6', relance, collins, collins) returning id into tid;
  -- 6b. …puis re-datée (le suivi automatique, Alain docteur)
  update public.tasks set due_at = relance + interval '2 days' where id = tid;
  -- 6c. …puis faite
  update public.tasks set status = 'fait' where id = tid;
  perform pg_temp.verifie('6. une relance seule (posée, re-datée, faite) ne ferme RIEN',
    pg_temp.rdv(m6) = 'prevu/∅/false', pg_temp.rdv(m6));
  -- 7. Note de repérage
  insert into public.activities (prospect_id, author_id, type, subject, occurred_at, is_exchange)
  values (p[6], collins, 'note', 'Site web à revoir', now(), false);
  perform pg_temp.verifie('7. une note de repérage ne ferme rien', pg_temp.rdv(m6) = 'prevu/∅/false', pg_temp.rdv(m6));
  -- 8. Brouillon
  insert into public.activities (prospect_id, author_id, type, subject, occurred_at, is_exchange, is_draft)
  values (p[6], collins, 'email', 'Brouillon', now(), false, true);
  perform pg_temp.verifie('8. un brouillon ne ferme rien', pg_temp.rdv(m6) = 'prevu/∅/false', pg_temp.rdv(m6));
  -- 9. Une activité « rendez_vous » (elle accompagne une pose)
  insert into public.activities (prospect_id, author_id, type, subject, occurred_at, is_exchange)
  values (p[6], collins, 'rendez_vous', 'RDV noté', now(), true);
  perform pg_temp.verifie('9. une activité rendez_vous ne ferme rien', pg_temp.rdv(m6) = 'prevu/∅/false', pg_temp.rdv(m6));
  -- 10. Une note rattachée à un RDV (compte rendu d'un débrief explicite)
  insert into public.activities (prospect_id, author_id, type, subject, occurred_at, is_exchange, meeting_id)
  values (p[6], collins, 'note', 'Compte rendu', now(), true, m6);
  perform pg_temp.verifie('10. une note rattachée à un RDV ne déclenche rien', pg_temp.rdv(m6) = 'prevu/∅/false', pg_temp.rdv(m6));
  -- 11. Une note datée AVANT le début du RDV
  insert into public.activities (prospect_id, author_id, type, subject, occurred_at, is_exchange)
  values (p[6], collins, 'note', 'Appel de préparation', passe - interval '1 day', true);
  perform pg_temp.verifie('11. une note datée avant le RDV ne le ferme pas', pg_temp.rdv(m6) = 'prevu/∅/false', pg_temp.rdv(m6));
  perform pg_temp.verifie('6-11. …et la fiche dit toujours « à débriefer »',
    pg_temp.na(p[6]) = 'rendez_vous @ ' || passe::text, pg_temp.na(p[6]));

  -- 12. RDV à venir : une note ne le touche pas
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[7], 'prospect', 'RDV P7', futur, futur + interval '1 hour', collins) returning id into m7;
  insert into public.activities (prospect_id, author_id, type, subject, occurred_at, is_exchange)
  values (p[7], collins, 'note', 'Confirmé par téléphone', now(), true);
  perform pg_temp.verifie('12. RDV à venir + note : intact', pg_temp.rdv(m7) = 'prevu/∅/false', pg_temp.rdv(m7));

  -- 13. Fiche gagnée / perdue : rien
  update public.prospects set status = 'gagne' where id = p[8];
  update public.prospects set status = 'perdu' where id = p[9];
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[8], 'prospect', 'RDV P8', passe, passe + interval '1 hour', collins) returning id into m8;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[9], 'prospect', 'RDV P9', passe, passe + interval '1 hour', collins) returning id into m9;
  insert into public.activities (prospect_id, author_id, type, outcome, occurred_at, is_exchange)
  values (p[8], collins, 'note', 'interesse', now(), true), (p[9], collins, 'note', 'rappeler', now(), true);
  perform pg_temp.verifie('13. fiche gagnée / perdue : le RDV passé n''est pas touché',
    pg_temp.rdv(m8) = 'prevu/∅/false' and pg_temp.rdv(m9) = 'prevu/∅/false');

  -- 14. RDV personnel passé : jamais concerné
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, null, 'perso', 'Rdv perso', passe, passe + interval '1 hour', collins) returning id into mperso;
  insert into public.activities (prospect_id, author_id, type, subject, occurred_at, is_exchange)
  values (p[10], collins, 'note', 'Appel', now(), true);
  perform pg_temp.verifie('14. RDV perso passé : intact', pg_temp.rdv(mperso) = 'prevu/∅/false', pg_temp.rdv(mperso));

  -- 15. Rémi ne peut pas écrire sur la fiche de Collins : rien ne se ferme
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[11], 'prospect', 'RDV P11', passe, passe + interval '1 hour', collins) returning id into m11;
  perform set_config('request.jwt.claims', json_build_object('sub', remi, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.activities (prospect_id, author_id, type, subject, occurred_at, is_exchange)
    values (p[11], remi, 'note', 'intrusion', now(), true);
    v_err := 'accepté';
  exception when others then
    v_err := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.verifie('15. Rémi : note refusée (42501), le RDV de Collins reste en attente',
    v_err = '42501' and pg_temp.rdv(m11) = 'prevu/∅/false', v_err || ' ' || pg_temp.rdv(m11));

  -- 16. RDV posé par Bora sur la fiche de Collins : la note de Collins le ferme
  --     (security definer — meetings_update est réservé au propriétaire du RDV)
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p[10], 'prospect', 'RDV P10 posé par Bora', passe, passe + interval '1 hour', bora) returning id into m10;
  perform set_config('request.jwt.claims', json_build_object('sub', collins, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.meetings set status = 'honore' where id = m10;   -- directement : 0 ligne
  get diagnostics n = row_count;
  insert into public.activities (prospect_id, author_id, type, subject, occurred_at, is_exchange)
  values (p[10], collins, 'note', 'Rappelé après la démo', now(), true);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.verifie('16. Collins ne peut pas modifier le RDV de Bora directement (0 ligne)', n = 0, n::text);
  perform pg_temp.verifie('16. …mais sa note le ferme par la règle', pg_temp.rdv(m10) = 'honore/suite_posee/true', pg_temp.rdv(m10));

  -- ==========================================================================
  -- E. Un seul rendez-vous en attente par fiche
  -- ==========================================================================
  -- 17. Deux RDV passés en attente (le doublon de Nice Cars), puis une note :
  --     le plus récent est tenu, l'ancien est remplacé.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[12], 'prospect', 'RDV P12 ancien', passe, passe + interval '1 hour', collins) returning id into m12a;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[12], 'prospect', 'RDV P12 récent', passe2, passe2 + interval '1 hour', collins) returning id into m12b;
  perform pg_temp.verifie('17. poser un RDV PASSÉ alors qu''un autre attend : l''ancien est remplacé',
    pg_temp.rdv(m12a) = 'annule/remplace/true' and pg_temp.rdv(m12b) = 'prevu/∅/false',
    pg_temp.rdv(m12a) || ' ' || pg_temp.rdv(m12b));
  perform pg_temp.verifie('17. …avec sa ligne « remplacé par le RDV du … », rattachée',
    (select count(*) from public.activities where prospect_id = p[12] and meeting_id = m12a
       and subject like 'RDV du % remplacé par le RDV du %') = 1);
  perform pg_temp.verifie('17. …et la fiche n''attend plus qu''UN débrief',
    pg_temp.na(p[12]) = 'rendez_vous @ ' || passe2::text, pg_temp.na(p[12]));

  -- 18. Doublons existants (état d'avant la 027) : insérés « annulés » — un RDV
  --     mort ne remplace rien — puis ranimés sans changer de date. Aucun DDL :
  --     la recette ne prend jamais de verrou exclusif sur meetings en production.
  --     Puis une note : le récent est tenu, l'ancien remplacé.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by, status)
  values (collins, p[13], 'prospect', 'RDV P13 ancien', passe, passe + interval '1 hour', collins, 'annule') returning id into m13a;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by, status)
  values (collins, p[13], 'prospect', 'RDV P13 récent', passe2, passe2 + interval '1 hour', collins, 'annule') returning id into m13b;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by, status)
  values (collins, p[14], 'prospect', 'RDV P14 ancien', passe, passe + interval '1 hour', collins, 'annule') returning id into m14a;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by, status)
  values (collins, p[14], 'prospect', 'RDV P14 récent', passe2, passe2 + interval '1 hour', collins, 'annule') returning id into m14b;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by, status)
  values (collins, p[15], 'prospect', 'RDV P15 ancien', passe, passe + interval '1 hour', collins, 'annule') returning id into m15a;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by, status)
  values (collins, p[15], 'prospect', 'RDV P15 récent', passe2, passe2 + interval '1 hour', collins, 'annule') returning id into m15b;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by, status)
  values (collins, p[16], 'prospect', 'RDV P16 passé', passe, passe + interval '1 hour', collins, 'annule') returning id into m16a;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by, status)
  values (collins, p[17], 'prospect', 'RDV P17 passé', passe, passe + interval '1 hour', collins, 'annule') returning id into m17;
  -- Ranimés sans changer de date : ni pose ni débrief, le trigger ne fait rien.
  update public.meetings set status = 'reporte' where id = m13a;
  update public.meetings set status = 'prevu' where id in (m13b, m14a, m14b, m15a, m15b, m16a, m17);

  insert into public.activities (prospect_id, author_id, type, outcome, occurred_at, is_exchange)
  values (p[13], collins, 'note', 'rappeler', now(), true);
  perform pg_temp.verifie('18. doublon + note : le plus récent est tenu, l''ancien (reporté) remplacé',
    pg_temp.rdv(m13b) = 'honore/a_rappeler/true' and pg_temp.rdv(m13a) = 'annule/remplace/true',
    pg_temp.rdv(m13b) || ' ' || pg_temp.rdv(m13a));
  perform pg_temp.verifie('18. …exactement deux lignes de clôture au journal, aucune en boucle',
    (select count(*) from public.activities where prospect_id = p[13] and meeting_id is not null) = 2);

  -- 19. Débrief explicite « honoré » du plus récent : l'ancien est remplacé.
  update public.meetings set status = 'honore', debriefed_at = now(), debrief_issue = 'proposition' where id = m14b;
  perform pg_temp.verifie('19. débrief explicite du récent : l''ancien est remplacé',
    pg_temp.rdv(m14a) = 'annule/remplace/true', pg_temp.rdv(m14a));
  -- 20. Débrief « annulé » du plus récent : l'ancien reste à débriefer.
  update public.meetings set status = 'annule', debriefed_at = now() where id = m15b;
  perform pg_temp.verifie('20. annulation du récent : l''ancien reste en attente',
    pg_temp.rdv(m15a) = 'prevu/∅/false', pg_temp.rdv(m15a));
  -- 20b. Débrief explicite de l'ANCIEN : le récent n'est pas touché.
  update public.meetings set status = 'honore', debriefed_at = now() where id = m15a;
  perform pg_temp.verifie('20b. débrief de l''ancien : rien d''autre ne bouge',
    pg_temp.rdv(m15b) = 'annule/∅/true', pg_temp.rdv(m15b));

  -- 21. Poser un RDV À VENIR alors qu'un RDV passé attend : l'ancien est
  --     remplacé (annule), JAMAIS honoré ; le nouveau devient la prochaine action.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[16], 'prospect', 'RDV P16 nouveau', futur, futur + interval '1 hour', collins) returning id into m16b;
  perform pg_temp.verifie('21. pose d''un RDV à venir : le passé est remplacé, pas honoré',
    pg_temp.rdv(m16a) = 'annule/remplace/true', pg_temp.rdv(m16a));
  perform pg_temp.verifie('21. …le nouveau RDV est la prochaine action',
    pg_temp.na(p[16]) = 'rendez_vous @ ' || futur::text, pg_temp.na(p[16]));

  -- 22. Un RDV À VENIR n'est jamais touché : en poser un second, en tenir un.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[16], 'prospect', 'RDV P16 installation', futur + interval '7 days', futur + interval '7 days 1 hour', collins);
  perform pg_temp.verifie('22. deux RDV à venir coexistent',
    pg_temp.rdv(m16b) = 'prevu/∅/false', pg_temp.rdv(m16b));

  -- 23. Reporter un RDV passé à une date future, alors qu'un autre passé attend.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by, status)
  values (collins, p[17], 'prospect', 'RDV P17 autre', passe2, passe2 + interval '1 hour', collins, 'annule') returning id into m14c;
  update public.meetings set status = 'prevu' where id = m14c;
  update public.meetings set starts_at = futur, ends_at = futur + interval '1 hour', status = 'reporte' where id = m17;
  perform pg_temp.verifie('23. report à venir : l''autre RDV passé est remplacé, le reporté vit',
    pg_temp.rdv(m14c) = 'annule/remplace/true' and pg_temp.rdv(m17) = 'reporte/∅/false',
    pg_temp.rdv(m14c) || ' ' || pg_temp.rdv(m17));

  -- 24. Fiche gagnée : poser un RDV ne remplace rien.
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[8], 'prospect', 'RDV P8 bis', passe2, passe2 + interval '1 hour', collins) returning id into m13c;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[8], 'prospect', 'Installation P8', futur, futur + interval '1 hour', collins);
  perform pg_temp.verifie('24. fiche gagnée : la pose ne remplace rien',
    pg_temp.rdv(m8) = 'prevu/∅/false' and pg_temp.rdv(m13c) = 'prevu/∅/false');

  -- ==========================================================================
  -- F. Rejouer Carrosserie carsystem
  --    RDV tenu le 29/09, appels les 14 et 15/10 (« À rappeler »), note
  --    « rappeler Mounir dans 2 semaines », relance au 22/10. Avant la 027 :
  --    RDV « prevu » à jamais, relance masquée derrière « À débriefer ».
  -- ==========================================================================
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (collins, p[18], 'prospect', 'RDV avec Carrosserie (recette)', passe, passe + interval '1 hour', collins) returning id into mcs;
  -- La relance d'abord (posée seule : elle ne ferme rien)
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p[18], 'Relancer Carrosserie (recette)', relance, collins, collins);
  perform pg_temp.verifie('carsystem : relance posée seule → toujours « à débriefer »',
    pg_temp.na(p[18]) = 'rendez_vous @ ' || passe::text and pg_temp.rdv(mcs) = 'prevu/∅/false', pg_temp.na(p[18]));
  -- Puis l'appel du 14/10 : « À rappeler », tapé depuis la fiche
  perform set_config('request.jwt.claims', json_build_object('sub', collins, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.activities (prospect_id, author_id, type, outcome, subject, occurred_at, is_exchange)
  values (p[18], collins, 'note', 'rappeler', 'rappeler Mounir dans 2 semaines', h - interval '4 days', true);
  insert into public.activities (prospect_id, author_id, type, outcome, occurred_at, is_exchange)
  values (p[18], collins, 'note', 'rappeler', h - interval '3 days', true);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.verifie('carsystem : le premier « À rappeler » clôt le RDV — honore / a_rappeler',
    pg_temp.rdv(mcs) = 'honore/a_rappeler/true', pg_temp.rdv(mcs));
  perform pg_temp.verifie('carsystem : la relance est la prochaine action',
    pg_temp.na(p[18]) = 'relance @ ' || relance::text, pg_temp.na(p[18]));
  perform pg_temp.verifie('carsystem : UNE seule ligne « marqué comme tenu »',
    (select count(*) from public.activities where prospect_id = p[18] and subject like 'RDV du % marqué comme tenu%') = 1);
  perform pg_temp.verifie('carsystem : la dernière action reste le second appel « À rappeler »',
    (select last_outcome from public.prospect_action_state where prospect_id = p[18]) = 'rappeler');

  -- ==========================================================================
  -- G. Rien d'autre que les fiches de recette n'a bougé
  -- ==========================================================================
  select count(*) into n from public.prospects pr join base_prospects b on b.id = pr.id
   where (pr.status, pr.next_action_at, pr.next_action_kind) is distinct from (b.status, b.next_action_at, b.next_action_kind);
  perform pg_temp.verifie('fin : aucune fiche réelle n''a changé', n = 0, n::text);
  select count(*) into n from public.meetings m
   where m.prospect_id is not null and not (m.prospect_id = any (p)) and m.debrief_issue is not null;
  perform pg_temp.verifie('fin : aucun RDV réel n''a été clos', n = 0, n::text);
end $recette$;
