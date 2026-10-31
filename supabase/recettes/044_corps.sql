do $r$
declare n int; m int; e text; ok int := 0; ko int := 0; log text := '';
  p uuid; t1 uuid; t2 uuid; t3 uuid;
  nathan uuid := 'f9d07f3f-daea-46b8-ae6c-b9380444be4b';
  phrase text := 'Cette fiche est perdue : choisissez d''abord une autre étape pour la relancer.';
begin
  -- A. La reprise : plus aucune relance ouverte sur une fiche perdue, et
  --    SEULEMENT celles-là ont bougé.
  select count(*) into n from tasks t join prospects pr on pr.id = t.prospect_id
   where pr.status::text = 'perdu' and t.status = 'a_faire';
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | relances ouvertes sur des perdues : ' || n; end if;
  select count(*) into n from tasks t join avant_044 a using (id) where t.status::text <> a.status;
  select count(*) into m from perdues_044;
  if n = m then ok := ok + 1; else ko := ko + 1; log := log || ' | relances changées : ' || n || ' (attendu ' || m || ')'; end if;
  select count(*) into n from tasks t join avant_044 a using (id)
   where t.status::text <> a.status and (t.id not in (select id from perdues_044) or t.status::text <> 'annule');
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | relances touchées hors reprise : ' || n; end if;
  select count(*) into n from tasks t join avant_044 a using (id) where t.due_at is distinct from a.due_at or t.title is distinct from a.title;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | date ou titre changés : ' || n; end if;
  select count(*) into n from reprise_044;
  if n = m then ok := ok + 1; else ko := ko + 1; log := log || ' | reprise_044 : ' || n; end if;
  if (select relrowsecurity from pg_class where oid = 'public.reprise_044'::regclass)
     and not exists (select 1 from pg_policies where tablename = 'reprise_044') then ok := ok + 1;
  else ko := ko + 1; log := log || ' | reprise_044 pas fermée'; end if;

  -- B. Passer en Perdu annule les relances ouvertes — quel que soit le chemin
  --    (ici, une simple écriture de l'étape, comme le menu d'étape).
  insert into prospects(company_name, owner_id, created_by, status) values ('ZZ Sonde 044', nathan, nathan, 'a_rappeler') returning id into p;
  insert into tasks(prospect_id, title, due_at, assignee_id, created_by) values (p, 'ZZ relance 1', now() + interval '1 day', nathan, nathan) returning id into t1;
  insert into tasks(prospect_id, title, due_at, assignee_id, created_by) values (p, 'ZZ relance 2', now() + interval '2 day', nathan, nathan) returning id into t2;
  insert into tasks(prospect_id, title, due_at, assignee_id, created_by, status) values (p, 'ZZ faite', now() - interval '1 day', nathan, nathan, 'fait') returning id into t3;
  update prospects set status = 'perdu', status_locked = true where id = p;
  select count(*) into n from tasks where id in (t1, t2) and status = 'annule';
  if n = 2 then ok := ok + 1; else ko := ko + 1; log := log || ' | passage en Perdu : ' || n || '/2 annulées'; end if;
  select status::text into e from tasks where id = t3;
  if e = 'fait' then ok := ok + 1; else ko := ko + 1; log := log || ' | relance faite touchée : ' || e; end if;

  -- C. On ne pose pas de relance sur une fiche perdue — avec la phrase de l'écran.
  begin
    insert into tasks(prospect_id, title, due_at, assignee_id, created_by) values (p, 'ZZ interdite', now() + interval '1 day', nathan, nathan);
    ko := ko + 1; log := log || ' | relance posée sur une perdue';
  exception when raise_exception then
    if sqlerrm = phrase then ok := ok + 1; else ko := ko + 1; log := log || ' | message : ' || sqlerrm; end if;
  end;
  -- … ni ne la rouvre.
  begin
    update tasks set status = 'a_faire' where id = t1;
    ko := ko + 1; log := log || ' | relance rouverte sur une perdue';
  exception when raise_exception then ok := ok + 1;
  end;
  -- … mais on garde le droit d'en tracer une faite (historique).
  insert into tasks(prospect_id, title, due_at, assignee_id, created_by, status) values (p, 'ZZ trace', now(), nathan, nathan, 'fait');
  ok := ok + 1;

  -- D. Défaire (« Pas intéressé » tapé par erreur) : la fiche sort de Perdu,
  --    puis ses relances rouvrent — l'ordre de defairePerdu.
  update prospects set status = 'a_rappeler' where id = p;
  update tasks set status = 'a_faire' where id in (t1, t2);
  select count(*) into n from tasks where id in (t1, t2) and status = 'a_faire';
  if n = 2 then ok := ok + 1; else ko := ko + 1; log := log || ' | défaire : ' || n || '/2'; end if;

  -- E. Les autres étapes ne touchent à rien (Gagné compris).
  update prospects set status = 'gagne' where id = p;
  select count(*) into n from tasks where id in (t1, t2) and status = 'a_faire';
  if n = 2 then ok := ok + 1; else ko := ko + 1; log := log || ' | gagné a touché les relances'; end if;
  insert into tasks(prospect_id, title, due_at, assignee_id, created_by) values (p, 'ZZ sur gagnée', now() + interval '3 day', nathan, nathan);
  ok := ok + 1;
  -- F. Re-passer en Perdu une fiche déjà perdue ne fait rien de plus (pas de
  --    ré-annulation d'une relance rouverte… puisqu'il ne peut plus y en avoir).
  update prospects set status = 'perdu' where id = p;
  select count(*) into n from tasks where prospect_id = p and status = 'a_faire';
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | gagné → perdu : ' || n || ' encore ouvertes'; end if;

  raise exception 'RECETTE 044 — % OK, % FAUTE(S)% [reprise : % relances]', ok, ko, log, m;
end $r$;
