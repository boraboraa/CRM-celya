-- ============================================================
-- Recette 034 — corps (assertions). NE S'EXÉCUTE PAS SEUL.
--
-- Assemblé par supabase/recettes/034_assembler.sh :
--   1. baseline (même transaction, juste avant la migration) ;
--   2. la migration 034 VERBATIM ;
--   3. ce corps — lib/crm/lieux.cas.json et la liste des régions de
--      lib/crm/regions.ts y sont injectés à la place des marqueurs @@… ;
--   4. une exception finale qui porte le rapport ET garantit le rollback.
-- Les fiches de sonde s'appellent « ZZ Recette 034 … » (Nathan, commercial).
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

do $recette$
declare
  nathan uuid := (select id from public.crm_users where full_name ilike 'Nathan%' and role = 'commercial' limit 1);
  v text;
  r record;
  fx uuid;
  avant timestamptz;
begin
  -- ==========================================================================
  -- 1. La règle, cas par cas
  -- ==========================================================================
  -- @@CAS_LIEUX@@

  -- ==========================================================================
  -- 2. La liste des régions : la même qu'en TypeScript
  -- ==========================================================================
  -- @@REGIONS_TS@@

  -- ==========================================================================
  -- 3. Le trigger, sous la session d'un commercial (RLS comprise)
  -- ==========================================================================
  perform pg_temp.etre(nathan);
  insert into public.prospects (company_name, owner_id, city)
    values ('ZZ Recette 034 Woluwe', nathan, 'woluwe st pierre') returning id into fx;
  select city, region into r from public.prospects where id = fx;
  perform pg_temp.verifie('trigger : à la création, la commune est rangée et la région déduite',
    r.city = 'Woluwe-Saint-Pierre' and r.region = 'Woluwe-Saint-Pierre', r.city || ' / ' || coalesce(r.region, 'NULL'));

  update public.prospects set city = 'Éghezée' where id = fx;
  select city, region into r from public.prospects where id = fx;
  perform pg_temp.verifie('trigger : la ville change → la région suit', r.region = 'Namur', coalesce(r.region, 'NULL'));

  update public.prospects set region = 'Brabant wallon' where id = fx;
  update public.prospects set notes = 'ZZ' where id = fx;
  select region into v from public.prospects where id = fx;
  perform pg_temp.verifie('trigger : une région choisie à la main reste (autre champ modifié)', v = 'Brabant wallon', v);

  update public.prospects set city = 'Uccle', region = 'Namur' where id = fx;
  select region into v from public.prospects where id = fx;
  perform pg_temp.verifie('trigger : ville ET région changées ensemble → la région choisie l''emporte', v = 'Namur', v);

  update public.prospects set city = 'Lyon' where id = fx;
  select city, region into r from public.prospects where id = fx;
  perform pg_temp.verifie('trigger : ville inconnue → région vide, ville gardée telle quelle',
    r.city = 'Lyon' and r.region is null, r.city || ' / ' || coalesce(r.region, 'NULL'));

  insert into public.prospects (company_name, owner_id) values ('ZZ Recette 034 Auto5 Anderlecht', nathan) returning id into fx;
  select city, region into r from public.prospects where id = fx;
  perform pg_temp.verifie('trigger : sans ville ni adresse, la commune bruxelloise du nom',
    r.city = 'Anderlecht' and r.region = 'Anderlecht', coalesce(r.city, 'NULL') || ' / ' || coalesce(r.region, 'NULL'));

  insert into public.prospects (company_name, owner_id, city, region) values ('ZZ Recette 034 Choix', nathan, 'Uccle', 'Hainaut') returning id into fx;
  select region into v from public.prospects where id = fx;
  perform pg_temp.verifie('trigger : une région donnée à la création n''est pas remplacée', v = 'Hainaut', v);

  v := pg_temp.etat(format('update public.prospects set region = %L where id = %L', 'Mars', fx));
  perform pg_temp.verifie('contrainte : une région hors liste est refusée (23514)', v = '23514', v);

  v := pg_temp.etat('select count(*) from public.localites_be');
  perform pg_temp.verifie('localités : fermées à un membre (42501)', v = '42501', v);
  v := pg_temp.etat('select count(*) from public.lieux_alias');
  perform pg_temp.verifie('alias : fermés à un membre (42501)', v = '42501', v);

  perform pg_temp.verifie('lieux_de : l''aperçu de « Ma liste », dans l''ordre',
    (select array_agg(l.region order by l.i) from public.lieux_de(
      array['Elsene', null, 'Overijs'], array[null, 'Rue de Fer 12, 5000 Namur', null], array['A', 'B', 'C']) l)
      = array['Ixelles', 'Namur', 'Brabant flamand']);
  perform pg_temp.redevenir();

  execute 'set local role anon';
  v := pg_temp.etat($$select * from public.lieu_de('Uccle', null, null)$$);
  perform pg_temp.verifie('anon : lieu_de refusé (42501)', v = '42501', v);
  execute 'reset role';

  -- ==========================================================================
  -- 4. La reprise : seules city et region ont bougé, la date d'activité non
  --    (comparée à la copie de l'avant, public.reprise_034)
  -- ==========================================================================
  perform pg_temp.verifie('reprise : la copie de l''avant couvre toutes les fiches d''alors',
    (select count(*) from public.reprise_034) > 0
    and not exists (select 1 from public.reprise_034 b where not exists (select 1 from public.prospects p where p.id = b.id)));
  perform pg_temp.verifie('reprise : aucune date d''activité n''a bougé',
    not exists (select 1 from public.prospects p join public.reprise_034 b on b.id = p.id
                 where p.updated_at is distinct from b.updated_at and p.company_name not like 'ZZ Recette 034%'),
    (select string_agg(p.company_name, ', ') from public.prospects p join public.reprise_034 b on b.id = p.id
      where p.updated_at is distinct from b.updated_at and p.company_name not like 'ZZ Recette 034%'));
  perform pg_temp.verifie('reprise : aucune ville effacée',
    not exists (select 1 from public.prospects p join public.reprise_034 b on b.id = p.id
                 where nullif(btrim(b.city), '') is not null and nullif(btrim(p.city), '') is null));
  perform pg_temp.info('fiches avec une région : ' ||
    (select count(*) from public.prospects where region is not null and company_name not like 'ZZ Recette 034%') ||
    ' / ' || (select count(*) from public.prospects where company_name not like 'ZZ Recette 034%'));
  perform pg_temp.info('par région : ' || coalesce((select string_agg(region || ' ' || n, ', ' order by n desc, region) from (
    select region, count(*) n from public.prospects where region is not null and company_name not like 'ZZ Recette 034%' group by 1) x), '—'));
  perform pg_temp.info('villes rangées : ' || coalesce((select string_agg(distinct b.city || ' → ' || p.city, ' ; ')
    from public.prospects p join public.reprise_034 b on b.id = p.id where b.city is distinct from p.city), 'aucune'));
  perform pg_temp.info('villes sans région : ' || coalesce((select string_agg(distinct p.city, ', ')
    from public.prospects p where p.city is not null and p.region is null and p.company_name not like 'ZZ Recette 034%'), 'aucune'));
end $recette$;
