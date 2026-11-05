#!/usr/bin/env bash
# Assemble la recette 046 : les sondes du jeu de cas COMMUN
# (lib/crm/etapes.cas.json, le même que test:etapes), la 042 VERBATIM (elle
# passe avant en production), la baseline, la 046 VERBATIM, puis les
# assertions — en transaction ANNULÉE (l'exception finale). Rien n'est validé.
# Usage : bash supabase/recettes/046_assembler.sh > /tmp/recette046.sql
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 -I - <<'PY'
import json
m042 = open("supabase/migrations/042_sans_contacte.sql", encoding="utf-8").read()
m046 = open("supabase/migrations/046_pas_decroche_a_appeler.sql", encoding="utf-8").read()
cas = json.load(open("lib/crm/etapes.cas.json", encoding="utf-8"))
# Ce que la 046 doit faire d'une fiche « À rappeler » non verrouillée : la
# remettre en « À appeler » si la règle TypeScript le dit ET qu'elle a eu un
# « Pas décroché » (une fiche sans aucun appel n'est pas son sujet).
for c in cas:
    tentee = any(a.get("outcome") in ("sans_reponse", "barrage") and not a.get("is_draft") for a in c.get("activities", []))
    c["attendu_046"] = "a_appeler" if c["attendu"] == "a_appeler" and tentee else "a_rappeler"
lit = "'" + json.dumps(cas, ensure_ascii=False, separators=(",", ":")).replace("'", "''") + "'::jsonb"
corps = open("supabase/recettes/046_corps.sql", encoding="utf-8").read()
corps = corps.replace("-- <<CAS>>", lit, 1)
corps = corps.replace("-- <<042>>", "-- ===== migration 042, verbatim =====\n" + m042, 1)
corps = corps.replace("-- <<046>>", "-- ===== migration 046, verbatim =====\n" + m046, 1)
assert "<<" not in corps
print(corps)
PY
