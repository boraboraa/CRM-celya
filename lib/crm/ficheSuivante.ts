/**
 * « Fiche suivante » — enchaîner les fiches de « À faire » sans repasser par
 * le tableau de bord (18/10). L'ORDRE est celui de l'écran, tel qu'il vient
 * d'être affiché : rendez-vous à débriefer, puis à appeler / à rappeler (en
 * retard, aujourd'hui), puis en attente de réponse, puis réponses reçues. Une
 * fiche présente dans deux zones n'apparaît qu'une fois, à sa première place.
 *
 * Le tableau de bord mémorise la liste (sessionStorage, par onglet) ; la
 * fiche ouverte DEPUIS « À faire » (`?depuis=a-faire`) y cherche la suivante.
 * Rien n'est recalculé ailleurs : la liste est exactement ce qu'on a vu.
 *
 * Module NEUTRE, sans import : exécuté par `npm run test:fiche-suivante`.
 */

/** Le paramètre d'URL qui dit « ouverte depuis À faire ». */
export const DEPUIS_A_FAIRE = "a-faire";

/** La clé de mémoire (sessionStorage). */
export const MEMOIRE_A_FAIRE = "celya:a-faire";

/** Les zones, dans l'ordre de l'écran → une liste de fiches, sans doublon. */
export function ordreAFaire(zones: (string | null | undefined)[][]): string[] {
  const vus = new Set<string>();
  const out: string[] = [];
  for (const zone of zones) {
    for (const id of zone) {
      if (!id || vus.has(id)) continue;
      vus.add(id);
      out.push(id);
    }
  }
  return out;
}

export type PositionAFaire = {
  /** La fiche suivante, ou null : c'était la dernière. */
  suivante: string | null;
  /** 1 = la première ligne. */
  position: number;
  total: number;
};

/** Où est la fiche courante, et quelle est la suivante — null si absente. */
export function ficheSuivante(
  liste: readonly string[],
  courant: string
): PositionAFaire | null {
  const i = liste.indexOf(courant);
  if (i < 0) return null;
  return {
    suivante: liste[i + 1] ?? null,
    position: i + 1,
    total: liste.length,
  };
}

/** Le lien vers une fiche ouverte depuis « À faire ». */
export function lienDepuisAFaire(prospectId: string): string {
  return `/prospects/${prospectId}?depuis=${DEPUIS_A_FAIRE}`;
}

/** Relit la liste mémorisée — tolérante à tout (stockage bloqué, JSON abîmé). */
export function lireListe(brut: string | null | undefined): string[] {
  if (!brut) return [];
  try {
    const v = JSON.parse(brut);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
