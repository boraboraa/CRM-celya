#!/usr/bin/env bash
# Assemble la recette différentielle de la 034 en UN script, à exécuter d'un
# bloc (MCP Supabase execute_sql) : baseline → migration VERBATIM → assertions
# → exception finale (le rapport, et le ROLLBACK garanti).
#
# Injectés dans le corps :
#   lib/crm/lieux.cas.json → public.lieu_de, cas par cas
#   lib/crm/regions.ts     → REGIONS, comparée à public.regions_valides()
#
# Aucun « drop trigger / policy / table / function » (l'outil execute_sql du
# MCP attend alors une confirmation qui ne vient jamais — 18/10).
set -euo pipefail
cd "$(dirname "$0")/../.."
# Deux modes :
#   034_assembler.sh [sortie]          baseline + migration verbatim + assertions
#   034_assembler.sh --apres [sortie]  assertions seules, contre la base où la
#                                      034 est appliquée (la copie de l'avant,
#                                      public.reprise_034, sert de référence)
apres=0
if [ "${1:-}" = "--apres" ]; then apres=1; shift; fi
out="${1:-/dev/stdout}"
tmp="$(mktemp)"
corps="$(mktemp)"
regions="$(mktemp)"
trap 'rm -f "$tmp" "$corps" "$regions"' EXIT

node --experimental-strip-types --no-warnings -e '
import("./lib/crm/regions.ts").then((m) => process.stdout.write(JSON.stringify(m.REGIONS)));
' > "$regions"

python3 -I - supabase/recettes/034_corps.sql lib/crm/lieux.cas.json "$regions" > "$corps" <<'PY'
import json, sys
corps, f_cas, f_regions = sys.argv[1:4]
s = open(corps, encoding="utf-8").read()
q = lambda v: "null::text" if v is None else "'" + v.replace("'", "''") + "'"

cas = json.load(open(f_cas, encoding="utf-8"))["cas"]
vals = ", ".join(f"({q(v)}, {q(a)}, {q(n)}, {q(c)}, {q(r)}, {q(p)})" for v, a, n, c, r, p in cas)
bloc = f"""perform pg_temp.verifie('règle : les {len(cas)} cas de lieux.cas.json',
    not exists (select 1 from (values {vals}) c(v, a, n, ec, er, p)
                cross join lateral public.lieu_de(c.v, c.a, case when nullif(btrim(c.v), '') is null and nullif(btrim(c.a), '') is null then c.n end) l
                where l.commune is distinct from c.ec or l.region is distinct from c.er),
    (select string_agg(coalesce(c.v, c.a, c.n, 'NULL') || ' → ' || coalesce(l.commune, 'NULL') || ' / ' || coalesce(l.region, 'NULL')
                       || ' (attendu ' || coalesce(c.ec, 'NULL') || ' / ' || coalesce(c.er, 'NULL') || ')', ' ; ')
       from (values {vals}) c(v, a, n, ec, er, p)
       cross join lateral public.lieu_de(c.v, c.a, case when nullif(btrim(c.v), '') is null and nullif(btrim(c.a), '') is null then c.n end) l
      where l.commune is distinct from c.ec or l.region is distinct from c.er));"""
s = s.replace("-- @@CAS_LIEUX@@", bloc)

regs = json.load(open(f_regions, encoding="utf-8"))
arr = "array[" + ", ".join(q(r) for r in regs) + "]::text[]"
bloc = f"""perform pg_temp.verifie('régions : public.regions_valides() = REGIONS de lib/crm/regions.ts ({len(regs)})',
    (select array_agg(x order by x) from unnest(public.regions_valides()) x) = (select array_agg(x order by x) from unnest({arr}) x));"""
s = s.replace("-- @@REGIONS_TS@@", bloc)
print(s)
PY

{
  cat <<'SQL'
-- Recette 034 — assemblée par supabase/recettes/034_assembler.sh. Rien n'est validé.
set local lock_timeout = '3s';
SQL
  echo "-- === Migration 034, verbatim ==="
  if [ "$apres" = 0 ]; then cat supabase/migrations/034_commune_region.sql; else echo "-- (déjà appliquée : mode --apres)"; fi
  echo
  echo "-- === Assertions ==="
  cat "$corps"
  cat <<'SQL'

-- === Fin : le rapport, et le ROLLBACK garanti ===
do $fin$
declare
  q text := current_query();
  debut_mig text := E'-- === Migration 034, verbatim ===\n';
  i int := strpos(q, debut_mig) + length(debut_mig);
  j int := strpos(q, E'\n-- === Assertions ===');
begin
  raise exception 'RECETTE 034 — % OK, % FAUTE(S) [migration jouée : md5 %]%',
    coalesce(nullif(current_setting('recette.ok', true), ''), '0'),
    coalesce(nullif(current_setting('recette.ko', true), ''), '0'),
    md5(substr(q, i, j - i)),
    current_setting('recette.log', true);
end $fin$;
SQL
} > "$tmp"
if grep -qiE 'drop (trigger|policy|table|function)' "$tmp"; then
  echo "034_assembler : le script produit contient un « drop » interdit — refusé." >&2
  exit 1
fi
cat "$tmp" > "$out"
python3 -I - supabase/migrations/034_commune_region.sql <<'PY' >&2
import hashlib, sys
print("md5 du fichier de migration (à comparer au rapport) :", hashlib.md5(open(sys.argv[1], "rb").read()).hexdigest())
PY
