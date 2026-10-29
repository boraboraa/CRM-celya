#!/usr/bin/env bash
# Assemble la recette 036 : la migration VERBATIM à la place de <<MIGRATION>>.
# Usage : bash supabase/recettes/036_assembler.sh > /tmp/recette036.sql
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
m = open("supabase/migrations/036_debrief_ferme_les_doublons.sql").read()
r = open("supabase/recettes/036.sql").read()
print(r.replace("-- <<MIGRATION>>", m))
PY
