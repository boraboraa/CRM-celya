-- ============================================================
-- Recette 031 — corps (assertions). NE S'EXÉCUTE PAS SEUL.
--
-- Assemblé par supabase/recettes/031_assembler.sh :
--   1. baseline (même transaction, juste avant la migration) ;
--   2. la migration 031 VERBATIM ;
--   3. ce corps — les jeux de cas JSON (secteurs, clés de doublon, compteurs)
--      y sont injectés par l'assembleur à la place des marqueurs @@… ;
--   4. une exception finale qui porte le rapport ET garantit le rollback.
--
-- Comptes RÉELS (27/10/2026) : Bora (admin), Collins et Nathan (encadrent les
-- quatre étudiants), Rémi (seul), Hakim et Meryem (étudiants), et le compte
-- de banc désactivé `mobile-admin@celya.test` (un compte INACTIF).
-- Toutes les fiches de sonde s'appellent « ZZ Recette 031 … ».
--
-- La 030 (valeur d'enum `essai_gratuit`) ne peut pas être utilisée dans la
-- transaction qui l'ajoute : les assertions qui posent l'étape sont SAUTÉES
-- tant que la 030 n'est pas appliquée (elles le disent, elles ne comptent
-- pas comme réussies).
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

-- Se mettre dans la peau d'un membre (RLS et auth.uid() comme sous PostgREST).
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

-- Exécuter une instruction et rendre son issue : « OK », ou le SQLSTATE.
create function pg_temp.etat(p_sql text) returns text language plpgsql as $s$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate;
end $s$;

-- Le nombre de lignes touchées par une instruction (0 si elle échoue).
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
  remi    constant uuid := '640f3e05-d9da-4fdc-a0eb-553a3afa00d6';
  hakim   constant uuid := 'afa7eb3d-b3cd-45d9-bac7-ae437757e0c9';
  meryem  constant uuid := '40e345c5-1adb-4e43-a89d-74303d473ad0';
  inactif constant uuid := 'b0000000-0000-4000-8000-00000000ad01';
  h constant timestamptz := date_trunc('hour', now());
  f_h uuid; f_m uuid; f_attr uuid; f_b uuid; f_x uuid;
  t_ouverte uuid; t_faite uuid; m_futur uuid; m_passe uuid; m_essai uuid;
  r record; n int; v text; v_ids uuid[];
  enum_essai boolean := exists (
    select 1 from pg_enum where enumtypid = 'public.prospect_status'::regtype and enumlabel = 'essai_gratuit');
begin
  -- ==========================================================================
  -- A. La reprise : seuls les secteurs bougent, et exactement comme prévu
  -- ==========================================================================
  select count(*) into n from base_prospects b where b.sector is distinct from public.normaliser_secteur(b.sector);
  perform pg_temp.info(n || ' fiche(s) dont le secteur change (52 le 27/10 à 15h, sur 98 fiches)');
  perform pg_temp.verifie('reprise : chaque secteur a pris la valeur de normaliser_secteur, et seulement elle',
    not exists (select 1 from base_prospects b join public.prospects p using (id)
                 where p.sector is distinct from public.normaliser_secteur(b.sector)));
  perform pg_temp.verifie('reprise : les fiches dont le secteur ne change pas gardent leur updated_at',
    not exists (select 1 from base_prospects b join public.prospects p using (id)
                 where b.sector is not distinct from public.normaliser_secteur(b.sector)
                   and p.updated_at is distinct from b.updated_at));
  perform pg_temp.verifie('reprise : toutes les valeurs sont dans la liste fixe (ou vides)',
    not exists (select 1 from public.prospects p where p.sector is not null and p.sector <> all (array[
      'Garage / carrosserie', 'Syndic de copropriété', 'Agence immobilière', 'Vétérinaire', 'Cabinet dentaire',
      'Centre médical / maison médicale', 'Kiné / paramédical', 'Opticien / audioprothésiste',
      'Chauffagiste / plombier', 'Institut de beauté', 'Auto-école', 'Infirmier à domicile',
      'Courtier en assurances', 'Restaurant / HoReCa', 'Autre'])));
  perform pg_temp.verifie('reprise : aucune AUTRE colonne de fiche n''a bougé',
    (select md5(string_agg((to_jsonb(p) - 'sector' - 'updated_at' - 'starred_at' - 'essai_gratuit_at')::text, '|' order by p.id))
       from public.prospects p) = (select prospects_hors_secteur from base_md5));
  perform pg_temp.verifie('reprise : aucune relance, aucun RDV, aucune ligne de journal touchés',
    (select md5(string_agg(t::text, '|' order by t.id)) from public.tasks t) = (select tasks from base_md5)
    and (select md5(string_agg(m::text, '|' order by m.id)) from public.meetings m) = (select meetings from base_md5)
    and (select md5(string_agg(a::text, '|' order by a.id)) from public.activities a) = (select activities from base_md5));

  -- ==========================================================================
  -- B. Les jeux de cas partagés avec le TypeScript (injectés)
  -- ==========================================================================
  -- @@CAS_SECTEURS@@
  -- @@CAS_CLES@@

  -- Le trigger range ce qu'écrivent tous les écrivains.
  insert into public.prospects (company_name, sector, owner_id, created_by)
    values ('ZZ Recette 031 Secteur', 'garage', hakim, hakim) returning id into f_x;
  perform pg_temp.verifie('trigger : « garage » à l''insertion → Garage / carrosserie',
    (select sector from public.prospects where id = f_x) = 'Garage / carrosserie');
  update public.prospects set sector = 'Toiture' where id = f_x;
  perform pg_temp.verifie('trigger : « Toiture » à la mise à jour → Autre',
    (select sector from public.prospects where id = f_x) = 'Autre');
  update public.prospects set sector = '   ' where id = f_x;
  perform pg_temp.verifie('trigger : des espaces → pas de secteur',
    (select sector from public.prospects where id = f_x) is null);

  -- ==========================================================================
  -- C. prospects_insert : seul l'admin crée au nom d'un autre
  -- ==========================================================================
  perform pg_temp.etre(hakim);
  perform pg_temp.verifie('insertion : un étudiant crée SA fiche sans préciser le responsable',
    pg_temp.etat($$insert into public.prospects (company_name) values ('ZZ Recette 031 Hakim seul')$$) = 'OK');
  perform pg_temp.verifie('insertion : …et elle est bien à lui',
    (select owner_id from public.prospects where company_name = 'ZZ Recette 031 Hakim seul') = hakim);
  v := pg_temp.etat(format($$insert into public.prospects (company_name, owner_id) values ('ZZ Recette 031 Poussée', %L)$$, collins));
  perform pg_temp.verifie('insertion : un étudiant NE PEUT PAS créer une fiche au nom de Collins (42501)', v = '42501', v);
  perform pg_temp.redevenir();
  perform pg_temp.etre(bora);
  perform pg_temp.verifie('insertion : l''admin crée une fiche pour Hakim',
    pg_temp.etat(format($$insert into public.prospects (company_name, owner_id) values ('ZZ Recette 031 Pour Hakim', %L)$$, hakim)) = 'OK');
  perform pg_temp.redevenir();

  -- ==========================================================================
  -- D. Doublons d'équipe — des booléens, sans nommer personne
  -- ==========================================================================
  insert into public.prospects (company_name, phone, owner_id, created_by)
    values ('ZZ Recette 031 Cabinet Doublon', '081 99 88 77', meryem, meryem) returning id into f_m;

  perform pg_temp.etre(hakim);
  select * into r from public.doublons_equipe(array['+32 81 99 88 77'], array[null::text]);
  perform pg_temp.verifie('doublon (Hakim) : même numéro écrit autrement → « déjà suivie », sans fiche ni responsable',
    r.par_telephone and not r.par_societe and not r.a_moi and r.fiche_id is null and r.proprietaire is null,
    row_to_json(r)::text);
  select * into r from public.doublons_equipe(array[null::text], array['zz recette 031 cabinet doublon SPRL']);
  perform pg_temp.verifie('doublon (Hakim) : même nom, forme juridique ignorée',
    r.par_societe and r.fiche_id is null and r.proprietaire is null, row_to_json(r)::text);
  perform pg_temp.verifie('doublon (Hakim) : la fiche de Meryem lui reste INVISIBLE',
    not exists (select 1 from public.prospects where id = f_m));
  select * into r from public.doublons_equipe(array['0470 00 00 01'], array['ZZ Recette 031 Inexistant']);
  perform pg_temp.verifie('doublon (Hakim) : rien de semblable → tout faux',
    not r.par_telephone and not r.par_societe and not r.a_moi, row_to_json(r)::text);
  v := pg_temp.etat($$select * from public.doublons_equipe_pour('40e345c5-1adb-4e43-a89d-74303d473ad0', array['x'], array['y'])$$);
  perform pg_temp.verifie('doublon : la porte service_role est fermée à un membre (42501)', v = '42501', v);
  v := pg_temp.etat($$select * from public.doublons_equipe(array_fill('0470 00 00 00'::text, array[201]), array_fill(null::text, array[201]))$$);
  perform pg_temp.verifie('doublon : 200 entrées au plus par appel (22023)', v = '22023', v);
  perform pg_temp.redevenir();

  perform pg_temp.etre(meryem);
  select * into r from public.doublons_equipe(array['081 99 88 77'], array[null::text]);
  perform pg_temp.verifie('doublon (Meryem) : c''est la SIENNE → a_moi et l''id de la fiche',
    r.a_moi and r.fiche_id = f_m and r.proprietaire is null, row_to_json(r)::text);
  perform pg_temp.redevenir();

  perform pg_temp.etre(bora);
  select * into r from public.doublons_equipe(array['081 99 88 77'], array[null::text]);
  perform pg_temp.verifie('doublon (admin) : le responsable est nommé',
    r.par_telephone and r.proprietaire = meryem, row_to_json(r)::text);
  perform pg_temp.redevenir();

  perform pg_temp.etre(inactif);
  v := pg_temp.etat($$select * from public.doublons_equipe(array['081 99 88 77'], array[null::text])$$);
  perform pg_temp.verifie('doublon : un compte INACTIF n''apprend rien (42501)', v = '42501', v);
  perform pg_temp.redevenir();

  execute 'set local role anon';
  v := pg_temp.etat($$select * from public.doublons_equipe(array['081 99 88 77'], array[null::text])$$);
  perform pg_temp.verifie('doublon : anon refusé (42501)', v = '42501', v);
  execute 'reset role';

  perform pg_temp.verifie('doublon (service_role) : la porte du connecteur, au nom du porteur',
    (select a_moi from public.doublons_equipe_pour(meryem, array['081 99 88 77'], array[null::text])));

  -- ==========================================================================
  -- E. L'étoile — le responsable seul ; l'encadrant la voit
  -- ==========================================================================
  insert into public.prospects (company_name, owner_id, created_by)
    values ('ZZ Recette 031 Étoile', hakim, hakim) returning id into f_h;
  perform pg_temp.etre(hakim);
  n := pg_temp.lignes(format($$update public.prospects set starred_at = now() where id = %L$$, f_h));
  perform pg_temp.verifie('étoile : l''étudiant étoile SA fiche', n = 1, n::text);
  perform pg_temp.redevenir();
  perform pg_temp.etre(collins);
  n := pg_temp.lignes(format($$update public.prospects set starred_at = null where id = %L$$, f_h));
  perform pg_temp.verifie('étoile : l''encadrant ne la retire pas (0 ligne)', n = 0, n::text);
  perform pg_temp.verifie('étoile : …mais il la VOIT',
    (select starred_at is not null from public.prospects where id = f_h));
  perform pg_temp.redevenir();
  perform pg_temp.etre(meryem);
  perform pg_temp.verifie('étoile : un autre étudiant ne voit pas la fiche',
    not exists (select 1 from public.prospects where id = f_h));
  perform pg_temp.redevenir();

  -- ==========================================================================
  -- F. L'attribution — l'admin seul ; relances ouvertes et RDV à venir suivent
  -- ==========================================================================
  insert into public.prospects (company_name, owner_id, created_by)
    values ('ZZ Recette 031 Attribution', hakim, bora) returning id into f_attr;
  -- Le RDV passé est DÉBRIEFÉ (sinon le RDV à venir le clorait « remplacé »,
  -- 027) ; la relance tombe APRÈS le RDV à venir (sinon il la clorait, 022).
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, status, debriefed_at, created_by)
    values (hakim, f_attr, 'prospect', 'ZZ passé', h - interval '10 days', h - interval '10 days' + interval '1 hour', 'honore', h - interval '9 days', hakim)
    returning id into m_passe;
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, status, created_by)
    values (hakim, f_attr, 'prospect', 'ZZ à venir', h + interval '3 days', h + interval '3 days' + interval '1 hour', 'prevu', hakim)
    returning id into m_futur;
  insert into public.tasks (prospect_id, title, due_at, status, assignee_id, created_by)
    values (f_attr, 'ZZ ouverte', h + interval '5 days', 'a_faire', hakim, hakim) returning id into t_ouverte;
  insert into public.tasks (prospect_id, title, due_at, status, assignee_id, created_by)
    values (f_attr, 'ZZ faite', h - interval '5 days', 'fait', hakim, hakim) returning id into t_faite;

  perform pg_temp.etre(hakim);
  v := pg_temp.etat(format($$select public.attribuer_prospects(array[%L]::uuid[], %L)$$, f_attr, meryem));
  perform pg_temp.verifie('attribution : un étudiant ne réattribue pas (42501)', v = '42501', v);
  perform pg_temp.redevenir();
  perform pg_temp.etre(collins);
  v := pg_temp.etat(format($$select public.attribuer_prospects(array[%L]::uuid[], %L)$$, f_attr, meryem));
  perform pg_temp.verifie('attribution : un encadrant non plus (42501)', v = '42501', v);
  perform pg_temp.redevenir();

  perform pg_temp.etre(bora);
  perform pg_temp.verifie('attribution : l''admin attribue — une fiche a changé',
    public.attribuer_prospects(array[f_attr], meryem) = 1);
  perform pg_temp.verifie('attribution : la fiche est à Meryem',
    (select owner_id from public.prospects where id = f_attr) = meryem);
  perform pg_temp.verifie('attribution : la relance OUVERTE suit, la relance faite reste à Hakim',
    (select assignee_id from public.tasks where id = t_ouverte) = meryem
    and (select assignee_id from public.tasks where id = t_faite) = hakim);
  perform pg_temp.verifie('attribution : le RDV à venir suit, le RDV passé reste à Hakim',
    (select owner_id from public.meetings where id = m_futur) = meryem
    and (select owner_id from public.meetings where id = m_passe) = hakim);
  perform pg_temp.verifie('attribution : la relance ouverte n''a pas été close au passage',
    (select status from public.tasks where id = t_ouverte) = 'a_faire');
  perform pg_temp.verifie('attribution : une ligne au journal, signée de l''admin',
    exists (select 1 from public.activities where prospect_id = f_attr and author_id = bora
             and subject like 'Fiche attribuée à meryem%' and not is_exchange and outcome is null));
  perform pg_temp.verifie('attribution : rejouée, rien ne change (0)',
    public.attribuer_prospects(array[f_attr], meryem) = 0);
  v := pg_temp.etat(format($$select public.attribuer_prospects(array[%L]::uuid[], %L)$$, f_attr, inactif));
  perform pg_temp.verifie('attribution : vers un compte inactif, refusé (22023)', v = '22023', v);
  perform pg_temp.redevenir();

  -- ==========================================================================
  -- G. L'issue de débrief « essai » et l'étape « Essai gratuit »
  -- ==========================================================================
  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, status, created_by)
    values (hakim, f_h, 'prospect', 'ZZ essai', h - interval '2 days', h - interval '2 days' + interval '1 hour', 'prevu', hakim)
    returning id into m_essai;
  perform pg_temp.verifie('débrief : la contrainte accepte l''issue « essai »',
    pg_temp.etat(format($$update public.meetings set status = 'honore', debriefed_at = now(), debrief_issue = 'essai' where id = %L$$, m_essai)) = 'OK');
  v := pg_temp.etat(format($$update public.meetings set debrief_issue = 'bidon' where id = %L$$, m_essai));
  perform pg_temp.verifie('débrief : une issue inconnue est refusée (23514)', v = '23514', v);
  if enum_essai then
    execute format($$update public.prospects set status = 'essai_gratuit' where id = %L$$, f_h);
    perform pg_temp.verifie('essai : essai_gratuit_at est posé à l''entrée dans l''étape',
      (select essai_gratuit_at is not null from public.prospects where id = f_h));
    perform pg_temp.verifie('essai : une fiche en essai n''est pas close — sa prochaine action se calcule comme ailleurs',
      (select count(*) from public.prospects where id = f_h) = 1);
  else
    perform pg_temp.info('SAUTÉ (030 absente) : essai_gratuit_at et l''étape — à rejouer après la 030');
  end if;

  -- ==========================================================================
  -- H. Objectifs — l'admin écrit ; chacun lit les siens, l'encadrant ceux qu'il encadre
  -- ==========================================================================
  perform pg_temp.etre(bora);
  perform pg_temp.verifie('objectifs : l''admin pose ceux de Hakim et de Meryem',
    pg_temp.etat(format($$insert into public.objectifs (user_id, semaine, appels, reponses, rdv) values (%L, '2026-11-02', 60, 15, 3), (%L, '2026-11-02', 50, 10, 2)$$, hakim, meryem)) = 'OK'
    and pg_temp.etat(format($$insert into public.objectifs_periode (user_id, debut, essais) values (%L, '2026-11-02', 2)$$, hakim)) = 'OK');
  v := pg_temp.etat(format($$insert into public.objectifs (user_id, semaine, appels) values (%L, '2026-11-03', 1)$$, hakim));
  perform pg_temp.verifie('objectifs : une semaine se désigne par son LUNDI (23514)', v = '23514', v);
  perform pg_temp.redevenir();

  perform pg_temp.etre(hakim);
  v := pg_temp.etat(format($$insert into public.objectifs (user_id, semaine, appels) values (%L, '2026-11-09', 1)$$, hakim));
  perform pg_temp.verifie('objectifs : un étudiant n''écrit pas les siens (42501)', v = '42501', v);
  n := pg_temp.lignes(format($$update public.objectifs set appels = 1 where user_id = %L$$, hakim));
  perform pg_temp.verifie('objectifs : …ni ne les modifie (0 ligne)', n = 0, n::text);
  perform pg_temp.verifie('objectifs : il lit LES SIENS, pas ceux de Meryem',
    (select count(*) from public.objectifs) = 1 and (select user_id from public.objectifs) = hakim);
  perform pg_temp.redevenir();
  perform pg_temp.etre(collins);
  perform pg_temp.verifie('objectifs : l''encadrant lit ceux de ses deux étudiants',
    (select count(*) from public.objectifs where user_id in (hakim, meryem)) = 2);
  perform pg_temp.redevenir();
  perform pg_temp.etre(remi);
  perform pg_temp.verifie('objectifs : Rémi ne lit rien',
    (select count(*) from public.objectifs) = 0 and (select count(*) from public.objectifs_periode) = 0);
  perform pg_temp.redevenir();

  -- ==========================================================================
  -- I. Les compteurs — le jeu de cas de compteurs.cas.json (injecté)
  -- ==========================================================================
  -- @@FIXTURE_COMPTEURS@@

  perform pg_temp.etre(hakim);
  perform pg_temp.verifie('compteurs_de : soi-même', pg_temp.etat(format($$select * from public.compteurs_de(%L, '2026-11-02', '2026-11-09')$$, hakim)) = 'OK');
  v := pg_temp.etat(format($$select * from public.compteurs_de(%L, '2026-11-02', '2026-11-09')$$, meryem));
  perform pg_temp.verifie('compteurs_de : pas ceux d''un autre étudiant (42501)', v = '42501', v);
  v := pg_temp.etat(format($$select * from public.compteurs_de(%L, '2026-01-01', '2027-06-01')$$, hakim));
  perform pg_temp.verifie('compteurs_de : une période de plus de 400 jours est refusée (22023)', v = '22023', v);
  v := pg_temp.etat(format($$select * from public.compteurs_pour(array[%L]::uuid[], '2026-11-02', '2026-11-09')$$, hakim));
  perform pg_temp.verifie('compteurs_pour : la règle brute est fermée aux membres (42501)', v = '42501', v);
  perform pg_temp.redevenir();
  perform pg_temp.etre(collins);
  perform pg_temp.verifie('compteurs_de : l''encadrant lit ceux de son étudiant',
    pg_temp.etat(format($$select * from public.compteurs_de(%L, '2026-11-02', '2026-11-09')$$, hakim)) = 'OK');
  perform pg_temp.redevenir();
  perform pg_temp.etre(remi);
  v := pg_temp.etat(format($$select * from public.compteurs_de(%L, '2026-11-02', '2026-11-09')$$, hakim));
  perform pg_temp.verifie('compteurs_de : Rémi ne lit pas ceux d''un étudiant (42501)', v = '42501', v);
  perform pg_temp.redevenir();

  -- ==========================================================================
  -- J. Le classement — des chiffres, pour les participants seulement
  -- ==========================================================================
  perform pg_temp.etre(meryem);
  select array_agg(user_id order by user_id) into v_ids from public.classement_equipe('2026-11-02', '2026-11-09');
  perform pg_temp.verifie('classement : les participants sont ceux qui ont un objectif (Hakim, Meryem)',
    v_ids = (select array_agg(x order by x) from unnest(array[hakim, meryem]) x), coalesce(v_ids::text, '∅'));
  perform pg_temp.verifie('classement : ni Rémi (sans objectif), ni l''admin',
    not (remi = any(v_ids)) and not (bora = any(v_ids)));
  select * into r from public.classement_equipe('2026-11-02', '2026-11-09') where user_id = hakim;
  perform pg_temp.verifie('classement : un étudiant voit les chiffres de l''autre — et rien d''autre',
    (select array_agg(k order by k) from jsonb_object_keys(to_jsonb(r)) k)
      = array['appels', 'essais', 'interesses', 'nom', 'numeros', 'rdv', 'reponses', 'user_id'],
    to_jsonb(r)::text);
  perform pg_temp.redevenir();

  execute 'set local role anon';
  v := pg_temp.etat($$select * from public.classement_equipe('2026-11-02', '2026-11-09')$$);
  perform pg_temp.verifie('classement : anon refusé (42501)', v = '42501', v);
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  perform pg_temp.verifie('classement : le connecteur MCP (service_role) le lit',
    (select count(*) from public.classement_equipe('2026-11-02', '2026-11-09')) = 2);
  perform pg_temp.redevenir();

  perform pg_temp.etre(inactif);
  v := pg_temp.etat($$select * from public.classement_equipe('2026-11-02', '2026-11-09')$$);
  perform pg_temp.verifie('classement : un compte inactif refusé (42501)', v = '42501', v);
  perform pg_temp.redevenir();
end $recette$;
