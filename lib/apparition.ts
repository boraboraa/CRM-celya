/**
 * L'apparition des listes et des colonnes (3 novembre 2026) — module NEUTRE
 * et pur, testé par `test:pointeur`.
 *
 * Deux règles, pour que l'iPad reste fluide :
 * - un décalage par élément n'existe que pour les 6 PREMIERS ; au-delà,
 *   l'élément arrive sans animation (sept colonnes qui tombent une à une,
 *   c'était 280 ms d'attente avant de lire la dernière) ;
 * - une page DÉJÀ VUE dans la session ne rejoue rien au retour (`estRevue`) :
 *   revenir d'une fiche, c'est retrouver sa liste, pas la regarder réapparaître.
 */
export const APPARITIONS_MAX = 6;
export const PAS_APPARITION_MS = 30;

/** Le délai d'apparition du n-ième élément, ou `null` : pas d'animation. */
export function delaiApparition(index: number): number | null {
  if (!Number.isInteger(index) || index < 0 || index >= APPARITIONS_MAX) return null;
  return index * PAS_APPARITION_MS;
}

/** La clé d'une page : son chemin, sans les paramètres (un filtre ne la rend pas neuve). */
export function clePage(chemin: string): string {
  const sans = chemin.split(/[?#]/)[0] || "/";
  return sans.length > 1 ? sans.replace(/\/+$/, "") : sans;
}

/**
 * La page a-t-elle déjà été vue ? Renvoie la réponse ET la liste à retenir
 * (bornée à 50 chemins : la mémoire de session ne grossit pas sans fin).
 */
export function estRevue(vues: readonly string[], chemin: string): { revue: boolean; vues: string[] } {
  const cle = clePage(chemin);
  if (vues.includes(cle)) return { revue: true, vues: [...vues] };
  return { revue: false, vues: [...vues, cle].slice(-50) };
}
