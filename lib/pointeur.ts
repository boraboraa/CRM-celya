/**
 * Le pointeur — la souris ou le doigt (3 novembre 2026).
 *
 * Module NEUTRE et pur : ni React, ni DOM imposé. Tailwind (`tailwind.config.ts`,
 * l'écran `souris:`), la CSS (`app/globals.css`, le filet des 44 px) et le
 * hook client (`components/useSouris.ts`) lisent LA MÊME requête — elle n'est
 * écrite qu'ici, et `test:pointeur` vérifie que les deux fichiers qui ne
 * peuvent pas l'importer (la CSS) la recopient à l'identique.
 *
 * La règle du lot : **`souris:` pour les cibles, `lg:` pour la mise en page.**
 * Une cible ne rétrécit jamais à cause de la LARGEUR : un iPad en paysage
 * (1180 px) a la mise en page large ET des cibles de doigt. Avant, tout ce qui
 * dépassait 1024 px recevait les cibles d'une souris (case de 20 px, liens de
 * 11 px, croix de 12 px) — et Colin tapait à côté.
 */

/** Une souris (ou un trackpad) : survol possible, pointeur précis. */
export const REQUETE_SOURIS = "(hover: hover) and (pointer: fine)";

/** Un doigt : pointeur grossier (téléphone, iPad, écran tactile). */
export const REQUETE_DOIGT = "(pointer: coarse)";

/** La plus petite zone qui répond au doigt (Apple, WCAG 2.5.5). */
export const CIBLE_TACTILE_MIN = 44;

type MatchMedia = (requete: string) => { matches: boolean };

/**
 * Le pointeur est-il une souris ? Sans `matchMedia` (serveur, test), la
 * réponse est NON : on part du doigt, le cas le plus exigeant — une carte qui
 * ne se glisse pas reste un lien, une carte qui se glisse sous le doigt ouvre
 * un aperçu ou part en déplacement.
 */
export function estSouris(matchMedia?: MatchMedia | null): boolean {
  if (!matchMedia) return false;
  try {
    return matchMedia(REQUETE_SOURIS).matches;
  } catch {
    return false;
  }
}

/**
 * Une carte du pipeline (ou un rendez-vous de l'agenda) se glisse-t-elle ?
 * Seulement à la souris, et seulement si on a le droit de la déplacer. Au
 * doigt, la carte est un simple lien : l'étape se change par le menu.
 */
export function deplacable(souris: boolean, modifiable: boolean): boolean {
  return souris && modifiable;
}

/** Le balayage de l'agenda : jour suivant (1), précédent (-1), ou rien (0). */
export const BALAYAGE_MIN_PX = 60;

/**
 * Un geste franchement HORIZONTAL : au moins 60 px de côté, et deux fois plus
 * de côté que de vertical. Un défilement vertical un peu de travers ne change
 * plus de jour (le seuil de 40 px de vertical laissait passer un défilement
 * rapide et oblique).
 */
export function balayage(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < BALAYAGE_MIN_PX) return 0;
  if (Math.abs(dx) < 2 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
