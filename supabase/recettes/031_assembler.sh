#!/usr/bin/env bash
# Assemble la recette différentielle de la 031 en UN script, à exécuter d'un
# bloc (MCP Supabase execute_sql, ou psql -1) : baseline → migration VERBATIM →
# assertions → exception finale. L'exception porte le rapport ET garantit que
# rien n'est validé — fonctions, tables, policies et sondes comprises.
#
# Les jeux de cas JSON partagés avec le TypeScript sont injectés dans le corps :
#   lib/crm/secteurs.cas.json   → normaliser_secteur
#   lib/crm/doublons.cas.json   → cle_telephone, cle_societe
#   lib/crm/compteurs.cas.json  → compteurs_pour (lignes insérées, différentiel)
#
# Aucun « drop trigger » ni « drop policy » dans le script produit (l'outil
# execute_sql du MCP Supabase attend alors une confirmation qui ne vient
# jamais — 18/10) ; la migration n'a qu'un « drop constraint if exists »,
# qui passe. lock_timeout court : on ne bloque jamais la production.
#
# Le rapport porte l'empreinte md5 de la migration RÉELLEMENT jouée, à
# comparer à celle que l'assembleur affiche sur stderr.
set -euo pipefail
cd "$(dirname "$0")/../.."
out="${1:-/dev/stdout}"
tmp="$(mktemp)"
corps="$(mktemp)"
trap 'rm -f "$tmp" "$corps"' EXIT

python3 -I - supabase/recettes/031_corps.sql lib/crm/secteurs.cas.json lib/crm/doublons.cas.json lib/crm/compteurs.cas.json > "$corps" <<'PY'
import json, sys
corps, f_sect, f_cles, f_cpt = sys.argv[1:5]
s = open(corps, encoding="utf-8").read()
q = lambda v: "null::text" if v is None else "'" + v.replace("'", "''") + "'"

# --- secteurs
cas = json.load(open(f_sect, encoding="utf-8"))["cas"]
vals = ", ".join(f"({q(a)}, {q(b)})" for a, b, _ in cas)
sect = f"""perform pg_temp.verifie('secteurs : les {len(cas)} cas de secteurs.cas.json (les mêmes que test:secteurs)',
    not exists (select 1 from (values {vals}) c(s, a) where public.normaliser_secteur(c.s) is distinct from c.a),
    (select string_agg(coalesce(c.s, 'NULL') || ' → ' || coalesce(public.normaliser_secteur(c.s), 'NULL'), ' ; ')
       from (values {vals}) c(s, a) where public.normaliser_secteur(c.s) is distinct from c.a));"""
s = s.replace("-- @@CAS_SECTEURS@@", sect)

# --- clés de doublon
cles = json.load(open(f_cles, encoding="utf-8"))
vt = ", ".join(f"({q(a)}, {q(b)})" for a, b, _ in cles["telephone"])
vs = ", ".join(f"({q(a)}, {q(b)})" for a, b, _ in cles["societe"])
k = f"""perform pg_temp.verifie('clés : les {len(cles["telephone"])} cas de téléphone de doublons.cas.json',
    not exists (select 1 from (values {vt}) c(s, a) where public.cle_telephone(c.s) is distinct from c.a),
    (select string_agg(coalesce(c.s, 'NULL') || ' → ' || coalesce(public.cle_telephone(c.s), 'NULL'), ' ; ')
       from (values {vt}) c(s, a) where public.cle_telephone(c.s) is distinct from c.a));
  perform pg_temp.verifie('clés : les {len(cles["societe"])} cas de société de doublons.cas.json',
    not exists (select 1 from (values {vs}) c(s, a) where public.cle_societe(c.s) is distinct from c.a),
    (select string_agg(coalesce(c.s, 'NULL') || ' → ' || coalesce(public.cle_societe(c.s), 'NULL'), ' ; ')
       from (values {vs}) c(s, a) where public.cle_societe(c.s) is distinct from c.a));"""
s = s.replace("-- @@CAS_CLES@@", k)

# --- compteurs : les lignes du jeu, insérées, puis le différentiel
cpt = json.load(open(f_cpt, encoding="utf-8"))
qui = {"U": "hakim", "V": "meryem", "ADMIN": "bora", None: "null"}
d, f = cpt["semaine"]["debut"], cpt["semaine"]["fin"]
lignes = [
    "declare",
    "  fx_avant_u jsonb; fx_avant_v jsonb; fx_apres_u jsonb; fx_apres_v jsonb;",
    "  fx_fiche uuid; fx_id uuid; fx_m1 uuid;",
    "begin",
    f"  select to_jsonb(x) - 'user_id' into fx_avant_u from public.compteurs_pour(array[hakim], '{d}', '{f}') x;",
    f"  select to_jsonb(x) - 'user_id' into fx_avant_v from public.compteurs_pour(array[meryem], '{d}', '{f}') x;",
]
for i, p in enumerate(cpt["fiches"]):
    ess = q(p["essai_gratuit_at"]) + "::timestamptz" if p["essai_gratuit_at"] else "null"
    lignes.append(
        f"  insert into public.prospects (company_name, owner_id, created_by, created_at, essai_gratuit_at) values "
        f"('ZZ Recette 031 Compteurs {p['ref']}', {qui[p['owner']]}, {qui[p['created_by']]}, '{p['created_at']}', {ess}) returning id into fx_id;"
    )
    if i == 0:
        lignes.append("  fx_fiche := fx_id;")
for m in cpt["rdv"]:
    pid = "fx_fiche" if m["kind"] == "prospect" else "null"
    deb = "now()" if m["status"] == "honore" else "null"
    lignes.append(
        f"  insert into public.meetings (owner_id, prospect_id, kind, title, starts_at, ends_at, status, debriefed_at, created_by, created_at) values "
        f"({qui[m['owner']]}, {pid}, '{m['kind']}', 'ZZ Recette 031 {m['ref']}', '{m['created_at']}'::timestamptz + interval '20 days', "
        f"'{m['created_at']}'::timestamptz + interval '20 days 1 hour', '{m['status']}', {deb}, {qui[m['created_by']]}, '{m['created_at']}') returning id into fx_id;"
    )
    if m["ref"] == "m1":
        lignes.append("  fx_m1 := fx_id;")
for a in cpt["activites"]:
    lignes.append(
        f"  insert into public.activities (prospect_id, author_id, type, subject, outcome, occurred_at, is_draft, is_exchange, meeting_id) values "
        f"(fx_fiche, {qui[a['author']]}, 'note', 'ZZ Recette 031 {a['ref']}', {q(a['outcome'])}, '{a['occurred_at']}', "
        f"{'true' if a.get('draft') else 'false'}, false, {'fx_m1' if a.get('meeting') else 'null'});"
    )
lignes += [
    f"  select to_jsonb(x) - 'user_id' into fx_apres_u from public.compteurs_pour(array[hakim], '{d}', '{f}') x;",
    f"  select to_jsonb(x) - 'user_id' into fx_apres_v from public.compteurs_pour(array[meryem], '{d}', '{f}') x;",
]
for code, var in (("U", "u"), ("V", "v")):
    att = json.dumps(cpt["attendu"][code], ensure_ascii=False)
    lignes.append(
        f"  perform pg_temp.verifie('compteurs : {code} — le jeu de compteurs.cas.json, en différentiel (les mêmes que test:objectifs)',\n"
        f"    (select jsonb_object_agg(k, (fx_apres_{var}->>k)::int - (fx_avant_{var}->>k)::int) from jsonb_object_keys(fx_apres_{var}) k) = '{att}'::jsonb,\n"
        f"    (select jsonb_object_agg(k, (fx_apres_{var}->>k)::int - (fx_avant_{var}->>k)::int) from jsonb_object_keys(fx_apres_{var}) k)::text);"
    )
lignes.append("end;")
s = s.replace("-- @@FIXTURE_COMPTEURS@@", "\n  ".join(lignes))
assert "-- @@" not in s, "marqueur non remplacé"
sys.stdout.write(s)
PY

{
  cat <<'SQL'
set local lock_timeout = '3s';
set local statement_timeout = '90s';
-- === Baseline, dans la même transaction, juste avant la migration ===
do $avant$ begin
  if exists (select 1 from pg_proc where proname = 'normaliser_secteur' and pronamespace = 'public'::regnamespace) then
    raise exception 'RECETTE 031 — normaliser_secteur existe déjà : la 031 est appliquée, recette sans objet';
  end if;
end $avant$;
create temp table base_prospects on commit drop as
  select id, sector, updated_at from public.prospects;
create temp table base_md5 on commit drop as
  select (select md5(string_agg((to_jsonb(p) - 'sector' - 'updated_at')::text, '|' order by p.id)) from public.prospects p) as prospects_hors_secteur,
         (select md5(string_agg(t::text, '|' order by t.id)) from public.tasks t)      as tasks,
         (select md5(string_agg(m::text, '|' order by m.id)) from public.meetings m)   as meetings,
         (select md5(string_agg(a::text, '|' order by a.id)) from public.activities a) as activities;
SQL
  echo "-- === Migration 031, verbatim ==="
  cat supabase/migrations/031_cadre_equipe.sql
  echo
  echo "-- === Assertions ==="
  cat "$corps"
  cat <<'SQL'

-- === Fin : le rapport, et le ROLLBACK garanti ===
do $fin$
declare
  q text := current_query();
  debut_mig text := E'-- === Migration 031, verbatim ===\n';
  i int := strpos(q, debut_mig) + length(debut_mig);
  j int := strpos(q, E'\n-- === Assertions ===');
begin
  raise exception 'RECETTE 031 — % OK, % FAUTE(S) [migration jouée : md5 %]%',
    coalesce(nullif(current_setting('recette.ok', true), ''), '0'),
    coalesce(nullif(current_setting('recette.ko', true), ''), '0'),
    md5(substr(q, i, j - i)),
    current_setting('recette.log', true);
end $fin$;
SQL
} > "$tmp"
if grep -qiE 'drop (trigger|policy|table|function)' "$tmp"; then
  echo "031_assembler : le script produit contient un « drop » interdit — refusé." >&2
  grep -niE 'drop (trigger|policy|table|function)' "$tmp" >&2
  exit 1
fi
cat "$tmp" > "$out"
python3 -I - supabase/migrations/031_cadre_equipe.sql <<'PY' >&2
import hashlib, sys
data = open(sys.argv[1], "rb").read()
print("md5 du fichier de migration (à comparer au rapport) :", hashlib.md5(data).hexdigest())
PY
