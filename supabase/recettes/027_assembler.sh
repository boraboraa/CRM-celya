#!/usr/bin/env bash
# Assemble la recette différentielle de la 027 en UN script, à exécuter d'un
# bloc (MCP Supabase execute_sql, ou psql -1) : baseline → migration VERBATIM →
# assertions → exception finale. L'exception porte le rapport ET garantit que
# rien n'est validé.
set -euo pipefail
cd "$(dirname "$0")/../.."
out="${1:-/dev/stdout}"
{
  cat <<'SQL'
-- Jamais de file d'attente sur un verrou en production : on abandonne plutôt.
set local lock_timeout = '3s';
set local statement_timeout = '45s';
-- === Baseline, dans la même transaction, juste avant la migration ===
create temp table base_prospects on commit drop as
  select id, status, next_action_at, next_action_kind from public.prospects;
do $avant$ begin
  if exists (select 1 from pg_trigger where tgname in ('activities_debrief_implicite', 'meetings_rdv_remplaces')) then
    raise exception 'RECETTE 027 — les triggers existent déjà : la 027 est appliquée, recette sans objet';
  end if;
end $avant$;
create temp table base_md5 on commit drop as
  select (select md5(string_agg(t::text, '|' order by t.id)) from public.tasks t) as tasks,
         -- Colonnes d'AVANT la 027, nommées : la migration en ajoute une à chaque table.
         (select md5(string_agg(row(m.id, m.owner_id, m.prospect_id, m.kind, m.title, m.starts_at, m.ends_at,
                                    m.location, m.notes, m.status, m.debriefed_at, m.created_by)::text, '|' order by m.id))
            from public.meetings m) as meetings,
         (select md5(string_agg(row(a.id, a.prospect_id, a.author_id, a.type, a.subject, a.body, a.outcome,
                                    a.occurred_at, a.is_draft, a.is_exchange)::text, '|' order by a.id))
            from public.activities a) as activities;
SQL
  echo "-- === Migration 027, verbatim ==="
  # Les « drop trigger if exists » sont retirés : l'outil execute_sql du MCP
  # Supabase les prend pour une écriture destructive et attend une confirmation
  # qui ne vient jamais (délai dépassé, 18/10). Les triggers n'existent pas
  # avant la migration — le corps le vérifie dans la baseline.
  grep -v '^drop trigger if exists' supabase/migrations/027_debrief_rdv.sql
  echo
  echo "-- === Assertions ==="
  cat supabase/recettes/027_corps.sql
  cat <<'SQL'

-- === Fin : le rapport, et le ROLLBACK garanti ===
do $fin$
begin
  raise exception 'RECETTE 027 — % OK, % FAUTE(S)%',
    coalesce(nullif(current_setting('recette.ok', true), ''), '0'),
    coalesce(nullif(current_setting('recette.ko', true), ''), '0'),
    current_setting('recette.log', true);
end $fin$;
SQL
} > "$out"
