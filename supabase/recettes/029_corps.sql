-- Recette 029 — les assertions (assemblées par 029_assembler.sh, entre la
-- migration verbatim et l'exception finale qui garantit le ROLLBACK).
--
-- Fiches de SONDE « RECETTE-029 … », numéros fictifs en 081 99 xx xx, toutes
-- de Bora sauf une de Collins. Ce qui est établi :
--   · la simulation dit, fiche par fiche, la raison de la règle 025 — la même
--     que celle que rendra l'inscription réelle ;
--   · admin seul (Collins, anon : refusés) ; la simulation n'écrit RIEN ;
--   · « lancer » (appels_ia_inscrire sur les fiches COCHÉES) inscrit
--     exactement les cochées acceptées, refuse les autres avec la bonne
--     raison, ne touche à aucune fiche hors sélection ;
--   · la production hors sondes est intacte (empreintes md5 de la baseline).

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

do $recette$
declare
  bora constant uuid := 'b3fdb505-76b0-4541-84ec-21b330afe58d';
  collins constant uuid := 'fc088df7-6bd5-4d28-b10a-417483964a9f';
  p_ok uuid; p_sans_num uuid; p_oppo uuid; p_rdv uuid; p_file uuid; p_gagne uuid; p_perdu uuid;
  p_collins uuid; p_hors uuid; p_surtaxe uuid;
  inconnu constant uuid := '00000000-0000-4000-8000-0000000c0029';
  camp_sonde uuid; camp uuid;
  ids uuid[];
  r record;
  attendu jsonb;
  obtenu jsonb;
  e text;
  n int;
  file_avant int;
  res text;
begin
  -- ---------- Les sondes ----------
  insert into public.prospects (company_name, owner_id, status, phone) values ('RECETTE-029 appelable', bora, 'a_appeler', '081 99 00 01') returning id into p_ok;
  insert into public.prospects (company_name, owner_id, status, phone) values ('RECETTE-029 sans numéro', bora, 'a_appeler', null) returning id into p_sans_num;
  insert into public.prospects (company_name, owner_id, status, phone) values ('RECETTE-029 surtaxé', bora, 'a_appeler', '0903 12 34 56') returning id into p_surtaxe;
  insert into public.prospects (company_name, owner_id, status, phone) values ('RECETTE-029 opposition', bora, 'a_appeler', '081 99 00 03') returning id into p_oppo;
  insert into public.appels_ia_opposition (numero, motif, source, cree_par) values ('+3281990003', 'recette 029', 'manuel', bora);
  insert into public.prospects (company_name, owner_id, status, phone) values ('RECETTE-029 rdv à venir', bora, 'contacte', '081 99 00 04') returning id into p_rdv;
  insert into public.meetings (prospect_id, owner_id, kind, title, starts_at, ends_at, status)
    values (p_rdv, bora, 'prospect', 'RDV recette 029', now() + interval '3 days', now() + interval '3 days 1 hour', 'prevu');
  insert into public.prospects (company_name, owner_id, status, phone) values ('RECETTE-029 déjà en file', bora, 'a_appeler', '081 99 00 05') returning id into p_file;
  insert into public.appels_ia_campagnes (nom, cree_par) values ('RECETTE-029 sonde', bora) returning id into camp_sonde;
  insert into public.appels_ia_file (campagne_id, prospect_id, mode_test, origine, inscrit_par)
    values (camp_sonde, p_file, true, 'manuel', bora);
  insert into public.prospects (company_name, owner_id, status, phone) values ('RECETTE-029 gagnée', bora, 'gagne', '081 99 00 06') returning id into p_gagne;
  insert into public.prospects (company_name, owner_id, status, phone) values ('RECETTE-029 perdue', bora, 'perdu', '081 99 00 07') returning id into p_perdu;
  insert into public.prospects (company_name, owner_id, status, phone) values ('RECETTE-029 de Collins', collins, 'a_appeler', '081 99 00 08') returning id into p_collins;
  insert into public.prospects (company_name, owner_id, status, phone) values ('RECETTE-029 hors sélection', bora, 'a_appeler', '081 99 00 09') returning id into p_hors;

  ids := array[p_ok, p_sans_num, p_surtaxe, p_oppo, p_rdv, p_file, p_gagne, p_perdu, p_collins, inconnu];
  attendu := jsonb_build_array(
    null,
    'Pas de numéro belge appelable sur la fiche.',
    'Pas de numéro belge appelable sur la fiche.',
    'Ce numéro est sur la liste d''opposition.',
    'Un rendez-vous est déjà prévu avec cette fiche.',
    'La fiche est déjà dans la file.',
    'Fiche gagnée ou perdue : Janet ne l''appelle jamais.',
    'Fiche gagnée ou perdue : Janet ne l''appelle jamais.',
    null,
    'Fiche introuvable.'
  );

  select count(*) into file_avant from public.appels_ia_file;

  -- ---------- La simulation, sous la session de Bora ----------
  perform pg_temp.etre(bora);
  select jsonb_agg(s.refus order by s.rang), count(*)
    into obtenu, n
    from (select t.refus, row_number() over () as rang from public.appels_ia_simuler_inscription(ids) t) s;
  perform pg_temp.redevenir();
  perform pg_temp.verifie('simulation : une ligne par fiche demandée, dans l''ordre', n = 10, n::text);
  perform pg_temp.verifie('simulation : chaque raison est celle de la règle 025', obtenu = attendu, obtenu::text);
  perform pg_temp.verifie('simulation : appelable → aucune raison', obtenu->0 = 'null'::jsonb);
  perform pg_temp.verifie('simulation : la fiche d''un commercial reste inscriptible à la main', obtenu->8 = 'null'::jsonb);

  -- Chaque raison est EXACTEMENT celle de la fonction 025, appelée directement.
  select count(*) into n
    from unnest(ids) with ordinality as x(id, rang)
   where (attendu->>(x.rang::int - 1)) is distinct from public.appels_ia_refus_inscription(x.id, false, bora, true);
  perform pg_temp.verifie('simulation ≡ appels_ia_refus_inscription (aucune recopie)', n = 0, n::text);

  perform pg_temp.verifie('la simulation n''écrit RIEN dans la file',
    (select count(*) from public.appels_ia_file) = file_avant);

  perform pg_temp.etre(bora);
  select count(*) into n from public.appels_ia_simuler_inscription('{}'::uuid[]);
  perform pg_temp.redevenir();
  perform pg_temp.verifie('simulation : sélection vide → aucune ligne', n = 0);

  perform pg_temp.etre(bora);
  begin
    perform public.appels_ia_simuler_inscription(array(select gen_random_uuid() from generate_series(1, 1001)));
    e := 'accepté';
  exception when others then e := sqlstate; end;
  perform pg_temp.redevenir();
  perform pg_temp.verifie('simulation : plus de 1 000 fiches refusées (22023)', e = '22023', e);

  -- ---------- Admin seul ----------
  perform pg_temp.etre(collins);
  begin
    perform public.appels_ia_simuler_inscription(array[p_collins]);
    e := 'accepté';
  exception when others then e := sqlstate; end;
  perform pg_temp.redevenir();
  perform pg_temp.verifie('Collins (commercial) : refusé (42501), même sur SA fiche', e = '42501', e);

  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin
    perform public.appels_ia_simuler_inscription(array[p_ok]);
    e := 'accepté';
  exception when others then e := sqlstate; end;
  execute 'reset role';
  perform pg_temp.verifie('anon : refusé (42501)', e = '42501', e);

  -- ---------- « Lancer » : la sélection COCHÉE passe par appels_ia_inscrire ----------
  -- Cochées : appelable, sans numéro, opposition, de Collins. Pas cochée : « hors sélection ».
  perform pg_temp.etre(bora);
  insert into public.appels_ia_campagnes (nom, cree_par) values ('RECETTE-029 lancée', bora) returning id into camp;
  for r in select x.id, x.rang from unnest(array[p_ok, p_sans_num, p_oppo, p_collins]) with ordinality as x(id, rang) loop
    res := public.appels_ia_inscrire(r.id, camp, 'manuel', bora, 0::smallint, null);
    perform set_config('recette.lance_' || r.rang, coalesce(res, 'INSCRITE'), true);
  end loop;
  perform pg_temp.redevenir();

  perform pg_temp.verifie('lancer : l''appelable est inscrite', current_setting('recette.lance_1') = 'INSCRITE', current_setting('recette.lance_1'));
  perform pg_temp.verifie('lancer : sans numéro, refusée avec la MÊME raison que la simulation',
    current_setting('recette.lance_2') = attendu->>1, current_setting('recette.lance_2'));
  perform pg_temp.verifie('lancer : opposition, refusée avec la MÊME raison que la simulation',
    current_setting('recette.lance_3') = attendu->>3, current_setting('recette.lance_3'));
  perform pg_temp.verifie('lancer : la fiche de Collins cochée est inscrite', current_setting('recette.lance_4') = 'INSCRITE', current_setting('recette.lance_4'));

  perform pg_temp.verifie('lancer : EXACTEMENT deux lignes de plus dans la file',
    (select count(*) from public.appels_ia_file) = file_avant + 2,
    ((select count(*) from public.appels_ia_file) - file_avant)::text);
  perform pg_temp.verifie('lancer : les deux lignes sont dans la campagne lancée, en attente',
    (select count(*) from public.appels_ia_file where campagne_id = camp and statut = 'en_attente'
       and prospect_id in (p_ok, p_collins)) = 2);
  perform pg_temp.verifie('lancer : la fiche NON cochée n''entre pas dans la file',
    not exists (select 1 from public.appels_ia_file where prospect_id = p_hors));
  perform pg_temp.verifie('lancer : les refusées n''entrent pas dans la file',
    not exists (select 1 from public.appels_ia_file where prospect_id in (p_sans_num, p_oppo)));
  perform pg_temp.verifie('lancer : le mode de la ligne est celui des réglages',
    (select bool_and(f.mode_test = r2.mode_test) from public.appels_ia_file f, public.appels_ia_reglages r2
      where f.campagne_id = camp));

  perform pg_temp.etre(bora);
  select t.refus into res from public.appels_ia_simuler_inscription(array[p_ok]) t;
  perform pg_temp.redevenir();
  perform pg_temp.verifie('re-simuler après le lancement : « déjà dans la file »',
    res = 'La fiche est déjà dans la file.', res);

  perform pg_temp.verifie('aucune fiche n''a changé (simulation et inscription n''écrivent pas sur prospects)',
    (select md5(string_agg(p::text, '|' order by p.id)) from public.prospects p
      where p.company_name not like 'RECETTE-029 %') = (select prospects from base_md5));
  perform pg_temp.verifie('les relances, rendez-vous et activités d''avant sont intacts',
    (select md5(string_agg(t::text, '|' order by t.id)) from public.tasks t) = (select tasks from base_md5)
    and (select md5(string_agg(a::text, '|' order by a.id)) from public.activities a) = (select activities from base_md5)
    and (select md5(string_agg(m::text, '|' order by m.id)) from public.meetings m
          where m.title <> 'RDV recette 029') = (select meetings from base_md5));
  perform pg_temp.verifie('la file d''avant est intacte',
    (select md5(coalesce(string_agg(f::text, '|' order by f.id), '')) from public.appels_ia_file f
      where f.campagne_id not in (camp, camp_sonde)) = (select file from base_md5));
end $recette$;
