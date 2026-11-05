-- Corps de la recette 046 — assemblé par 046_assembler.sh (ne pas jouer seul).
-- Ordre de production : sondes → 042 (verbatim) → baseline → 046 (verbatim)
-- → assertions → exception finale (transaction ANNULÉE).
set local lock_timeout = '3s';
set local statement_timeout = '90s';

-- 1. Les sondes : pour chaque cas du jeu COMMUN (lib/crm/etapes.cas.json, le
--    même que test:etapes), une fiche « ZZ Sonde 046 » en « À rappeler » non
--    verrouillée, et une VERROUILLÉE. La 046 doit déplacer la première SI ET
--    SEULEMENT SI la règle TypeScript dit « À appeler » et que la fiche a eu
--    un « Pas décroché » ; jamais la seconde.
create temp table sondes_046 (id uuid primary key, nom text, attendu text) on commit drop;
do $s$
declare
  c jsonb; a jsonb; e jsonb; m jsonb; p uuid; verrou boolean;
  nathan uuid := 'f9d07f3f-daea-46b8-ae6c-b9380444be4b';
begin
  for c, verrou in select x.value, v.v from jsonb_array_elements(-- <<CAS>>
  ) x, unnest(array[false, true]) as v(v) loop
    insert into prospects(company_name, owner_id, created_by, status, status_locked)
    values ('ZZ Sonde 046 — ' || (c->>'nom'), nathan, nathan, 'a_rappeler', verrou) returning id into p;
    insert into sondes_046 values (p, (c->>'nom') || case when verrou then ' [verrouillée]' else '' end,
      case when not verrou and (c->>'attendu_046') = 'a_appeler' then 'a_appeler' else 'a_rappeler' end);
    for a in select * from jsonb_array_elements(coalesce(c->'activities', '[]')) loop
      insert into activities(prospect_id, author_id, type, occurred_at, is_exchange, is_draft, outcome, subject)
      values (p, nathan, coalesce(a->>'type', 'note')::activity_type, (a->>'at')::timestamptz,
              coalesce((a->>'is_exchange')::boolean, true), coalesce((a->>'is_draft')::boolean, false),
              a->>'outcome', 'sonde 046');
    end loop;
    for e in select * from jsonb_array_elements(coalesce(c->'emails', '[]')) loop
      insert into emails(prospect_id, direction, received_at, from_email, subject, message_id)
      values (p, (e->>'direction')::email_direction, (e->>'at')::timestamptz, 'sonde@celya.test', 'sonde 046',
              'sonde-046-' || gen_random_uuid() || '@celya.test');
    end loop;
    for m in select * from jsonb_array_elements(coalesce(c->'meetings', '[]')) loop
      insert into meetings(prospect_id, owner_id, created_by, kind, title, starts_at, ends_at, status, debrief_issue, debriefed_at)
      values (p, nathan, nathan, 'prospect'::meeting_kind, 'sonde 046', (m->>'starts_at')::timestamptz,
              (m->>'starts_at')::timestamptz + interval '1 hour', (m->>'status')::meeting_status, m->>'debrief_issue',
              case when m->>'debrief_issue' is not null then (m->>'starts_at')::timestamptz + interval '2 hours' end);
    end loop;
  end loop;
  -- Un déclencheur (rendez-vous, débrief) a pu bouger une sonde à l'insertion :
  -- on la remet en « À rappeler », comme une fiche réelle rangée par l'ancienne règle.
  update prospects set status = 'a_rappeler' where id in (select id from sondes_046) and status <> 'a_rappeler';
end $s$;

-- <<042>>

-- 2. La baseline, APRÈS la 042 (l'ordre de production).
create temp table avant_046 on commit drop as
  select p.id, p.company_name, p.status::text as status, p.status_locked, p.status_auto_reason,
         p.owner_id, p.updated_at, p.next_action_at, p.next_action_kind, p.region, p.city, p.phone
    from prospects p;
create temp table empreinte_046 on commit drop as
  select p.id,
    (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from tasks t where t.prospect_id = p.id) as taches,
    (select md5(coalesce(string_agg(m::text, '|' order by m.id), '')) from meetings m where m.prospect_id = p.id) as rdv,
    (select md5(coalesce(string_agg(a::text, '|' order by a.id), '')) from activities a where a.prospect_id = p.id) as journal,
    (select md5(coalesce(string_agg(e::text, '|' order by e.id), '')) from emails e where e.prospect_id = p.id) as mails
  from prospects p where p.status = 'a_rappeler';

-- <<046>>

do $r$
declare n int; m int; ok int := 0; ko int := 0; log text := ''; liste text := '';
  r record;
begin
  -- A. Rien ne disparaît, personne ne change de responsable.
  select count(*) into n from prospects; select count(*) into m from avant_046;
  if n = m then ok := ok + 1; else ko := ko + 1; log := log || E'\n FAUTE fiches : ' || m || ' → ' || n; end if;
  select count(*) into n from avant_046 a left join prospects p using (id) where p.id is null or p.owner_id is distinct from a.owner_id;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || E'\n FAUTE responsable changé : ' || n; end if;

  -- B. Seules des « À rappeler » non verrouillées bougent, et seulement vers « À appeler ».
  select count(*) into n from prospects p join avant_046 a using (id)
   where p.status::text <> a.status and not (a.status = 'a_rappeler' and not coalesce(a.status_locked, false) and p.status::text = 'a_appeler');
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || E'\n FAUTE déplacements hors règle : ' || n; end if;
  select count(*) into n from prospects p join avant_046 a using (id)
   where p.status::text = a.status and p.status_auto_reason is distinct from a.status_auto_reason;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || E'\n FAUTE motif réécrit sans déplacement : ' || n; end if;
  select count(*) into n from prospects p join avant_046 a using (id)
   where a.status_locked and (p.status::text <> a.status or p.status_locked is distinct from a.status_locked);
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || E'\n FAUTE verrouillée touchée : ' || n; end if;
  select count(*) into n from prospects p join avant_046 a using (id) where a.status in ('perdu', 'gagne') and p.status::text <> a.status;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || E'\n FAUTE perdue / gagnée touchée : ' || n; end if;

  -- C. Rien d'autre : updated_at, prochaine action, lieu ; relances, RDV, journal, mails.
  select count(*) into n from prospects p join avant_046 a using (id) where p.updated_at is distinct from a.updated_at;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || E'\n FAUTE updated_at changé : ' || n; end if;
  select count(*) into n from prospects p join avant_046 a using (id)
   where p.next_action_at is distinct from a.next_action_at or p.next_action_kind is distinct from a.next_action_kind
      or p.region is distinct from a.region or p.city is distinct from a.city;
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || E'\n FAUTE prochaine action / lieu changés : ' || n; end if;
  select count(*) into n from prospects p join avant_046 a using (id), lateral prochaine_action_de(p.id, p.status) d
   where p.status::text <> a.status and (d.o_at is distinct from p.next_action_at or d.o_kind is distinct from p.next_action_kind);
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || E'\n FAUTE prochaine action incohérente : ' || n; end if;
  select count(*) into n from empreinte_046 x,
    lateral (select
      (select md5(coalesce(string_agg(tt::text, '|' order by tt.id), '')) from tasks tt where tt.prospect_id = x.id) as taches,
      (select md5(coalesce(string_agg(mm::text, '|' order by mm.id), '')) from meetings mm where mm.prospect_id = x.id) as rdv,
      (select md5(coalesce(string_agg(aa::text, '|' order by aa.id), '')) from activities aa where aa.prospect_id = x.id) as journal,
      (select md5(coalesce(string_agg(ee::text, '|' order by ee.id), '')) from emails ee where ee.prospect_id = x.id) as mails) y
   where (x.taches, x.rdv, x.journal, x.mails) is distinct from (y.taches, y.rdv, y.journal, y.mails);
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || E'\n FAUTE relances / RDV / journal / mails touchés : ' || n; end if;

  -- D. Les sondes : la SQL range comme la règle TypeScript (test:etapes).
  for r in select s.nom, s.attendu, p.status::text as obtenu from sondes_046 s join prospects p using (id) where p.status::text <> s.attendu loop
    ko := ko + 1; log := log || E'\n FAUTE sonde « ' || r.nom || ' » : ' || r.obtenu || ' (attendu ' || r.attendu || ')';
  end loop;
  select count(*) into n from sondes_046 s join prospects p using (id) where p.status::text = s.attendu;
  if n = (select count(*) from sondes_046) then ok := ok + 1; end if;
  select count(*) into n from sondes_046 s join prospects p using (id) where p.status = 'a_appeler';
  log := log || E'\n  info  sondes : ' || (select count(*) from sondes_046) || ', dont ' || n || ' remises en « À appeler »';

  -- E. Le motif dit la vérité.
  select count(*) into n from prospects p join avant_046 a using (id)
   where p.status::text <> a.status and p.status_auto_reason is distinct from 'appelée, sans réponse';
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || E'\n FAUTE motif : ' || n; end if;

  -- F. La copie d'avant : une ligne par fiche déplacée, fermée, et elle suffit à défaire.
  select count(*) into n from reprise_046;
  select count(*) into m from avant_046 a join prospects p using (id) where p.status::text <> a.status;
  if n = m then ok := ok + 1; else ko := ko + 1; log := log || E'\n FAUTE reprise_046 : ' || n || ' / ' || m; end if;
  select count(*) into n from pg_policies where tablename = 'reprise_046';
  if n = 0 and (select relrowsecurity from pg_class where oid = 'public.reprise_046'::regclass)
     and not has_table_privilege('authenticated', 'public.reprise_046', 'select')
     and not has_table_privilege('anon', 'public.reprise_046', 'select') then ok := ok + 1;
  else ko := ko + 1; log := log || E'\n FAUTE reprise_046 pas fermée'; end if;

  -- G. Les fiches RÉELLES déplacées : le compte et la liste.
  for r in select a.company_name, coalesce(nullif(btrim(u.full_name), ''), split_part(u.email, '@', 1), '(sans responsable)') as qui,
                  (select count(*) from activities x where x.prospect_id = a.id and not coalesce(x.is_draft, false) and x.outcome in ('sans_reponse', 'barrage')) as fois,
                  (select to_char(max(x.occurred_at) at time zone 'Europe/Brussels', 'DD/MM') from activities x where x.prospect_id = a.id and not coalesce(x.is_draft, false) and x.outcome in ('sans_reponse', 'barrage')) as dernier
             from avant_046 a join prospects p using (id) left join crm_users u on u.id = a.owner_id
            where p.status::text <> a.status and a.id not in (select id from sondes_046)
            order by qui, a.company_name loop
    liste := liste || E'\n  · ' || r.qui || ' — ' || r.company_name || ' (' || r.fois || ' pas décroché, dernier ' || r.dernier || ')';
  end loop;
  select count(*) into n from avant_046 a join prospects p using (id) where p.status::text <> a.status and a.id not in (select id from sondes_046);
  log := log || E'\n  info  fiches réelles remises en « À appeler » : ' || n || liste;

  begin
    update prospects p set status = r2.status, status_auto_reason = r2.status_auto_reason, status_auto_at = r2.status_auto_at
      from reprise_046 r2 where r2.id = p.id;
    select count(*) into n from prospects p join avant_046 a using (id) where p.status::text <> a.status or p.status_auto_reason is distinct from a.status_auto_reason;
    raise exception using errcode = 'P0046', message = n::text;
  exception when sqlstate 'P0046' then
    if sqlerrm = '0' then ok := ok + 1; else ko := ko + 1; log := log || E'\n FAUTE défaire laisse ' || sqlerrm || ' écart(s)'; end if;
  end;
  raise exception 'RECETTE 042 puis 046 — % OK, % FAUTE(S)%', ok, ko, log;
end $r$;
