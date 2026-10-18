-- ============================================================
-- Recette — la recherche de prospects ne sort JAMAIS du périmètre autorisé
-- (lot 3, 18 octobre 2026). Transaction ANNULÉE (exception finale), aucun DDL.
--
-- La recherche globale (⌘K) et celle de /prospects passent par
-- lib/crm/recherche.ts et partent sur le client de l'UTILISATEUR : c'est la
-- RLS de `prospects` qui borne. On joue ici, rôle par rôle, la requête
-- EXACTE que PostgREST construit pour `filtreRecherche` — un terme très large
-- (« a ») et un numéro (« 4[^0-9]*… ») — et on vérifie que chaque ligne
-- rendue est une fiche que le rôle a le droit de voir :
--   · commercial seul (Rémi)            : les siennes ;
--   · porteur d'équipe (Collins)         : les siennes + celles de Nathan ;
--   · encadrant (Collins → un étudiant)  : + celles de l'étudiant ;
--   · étudiant encadré                   : les siennes, rien d'autre ;
--   · admin (Bora)                       : tout.
-- Le droit attendu est recalculé ICI, à la main, sans can_see_prospect —
-- sinon le test se donnerait raison à lui-même.
-- ============================================================
set local lock_timeout = '3s';
set local statement_timeout = '30s';

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
  nathan  constant uuid := 'f9d07f3f-daea-46b8-ae6c-b9380444be4b';
  remi    constant uuid := '640f3e05-d9da-4fdc-a0eb-553a3afa00d6';
  etud    constant uuid := '569b9125-4cc4-4369-a0ca-9044f6b81812';
  r record;
  rendus uuid[]; hors int; total int; attendus int;
  regex constant text := '4[^0-9]*7[^0-9]*0';
begin
  -- Sondes : une fiche par propriétaire, au même nom et au même numéro.
  insert into public.prospects (company_name, owner_id, phone) values
    ('RECHERCHE-SONDE Bora', bora, '+32 470 00 00 01'),
    ('RECHERCHE-SONDE Collins', collins, '+32 470 00 00 02'),
    ('RECHERCHE-SONDE Nathan', nathan, '+32 470 00 00 03'),
    ('RECHERCHE-SONDE Remi', remi, '+32 470 00 00 04'),
    ('RECHERCHE-SONDE Etudiant', etud, '+32 470 00 00 05');
  -- Collins encadre l'étudiant (dans la transaction seulement).
  insert into public.supervision (encadrant_id, commercial_id) values (collins, etud);

  for r in
    select * from (values
      ('Rémi (commercial seul)', remi,  array[remi]),
      ('Collins (porteur + encadrant)', collins, array[collins, nathan, etud]),
      ('Nathan (porteur)', nathan, array[nathan, collins]),
      ('l''étudiant (encadré)', etud, array[etud])
    ) as t(nom, uid, permis)
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    -- La requête de filtreRecherche (« a » : presque toutes les fiches ; et le numéro).
    select array_agg(p.id) into rendus
      from public.prospects p
     where p.company_name ilike '%a%' or p.contact_name ilike '%a%'
        or p.email ilike '%a%' or p.city ilike '%a%' or p.phone ~* regex;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);

    select count(*) into hors from public.prospects p
     where p.id = any (coalesce(rendus, '{}')) and not (p.owner_id = any (r.permis));
    perform pg_temp.verifie(r.nom || ' : aucune fiche hors de son périmètre', hors = 0, hors::text);

    select count(*) into attendus from public.prospects p
     where p.company_name like 'RECHERCHE-SONDE%' and p.owner_id = any (r.permis);
    select count(*) into total from public.prospects p
     where p.id = any (coalesce(rendus, '{}')) and p.company_name like 'RECHERCHE-SONDE%';
    perform pg_temp.verifie(r.nom || ' : retrouve toutes les sondes de son périmètre', total = attendus,
      total || ' / ' || attendus);
  end loop;

  -- L'admin : tout.
  perform set_config('request.jwt.claims', json_build_object('sub', bora, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into total from public.prospects p
   where p.company_name like 'RECHERCHE-SONDE%' and (p.company_name ilike '%sonde%' or p.phone ~* regex);
  execute 'reset role';
  perform pg_temp.verifie('Bora (admin) : retrouve les cinq sondes', total = 5, total::text);

  -- Le numéro seul, tapé « 0470 00 00 04 » : Rémi retrouve SA fiche, Collins non.
  perform set_config('request.jwt.claims', json_build_object('sub', collins, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into total from public.prospects p where p.phone ~* '4[^0-9]*7[^0-9]*0[^0-9]*0[^0-9]*0[^0-9]*0[^0-9]*0[^0-9]*0[^0-9]*4';
  execute 'reset role';
  perform pg_temp.verifie('Collins : le numéro de la fiche de Rémi ne rend rien', total = 0, total::text);
  perform set_config('request.jwt.claims', json_build_object('sub', remi, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into total from public.prospects p where p.phone ~* '4[^0-9]*7[^0-9]*0[^0-9]*0[^0-9]*0[^0-9]*0[^0-9]*0[^0-9]*0[^0-9]*4';
  execute 'reset role';
  perform pg_temp.verifie('Rémi : son numéro rend sa fiche', total = 1, total::text);
end $recette$;

do $fin$
begin
  raise exception 'RECETTE RECHERCHE — % OK, % FAUTE(S)%',
    coalesce(nullif(current_setting('recette.ok', true), ''), '0'),
    coalesce(nullif(current_setting('recette.ko', true), ''), '0'),
    current_setting('recette.log', true);
end $fin$;
