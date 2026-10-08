#!/usr/bin/env bash
# Assemble la recette différentielle de la 025 en UN script, à exécuter d'un
# bloc (MCP Supabase execute_sql, ou psql -1) : baseline → migration VERBATIM →
# assertions (avec les cas de numéros INJECTÉS) → exception finale. L'exception
# porte le rapport ET garantit que rien n'est validé — tables, trigger, tâche
# pg_cron et secrets Vault créés par la migration compris.
#
# Les cas du juge du numéro viennent de lib/appelsIa/numeros.cas.json : UN SEUL
# jeu de cas pour le juge TypeScript (lib/appelsIa/regles.test.ts) et le juge
# SQL (public.appels_ia_numero). Ils remplacent le marqueur `-- @@CAS_NUMEROS@@`
# du corps.
#
# Aucun mot « d-r-o-p » dans le script produit : le MCP Supabase demande une
# confirmation sur ce mot et tombe en délai dépassé. Les tables temporaires de
# la baseline disparaissent avec le rollback ; l'assembleur refuse de produire
# un script qui contiendrait ce mot.
set -euo pipefail
cd "$(dirname "$0")/../.."
out="${1:-/dev/stdout}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
{
  cat <<'SQL'
-- === Baseline, dans la même transaction, juste avant la migration ===
create temp table base_ids as
  select 'prospects'::text as t, id from public.prospects
  union all select 'tasks', id from public.tasks
  union all select 'meetings', id from public.meetings
  union all select 'activities', id from public.activities;
create temp table base_md5 as
  select (select md5(string_agg(p::text, '|' order by p.id)) from public.prospects p)  as prospects,
         (select md5(string_agg(t::text, '|' order by t.id)) from public.tasks t)      as tasks,
         (select md5(string_agg(m::text, '|' order by m.id)) from public.meetings m)   as meetings,
         (select md5(string_agg(a::text, '|' order by a.id)) from public.activities a) as activities;
-- Ce que Rémi voit AVANT la migration, mesuré sous son identité.
do $base$
declare
  n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from public.crm_users where email = 'remi.perezweber@zohomail.eu'),
    'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.prospects;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('recette.remi_base', n::text, true);
end $base$;
SQL
  echo "-- === Migration 025, verbatim ==="
  cat supabase/migrations/025_appels_ia.sql
  echo
  echo "-- === Assertions ==="
  python3 -I - supabase/recettes/025_corps.sql lib/appelsIa/numeros.cas.json <<'PY'
import json, sys
corps_path, cas_path = sys.argv[1], sys.argv[2]
with open(cas_path, encoding="utf-8") as f:
    cas = json.load(f)["cas"]
def lit(v):
    return "null" if v is None else "'" + v.replace("'", "''") + "'"
def lit_exact(v):
    # La saisie et l'attendu partent en ASCII : un caractère non ASCII (espace
    # insécable du cas « espaces insécables »…) s'écrit U&'\00A0', pour qu'aucun
    # copier-coller ne le transforme en espace ordinaire.
    if v is None or all(ord(c) < 128 for c in v):
        return lit(v)
    corps = "".join(c if ord(c) < 128 else "\\%04X" % ord(c) for c in v.replace("'", "''").replace("\\", "\\\\"))
    return "U&'" + corps + "'"
lignes = ["-- Cas injectés depuis lib/appelsIa/numeros.cas.json (%d)" % len(cas)]
for i, (saisie, attendu, pourquoi) in enumerate(cas, 1):
    lignes.append("select pg_temp.verifie_numero(%d, %s, %s, %s);" % (i, lit_exact(saisie), lit_exact(attendu), lit(pourquoi)))
lignes.append(
    "select pg_temp.verifie('numéros : les %d cas de numeros.cas.json ont tous été joués', "
    "current_setting('recette.cas_joues', true) = '%d', current_setting('recette.cas_joues', true));" % (len(cas), len(cas)))
with open(corps_path, encoding="utf-8") as f:
    corps = f.read()
marqueur = "-- @@CAS_NUMEROS@@"
if corps.count(marqueur) != 1:
    sys.exit("025_assembler : le marqueur %s doit figurer une fois exactement dans le corps" % marqueur)
sys.stdout.write(corps.replace(marqueur, "\n".join(lignes)))
PY
  cat <<'SQL'

-- === Fin : le rapport, et le ROLLBACK garanti ===
do $fin$
begin
  raise exception 'RECETTE 025 — % OK, % FAUTE(S)%',
    coalesce(nullif(current_setting('recette.ok', true), ''), '0'),
    coalesce(nullif(current_setting('recette.ko', true), ''), '0'),
    current_setting('recette.log', true);
end $fin$;
SQL
} > "$tmp"
if grep -qi 'drop' "$tmp"; then
  echo "025_assembler : le script produit contient le mot « drop » — refusé." >&2
  grep -ni 'drop' "$tmp" >&2
  exit 1
fi
cat "$tmp" > "$out"
