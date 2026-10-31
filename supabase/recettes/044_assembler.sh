#!/usr/bin/env bash
# Assemble la recette 044 : la baseline, la migration VERBATIM, puis les
# assertions — en transaction ANNULÉE (l'exception finale). Rien n'est validé.
# Usage : bash supabase/recettes/044_assembler.sh > /tmp/recette044.sql
set -euo pipefail
cd "$(dirname "$0")/../.."
echo "set local lock_timeout = '3s';"
echo "create temp table avant_044 on commit drop as select id, prospect_id, status::text as status, due_at, title from tasks;"
echo "create temp table perdues_044 on commit drop as select t.id from tasks t join prospects p on p.id = t.prospect_id where p.status::text = 'perdu' and t.status = 'a_faire';"
cat supabase/migrations/044_perdu_l_emporte.sql
cat supabase/recettes/044_corps.sql
