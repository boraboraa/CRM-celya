#!/usr/bin/env bash
# Assemble la recette différentielle de la 022 en UN script, à exécuter d'un
# bloc (MCP Supabase execute_sql, ou psql -1) : baseline → migration VERBATIM →
# assertions → exception finale. L'exception porte le rapport ET garantit que
# rien n'est validé. Rien, dans ce script, ne peut « commit ».
set -euo pipefail
cd "$(dirname "$0")/../.."
out="${1:-/dev/stdout}"
{
  cat <<'SQL'
-- === Baseline, dans la même transaction, juste avant la migration ===
create temp table base_prospects on commit drop as select id, next_action_at from public.prospects;
create temp table base_tasks on commit drop as select id, due_at, status from public.tasks;
create temp table base_counts on commit drop as select count(*) as c from public.activities;
SQL
  echo "-- === Migration 022, verbatim ==="
  cat supabase/migrations/022_rdv_prochaine_action.sql
  echo
  echo "-- === Assertions ==="
  cat supabase/recettes/022_corps.sql
  cat <<'SQL'

-- === Fin : le rapport, et le ROLLBACK garanti ===
do $fin$
begin
  raise exception 'RECETTE 022 — % OK, % FAUTE(S)%',
    coalesce(nullif(current_setting('recette.ok', true), ''), '0'),
    coalesce(nullif(current_setting('recette.ko', true), ''), '0'),
    current_setting('recette.log', true);
end $fin$;
SQL
} > "$out"
