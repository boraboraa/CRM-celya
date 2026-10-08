-- ============================================================
-- Recette 025 — corps (assertions). NE S'EXÉCUTE PAS SEUL.
--
-- Assemblé par supabase/recettes/025_assembler.sh :
--   1. baseline (même transaction, juste avant la migration) : identifiants et
--      empreintes md5 de prospects / tasks / meetings / activities, et le nombre
--      de fiches que Rémi voit ;
--   2. la migration 025 VERBATIM ;
--   3. ce corps, où le marqueur des cas de numéros est remplacé par les cas de
--      lib/appelsIa/numeros.cas.json (le MÊME jeu que le test TypeScript) ;
--   4. une exception finale qui porte le rapport ET garantit le rollback.
--
-- Différentielle : rien n'est comparé à un nombre écrit à la main ; les comptes
-- réels se lisent par email, l'attendu du rattrapage se calcule à part, et
-- « rien d'autre n'a bougé » se mesure contre la baseline.
--
-- Simuler quelqu'un : `pg_temp.x(rôle, uuid, sql)` pose les claims JWT, change
-- de rôle et exécute DANS UNE SOUS-TRANSACTION — une erreur l'annule, rôle et
-- claims compris, et renvoie `ERR:<sqlstate>`. `p_garder = false` annule même
-- un succès (sonde pure). Sans rôle : le propriétaire, auth.uid() nul — le
-- chemin service_role (connecteur MCP, Next côté serveur, pg_cron).
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

-- Exécuter `p_sql` sous une identité. Scalaire : la première colonne de la
-- première ligne (« null » si nulle). Sinon : « ok:<lignes touchées> ».
create function pg_temp.x(p_role text, p_qui uuid, p_sql text,
                          p_garder boolean default true, p_scalaire boolean default true)
returns text language plpgsql as $x$
declare
  v text;
  n bigint;
begin
  begin
    perform set_config('request.jwt.claims',
      case when p_qui is null then ''
           else json_build_object('sub', p_qui, 'role', coalesce(p_role, 'authenticated'))::text end, true);
    if p_role is not null then
      execute format('set local role %I', p_role);
    end if;
    if p_scalaire then
      execute p_sql into v;
      v := coalesce(v, 'null');
    else
      execute p_sql;
      get diagnostics n = row_count;
      v := 'ok:' || n;
    end if;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    if not p_garder then
      raise exception using errcode = 'RC999', message = 'sonde annulée';
    end if;
  exception
    when sqlstate 'RC999' then
      null;
    when others then
      v := 'ERR:' || sqlstate;
      perform set_config('recette.err', sqlerrm, true);
  end;
  return v;
end $x$;

-- Une fiche de sonde. Chaque insertion est comptée : le trigger d'inscription
-- ne doit JAMAIS faire échouer la création d'une fiche.
create function pg_temp.fiche(p_role text, p_qui uuid, p_nom text, p_status text,
                              p_phone text, p_owner uuid default null)
returns uuid language plpgsql as $f$
declare
  v_id uuid := gen_random_uuid();
  v text;
begin
  v := pg_temp.x(p_role, p_qui, format(
    'insert into public.prospects (id, company_name, status, phone, owner_id) values (%L, %L, %L, %L, %L)',
    v_id, 'RECETTE-025 ' || p_nom, p_status, p_phone, p_owner), true, false);
  perform set_config('recette.fiches_n',
    (coalesce(nullif(current_setting('recette.fiches_n', true), ''), '0')::int + 1)::text, true);
  if v is distinct from 'ok:1' then
    perform set_config('recette.fiches_ko', coalesce(current_setting('recette.fiches_ko', true), '')
      || ' [' || p_nom || ' : ' || v || ' ' || coalesce(current_setting('recette.err', true), '') || ']', true);
  end if;
  return v_id;
end $f$;

-- Lignes de file / briefs d'une fiche.
create function pg_temp.nf(p uuid) returns bigint language sql as $n$
  select count(*) from public.appels_ia_file where prospect_id = p;
$n$;
create function pg_temp.nb(p uuid) returns bigint language sql as $n$
  select count(*) from public.appels_ia_briefs where prospect_id = p;
$n$;

-- Un cas du juge du numéro (injecté par l'assembleur).
create function pg_temp.verifie_numero(p_i int, p_saisie text, p_attendu text, p_pourquoi text)
returns void language plpgsql as $c$
declare
  v text := public.appels_ia_numero(p_saisie);
begin
  perform set_config('recette.cas_joues',
    (coalesce(nullif(current_setting('recette.cas_joues', true), ''), '0')::int + 1)::text, true);
  perform pg_temp.verifie(
    format('numéro %s : %s → %s (%s)', p_i, coalesce('« ' || p_saisie || ' »', 'null'), coalesce(p_attendu, 'null'), p_pourquoi),
    v is not distinct from p_attendu, 'obtenu ' || coalesce(v, 'null'));
end $c$;

-- @@CAS_NUMEROS@@

do $recette$
declare
  bora    constant uuid := (select id from public.crm_users where email = 'dogrulbora@gmail.com');
  remi    constant uuid := (select id from public.crm_users where email = 'remi.perezweber@zohomail.eu');
  collins constant uuid := (select id from public.crm_users where email = 'collinscraig.mohe@gmail.com');
  tables  constant text[] := array['appels_ia_reglages', 'appels_ia_campagnes', 'appels_ia_file', 'appels_ia',
                                   'appels_ia_opposition', 'appels_ia_briefs', 'appels_ia_scripts'];
  futur   constant timestamptz := date_trunc('hour', now()) + interval '3 days';
  t text;
  v text; v2 text; acc text;
  n bigint; n2 bigint; attendu bigint; reelles bigint;
  f record;
  p_off uuid; p_on uuid; p_col uuid; p_forge uuid; p_0900 uuid; p_cont uuid; p_opp uuid;
  p_mcp uuid; p_sans uuid; p_corr uuid; p_reel uuid;
  p_g uuid; p_p uuid; p_inv uuid; p_opp2 uuid; p_rdv uuid; p_t uuid; p_k uuid; p_s uuid;
  c_fiche uuid; c_auto uuid; c_rec uuid; c_fin uuid;
  file_k uuid; file_s uuid; file_on uuid; file_reel uuid;
  a1 uuid;
  fiche_remi uuid;
begin
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.verifie('comptes lus par email : Bora admin, Rémi et Collins commerciaux, actifs',
    (select count(*) from public.crm_users
      where (id = bora and role = 'admin' and is_active)
         or (id = remi and role = 'commercial' and is_active)
         or (id = collins and role = 'commercial' and is_active)) = 3);

  -- ==========================================================================
  -- A. Les objets
  -- ==========================================================================
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relname = any (tables) and c.relrowsecurity;
  perform pg_temp.verifie('les 7 tables appels_ia existent, RLS activée', n = 7, n::text);

  select count(*), count(*) filter (where pg_get_expr(polqual, polrelid) = 'is_admin()'
                                      and pg_get_expr(polwithcheck, polrelid) = 'is_admin()'
                                      and polroles = array['authenticated'::regrole::oid])
    into n, n2
    from pg_policy where polrelid in (select ('public.' || x)::regclass from unnest(tables) x);
  perform pg_temp.verifie('une seule policy par table, is_admin() en lecture ET en écriture, rôle authenticated',
    n = 7 and n2 = 7, n || ' / ' || n2);

  select count(*) into n from unnest(tables) x
   where has_table_privilege('anon', 'public.' || x, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
  perform pg_temp.verifie('anon : aucun privilège sur les 7 tables', n = 0, n::text);

  acc := '';
  foreach t in array tables loop
    v := pg_temp.x('anon', null, format('select count(*) from public.%I', t));
    if v <> 'ERR:42501' then acc := acc || ' ' || t || '=' || v; end if;
  end loop;
  perform pg_temp.verifie('anon : un SELECT sur chacune des 7 tables est refusé (42501)', acc = '', acc);

  select count(*), string_agg(p.oid::regprocedure::text, ', ') into n, v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'appels_ia%'
     and p.proname <> 'appels_ia_numero' and has_function_privilege('anon', p.oid, 'EXECUTE');
  perform pg_temp.verifie('anon : aucune fonction appels_ia exécutable (hors le juge du numéro)', n = 0, v);

  select count(*), string_agg(p.oid::regprocedure::text, ', ') into n, v from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('appels_ia_secret', 'appels_ia_prendre', 'appels_ia_prendre_test',
                       'appels_ia_refus_inscription', 'appels_ia_inscription_auto')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  perform pg_temp.verifie('authenticated : secret, prendre, prendre_test, règle et trigger NON exécutables', n = 0, v);

  perform pg_temp.verifie('service_role : appels_ia_secret, appels_ia_prendre, appels_ia_prendre_test exécutables',
    has_function_privilege('service_role', 'public.appels_ia_secret(text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.appels_ia_prendre(uuid, text, boolean, uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.appels_ia_prendre_test(uuid, text, uuid)', 'EXECUTE'));

  select count(*) into n from pg_attribute a
   where a.attrelid = 'public.appels_ia'::regclass and a.attname = 'fin_prise_at'
     and a.atttypid = 'timestamptz'::regtype and not a.attnotnull and not a.atthasdef
     and a.attnum = (select b.attnum + 1 from pg_attribute b
                      where b.attrelid = 'public.appels_ia'::regclass and b.attname = 'age_worker_s');
  perform pg_temp.verifie('appels_ia.fin_prise_at : présente, timestamptz, nullable, sans défaut, juste après age_worker_s', n = 1, n::text);

  select count(*) into n from pg_trigger
   where tgname = 'prospects_appels_ia_inscription' and tgrelid = 'public.prospects'::regclass and tgenabled = 'O';
  perform pg_temp.verifie('le trigger prospects_appels_ia_inscription est posé sur prospects, actif', n = 1, n::text);

  select count(*) into n from cron.job
   where jobname = 'appels-ia-tick' and schedule = '* * * * *' and active
     and command like '%/api/appels-ia/tick%' and command like '%appels_ia_secret_interne%';
  perform pg_temp.verifie('la tâche cron appels-ia-tick existe, chaque minute, vers /api/appels-ia/tick', n = 1, n::text);

  select count(*) into n from vault.secrets where name = 'appels_ia_secret_interne';
  perform pg_temp.verifie('le secret Vault appels_ia_secret_interne existe, une fois', n = 1, n::text);
  perform pg_temp.verifie('le secret interne fait 64 caractères hexadécimaux (lu en service)',
    public.appels_ia_secret('secret_interne') ~ '^[0-9a-f]{64}$');

  select count(*) into n from public.appels_ia_reglages
   where id = 1 and not actif and mode_test and not inscription_auto and inscription_auto_par is null
     and numero_appelant is null and pause_cause is null;
  perform pg_temp.verifie('réglages à la naissance : une ligne, coupé, mode test MIS, inscription auto coupée',
    n = 1 and (select count(*) from public.appels_ia_reglages) = 1);
  select count(*) into n from public.appels_ia_scripts
   where secteur in ('garage', 'restaurant', 'cabinet', 'autre') and length(objectif) > 0;
  perform pg_temp.verifie('quatre scripts de secteur', n = 4, n::text);

  -- ==========================================================================
  -- B. Bora (admin) : les réglages et les secrets
  -- ==========================================================================
  v := pg_temp.x('authenticated', bora, $q$
    select count(*)::text || ':' || string_agg(actif::text || ',' || mode_test::text || ',' || inscription_auto::text, ';')
      from public.appels_ia_reglages $q$);
  perform pg_temp.verifie('Bora lit les réglages : une ligne, actif faux, mode_test vrai, inscription_auto faux',
    v = '1:false,true,false', v);

  v := pg_temp.x('authenticated', bora, $q$
    with s as (select public.appels_ia_poser_secret('openai_api_key', 'sk-test')) select 'posé' from s $q$);
  perform pg_temp.verifie('Bora pose openai_api_key', v = 'posé', v || ' ' || coalesce(current_setting('recette.err', true), ''));
  perform pg_temp.verifie('…le Vault la porte bien (lu en service)',
    (select decrypted_secret from vault.decrypted_secrets where name = 'appels_ia_openai_api_key') = 'sk-test');

  v := pg_temp.x('authenticated', bora, $q$
    select coalesce(json_agg(s)::text, '[]') from public.appels_ia_secrets_poses() s $q$);
  perform pg_temp.verifie('appels_ia_secrets_poses() liste le nom, et JAMAIS la valeur',
    v like '[%' and json_array_length(v::json) = 1 and (v::json -> 0 ->> 'nom') = 'openai_api_key'
    and (v::json -> 0 ->> 'pose_le') is not null and v not like '%sk-test%', v);

  v := pg_temp.x('authenticated', bora, $q$
    with s as (select public.appels_ia_poser_secret('openai_api_key', 'sk-test-2')) select 'posé' from s $q$);
  perform pg_temp.verifie('Bora REMPLACE la clé : la valeur change, le secret reste unique',
    v = 'posé'
    and (select decrypted_secret from vault.decrypted_secrets where name = 'appels_ia_openai_api_key') = 'sk-test-2'
    and (select count(*) from vault.secrets where name = 'appels_ia_openai_api_key') = 1, v);

  v := pg_temp.x('authenticated', bora, $q$
    with s as (select public.appels_ia_poser_secret('autre_cle', 'x')) select 'posé' from s $q$);
  perform pg_temp.verifie('un nom hors liste blanche est refusé (22023)', v = 'ERR:22023', v);

  v2 := public.appels_ia_secret('secret_interne');
  v := pg_temp.x('authenticated', bora, $q$
    with s as (select public.appels_ia_poser_secret('secret_interne', 'pirate')) select 'posé' from s $q$);
  perform pg_temp.verifie('l''admin ne peut PAS réécrire le secret interne par appels_ia_poser_secret (22023)',
    v = 'ERR:22023' and public.appels_ia_secret('secret_interne') = v2, v);

  v := pg_temp.x('authenticated', bora, $q$
    with s as (select public.appels_ia_poser_secret('sip_identifiant', '   ')) select 'posé' from s $q$);
  perform pg_temp.verifie('une valeur vide est refusée (22023)', v = 'ERR:22023', v);

  v := pg_temp.x('authenticated', bora, $q$ select public.appels_ia_secret('openai_api_key') $q$);
  perform pg_temp.verifie('appels_ia_secret est refusé à Bora (42501) — la valeur ne sort que vers le service', v = 'ERR:42501', v);
  perform pg_temp.verifie('en service : appels_ia_secret rend la clé, et rien hors liste blanche',
    public.appels_ia_secret('openai_api_key') = 'sk-test-2' and public.appels_ia_secret('autre_cle') is null);

  -- ==========================================================================
  -- C. Les contraintes (en propriétaire, sondes annulées)
  -- ==========================================================================
  c_fiche := public.appels_ia_campagne_systeme('fiche', bora);
  perform pg_temp.verifie('campagne système « fiche » : créée une fois, la seconde demande rend la même',
    c_fiche is not null and public.appels_ia_campagne_systeme('fiche', bora) = c_fiche
    and (select count(*) from public.appels_ia_campagnes where systeme = 'fiche') = 1);

  v := pg_temp.x(null, null, 'update public.appels_ia_reglages set plafond_jour = limite_compte_jour + 1 where id = 1', false, false);
  perform pg_temp.verifie('plafond_jour au-dessus de limite_compte_jour → 23514', v = 'ERR:23514', v);
  v := pg_temp.x(null, null, 'update public.appels_ia_reglages set plafond_jour = limite_compte_jour where id = 1', false, false);
  perform pg_temp.verifie('…témoin : plafond_jour ÉGAL à la limite passe', v = 'ok:1', v);
  v := pg_temp.x(null, null, 'update public.appels_ia_reglages set plafond_heure = limite_compte_heure + 1 where id = 1', false, false);
  perform pg_temp.verifie('plafond_heure au-dessus de limite_compte_heure → 23514', v = 'ERR:23514', v);
  v := pg_temp.x(null, null, 'update public.appels_ia_reglages set inscription_auto = true where id = 1', false, false);
  perform pg_temp.verifie('inscription_auto vrai sans inscription_auto_par → 23514', v = 'ERR:23514', v);
  v := pg_temp.x(null, null, format('update public.appels_ia_campagnes set statut = ''terminee'' where id = %L', c_fiche), false, false);
  perform pg_temp.verifie('une campagne système ne passe pas en « terminee » → 23514', v = 'ERR:23514', v);

  c_rec := pg_temp.x('authenticated', bora, $q$
    insert into public.appels_ia_campagnes (nom, cree_par) values ('RECETTE-025 campagne', auth.uid()) returning id $q$)::uuid;
  c_fin := pg_temp.x('authenticated', bora, $q$
    insert into public.appels_ia_campagnes (nom, statut, cree_par) values ('RECETTE-025 terminée', 'terminee', auth.uid()) returning id $q$)::uuid;
  v := pg_temp.x(null, null, format('update public.appels_ia_campagnes set statut = ''terminee'' where id = %L', c_rec), false, false);
  perform pg_temp.verifie('…témoin : une campagne ordinaire, elle, se termine', v = 'ok:1', v);

  -- ==========================================================================
  -- D. Le trigger d'inscription automatique
  -- ==========================================================================
  -- D1. Interrupteur coupé : rien n'entre.
  p_off := pg_temp.fiche('authenticated', bora, 'coupé', 'a_appeler', '081 22 33 44');
  perform pg_temp.verifie('interrupteur coupé : une fiche de Bora « À appeler » en 081 n''entre PAS dans la file',
    (select owner_id from public.prospects where id = p_off) = bora and pg_temp.nf(p_off) = 0 and pg_temp.nb(p_off) = 0,
    pg_temp.nf(p_off) || ' / ' || pg_temp.nb(p_off));

  -- D2. Bora allume.
  v := pg_temp.x('authenticated', bora, $q$
    with u as (update public.appels_ia_reglages set inscription_auto = true, inscription_auto_par = auth.uid()
                where id = 1 returning 1)
    select count(*) from u $q$);
  perform pg_temp.verifie('Bora allume l''inscription automatique',
    v = '1' and (select inscription_auto and inscription_auto_par = bora from public.appels_ia_reglages where id = 1), v);

  -- D3. Allumé : sa fiche « À appeler » entre.
  p_on := pg_temp.fiche('authenticated', bora, 'allumé', 'a_appeler', '081 22 33 44');
  select * into f from public.appels_ia_file where prospect_id = p_on;
  c_auto := (select id from public.appels_ia_campagnes where systeme = 'auto');
  file_on := f.id;
  perform pg_temp.verifie('allumé : la fiche de Bora « À appeler » entre dans la file, une fois',
    pg_temp.nf(p_on) = 1, pg_temp.nf(p_on)::text);
  perform pg_temp.verifie('…mode_test VRAI, figé depuis les réglages ; origine auto ; en attente ; 0 essai',
    f.mode_test and f.origine = 'auto' and f.statut = 'en_attente' and f.essais = 0,
    format('%s %s %s %s', f.mode_test, f.origine, f.statut, f.essais));
  perform pg_temp.verifie('…pas_avant = now() + 5 min (le temps du brief)',
    f.pas_avant between now() + interval '4 minutes 59 seconds' and now() + interval '5 minutes 1 second',
    f.pas_avant::text || ' vs ' || now()::text);
  perform pg_temp.verifie('…inscrite au nom de Bora, dans la campagne système « auto »',
    f.inscrit_par = bora and f.campagne_id = c_auto and c_auto is not null);
  perform pg_temp.verifie('…un brief « a_preparer » existe',
    (select etat from public.appels_ia_briefs where prospect_id = p_on) = 'a_preparer');

  -- D4. Une fiche de Collins, créée sous son identité.
  p_col := pg_temp.fiche('authenticated', collins, 'Collins', 'a_appeler', '081 77 88 99');
  perform pg_temp.verifie('une fiche de COLLINS (créée sous son identité) n''entre pas',
    (select owner_id from public.prospects where id = p_col) = collins and pg_temp.nf(p_col) = 0,
    pg_temp.nf(p_col)::text);

  -- D5. Collins crée une fiche AU NOM DE Bora (prospects_insert n'exige que
  --     is_member()) : elle ne doit pas faire appeler Janet pour autant.
  p_forge := pg_temp.fiche('authenticated', collins, 'forgée par Collins', 'a_appeler', '081 77 88 98', bora);
  perform pg_temp.verifie('une fiche créée par Collins AU NOM DE Bora n''entre pas (et sa création réussit)',
    (select owner_id from public.prospects where id = p_forge) = bora and pg_temp.nf(p_forge) = 0,
    pg_temp.nf(p_forge)::text);

  -- D6–D8. Les refus de la règle automatique (chemin service : connecteur MCP).
  p_0900 := pg_temp.fiche(null, null, '0900', 'a_appeler', '0900 12 345', bora);
  perform pg_temp.verifie('une fiche de Bora en 0900 n''entre pas', pg_temp.nf(p_0900) = 0);
  p_cont := pg_temp.fiche(null, null, 'contactée', 'contacte', '081 33 44 55', bora);
  perform pg_temp.verifie('une fiche de Bora « contacte » n''entre pas (automatique = « À appeler » seulement)', pg_temp.nf(p_cont) = 0);
  insert into public.appels_ia_opposition (numero, motif, source, cree_par)
  values ('+3281556677', 'recette 025', 'manuel', bora);
  p_opp := pg_temp.fiche(null, null, 'opposition', 'a_appeler', '081 55 66 77', bora);
  perform pg_temp.verifie('une fiche de Bora dont le numéro est en opposition n''entre pas', pg_temp.nf(p_opp) = 0);

  -- D9. Le chemin service (connecteur MCP) : la fiche de Bora entre.
  p_mcp := pg_temp.fiche(null, null, 'MCP', 'a_appeler', '010 22 33 44', bora);
  perform pg_temp.verifie('chemin service (MCP) : une fiche de Bora « À appeler » entre, au nom de Bora',
    (select count(*) from public.appels_ia_file where prospect_id = p_mcp and origine = 'auto' and inscrit_par = bora) = 1);

  -- D10. Sans téléphone, puis un numéro ajouté après coup.
  p_sans := pg_temp.fiche('authenticated', bora, 'sans téléphone', 'a_appeler', null);
  perform pg_temp.verifie('une fiche de Bora sans téléphone n''entre pas', pg_temp.nf(p_sans) = 0 and pg_temp.nb(p_sans) = 0);
  v := pg_temp.x('authenticated', bora, format(
    'update public.prospects set phone = ''0470 12 34 56'' where id = %L', p_sans), true, false);
  perform pg_temp.verifie('…on lui ajoute un téléphone (update of phone) : elle entre',
    v = 'ok:1' and pg_temp.nf(p_sans) = 1 and pg_temp.nb(p_sans) = 1
    and (select origine from public.appels_ia_file where prospect_id = p_sans) = 'auto', v || ' / ' || pg_temp.nf(p_sans));
  v := pg_temp.x('authenticated', bora, format(
    'update public.prospects set phone = ''0471 12 34 56'' where id = %L', p_sans), true, false);
  perform pg_temp.verifie('…une seconde mise à jour du numéro ne crée pas de doublon',
    v = 'ok:1' and pg_temp.nf(p_sans) = 1 and pg_temp.nb(p_sans) = 1, v || ' / ' || pg_temp.nf(p_sans));

  -- D11. Un numéro INVALIDE corrigé en numéro valide : il devient appelable, elle entre.
  p_corr := pg_temp.fiche('authenticated', bora, 'numéro corrigé', 'a_appeler', '070 11 22 33');
  perform pg_temp.verifie('une fiche de Bora en 070 n''entre pas', pg_temp.nf(p_corr) = 0);
  v := pg_temp.x('authenticated', bora, format(
    'update public.prospects set phone = ''081 11 22 33'' where id = %L', p_corr), true, false);
  perform pg_temp.verifie('…corrigée en 081 (le numéro DEVIENT appelable) : elle entre',
    v = 'ok:1' and pg_temp.nf(p_corr) = 1, v || ' / ' || pg_temp.nf(p_corr));

  -- D12. Le formulaire « Modifier la fiche » (updateProspectAction) réécrit
  --      `phone` à CHAQUE enregistrement, même inchangé. Une fiche déjà
  --      appelable avant l'allumage relève du rattrapage — explicite, compté —
  --      pas d'un enregistrement de formulaire.
  v := pg_temp.x('authenticated', bora, format(
    'update public.prospects set company_name = company_name || '' (modifiée)'', phone = phone where id = %L', p_off), true, false);
  perform pg_temp.verifie('formulaire : ré-enregistrer une fiche d''avant l''allumage (même numéro) ne l''inscrit PAS',
    v = 'ok:1' and pg_temp.nf(p_off) = 0, v || ' / ' || pg_temp.nf(p_off));

  -- D13. Le mode test se FIGE à la mise en file.
  v := pg_temp.x('authenticated', bora, $q$
    with u as (update public.appels_ia_reglages set mode_test = false where id = 1 returning 1) select count(*) from u $q$);
  p_reel := pg_temp.fiche('authenticated', bora, 'mode réel', 'a_appeler', '081 66 77 88');
  select id into file_reel from public.appels_ia_file where prospect_id = p_reel;
  perform pg_temp.verifie('mode test coupé : la ligne déjà en file RESTE en mode test, la nouvelle naît en mode réel',
    v = '1' and (select mode_test from public.appels_ia_file where id = file_on)
    and (select not mode_test from public.appels_ia_file where id = file_reel), v);
  v := pg_temp.x('authenticated', bora, $q$
    with u as (update public.appels_ia_reglages set mode_test = true where id = 1 returning 1) select count(*) from u $q$);
  perform pg_temp.verifie('…Bora remet le mode test', v = '1', v);

  -- ==========================================================================
  -- E. Le rattrapage (en Bora, mode test)
  -- ==========================================================================
  -- L'attendu, calculé À PART, sans appeler la règle de la migration.
  select count(*), count(*) filter (where p.company_name not like 'RECETTE-025%') into attendu, reelles
    from public.prospects p
   where p.owner_id = bora and p.status = 'a_appeler'
     and public.appels_ia_numero(p.phone) is not null
     and not exists (select 1 from public.appels_ia_opposition o where o.numero = public.appels_ia_numero(p.phone))
     and not exists (select 1 from public.meetings m
                      where m.prospect_id = p.id and m.kind = 'prospect'
                        and m.status in ('prevu', 'confirme', 'reporte') and m.starts_at > now())
     and not exists (select 1 from public.appels_ia_file x
                      where x.prospect_id = p.id and (x.mode_test or x.statut in ('en_attente', 'en_cours')));
  perform pg_temp.info(format('rattrapage : %s fiche(s) attendue(s), dont %s réelle(s) de Bora', attendu, reelles));

  n := (select count(*) from public.appels_ia_file);
  n2 := (select count(*) from public.appels_ia_briefs);
  v := pg_temp.x('authenticated', bora, 'select public.appels_ia_rattrapage(false)');
  perform pg_temp.verifie('rattrapage(false) compte exactement les fiches de Bora inscriptibles',
    v = attendu::text and attendu >= 1, v || ' vs ' || attendu);
  perform pg_temp.verifie('…et n''écrit rien',
    (select count(*) from public.appels_ia_file) = n and (select count(*) from public.appels_ia_briefs) >= n2
    and (select count(*) from public.appels_ia_briefs) = n2);

  v := pg_temp.x('authenticated', bora, 'select public.appels_ia_rattrapage(true)');
  select count(*) into n2 from public.appels_ia_file x
   where x.origine = 'rattrapage' and x.mode_test and x.inscrit_par = bora and x.campagne_id = c_auto
     and x.statut = 'en_attente' and x.pas_avant = now() + interval '5 minutes'
     and exists (select 1 from public.appels_ia_briefs b where b.prospect_id = x.prospect_id);
  perform pg_temp.verifie('rattrapage(true) les inscrit (origine rattrapage, mode test, au nom de Bora, brief prêt à préparer)',
    v = attendu::text and n2 = attendu and (select count(*) from public.appels_ia_file) = n + attendu,
    v || ' / ' || n2 || ' vs ' || attendu);
  perform pg_temp.verifie('…dont la fiche créée interrupteur coupé', pg_temp.nf(p_off) = 1);
  v := pg_temp.x('authenticated', bora, 'select public.appels_ia_rattrapage(false)');
  v2 := pg_temp.x('authenticated', bora, 'select public.appels_ia_rattrapage(true)');
  perform pg_temp.verifie('un second rattrapage rend 0', v = '0' and v2 = '0', v || ' / ' || v2);

  -- ==========================================================================
  -- F. L'inscription à la main (en Bora)
  -- ==========================================================================
  p_g    := pg_temp.fiche(null, null, 'gagnée',            'gagne',    '081 10 10 10', bora);
  p_p    := pg_temp.fiche(null, null, 'perdue',            'perdu',    '081 20 20 20', bora);
  p_inv  := pg_temp.fiche(null, null, 'numéro invalide',   'contacte', '070 22 33 44', bora);
  p_opp2 := pg_temp.fiche(null, null, 'opposition (main)', 'contacte', '081 55 66 77', bora);
  p_rdv  := pg_temp.fiche(null, null, 'RDV à venir',       'contacte', '081 30 30 30', bora);
  p_t    := pg_temp.fiche(null, null, 'campagne terminée', 'contacte', '081 40 40 40', bora);
  p_k    := pg_temp.fiche(null, null, 'à la main',         'contacte', '081 50 50 50', bora);
  p_s    := pg_temp.fiche(null, null, 'service',           'contacte', '081 60 60 60', bora);
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, created_by)
  values (bora, p_rdv, 'prospect', 'RDV recette 025', futur, futur + interval '1 hour', bora);

  v := pg_temp.x('authenticated', bora, format('select public.appels_ia_inscrire(%L, %L, ''manuel'', %L)', p_g, c_fiche, bora));
  perform pg_temp.verifie('inscrire refuse une fiche gagnée', v = 'Fiche gagnée ou perdue : Janet ne l''appelle jamais.', v);
  v := pg_temp.x('authenticated', bora, format('select public.appels_ia_inscrire(%L, %L, ''manuel'', %L)', p_p, c_fiche, bora));
  perform pg_temp.verifie('inscrire refuse une fiche perdue', v = 'Fiche gagnée ou perdue : Janet ne l''appelle jamais.', v);
  v := pg_temp.x('authenticated', bora, format('select public.appels_ia_inscrire(%L, %L, ''manuel'', %L)', p_inv, c_fiche, bora));
  perform pg_temp.verifie('inscrire refuse un numéro invalide (070)', v = 'Pas de numéro belge appelable sur la fiche.', v);
  v := pg_temp.x('authenticated', bora, format('select public.appels_ia_inscrire(%L, %L, ''manuel'', %L)', p_opp2, c_fiche, bora));
  perform pg_temp.verifie('inscrire refuse un numéro en opposition', v = 'Ce numéro est sur la liste d''opposition.', v);
  v := pg_temp.x('authenticated', bora, format('select public.appels_ia_inscrire(%L, %L, ''manuel'', %L)', p_rdv, c_fiche, bora));
  perform pg_temp.verifie('inscrire refuse une fiche avec un RDV à venir', v = 'Un rendez-vous est déjà prévu avec cette fiche.', v);
  v := pg_temp.x('authenticated', bora, format('select public.appels_ia_inscrire(%L, %L, ''manuel'', %L)', p_t, c_fin, bora));
  perform pg_temp.verifie('inscrire refuse une campagne terminée (la fiche, elle, était acceptable)',
    v = 'Cette campagne est terminée.' and pg_temp.nf(p_t) = 0, v);
  v := pg_temp.x('authenticated', bora, format('select public.appels_ia_inscrire(%L, %L, ''manuel'', %L)', p_t, gen_random_uuid(), bora));
  perform pg_temp.verifie('inscrire refuse une campagne introuvable', v = 'Campagne introuvable.', v);
  v := pg_temp.x('authenticated', bora, format('select public.appels_ia_inscrire(%L, %L, ''auto'', %L)', p_t, c_fiche, bora));
  perform pg_temp.verifie('inscrire refuse l''origine « auto » (réservée au trigger) → 22023', v = 'ERR:22023', v);
  perform pg_temp.verifie('…aucun de ces refus n''a écrit de ligne de file',
    pg_temp.nf(p_g) + pg_temp.nf(p_p) + pg_temp.nf(p_inv) + pg_temp.nf(p_opp2) + pg_temp.nf(p_rdv) + pg_temp.nf(p_t) = 0);

  v := pg_temp.x('authenticated', bora, format('select public.appels_ia_inscrire(%L, %L, ''manuel'', %L)', p_k, c_fiche, bora));
  select * into f from public.appels_ia_file where prospect_id = p_k;
  file_k := f.id;
  perform pg_temp.verifie('inscrire accepte À LA MAIN une fiche « contacte »',
    v = 'null' and f.origine = 'manuel' and f.inscrit_par = bora and f.mode_test and f.statut = 'en_attente'
    and f.pas_avant = now() and f.campagne_id = c_fiche and pg_temp.nb(p_k) = 1,
    v || ' ' || coalesce(current_setting('recette.err', true), ''));
  v := pg_temp.x('authenticated', bora, format('select public.appels_ia_inscrire(%L, %L, ''manuel'', %L)', p_k, c_fiche, bora));
  perform pg_temp.verifie('une seconde inscription de la même fiche rend « La fiche est déjà dans la file. »',
    v = 'La fiche est déjà dans la file.' and pg_temp.nf(p_k) = 1, v);
  v := pg_temp.x('authenticated', bora, format(
    'insert into public.appels_ia_file (campagne_id, prospect_id, mode_test, origine, inscrit_par) values (%L, %L, true, ''manuel'', %L)',
    c_fiche, p_k, bora), false, false);
  perform pg_temp.verifie('une insertion DIRECTE d''une seconde ligne vivante pour la même fiche → 23505', v = 'ERR:23505', v);

  v := pg_temp.x('authenticated', bora, format('select public.appels_ia_inscrire(%L, %L, ''manuel'', %L)', p_col, c_fiche, bora));
  perform pg_temp.verifie('à la main, l''admin peut inscrire la fiche d''un commercial (décision explicite)',
    v = 'null' and pg_temp.nf(p_col) = 1, v);

  -- Le chemin service (connecteur MCP) : p_par doit désigner un admin actif.
  v := pg_temp.x(null, null, format('select public.appels_ia_inscrire(%L, %L, ''mcp'', %L)', p_s, c_fiche, remi));
  perform pg_temp.verifie('en service, p_par = un commercial → 42501', v = 'ERR:42501', v);
  v := pg_temp.x(null, null, format('select public.appels_ia_inscrire(%L, %L, ''mcp'', null)', p_s, c_fiche));
  perform pg_temp.verifie('en service, p_par absent → 42501', v = 'ERR:42501', v);
  v := pg_temp.x(null, null, format('select public.appels_ia_inscrire(%L, %L, ''mcp'', %L)', p_s, c_fiche, bora));
  select id into file_s from public.appels_ia_file where prospect_id = p_s;
  perform pg_temp.verifie('en service, p_par = Bora → inscrite, origine mcp, au nom de Bora',
    v = 'null' and (select origine = 'mcp' and inscrit_par = bora from public.appels_ia_file where id = file_s), v);

  -- ==========================================================================
  -- G. Le verrou et la prise (en service)
  -- ==========================================================================
  perform pg_temp.verifie('aucun appel en cours au départ',
    (select count(*) from public.appels_ia where statut in ('reserve', 'composition', 'sonnerie', 'en_ligne')) = 0);
  v := pg_temp.x(null, null, format(
    'insert into public.appels_ia (prospect_id, mode_test, numero_compose, statut) values (%L, true, ''+3281505050'', ''termine'')', p_k),
    true, false);
  perform pg_temp.verifie('témoin : un appel TERMINÉ ne tient pas le verrou', v = 'ok:1', v);
  v := pg_temp.x(null, null, $q$
    with a as (insert into public.appels_ia (mode_test, numero_compose, statut) values (true, '+3281000001', 'reserve') returning 1),
         b as (insert into public.appels_ia (mode_test, numero_compose, statut) values (true, '+3281000002', 'en_ligne') returning 1)
    select (select count(*) from a) + (select count(*) from b) $q$, false);
  perform pg_temp.verifie('deux lignes appels_ia actives → la seconde 23505', v = 'ERR:23505', v);

  v := pg_temp.x(null, null, format('select public.appels_ia_prendre(%L, ''+3281505050'', false)', file_k));
  perform pg_temp.verifie('prendre une ligne de TEST en demandant le mode réel → null', v = 'null', v);
  v := pg_temp.x(null, null, format('select public.appels_ia_prendre(%L, ''+3281667788'', true)', file_reel));
  perform pg_temp.verifie('prendre une ligne RÉELLE en demandant le mode test → null', v = 'null', v);
  v := pg_temp.x(null, null, format('select public.appels_ia_prendre(%L, ''+3281223344'', false)', file_on));
  perform pg_temp.verifie('la ligne automatique de mode test n''est jamais prise en mode réel', v = 'null', v);
  perform pg_temp.verifie('…ces refus de mode n''ont rien réservé',
    (select count(*) from public.appels_ia where statut in ('reserve', 'composition', 'sonnerie', 'en_ligne')) = 0
    and (select statut from public.appels_ia_file where id = file_k) = 'en_attente');

  v := pg_temp.x(null, null, format('select public.appels_ia_prendre(%L, ''+3281505050'', true)', file_k));
  a1 := case when v ~ '^[0-9a-f-]{36}$' then v::uuid end;
  perform pg_temp.verifie('prendre une ligne due du MÊME mode rend un appel réservé', a1 is not null, v);
  select * into f from public.appels_ia where id = a1;
  perform pg_temp.verifie('…l''appel : réservé, mode test, fiche, propriétaire, lancé par l''inscripteur, essai 1, numéro figé',
    f.statut = 'reserve' and f.mode_test and f.prospect_id = p_k and f.proprietaire_id = bora
    and f.lance_par = bora and f.essai = 1 and f.numero_compose = '+3281505050' and f.file_id = file_k,
    format('%s %s %s %s %s', f.statut, f.mode_test, f.proprietaire_id, f.lance_par, f.essai));
  perform pg_temp.verifie('…la ligne de file passe « en_cours », cycle_debut posé',
    (select statut = 'en_cours' and cycle_debut is not null from public.appels_ia_file where id = file_k));
  v := pg_temp.x(null, null, format('select public.appels_ia_prendre(%L, ''+3281505050'', true)', file_k));
  perform pg_temp.verifie('…la même ligne ne se reprend pas (null)', v = 'null', v);

  v := pg_temp.x(null, null, $q$ insert into public.appels_ia (mode_test, numero_compose, statut) values (true, '+3281000003', 'composition') $q$, false, false);
  perform pg_temp.verifie('appel en cours : une seconde ligne active insérée directement → 23505', v = 'ERR:23505', v);
  v := pg_temp.x(null, null, format('select public.appels_ia_prendre(%L, ''+3281606060'', true)', file_s));
  perform pg_temp.verifie('appel en cours : une seconde prise lève 23505',
    v = 'ERR:23505' and (select statut from public.appels_ia_file where id = file_s) = 'en_attente', v);
  v := pg_temp.x(null, null, format('select public.appels_ia_prendre_test(null, ''+32470000000'', %L)', bora));
  perform pg_temp.verifie('appel en cours : l''appel de test hors file heurte le même verrou (23505)', v = 'ERR:23505', v);
  perform pg_temp.verifie('…toujours UN SEUL appel en cours',
    (select count(*) from public.appels_ia where statut in ('reserve', 'composition', 'sonnerie', 'en_ligne')) = 1);

  -- ==========================================================================
  -- H. Rémi (commercial) : rien, nulle part
  -- ==========================================================================
  acc := '';
  foreach t in array tables loop
    execute format('select count(*) from public.%I', t) into n;
    if n = 0 then acc := acc || ' ' || t; end if;
  end loop;
  perform pg_temp.verifie('précondition : les 7 tables ont des lignes (sinon « 0 ligne » ne prouverait rien)', acc = '', 'vides :' || acc);

  acc := '';
  foreach t in array tables loop
    v := pg_temp.x('authenticated', remi, format('select count(*) from public.%I', t));
    if v <> '0' then acc := acc || ' ' || t || '=' || v; end if;
  end loop;
  perform pg_temp.verifie('Rémi : SELECT sur chacune des 7 tables rend 0 ligne', acc = '', acc);

  v := pg_temp.x('authenticated', remi, 'insert into public.appels_ia_reglages (id, actif, mode_test) values (1, true, false)', false, false);
  perform pg_temp.verifie('Rémi : insérer des réglages → 42501', v = 'ERR:42501', v);
  v := pg_temp.x('authenticated', remi, format(
    'update public.appels_ia_reglages set actif = true, mode_test = false, inscription_auto_par = %L where id = 1', remi), true, false);
  perform pg_temp.verifie('Rémi : allumer le moteur / couper le mode test → 0 ligne, réglages intacts',
    v = 'ok:0' and (select not actif and mode_test and inscription_auto_par = bora from public.appels_ia_reglages where id = 1), v);
  fiche_remi := coalesce((select id from public.prospects where owner_id = remi order by id limit 1), p_k);
  v := pg_temp.x('authenticated', remi, format(
    'insert into public.appels_ia_file (campagne_id, prospect_id, mode_test, origine, inscrit_par) values (%L, %L, false, ''manuel'', %L)',
    c_rec, fiche_remi, remi), false, false);
  perform pg_temp.verifie('Rémi : mettre SA fiche dans la file en direct → 42501', v = 'ERR:42501', v);
  v := pg_temp.x('authenticated', remi, $q$ insert into public.appels_ia_opposition (numero, source) values ('+3281999999', 'manuel') $q$, false, false);
  perform pg_temp.verifie('Rémi : écrire dans la liste d''opposition → 42501', v = 'ERR:42501', v);
  n := (select count(*) from public.appels_ia_opposition);
  v := pg_temp.x('authenticated', remi, 'delete from public.appels_ia_opposition', true, false);
  perform pg_temp.verifie('Rémi : vider la liste d''opposition → 0 ligne', v = 'ok:0' and (select count(*) from public.appels_ia_opposition) = n, v);
  v := pg_temp.x('authenticated', remi, 'update public.appels_ia_file set statut = ''arrete''', true, false);
  perform pg_temp.verifie('Rémi : arrêter la file → 0 ligne', v = 'ok:0', v);

  v := pg_temp.x('authenticated', remi, $q$ with s as (select public.appels_ia_poser_secret('openai_api_key', 'sk-remi')) select 'posé' from s $q$);
  perform pg_temp.verifie('Rémi : appels_ia_poser_secret → 42501',
    v = 'ERR:42501' and public.appels_ia_secret('openai_api_key') = 'sk-test-2', v);
  v := pg_temp.x('authenticated', remi, 'select public.appels_ia_rattrapage(false)');
  v2 := pg_temp.x('authenticated', remi, 'select public.appels_ia_rattrapage(true)');
  perform pg_temp.verifie('Rémi : appels_ia_rattrapage (compter comme confirmer) → 42501', v = 'ERR:42501' and v2 = 'ERR:42501', v || ' / ' || v2);
  v := pg_temp.x('authenticated', remi, format('select public.appels_ia_inscrire(%L, %L, ''manuel'', %L)', fiche_remi, c_rec, bora));
  perform pg_temp.verifie('Rémi : appels_ia_inscrire (même en se réclamant de Bora) → 42501', v = 'ERR:42501', v);
  v := pg_temp.x('authenticated', remi, format('select public.appels_ia_campagne_systeme(''auto'', %L)', remi));
  perform pg_temp.verifie('Rémi : appels_ia_campagne_systeme → 42501', v = 'ERR:42501', v);
  v := pg_temp.x('authenticated', remi, $q$ select public.appels_ia_secret('openai_api_key') $q$);
  perform pg_temp.verifie('Rémi : appels_ia_secret non exécutable → 42501', v = 'ERR:42501', v);
  v := pg_temp.x('authenticated', remi, format('select public.appels_ia_prendre(%L, ''+3281606060'', true)', file_s));
  perform pg_temp.verifie('Rémi : appels_ia_prendre non exécutable → 42501', v = 'ERR:42501', v);
  v := pg_temp.x('authenticated', remi, format('select public.appels_ia_prendre_test(null, ''+32470000000'', %L)', remi));
  perform pg_temp.verifie('Rémi : appels_ia_prendre_test non exécutable → 42501', v = 'ERR:42501', v);
  v := pg_temp.x('authenticated', remi, 'select count(*) from public.appels_ia_secrets_poses()');
  perform pg_temp.verifie('Rémi : appels_ia_secrets_poses() ne lui montre rien', v = '0', v);

  v := pg_temp.x('authenticated', remi, 'select count(*) from public.prospects');
  perform pg_temp.verifie('Rémi voit le même nombre de fiches qu''à la baseline',
    v = current_setting('recette.remi_base', true), v || ' vs ' || current_setting('recette.remi_base', true));

  -- Anon : aucune fonction d'action.
  acc := '';
  foreach v2 in array array[
    'select public.appels_ia_rattrapage(false)',
    format('select public.appels_ia_inscrire(%L, %L, ''manuel'', %L)', p_t, c_rec, bora),
    'with s as (select public.appels_ia_poser_secret(''openai_api_key'', ''x'')) select 1 from s',
    'select count(*) from public.appels_ia_secrets_poses()',
    format('select public.appels_ia_campagne_systeme(''auto'', %L)', bora)] loop
    v := pg_temp.x('anon', null, v2);
    if v <> 'ERR:42501' then acc := acc || ' [' || v2 || ' → ' || v || ']'; end if;
  end loop;
  perform pg_temp.verifie('anon : rattrapage, inscrire, poser_secret, secrets_poses, campagne_systeme → 42501', acc = '', acc);

  -- ==========================================================================
  -- I. Rien d'autre n'a bougé
  -- ==========================================================================
  perform pg_temp.verifie('chaque insertion de fiche a réussi (le trigger n''échoue jamais une insertion)',
    coalesce(current_setting('recette.fiches_ko', true), '') = ''
    and (select count(*) from public.prospects where company_name like 'RECETTE-025%')
        = current_setting('recette.fiches_n', true)::int,
    current_setting('recette.fiches_n', true) || ' insertions' || coalesce(current_setting('recette.fiches_ko', true), ''));

  perform pg_temp.verifie('prospects : les lignes d''avant ont la même empreinte qu''à la baseline',
    (select md5(string_agg(p::text, '|' order by p.id)) from public.prospects p
      where p.id in (select id from base_ids where base_ids.t = 'prospects')) = (select prospects from base_md5)
    and (select count(*) from public.prospects p where p.id in (select id from base_ids where base_ids.t = 'prospects'))
        = (select count(*) from base_ids where base_ids.t = 'prospects'));
  perform pg_temp.verifie('tasks : les lignes d''avant ont la même empreinte qu''à la baseline',
    (select md5(string_agg(x::text, '|' order by x.id)) from public.tasks x
      where x.id in (select id from base_ids where base_ids.t = 'tasks')) = (select tasks from base_md5)
    and (select count(*) from public.tasks x where x.id in (select id from base_ids where base_ids.t = 'tasks'))
        = (select count(*) from base_ids where base_ids.t = 'tasks'));
  perform pg_temp.verifie('meetings : les lignes d''avant ont la même empreinte qu''à la baseline',
    (select md5(string_agg(x::text, '|' order by x.id)) from public.meetings x
      where x.id in (select id from base_ids where base_ids.t = 'meetings')) = (select meetings from base_md5)
    and (select count(*) from public.meetings x where x.id in (select id from base_ids where base_ids.t = 'meetings'))
        = (select count(*) from base_ids where base_ids.t = 'meetings'));
  perform pg_temp.verifie('activities : les lignes d''avant ont la même empreinte qu''à la baseline',
    (select md5(string_agg(x::text, '|' order by x.id)) from public.activities x
      where x.id in (select id from base_ids where base_ids.t = 'activities')) = (select activities from base_md5)
    and (select count(*) from public.activities x where x.id in (select id from base_ids where base_ids.t = 'activities'))
        = (select count(*) from base_ids where base_ids.t = 'activities'));
  perform pg_temp.verifie('les seules nouvelles lignes de prospects / tasks / meetings / activities sont des sondes',
    not exists (select 1 from public.prospects p
                 where p.id not in (select id from base_ids where base_ids.t = 'prospects')
                   and p.company_name not like 'RECETTE-025%')
    and not exists (select 1 from public.tasks x left join public.prospects p on p.id = x.prospect_id
                     where x.id not in (select id from base_ids where base_ids.t = 'tasks')
                       and coalesce(p.company_name, '') not like 'RECETTE-025%')
    and not exists (select 1 from public.meetings x left join public.prospects p on p.id = x.prospect_id
                     where x.id not in (select id from base_ids where base_ids.t = 'meetings')
                       and coalesce(p.company_name, '') not like 'RECETTE-025%')
    and not exists (select 1 from public.activities x left join public.prospects p on p.id = x.prospect_id
                     where x.id not in (select id from base_ids where base_ids.t = 'activities')
                       and coalesce(p.company_name, '') not like 'RECETTE-025%'));
end $recette$;
