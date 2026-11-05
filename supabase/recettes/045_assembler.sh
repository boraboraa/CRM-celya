#!/usr/bin/env bash
# Assemble la recette 045 (les vrais « intéressés ») en UN script, à exécuter
# d'un bloc (MCP Supabase execute_sql, ou psql -1) : baseline → migration 045
# VERBATIM → assertions → exception finale. L'exception porte le rapport ET
# garantit que rien n'est validé.
#
# Le jeu de cas COMMUN lib/crm/compteurs.cas.json (le même que
# test:objectifs) est injecté : ses lignes sont insérées, et la différence
# des compteurs avant / après doit valoir l'attendu.
# Usage : bash supabase/recettes/045_assembler.sh > /tmp/recette045.sql
set -euo pipefail
cd "$(dirname "$0")/../.."
corps="$(mktemp)"
trap 'rm -f "$corps"' EXIT

python3 -I - supabase/recettes/045_corps.sql lib/crm/compteurs.cas.json > "$corps" <<'PY'
import json, sys
f_corps, f_cpt = sys.argv[1:3]
s = open(f_corps, encoding="utf-8").read()
q = lambda v: "null" if v is None else "'" + v.replace("'", "''") + "'"
cpt = json.load(open(f_cpt, encoding="utf-8"))
qui = {"U": "hakim", "V": "meryem", "ADMIN": "bora", None: "null"}
d, f = cpt["semaine"]["debut"], cpt["semaine"]["fin"]
L = [
  "declare",
  "  bora    constant uuid := 'b3fdb505-76b0-4541-84ec-21b330afe58d';",
  "  hakim   constant uuid := 'afa7eb3d-b3cd-45d9-bac7-ae437757e0c9';",
  "  meryem  constant uuid := '40e345c5-1adb-4e43-a89d-74303d473ad0';",
  "  fx_avant_u jsonb; fx_avant_v jsonb; fx_apres_u jsonb; fx_apres_v jsonb;",
  "  fx_fiche uuid; fx_id uuid; fx_m1 uuid;",
  "begin",
  f"  select to_jsonb(x) - 'user_id' into fx_avant_u from public.compteurs_pour(array[hakim], '{d}', '{f}') x;",
  f"  select to_jsonb(x) - 'user_id' into fx_avant_v from public.compteurs_pour(array[meryem], '{d}', '{f}') x;",
]
for i, p in enumerate(cpt["fiches"]):
  ess = q(p["essai_gratuit_at"]) + "::timestamptz" if p["essai_gratuit_at"] else "null"
  L.append(f"  insert into public.prospects (company_name, owner_id, created_by, created_at, essai_gratuit_at) values "
           f"('ZZ Recette 045 {p['ref']}', {qui[p['owner']]}, {qui[p['created_by']]}, '{p['created_at']}', {ess}) returning id into fx_id;")
  if i == 0: L.append("  fx_fiche := fx_id;")
for m in cpt["rdv"]:
  pid = "fx_fiche" if m["kind"] == "prospect" else "null"
  deb = "now()" if m["status"] == "honore" else "null"
  L.append(f"  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, status, debriefed_at, created_by, created_at) values "
           f"({qui[m['owner']]}, {pid}, '{m['kind']}', 'ZZ Recette 045 {m['ref']}', '{m['created_at']}'::timestamptz + interval '20 days', "
           f"'{m['created_at']}'::timestamptz + interval '20 days 1 hour', '{m['status']}', {deb}, {qui[m['created_by']]}, '{m['created_at']}') returning id into fx_id;")
  if m["ref"] == "m1": L.append("  fx_m1 := fx_id;")
for a in cpt["activites"]:
  L.append(f"  insert into public.activities (prospect_id, author_id, type, subject, outcome, occurred_at, is_draft, is_exchange, meeting_id) values "
           f"(fx_fiche, {qui[a['author']]}, 'note', 'ZZ Recette 045 {a['ref']}', {q(a['outcome'])}, '{a['occurred_at']}', "
           f"{'true' if a.get('draft') else 'false'}, false, {'fx_m1' if a.get('meeting') else 'null'});")
L += [
  f"  select to_jsonb(x) - 'user_id' into fx_apres_u from public.compteurs_pour(array[hakim], '{d}', '{f}') x;",
  f"  select to_jsonb(x) - 'user_id' into fx_apres_v from public.compteurs_pour(array[meryem], '{d}', '{f}') x;",
]
for code, var in (("U", "u"), ("V", "v")):
  att = json.dumps(cpt["attendu"][code], ensure_ascii=False)
  diff = f"(select jsonb_object_agg(k, (fx_apres_{var}->>k)::int - (fx_avant_{var}->>k)::int) from jsonb_object_keys(fx_apres_{var}) k)"
  L.append(f"  perform pg_temp.verifie('jeu commun : {code} — compteurs.cas.json en différentiel (les mêmes que test:objectifs)',\n"
           f"    {diff} = '{att}'::jsonb, {diff}::text);")
L.append("end")
s = s.replace("-- @@FIXTURE_COMPTEURS@@", "\n  ".join(L))
assert "@@" not in s
sys.stdout.write(s)
PY

cat <<'SQL'
set local lock_timeout = '3s';
set local statement_timeout = '90s';
create function pg_temp.verifie(p_nom text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $v$
begin
  if coalesce(p_ok, false) then
    perform set_config('recette.ok', (coalesce(nullif(current_setting('recette.ok', true), ''), '0')::int + 1)::text, true);
    perform set_config('recette.log', coalesce(current_setting('recette.log', true), '') || E'\n OK    ' || p_nom, true);
  else
    perform set_config('recette.ko', (coalesce(nullif(current_setting('recette.ko', true), ''), '0')::int + 1)::text, true);
    perform set_config('recette.log', coalesce(current_setting('recette.log', true), '') || E'\n FAUTE ' || p_nom || coalesce(' — ' || p_detail, ''), true);
  end if;
end $v$;
create function pg_temp.info(p text) returns void language sql as $i$
  select set_config('recette.log', coalesce(current_setting('recette.log', true), '') || E'\n  info  ' || p, true);
$i$;
-- === Baseline : les compteurs réels depuis le 2/11, AVANT la migration ===
create temp table compteurs_avant_045 on commit drop as
  select k.* from public.compteurs_pour(
    (select array_agg(id) from public.crm_users where is_active), '2026-11-02', (current_date + 1)) k;
SQL
echo "-- === Migration 045, verbatim ==="
cat supabase/migrations/045_vrais_interesses.sql
echo
echo "-- === Assertions ==="
cat "$corps"
cat <<'SQL'

-- === Fin : le rapport, et le ROLLBACK garanti ===
do $fin$
begin
  raise exception 'RECETTE 045 — % OK, % FAUTE(S)%',
    coalesce(nullif(current_setting('recette.ok', true), ''), '0'),
    coalesce(nullif(current_setting('recette.ko', true), ''), '0'),
    current_setting('recette.log', true);
end $fin$;
SQL
python3 -I -c 'import hashlib,sys; print("md5 de la migration 045 :", hashlib.md5(open(sys.argv[1],"rb").read()).hexdigest(), file=sys.stderr)' supabase/migrations/045_vrais_interesses.sql
