-- Corps de la recette 042 + 043 — assemblé par 042_assembler.sh (ne pas jouer seul).
-- Jouée le 29/10 au soir contre la production, en transaction annulée : 19 OK, 0 faute (26 fiches).
set local lock_timeout = '3s';

-- 1. Les sondes : une fiche « ZZ Sonde 042 » en « Contacté » par cas du jeu
--    commun (lib/crm/etapes.cas.json), avec son journal. La migration doit les
--    ranger exactement comme test:etapes (la règle TypeScript).
create temp table sondes_042 (id uuid primary key, nom text, attendu text) on commit drop;
do $s$
declare
  c jsonb; a jsonb; e jsonb; m jsonb; p uuid;
  nathan uuid := 'f9d07f3f-daea-46b8-ae6c-b9380444be4b';
begin
  for c in select * from jsonb_array_elements(-- <<CAS>>
  ) loop
    insert into prospects(company_name, owner_id, created_by, status)
    values ('ZZ Sonde 042 — ' || (c->>'nom'), nathan, nathan, 'contacte') returning id into p;
    insert into sondes_042 values (p, c->>'nom', c->>'attendu');
    for a in select * from jsonb_array_elements(coalesce(c->'activities', '[]')) loop
      insert into activities(prospect_id, author_id, type, occurred_at, is_exchange, is_draft, outcome, subject)
      values (p, nathan, coalesce(a->>'type', 'note')::activity_type, (a->>'at')::timestamptz,
              coalesce((a->>'is_exchange')::boolean, true), coalesce((a->>'is_draft')::boolean, false),
              a->>'outcome', 'sonde 042');
    end loop;
    for e in select * from jsonb_array_elements(coalesce(c->'emails', '[]')) loop
      insert into emails(prospect_id, direction, received_at, from_email, subject, message_id)
      values (p, (e->>'direction')::email_direction, (e->>'at')::timestamptz, 'sonde@celya.test', 'sonde 042',
              'sonde-042-' || gen_random_uuid() || '@celya.test');
    end loop;
    for m in select * from jsonb_array_elements(coalesce(c->'meetings', '[]')) loop
      insert into meetings(prospect_id, owner_id, created_by, kind, title, starts_at, ends_at, status, debrief_issue, debriefed_at)
      values (p, nathan, nathan, 'prospect'::meeting_kind, 'sonde 042', (m->>'starts_at')::timestamptz,
              (m->>'starts_at')::timestamptz + interval '1 hour', (m->>'status')::meeting_status, m->>'debrief_issue',
              case when m->>'debrief_issue' is not null then (m->>'starts_at')::timestamptz + interval '2 hours' end);
    end loop;
  end loop;
end $s$;

-- 2. Ce que la 042 doit donner aux fiches RÉELLES (le tableau du prompt).
create temp table attendus_042 (nom text primary key, vers text) on commit drop;
insert into attendus_042 values
    -- <<ATTENDUS>>
;

-- 3. La baseline, APRÈS les sondes (elles aussi ne doivent bouger que d'étape).
create temp table avant_042 on commit drop as
  select p.id, p.company_name, p.status::text as status, p.status_locked, p.status_auto_reason,
         p.owner_id, p.updated_at, p.next_action_at, p.next_action_kind, p.region, p.city, p.phone
    from prospects p;
create temp table empreinte_042 on commit drop as
  select p.id,
    (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from tasks t where t.prospect_id = p.id) as taches,
    (select md5(coalesce(string_agg(m::text, '|' order by m.id), '')) from meetings m where m.prospect_id = p.id) as rdv,
    (select md5(coalesce(string_agg(a::text, '|' order by a.id), '')) from activities a where a.prospect_id = p.id) as journal,
    (select md5(coalesce(string_agg(e::text, '|' order by e.id), '')) from emails e where e.prospect_id = p.id) as mails
  from prospects p where p.status = 'contacte';

create temp table bilan_042 (n_ok int, n_ko int, detail text) on commit drop;

-- <<MIGRATIONS>>

do $r$
declare n int; m int; e text; ok int := 0; ko int := 0; log text := '';
  r record;
begin
  -- A. Aucune fiche perdue, aucune en « Contacté ».
  select count(*) into n from prospects;
  select count(*) into m from avant_042;
  if n = m then ok := ok + 1; else ko := ko + 1; log := log || ' | fiches : ' || m || ' → ' || n; end if;
  select count(*) into n from avant_042 a left join prospects p using (id)
   where p.id is null or p.owner_id is distinct from a.owner_id;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | responsable changé ou fiche disparue : ' || n; end if;
  select count(*) into n from prospects where status = 'contacte';
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | reste en Contacté : ' || n; end if;

  -- B. Seules les fiches « Contacté » ont bougé — et seulement d'étape.
  select count(*) into n from prospects p join avant_042 a using (id)
   where a.status <> 'contacte' and (p.status::text <> a.status or p.status_auto_reason is distinct from a.status_auto_reason);
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | autres fiches touchées : ' || n; end if;
  select count(*) into n from prospects p join avant_042 a using (id)
   where p.updated_at is distinct from a.updated_at;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | updated_at changé : ' || n; end if;
  select count(*) into n from prospects p join avant_042 a using (id)
   where p.next_action_at is distinct from a.next_action_at or p.next_action_kind is distinct from a.next_action_kind
      or p.region is distinct from a.region or p.city is distinct from a.city;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | prochaine action / lieu changés : ' || n; end if;
  -- … et la prochaine action reste celle que la base calculerait pour la nouvelle étape.
  select count(*) into n from prospects p join avant_042 a using (id), lateral prochaine_action_de(p.id, p.status) d
   where a.status = 'contacte' and (d.o_at is distinct from p.next_action_at or d.o_kind is distinct from p.next_action_kind);
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | prochaine action incohérente : ' || n; end if;
  select count(*) into n from empreinte_042 x,
    lateral (select
      (select md5(coalesce(string_agg(tt::text, '|' order by tt.id), '')) from tasks tt where tt.prospect_id = x.id) as taches,
      (select md5(coalesce(string_agg(mm::text, '|' order by mm.id), '')) from meetings mm where mm.prospect_id = x.id) as rdv,
      (select md5(coalesce(string_agg(aa::text, '|' order by aa.id), '')) from activities aa where aa.prospect_id = x.id) as journal,
      (select md5(coalesce(string_agg(ee::text, '|' order by ee.id), '')) from emails ee where ee.prospect_id = x.id) as mails) y
   where (x.taches, x.rdv, x.journal, x.mails) is distinct from (y.taches, y.rdv, y.journal, y.mails);
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | relances / RDV / journal / mails touchés : ' || n; end if;

  -- C. Les sondes : la SQL range comme la règle TypeScript (test:etapes).
  for r in select s.nom, s.attendu, p.status::text as obtenu from sondes_042 s join prospects p using (id)
            where p.status::text <> s.attendu loop
    ko := ko + 1; log := log || ' | sonde « ' || r.nom || ' » : ' || r.obtenu || ' (attendu ' || r.attendu || ')';
  end loop;
  select count(*) into n from sondes_042 s join prospects p using (id) where p.status::text = s.attendu;
  if n = (select count(*) from sondes_042) then ok := ok + 1; end if;

  -- D. Les fiches réelles : là où le tableau le dit. Une fiche qui n'y est
  --    pas, ou qui part ailleurs : FAUTE — on n'applique pas, on montre.
  for r in select a.company_name, p.status::text as obtenu, t.vers
             from avant_042 a join prospects p using (id) left join attendus_042 t on t.nom = a.company_name
            where a.status = 'contacte' and a.id not in (select id from sondes_042)
              and (t.vers is null or t.vers <> p.status::text) loop
    ko := ko + 1; log := log || ' | « ' || r.company_name || ' » → ' || r.obtenu || ' (tableau : ' || coalesce(r.vers, 'absente') || ')';
  end loop;
  select count(*) into n from avant_042 a join prospects p using (id) join attendus_042 t on t.nom = a.company_name
   where a.status = 'contacte' and t.vers = p.status::text;
  if n = (select count(*) from avant_042 where status = 'contacte' and id not in (select id from sondes_042))
  then ok := ok + 1; end if;

  -- E. Les verrouillées gardent leur verrou et leur motif ; les autres disent pourquoi.
  select count(*) into n from prospects p join avant_042 a using (id)
   where a.status = 'contacte' and a.status_locked and (not p.status_locked or p.status_auto_reason is distinct from a.status_auto_reason);
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | verrou ou motif d''une verrouillée touché : ' || n; end if;
  select status_auto_reason into e from prospects where company_name = 'Garage Nima';
  if e = 'étape « Contacté » retirée : on n''a pas encore eu le décideur' then ok := ok + 1;
  else ko := ko + 1; log := log || ' | motif Nima : ' || coalesce(e, 'null'); end if;
  select status_auto_reason into e from prospects where company_name = 'Baradent';
  if e = 'étape « Contacté » retirée : la suite se joue par email' then ok := ok + 1;
  else ko := ko + 1; log := log || ' | motif Baradent : ' || coalesce(e, 'null'); end if;

  -- F. La copie d'avant : une ligne par fiche déplacée, et elle suffit à défaire.
  select count(*) into n from reprise_042;
  select count(*) into m from avant_042 where status = 'contacte';
  if n = m then ok := ok + 1; else ko := ko + 1; log := log || ' | reprise_042 : ' || n || ' / ' || m; end if;
  select count(*) into n from pg_policies where tablename = 'reprise_042';
  if n = 0 and (select relrowsecurity from pg_class where oid = 'public.reprise_042'::regclass) then ok := ok + 1;
  else ko := ko + 1; log := log || ' | reprise_042 pas fermée'; end if;
  begin
    update prospects p set status = r2.status, status_auto_reason = r2.status_auto_reason, status_auto_at = r2.status_auto_at
      from reprise_042 r2 where r2.id = p.id;
    select count(*) into n from prospects p join avant_042 a using (id) where p.status::text <> a.status;
    raise exception using errcode = 'P0042', message = n::text;
  exception when sqlstate 'P0042' then
    if sqlerrm = '0' then ok := ok + 1; else ko := ko + 1; log := log || ' | défaire laisse ' || sqlerrm || ' écart(s)'; end if;
  end;
  insert into bilan_042 values (ok, ko, log);
end $r$;

-- <<043>>

do $r2$
declare p uuid; e text; ok int := 0; ko int := 0; log text := '';
  nathan uuid := 'f9d07f3f-daea-46b8-ae6c-b9380444be4b';
begin
  -- G. La contrainte refuse « Contacté », à la création comme au changement…
  begin
    insert into prospects(company_name, owner_id, created_by, status) values ('ZZ Sonde 043 a', nathan, nathan, 'contacte');
    ko := ko + 1; log := log || ' | création en contacte acceptée';
  exception when check_violation then ok := ok + 1;
  end;
  insert into prospects(company_name, owner_id, created_by) values ('ZZ Sonde 043 b', nathan, nathan) returning id into p;
  begin
    update prospects set status = 'contacte' where id = p;
    ko := ko + 1; log := log || ' | passage en contacte accepté';
  exception when check_violation then ok := ok + 1;
  end;
  -- … et laisse passer les sept étapes.
  update prospects set status = 'rendez_vous' where id = p;
  update prospects set status = 'a_rappeler' where id = p;
  update prospects set status = 'suivi_email' where id = p;
  update prospects set status = 'essai_gratuit' where id = p;
  update prospects set status = 'gagne' where id = p;
  update prospects set status = 'perdu' where id = p;
  update prospects set status = 'a_appeler' where id = p;
  select status::text into e from prospects where id = p;
  if e = 'a_appeler' then ok := ok + 1; else ko := ko + 1; log := log || ' | sept étapes : ' || e; end if;

  select ok + b.n_ok, ko + b.n_ko, b.detail || log into ok, ko, log from bilan_042 b;
  raise exception 'RECETTE 042+043 — % OK, % FAUTE(S)%', ok, ko, log;
end $r2$;
