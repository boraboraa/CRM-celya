-- Recette 037 — en transaction ANNULÉE (l'exception finale). Rien n'est validé.
-- Jouée le 29/10 contre la production : 5 OK, 0 faute.
set local lock_timeout = '3s';
create temp table avant on commit drop as select id, status, status_locked from prospects;

-- (corps de la migration 037, verbatim)
with visees as (
  select p.id from public.prospects p join public.prospect_action_state s on s.prospect_id = p.id
   where s.last_outcome = 'refus' and p.status not in ('perdu', 'gagne')
), relances as (
  update public.tasks t set status = 'annule' from visees v where t.prospect_id = v.id and t.status = 'a_faire' returning t.id
)
update public.prospects p set status = 'perdu', status_locked = true, status_locked_at = now(), status_auto_reason = null, status_auto_at = null,
       lost_reason = coalesce(nullif(trim(p.lost_reason), ''), 'Pas intéressé')
  from visees v where p.id = v.id;

do $r$
declare n int; m int; ok int := 0; ko int := 0; log text := '';
begin
  select count(*) into n from prospects p join avant a using (id) where a.status <> p.status;
  if n = 4 then ok := ok + 1; else ko := ko + 1; log := log || ' | changées : ' || n; end if;
  select count(*) into n from prospects where company_name in ('Syrez beauté','les germaines salon de coiffure','Point S lyon 3','GARAGE RACHAIS Dacia') and status = 'perdu' and status_locked;
  if n = 4 then ok := ok + 1; else ko := ko + 1; log := log || ' | les 4 : ' || n; end if;
  select count(*) into m from prospects p join avant a using (id) where a.status = 'gagne' and p.status <> 'gagne';
  if m = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | gagnée touchée'; end if;
  select count(*) into n from prospects p join prospect_action_state s on s.prospect_id = p.id where s.last_outcome = 'refus' and p.status not in ('perdu','gagne');
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | reste ' || n; end if;
  select count(*) into n from prospects where status = 'perdu';
  if n = 29 then ok := ok + 1; else ko := ko + 1; log := log || ' | perdues : ' || n; end if;
  raise exception 'RECETTE 037 — % OK, % FAUTE(S)%', ok, ko, log;
end $r$;
