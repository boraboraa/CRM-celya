-- ============================================================
-- Recette 045 — corps (assertions). NE S'EXÉCUTE PAS SEUL.
-- Assemblé par supabase/recettes/045_assembler.sh : baseline → migration 045
-- VERBATIM → ce corps (le jeu compteurs.cas.json injecté dans le bloc C)
-- → exception finale (rapport + rollback garanti).
-- ============================================================

do $r$
declare
  bora    constant uuid := 'b3fdb505-76b0-4541-84ec-21b330afe58d';
  hakim   constant uuid := 'afa7eb3d-b3cd-45d9-bac7-ae437757e0c9';
  meryem  constant uuid := '40e345c5-1adb-4e43-a89d-74303d473ad0';
  r record;
  f oid := 'public.compteurs_pour(uuid[], date, date)'::regprocedure;
begin
  -- A. La forme de la fonction : inchangée hors de la règle.
  perform pg_temp.verifie('forme : compteurs_pour reste SECURITY DEFINER',
    (select prosecdef from pg_proc where oid = f));
  perform pg_temp.verifie('forme : compteurs_pour garde search_path = ''''',
    (select proconfig from pg_proc where oid = f) = array['search_path=""'],
    (select proconfig::text from pg_proc where oid = f));
  perform pg_temp.verifie('droits : anon ne peut PAS l''exécuter', not has_function_privilege('anon', f, 'execute'));
  perform pg_temp.verifie('droits : authenticated ne peut PAS l''exécuter', not has_function_privilege('authenticated', f, 'execute'));
  perform pg_temp.verifie('droits : service_role peut l''exécuter', has_function_privilege('service_role', f, 'execute'));
  perform pg_temp.verifie('classement_equipe appelle compteurs_pour et ne recopie pas la règle',
    position('compteurs_pour' in pg_get_functiondef('public.classement_equipe(date, date)'::regprocedure)) > 0
    and position('outcome' in pg_get_functiondef('public.classement_equipe(date, date)'::regprocedure)) = 0);
  perform pg_temp.verifie('compteurs_de appelle compteurs_pour et ne recopie pas la règle',
    position('compteurs_pour' in pg_get_functiondef('public.compteurs_de(uuid, date, date)'::regprocedure)) > 0
    and position('outcome' in pg_get_functiondef('public.compteurs_de(uuid, date, date)'::regprocedure)) = 0);

  -- B. Les compteurs réels de l'équipe depuis le 2/11 : seuls les intéressés
  --    bougent, et ils valent le nombre de « Intéressé ».
  for r in
    select c.id, coalesce(nullif(btrim(c.full_name), ''), split_part(c.email, '@', 1)) as nom,
           to_jsonb(av) - 'user_id' as avant, to_jsonb(ap) - 'user_id' as apres
      from public.crm_users c
      join compteurs_avant_045 av on av.user_id = c.id
      join lateral public.compteurs_pour(array[c.id], '2026-11-02', (current_date + 1)) ap on true
     order by av.appels desc
  loop
    perform pg_temp.info(rpad(r.nom, 24) || ' appels ' || (r.avant->>'appels') || ' · réponses ' || (r.avant->>'reponses')
      || ' → ' || (r.apres->>'reponses') || ' · intéressés ' || (r.avant->>'interesses') || ' → ' || (r.apres->>'interesses'));
    perform pg_temp.verifie('réel : ' || r.nom || ' — seuls les intéressés changent',
      (r.avant - 'interesses') = (r.apres - 'interesses'), (r.avant - 'interesses')::text || ' / ' || (r.apres - 'interesses')::text);
    perform pg_temp.verifie('réel : ' || r.nom || ' — intéressés = nombre de « Intéressé »',
      (r.apres->>'interesses')::int = (select count(*) from public.activities a
         where a.author_id = r.id and not coalesce(a.is_draft, false) and a.meeting_id is null and a.outcome = 'interesse'
           and a.occurred_at >= ('2026-11-02'::timestamp at time zone 'Europe/Brussels')
           and a.occurred_at < ((current_date + 1)::timestamp at time zone 'Europe/Brussels')));
  end loop;
end $r$;

-- C. Le jeu commun, en différentiel (les mêmes cas que test:objectifs).
do $fx$
  -- @@FIXTURE_COMPTEURS@@
$fx$;
