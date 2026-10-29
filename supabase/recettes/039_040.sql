-- Recette 039 + 040 — en transaction ANNULÉE (l'exception finale). Rien n'est validé.
-- Jouée le 29/10 contre la production : 7 OK, 0 faute.
set local lock_timeout = '3s';
create temp table avant on commit drop as select id, status, status_locked, updated_at from prospects;

-- (corps de la migration 039, verbatim)
update public.prospects
   set status = 'a_rappeler',
       status_locked = true,
       status_locked_at = coalesce(status_locked_at, now()),
       status_auto_reason = null,
       status_auto_at = null
 where status = 'proposition';

-- (corps de la migration 040, verbatim)
alter table public.prospects
  add constraint prospects_sans_proposition check (status <> 'proposition');

do $r$
declare n int; p uuid; e text; ok int := 0; ko int := 0; log text := '';
  nathan uuid := 'f9d07f3f-daea-46b8-ae6c-b9380444be4b';
begin
  -- 1. Les deux fiches, et elles seules.
  select count(*) into n from prospects p join avant a using (id) where a.status is distinct from p.status;
  if n = 2 then ok := ok + 1; else ko := ko + 1; log := log || ' | changées : ' || n; end if;
  select count(*) into n from prospects where company_name in ('New Auto Torino', 'Wondercar car Overijs') and status = 'a_rappeler' and status_locked;
  if n = 2 then ok := ok + 1; else ko := ko + 1; log := log || ' | les 2 en À rappeler verrouillées : ' || n; end if;
  select count(*) into n from prospects where status = 'proposition';
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | reste en proposition : ' || n; end if;
  select count(*) into n from prospects p join avant a using (id) where a.status <> 'proposition' and p.updated_at is distinct from a.updated_at;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | autres fiches touchées : ' || n; end if;

  -- 2. La contrainte refuse « proposition », à la création comme au changement.
  begin
    insert into prospects(company_name, owner_id, created_by, status) values ('ZZ Sonde 040 a', nathan, nathan, 'proposition');
    ko := ko + 1; log := log || ' | création en proposition acceptée';
  exception when check_violation then ok := ok + 1;
  end;
  insert into prospects(company_name, owner_id, created_by) values ('ZZ Sonde 040 b', nathan, nathan) returning id into p;
  begin
    update prospects set status = 'proposition' where id = p;
    ko := ko + 1; log := log || ' | passage en proposition accepté';
  exception when check_violation then ok := ok + 1;
  end;
  -- … et laisse passer toutes les autres étapes.
  update prospects set status = 'suivi_email' where id = p;
  update prospects set status = 'essai_gratuit' where id = p;
  update prospects set status = 'a_rappeler' where id = p;
  select status::text into e from prospects where id = p;
  if e = 'a_rappeler' then ok := ok + 1; else ko := ko + 1; log := log || ' | autres étapes : ' || e; end if;

  raise exception 'RECETTE 039+040 — % OK, % FAUTE(S)%', ok, ko, log;
end $r$;
