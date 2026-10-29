-- Recette 041 — en transaction ANNULÉE (l'exception finale). Rien n'est validé.
-- Jouée le 29/10 contre la production : 5 OK, 0 faute (12 fiches).
set local lock_timeout = '3s';
create temp table avant on commit drop as select id, company_name, status, status_locked from prospects;
with derniers as (
  select a.prospect_id, max(a.occurred_at) as at
    from public.activities a
   where a.outcome = 'rappeler' and coalesce(a.is_draft, false) = false
   group by a.prospect_id
)
update public.prospects p
   set status = 'a_rappeler',
       status_auto_at = now(),
       status_auto_reason = 'la personne a demandé à être rappelée le '
         || to_char(d.at at time zone 'Europe/Brussels', 'DD') || ' '
         || (array['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'])
              [extract(month from d.at at time zone 'Europe/Brussels')::int]
         || ' ' || to_char(d.at at time zone 'Europe/Brussels', 'YYYY')
  from derniers d
 where d.prospect_id = p.id
   and coalesce(p.status_locked, false) = false
   and p.status in ('a_appeler', 'contacte', 'rendez_vous');
do $r$
declare n int; e text; ok int := 0; ko int := 0; log text := '';
begin
  select count(*) into n from prospects p join avant a using (id) where a.status is distinct from p.status;
  if n = 12 then ok := ok + 1; else ko := ko + 1; log := log || ' | changées : ' || n; end if;
  select count(*) into n from prospects p join avant a using (id) where a.status is distinct from p.status and (a.status_locked or a.status not in ('a_appeler','contacte','rendez_vous') or p.status <> 'a_rappeler');
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | hors règle : ' || n; end if;
  select count(*) into n from prospects where company_name in ('Catius - Assurances & Finances','Garage Stockel','Mechanik Slawek') and status in ('contacte','perdu');
  if n = 3 then ok := ok + 1; else ko := ko + 1; log := log || ' | verrouillées touchées'; end if;
  select status_auto_reason into e from prospects where company_name = 'Abel Concept';
  if e = 'la personne a demandé à être rappelée le 29 oct. 2026' then ok := ok + 1; else ko := ko + 1; log := log || ' | motif : ' || coalesce(e,'null'); end if;
  select status_auto_reason into e from prospects where company_name like 'SMART ACCESS%';
  if e = 'la personne a demandé à être rappelée le 17 sept. 2026' then ok := ok + 1; else ko := ko + 1; log := log || ' | motif sept : ' || coalesce(e,'null'); end if;
  raise exception 'RECETTE 041 — % OK, % FAUTE(S)%', ok, ko, log;
end $r$;
