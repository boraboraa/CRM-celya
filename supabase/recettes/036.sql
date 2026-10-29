-- Recette 036 — en transaction ANNULÉE (l'exception finale). Rien n'est validé.
-- Se joue en collant la migration 036 VERBATIM entre l'en-tête et le bloc
-- `do` (supabase/recettes/036_assembler.sh), contre la production.
set local lock_timeout = '3s';

-- <<MIGRATION>>

do $r$
declare
  nathan uuid := 'f9d07f3f-daea-46b8-ae6c-b9380444be4b';
  p uuid; pg uuid; m26 uuid; m28 uuid; mfut uuid; mx uuid; my uuid; g1 uuid; g2 uuid;
  api uuid;
  n int; s text; ok int := 0; ko int := 0; log text := '';
begin
  -- Le cas API CAR 3000 rejoué sur une fiche de sonde : deux RDV passés, un à venir.
  insert into prospects(company_name, owner_id, created_by, status)
    values ('ZZ Sonde 036', nathan, nathan, 'rendez_vous') returning id into p;
  -- Le RDV à venir naît d'abord (poser un RDV ferme les RDV passés en
  -- attente, 027) ; annulé le temps de lire l'effet des seuls RDV passés.
  insert into meetings(prospect_id, owner_id, created_by, kind, title, starts_at, ends_at, status)
    values (p, nathan, nathan, 'prospect', 'RDV futur', now() + interval '5 days', now() + interval '5 days 1 hour', 'prevu') returning id into mfut;
  update meetings set status = 'annule' where id = mfut;
  insert into meetings(prospect_id, owner_id, created_by, kind, title, starts_at, ends_at, status)
    values (p, nathan, nathan, 'prospect', 'RDV 26', now() - interval '33 days', now() - interval '33 days' + interval '1 hour', 'prevu') returning id into m26;
  insert into meetings(prospect_id, owner_id, created_by, kind, title, starts_at, ends_at, status)
    values (p, nathan, nathan, 'prospect', 'RDV 28', now() - interval '31 days', now() - interval '31 days' + interval '1 hour', 'prevu') returning id into m28;
  -- (poser m28 a remplacé m26, comme la 027 le veut : on le ranime pour
  --  rejouer le doublon réel, posé avant la 027)
  update meetings set status = 'prevu', debriefed_at = null, debrief_issue = null where id = m26;
  insert into tasks(prospect_id, assignee_id, created_by, title, due_at, status)
    values (p, nathan, nathan, 'Relancer ZZ', now() + interval '1 day', 'a_faire');

  -- 1. Débriefer le PLUS ANCIEN (26) ferme le plus récent (28).
  update meetings set status = 'honore', debriefed_at = now(), debrief_issue = 'a_rappeler' where id = m26;
  select status || '/' || coalesce(debrief_issue, '') into s from meetings where id = m28;
  if s = 'annule/remplace' then ok := ok + 1; else ko := ko + 1; log := log || ' | 28 non fermé (' || s || ')'; end if;
  select count(*) into n from activities where meeting_id = m28 and subject like 'RDV du % clos par le débrief du RDV du %';
  if n = 1 then ok := ok + 1; else ko := ko + 1; log := log || ' | ligne de journal du 28 : ' || n; end if;
  select next_action_kind into s from prospects where id = p;
  if s = 'relance' then ok := ok + 1; else ko := ko + 1; log := log || ' | prochaine action = ' || coalesce(s, 'null'); end if;
  if (select status from meetings where id = m26) = 'honore' then ok := ok + 1; else ko := ko + 1; log := log || ' | 26 pas honoré'; end if;

  -- 2. Un RDV À VENIR n'est jamais touché par un débrief.
  update meetings set status = 'prevu' where id = mfut;
  insert into meetings(prospect_id, owner_id, created_by, kind, title, starts_at, ends_at, status)
    values (p, nathan, nathan, 'prospect', 'RDV X', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'prevu') returning id into mx;
  update meetings set status = 'honore', debriefed_at = now(), debrief_issue = 'proposition' where id = mx;
  if (select status from meetings where id = mfut) = 'prevu' then ok := ok + 1; else ko := ko + 1; log := log || ' | RDV futur touché'; end if;

  -- 3. Une ANNULATION ne ferme rien.
  insert into meetings(prospect_id, owner_id, created_by, kind, title, starts_at, ends_at, status)
    values (p, nathan, nathan, 'prospect', 'RDV Y', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'prevu') returning id into my;
  update meetings set status = 'prevu', debriefed_at = null, debrief_issue = null where id = mx;  -- deux en attente : X (plus récent), Y
  update meetings set status = 'annule', debriefed_at = now() where id = my;
  if (select status from meetings where id = mx) = 'prevu' then ok := ok + 1; else ko := ko + 1; log := log || ' | une annulation a fermé un RDV'; end if;

  -- 4. Fiche gagnée : rien.
  insert into prospects(company_name, owner_id, created_by, status)
    values ('ZZ Sonde 036 gagnée', nathan, nathan, 'rendez_vous') returning id into pg;
  insert into meetings(prospect_id, owner_id, created_by, kind, title, starts_at, ends_at, status)
    values (pg, nathan, nathan, 'prospect', 'G1', now() - interval '10 days', now() - interval '10 days' + interval '1 hour', 'prevu') returning id into g1;
  insert into meetings(prospect_id, owner_id, created_by, kind, title, starts_at, ends_at, status)
    values (pg, nathan, nathan, 'prospect', 'G2', now() - interval '8 days', now() - interval '8 days' + interval '1 hour', 'prevu') returning id into g2;
  update meetings set status = 'prevu', debriefed_at = null, debrief_issue = null where id = g1;
  update prospects set status = 'gagne' where id = pg;
  update meetings set status = 'honore', debriefed_at = now() where id = g1;
  if (select status from meetings where id = g2) = 'prevu' then ok := ok + 1; else ko := ko + 1; log := log || ' | fiche gagnée touchée'; end if;

  -- 5. Le débrief IMPLICITE (une note attestée) ferme aussi tout.
  update meetings set status = 'prevu', debriefed_at = null, debrief_issue = null where id = my;
  -- X (-2 j) et Y (-3 j) en attente ; une note attestée posée maintenant.
  insert into activities(prospect_id, author_id, type, subject, occurred_at, is_exchange, outcome)
    values (p, nathan, 'note', 'rappelé, intéressé', now(), true, 'interesse');
  select count(*) into n from meetings where id in (mx, my) and status in ('prevu','confirme','reporte');
  if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | implicite : ' || n || ' RDV encore en attente'; end if;

  -- 6. La reprise : API CAR 3000 n'a plus aucun RDV passé en attente, et sa
  --    prochaine action est sa relance.
  select id into api from prospects where company_name = 'API CAR 3000';
  if api is null then
    log := log || ' | (API CAR 3000 absente : reprise non vérifiée)';
  else
    select count(*) into n from meetings
     where prospect_id = api and kind = 'prospect' and status in ('prevu','confirme','reporte')
       and debriefed_at is null and starts_at <= now();
    if n = 0 then ok := ok + 1; else ko := ko + 1; log := log || ' | API CAR : ' || n || ' RDV encore en attente'; end if;
    select next_action_kind into s from prospects where id = api;
    if s = 'relance' then ok := ok + 1; else ko := ko + 1; log := log || ' | API CAR prochaine action = ' || coalesce(s, 'null'); end if;
    select count(*) into n from activities where prospect_id = api and subject = 'RDV du 28/09 clos par le débrief du RDV du 26/09';
    if n = 1 then ok := ok + 1; else ko := ko + 1; log := log || ' | API CAR journal : ' || n; end if;
  end if;

  raise exception 'RECETTE 036 — % OK, % FAUTE(S)%', ok, ko, log;
end $r$;
