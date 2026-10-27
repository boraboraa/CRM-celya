/**
 * Lire une colonne NEUVE sans casser l'écran contre une base qui ne l'a pas
 * encore (27/10). Une fusion sur `main` redéploie Vercel tout de suite : si la
 * migration suit de quelques minutes, une requête qui nomme `starred_at`
 * rendrait la liste et « À faire » VIDES (PostgREST : 42703, colonne
 * inconnue). Le code doit partir en premier sans fenêtre de casse — la règle
 * du projet.
 *
 * `fabriquer(true)` nomme la colonne ; sur 42703 SEULEMENT, on rejoue
 * `fabriquer(false)`, qui ne la nomme pas. Toute autre erreur remonte telle
 * quelle. Après la migration, un seul aller-retour, comme avant.
 */
export const COLONNE_ABSENTE = "42703";

export async function avecRepliColonne<R extends { error: { code?: string } | null }>(
  fabriquer: (avecNeuves: boolean) => PromiseLike<R>
): Promise<R> {
  const r = await fabriquer(true);
  if (r.error?.code === COLONNE_ABSENTE) return fabriquer(false);
  return r;
}
