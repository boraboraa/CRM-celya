#!/usr/bin/env bash
# Assemble la recette 038 : la migration VERBATIM + les cas d'indicatifs
# (lib/crm/indicatifs.cas.json, les mêmes que test:regions) + les assertions,
# en transaction ANNULÉE (l'exception finale).
# Usage : bash supabase/recettes/038_assembler.sh > /tmp/recette038.sql
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import json
m = open("supabase/migrations/038_region_par_indicatif.sql").read()
cas = json.load(open("lib/crm/indicatifs.cas.json"))
def lit(v): return "null" if v is None else "'" + v.replace("'", "''") + "'"
valeurs = ",\n    ".join(f"({lit(c['tel'])}, {lit(c['region'])})" for c in cas)
corps = open("supabase/recettes/038_corps.sql").read().replace("-- <<CAS>>", valeurs)
print("set local lock_timeout = '3s';")
print("create temp table avant_038 on commit drop as select id, city, address, region, phone, updated_at from prospects;")
print(m)
print(corps)
PY
