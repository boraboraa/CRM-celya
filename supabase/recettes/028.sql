-- Recette 028 — transaction ANNULÉE (exception finale), aucun drop.
-- La migration verbatim, puis : l'existant intact, une relance ouverte sans
-- fiche refusée, une relance orpheline existante qu'on peut clore.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create temp table base on commit drop as
  select (select md5(string_agg(t::text, '|' order by t.id)) from public.tasks t) as tasks,
         (select count(*) from public.tasks where prospect_id is null and status = 'a_faire') as orphelines;

alter table public.tasks
  add constraint tasks_ouverte_sur_fiche
  check (prospect_id is not null or status <> 'a_faire') not valid;

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
  bora constant uuid := 'b3fdb505-76b0-4541-84ec-21b330afe58d';
  collins constant uuid := 'fc088df7-6bd5-4d28-b10a-417483964a9f';
  e text; n int; orph uuid; p uuid;
begin
  perform pg_temp.verifie('reprise : aucune relance touchée',
    (select md5(string_agg(t::text, '|' order by t.id)) from public.tasks t) = (select tasks from base));
  perform pg_temp.verifie('reprise : les relances orphelines existantes restent (NOT VALID)',
    (select count(*) from public.tasks where prospect_id is null and status = 'a_faire') = (select orphelines from base),
    (select orphelines from base)::text);

  begin
    insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
    values (null, 'Pense-bête', now() + interval '1 day', bora, bora);
    e := 'accepté';
  exception when others then e := sqlstate; end;
  perform pg_temp.verifie('une relance ouverte SANS fiche est refusée (23514), service_role compris', e = '23514', e);

  perform set_config('request.jwt.claims', json_build_object('sub', collins, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
    values (null, 'Pense-bête', now() + interval '1 day', collins, collins);
    e := 'accepté';
  exception when others then e := sqlstate; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.verifie('…par l''écran aussi (Collins, RLS) : refusée', e = '23514', e);

  insert into public.prospects (company_name, owner_id) values ('RECETTE-028', bora) returning id into p;
  insert into public.tasks (prospect_id, title, due_at, assignee_id, created_by)
  values (p, 'Relancer', now() + interval '1 day', bora, bora);
  perform pg_temp.verifie('une relance sur une fiche passe', true);

  select id into orph from public.tasks where prospect_id is null and status = 'a_faire' limit 1;
  if orph is not null then
    begin
      update public.tasks set status = 'fait' where id = orph;
      e := 'ok';
    exception when others then e := sqlstate; end;
    perform pg_temp.verifie('une orpheline existante peut être COCHÉE', e = 'ok', e);
    begin
      update public.tasks set status = 'a_faire', prospect_id = p where id = orph;
      e := 'ok';
    exception when others then e := sqlstate; end;
    perform pg_temp.verifie('…et RATTACHÉE à une fiche', e = 'ok', e);
  else
    perform pg_temp.verifie('aucune orpheline à clore (déjà traitées)', true);
  end if;
end $recette$;

do $fin$
begin
  raise exception 'RECETTE 028 — % OK, % FAUTE(S)%',
    coalesce(nullif(current_setting('recette.ok', true), ''), '0'),
    coalesce(nullif(current_setting('recette.ko', true), ''), '0'),
    current_setting('recette.log', true);
end $fin$;
