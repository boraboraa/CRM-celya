-- Recette 035 — en transaction ANNULÉE (l'exception finale). Rien n'est validé.
set local lock_timeout = '3s';
-- @@MIGRATION@@
do $r$
declare
  nathan uuid := 'f9d07f3f-daea-46b8-ae6c-b9380444be4b';
  bora uuid := (select id from crm_users where role='admin' and is_active order by created_at limit 1);
  remi uuid := (select id from crm_users where email like 'remi.%' limit 1);
  p uuid; p2 uuid; m1 uuid; m2 uuid; mperso uuid; e uuid;
  n int; ok int := 0; ko int := 0; log text := '';
  procedure_ok boolean;
begin
  insert into prospects(company_name, owner_id, created_by, phone) values ('ZZ Sonde 035', nathan, nathan, '+32 000 35 35 35') returning id into p;
  insert into prospects(company_name, owner_id, created_by) values ('ZZ Sonde 035 bis', nathan, nathan) returning id into p2;
  insert into meetings(prospect_id, owner_id, created_by, kind, title, starts_at, ends_at, status)
    values (p, nathan, nathan, 'prospect', 'RDV sonde', now() + interval '2 days', now() + interval '2 days 1 hour', 'prevu') returning id into m1;
  insert into meetings(prospect_id, owner_id, created_by, kind, title, starts_at, ends_at, status)
    values (p, bora, bora, 'prospect', 'RDV sonde posé par Bora', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'prevu') returning id into m2;
  insert into meetings(prospect_id, owner_id, created_by, kind, title, starts_at, ends_at, status)
    values (null, nathan, nathan, 'perso', 'Perso sonde', now() + interval '1 day', now() + interval '1 day 1 hour', 'prevu') returning id into mperso;
  insert into activities(prospect_id, author_id, type, subject, occurred_at, meeting_id) values (p, nathan, 'note', 'note sonde', now(), m2);
  insert into tasks(prospect_id, assignee_id, created_by, title, due_at, status) values (p, nathan, nathan, 'relance sonde', now() + interval '1 day', 'a_faire');

  -- Rémi ne supprime pas la fiche de Nathan.
  perform set_config('request.jwt.claims', json_build_object('sub', remi, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from prospects where id = p; get diagnostics n = row_count;
  reset role;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | Rémi a supprimé la fiche de Nathan'; end if;

  -- Nathan supprime SA fiche : les RDV partent, y compris celui que Bora a posé.
  perform set_config('request.jwt.claims', json_build_object('sub', nathan, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from prospects where id = p; get diagnostics n = row_count;
  reset role;
  if n = 1 then ok := ok + 1; else ko := ko + 1; log := log || ' | Nathan n''a pas supprimé sa fiche'; end if;
  if not exists (select 1 from meetings where id in (m1, m2)) then ok := ok + 1; else ko := ko + 1; log := log || ' | RDV restés'; end if;
  if exists (select 1 from meetings where id = mperso) then ok := ok + 1; else ko := ko + 1; log := log || ' | RDV perso supprimé'; end if;
  if not exists (select 1 from activities where prospect_id = p) and not exists (select 1 from tasks where prospect_id = p) then ok := ok + 1; else ko := ko + 1; log := log || ' | journal/relances restés'; end if;
  if exists (select 1 from prospects where id = p2) then ok := ok + 1; else ko := ko + 1; log := log || ' | autre fiche touchée'; end if;

  -- L'admin supprime la fiche d'un autre.
  perform set_config('request.jwt.claims', json_build_object('sub', bora, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from prospects where id = p2; get diagnostics n = row_count;
  reset role;
  if n = 1 then ok := ok + 1; else ko := ko + 1; log := log || ' | Bora n''a pas supprimé'; end if;

  if (select confdeltype from pg_constraint where conname = 'meetings_prospect_id_fkey') = 'c' then ok := ok + 1; else ko := ko + 1; log := log || ' | FK pas en cascade'; end if;

  raise exception 'RECETTE 035 — % OK, % FAUTE(S)%', ok, ko, log;
end $r$;
