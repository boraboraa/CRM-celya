#!/usr/bin/env bash
# Assemble la recette différentielle de la 033 en UN script, à exécuter d'un
# bloc (MCP Supabase execute_sql, ou psql -1) : baseline → migration VERBATIM →
# assertions → exception finale. L'exception porte le rapport ET garantit que
# rien n'est validé — contraintes, fonctions, trigger, reprise et sondes.
#
# La 032 (valeur d'enum `suivi_email`) n'est PAS nécessaire : la 033 ne porte
# la nouvelle valeur que dans des colonnes TEXTE (activities.outcome,
# meetings.debrief_issue). L'étape `suivi_email` elle-même est testée côté
# TypeScript (test:debrief).
#
# Aucun « drop trigger » ni « drop policy » dans le script produit (l'outil
# execute_sql du MCP Supabase attend alors une confirmation qui ne vient
# jamais — 18/10) ; la migration n'a que des « drop constraint if exists »,
# qui passent. lock_timeout court : on ne bloque jamais la production.
set -euo pipefail
cd "$(dirname "$0")/../.."
out="${1:-/dev/stdout}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
{
  cat <<'SQL'
set local lock_timeout = '3s';
set local statement_timeout = '90s';
-- === Baseline, dans la même transaction, juste avant la migration ===
do $avant$ begin
  if exists (select 1 from pg_proc where proname = 'prospects_essai_clot_rdv' and pronamespace = 'public'::regnamespace) then
    raise exception 'RECETTE 033 — prospects_essai_clot_rdv existe déjà : la 033 est appliquée, recette sans objet';
  end if;
end $avant$;
create temp table base_meetings on commit drop as
  select id, prospect_id, status, debrief_issue, debriefed_at from public.meetings;
create temp table base_md5 on commit drop as
  select (select md5(string_agg(t::text, '|' order by t.id)) from public.tasks t) as tasks,
         (select max(created_at) from public.activities) as act_max,
         (select count(*) from public.activities) as act_n,
         (select md5(string_agg((to_jsonb(p) - 'next_action_at' - 'next_action_kind' - 'updated_at' - 'last_contact_at')::text, '|' order by p.id))
            from public.prospects p) as prospects;
SQL
  echo "-- === Migration 033, verbatim ==="
  cat supabase/migrations/033_simplifier.sql
  echo
  echo "-- === Assertions ==="
  cat supabase/recettes/033_corps.sql
  cat <<'SQL'

-- === Fin : le rapport, et le ROLLBACK garanti ===
do $fin$
declare
  q text := current_query();
  debut_mig text := E'-- === Migration 033, verbatim ===\n';
  i int := strpos(q, debut_mig) + length(debut_mig);
  j int := strpos(q, E'\n-- === Assertions ===');
begin
  raise exception 'RECETTE 033 — % OK, % FAUTE(S) [migration jouée : md5 %]%',
    coalesce(nullif(current_setting('recette.ok', true), ''), '0'),
    coalesce(nullif(current_setting('recette.ko', true), ''), '0'),
    md5(substr(q, i, j - i)),
    current_setting('recette.log', true);
end $fin$;
SQL
} > "$tmp"
if grep -qiE 'drop (trigger|policy|table|function)' "$tmp"; then
  echo "033_assembler : le script produit contient un « drop » interdit — refusé." >&2
  grep -niE 'drop (trigger|policy|table|function)' "$tmp" >&2
  exit 1
fi
cat "$tmp" > "$out"
python3 -I - supabase/migrations/033_simplifier.sql <<'PY' >&2
import hashlib, sys
data = open(sys.argv[1], "rb").read()
print("md5 du fichier de migration (à comparer au rapport) :", hashlib.md5(data).hexdigest())
PY
