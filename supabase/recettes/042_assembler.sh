#!/usr/bin/env bash
# Assemble la recette 042 + 043 : les sondes du jeu de cas COMMUN
# (lib/crm/etapes.cas.json, le même que test:etapes), la baseline, les deux
# migrations VERBATIM, puis les assertions — en transaction ANNULÉE
# (l'exception finale). Rien n'est validé.
# Usage : bash supabase/recettes/042_assembler.sh > /tmp/recette042.sql
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import json
m042 = open("supabase/migrations/042_sans_contacte.sql").read()
m043 = open("supabase/migrations/043_contacte_refusee.sql").read()
cas = json.load(open("lib/crm/etapes.cas.json"))
attendus = json.load(open("supabase/recettes/042_attendus.json"))
def lit(v): return "null" if v is None else "'" + str(v).replace("'", "''") + "'"
corps = open("supabase/recettes/042_corps.sql").read()
corps_avant, corps_apres = corps.split("-- <<MIGRATIONS>>")
print(corps_avant
      .replace("-- <<CAS>>", lit(json.dumps(cas, ensure_ascii=False)) + "::jsonb")
      .replace("-- <<ATTENDUS>>", ",\n    ".join(f"({lit(n)}, {lit(v)})" for n, v in attendus.items())))
print("-- ===== migration 042, verbatim =====")
print(m042)
print(corps_apres.split("-- <<043>>")[0])
print("-- ===== migration 043, verbatim =====")
print(m043)
print(corps_apres.split("-- <<043>>")[1])
PY
