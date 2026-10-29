do $r$
declare
  nathan uuid := 'f9d07f3f-daea-46b8-ae6c-b9380444be4b';
  c record; p uuid; s text; n int; ok int := 0; ko int := 0; log text := '';
begin
  -- 1. Les cas communs avec test:regions.
  for c in select * from (values
    -- <<CAS>>
  ) as t(tel, region) loop
    if public.region_de_telephone(c.tel) is not distinct from c.region then ok := ok + 1;
    else ko := ko + 1; log := log || ' | ' || coalesce(c.tel, 'null') || ' → ' || coalesce(public.region_de_telephone(c.tel), 'null'); end if;
  end loop;

  -- 2. Création sans commune ni adresse : l'indicatif.
  insert into prospects(company_name, owner_id, created_by, phone) values ('ZZ Sonde 038 a', nathan, nathan, '+32 2 425 34 69') returning id into p;
  select region into s from prospects where id = p;
  if s = 'Bruxelles (commune à préciser)' then ok := ok + 1; else ko := ko + 1; log := log || ' | création 02 : ' || coalesce(s, 'null'); end if;

  -- 3. Le numéro change : la région suit (elle venait de l'indicatif).
  update prospects set phone = '081 22 33 44' where id = p;
  select region into s from prospects where id = p;
  if s = 'Namur' then ok := ok + 1; else ko := ko + 1; log := log || ' | changement de numéro : ' || coalesce(s, 'null'); end if;

  -- 4. Une adresse arrive : elle passe devant l'indicatif.
  update prospects set address = 'Chaussée de Wavre 1557, 1160 Auderghem' where id = p;
  select region into s from prospects where id = p;
  if s = 'Auderghem' then ok := ok + 1; else ko := ko + 1; log := log || ' | adresse : ' || coalesce(s, 'null'); end if;

  -- 5. La commune passe devant l'indicatif dès la création.
  insert into prospects(company_name, owner_id, created_by, city, phone) values ('ZZ Sonde 038 b', nathan, nathan, 'Overijse', '02 343 85 92') returning id into p;
  select region into s from prospects where id = p;
  if s = 'Brabant flamand' then ok := ok + 1; else ko := ko + 1; log := log || ' | commune + 02 : ' || coalesce(s, 'null'); end if;
  -- … et changer son numéro ne touche pas la région de la commune.
  update prospects set phone = '081 22 33 44' where id = p;
  select region into s from prospects where id = p;
  if s = 'Brabant flamand' then ok := ok + 1; else ko := ko + 1; log := log || ' | commune puis 081 : ' || coalesce(s, 'null'); end if;

  -- 6. Une région fixée à la main n'est jamais écrasée.
  insert into prospects(company_name, owner_id, created_by, phone, region) values ('ZZ Sonde 038 c', nathan, nathan, '081 22 33 44', 'Hainaut') returning id into p;
  select region into s from prospects where id = p;
  if s = 'Hainaut' then ok := ok + 1; else ko := ko + 1; log := log || ' | région à la main : ' || coalesce(s, 'null'); end if;

  -- 7. Un GSM ne dit rien.
  insert into prospects(company_name, owner_id, created_by, phone) values ('ZZ Sonde 038 d', nathan, nathan, '0471 20 24 53') returning id into p;
  select region into s from prospects where id = p;
  if s is null then ok := ok + 1; else ko := ko + 1; log := log || ' | GSM : ' || s; end if;

  -- 8. La reprise : plus aucune fiche sans région dont le fixe parle.
  select count(*) into n from prospects where region is null and public.region_de_telephone(phone) is not null;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | reste à reprendre : ' || n; end if;
  -- … sans toucher une fiche qui avait déjà une région, ni sa date d'activité.
  select count(*) into n from prospects p join avant_038 a using (id) where a.region is not null and p.region is distinct from a.region;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | régions existantes changées : ' || n; end if;
  select count(*) into n from prospects p join avant_038 a using (id) where p.updated_at is distinct from a.updated_at;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | updated_at touchés : ' || n; end if;
  select count(*) into n from prospects p join avant_038 a using (id) where a.region is null and p.region is not null;
  raise notice 'reprise : % fiches reçoivent une région', n;
  log := log || ' | reprise : ' || n || ' fiches';

  raise exception 'RECETTE 038 — % OK, % FAUTE(S)%', ok, ko, log;
end $r$;
