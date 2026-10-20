#!/usr/bin/env bash
# Assemble la recette différentielle de la 029 en UN script, à exécuter d'un
# bloc (MCP Supabase execute_sql, ou psql -1) : baseline → migration VERBATIM →
# assertions → exception finale. L'exception porte le rapport ET garantit que
# rien n'est validé — la fonction créée et les sondes comprises.
#
# Aucun mot « d-r-o-p » dans le script produit (le MCP Supabase attend alors
# une confirmation qui ne vient jamais) ; aucun DDL hors la migration ;
# lock_timeout court pour ne jamais bloquer la production.
#
# Le rapport porte l'empreinte md5 de la migration RÉELLEMENT jouée
# (current_query()), à comparer à celle que l'assembleur affiche sur stderr.
set -euo pipefail
cd "$(dirname "$0")/../.."
out="${1:-/dev/stdout}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
{
  cat <<'SQL'
set local lock_timeout = '3s';
set local statement_timeout = '60s';
-- === Baseline, dans la même transaction, juste avant la migration ===
create temp table base_md5 as
  select (select md5(string_agg(p::text, '|' order by p.id)) from public.prospects p)  as prospects,
         (select md5(string_agg(t::text, '|' order by t.id)) from public.tasks t)      as tasks,
         (select md5(string_agg(m::text, '|' order by m.id)) from public.meetings m)   as meetings,
         (select md5(string_agg(a::text, '|' order by a.id)) from public.activities a) as activities,
         (select md5(coalesce(string_agg(f::text, '|' order by f.id), '')) from public.appels_ia_file f) as file;
SQL
  echo "-- === Migration 029, verbatim ==="
  cat supabase/migrations/029_simuler_inscription.sql
  echo
  echo "-- === Assertions ==="
  cat supabase/recettes/029_corps.sql
  cat <<'SQL'

-- === Fin : le rapport, et le ROLLBACK garanti ===
do $fin$
declare
  q text := current_query();
  debut_mig text := E'-- === Migration 029, verbatim ===\n';
  i int := strpos(q, debut_mig) + length(debut_mig);
  j int := strpos(q, E'\n-- === Assertions ===');
begin
  raise exception 'RECETTE 029 — % OK, % FAUTE(S) [migration jouée : md5 %]%',
    coalesce(nullif(current_setting('recette.ok', true), ''), '0'),
    coalesce(nullif(current_setting('recette.ko', true), ''), '0'),
    md5(substr(q, i, j - i)),
    current_setting('recette.log', true);
end $fin$;
SQL
} > "$tmp"
if grep -qi 'drop' "$tmp"; then
  echo "029_assembler : le script produit contient le mot « drop » — refusé." >&2
  grep -ni 'drop' "$tmp" >&2
  exit 1
fi
cat "$tmp" > "$out"
python3 -I - supabase/migrations/029_simuler_inscription.sql <<'PY' >&2
import hashlib, sys
print("029_assembler : md5 attendu — migration", hashlib.md5(open(sys.argv[1], encoding="utf-8").read().encode("utf-8")).hexdigest())
PY
