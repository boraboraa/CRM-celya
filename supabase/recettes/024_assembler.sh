#!/usr/bin/env bash
# Assemble la recette différentielle de la 024 en UN script, à exécuter d'un
# bloc (MCP Supabase execute_sql, ou psql -1) : baseline → migration VERBATIM →
# assertions → exception finale. L'exception porte le rapport ET garantit que
# rien n'est validé.
set -euo pipefail
cd "$(dirname "$0")/../.."
out="${1:-/dev/stdout}"
{
  cat <<'SQL'
-- === Baseline, dans la même transaction, juste avant la migration ===
create temp table base_prospects on commit drop as
  select id, status, next_action_at, next_action_kind from public.prospects;
create temp table base_md5 on commit drop as
  select (select md5(string_agg(t::text, '|' order by t.id)) from public.tasks t)      as tasks,
         (select md5(string_agg(m::text, '|' order by m.id)) from public.meetings m)   as meetings,
         (select md5(string_agg(a::text, '|' order by a.id)) from public.activities a) as activities;
SQL
  echo "-- === Migration 024, verbatim ==="
  cat supabase/migrations/024_rdv_toujours_devant.sql
  echo
  echo "-- === Assertions ==="
  cat supabase/recettes/024_corps.sql
  cat <<'SQL'

-- === Fin : le rapport, et le ROLLBACK garanti ===
do $fin$
begin
  raise exception 'RECETTE 024 — % OK, % FAUTE(S)%',
    coalesce(nullif(current_setting('recette.ok', true), ''), '0'),
    coalesce(nullif(current_setting('recette.ko', true), ''), '0'),
    current_setting('recette.log', true);
end $fin$;
SQL
} > "$out"
