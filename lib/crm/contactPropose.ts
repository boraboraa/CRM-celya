/**
 * Le nom de la personne, au bon endroit (27/10, retours de Bora).
 *
 * Quand le compte rendu d'un appel ou d'un débrief contient le nom de la
 * personne (« parlé à Mme Lambert, la gérante »), il est PROPOSÉ comme contact
 * de la fiche — une pastille « Contact → Mme Lambert (gérante) », gardée d'un
 * tap ou retirée d'une croix. Trois règles :
 *
 *   · jamais écrit sans ce geste ;
 *   · jamais par-dessus un contact déjà présent sans le DIRE : la pastille
 *     devient « Remplacer « M. Dupont » par « Mme Lambert » ? » ;
 *   · un nom déjà sur la fiche (même écrit autrement : accents, majuscules,
 *     civilité, fonction) n'est pas reproposé.
 *
 * La LECTURE du nom vit dans lib/crm/raccourcis.ts (déterministe, à la frappe) ;
 * ce module ne fait que confronter ce qui est lu à ce qui est sur la fiche.
 * Module NEUTRE, joué par `npm run test:raccourcis`.
 */

/** La longueur de `prospects.contact_name` que l'écriture garde. */
export const CONTACT_MAX = 120;

export type PropositionContact = {
  /** Ce qui sera écrit dans `contact_name`. */
  valeur: string;
  /** Le contact actuel que la proposition remplacerait — null s'il n'y en a pas. */
  remplace: string | null;
};

/** La personne, sans civilité ni fonction, sans accents ni casse. */
export function clePersonne(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(madame|monsieur|mademoiselle|mme|mlle|mr|m)\b\.?/g, " ")
    .replace(/[^a-z' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ce qu'on propose d'écrire, ou null : rien de lu, ou c'est déjà la personne
 * de la fiche. `remplace` dit le contact qu'on écraserait.
 */
export function propositionContact(
  lu: string | null | undefined,
  actuel: string | null | undefined
): PropositionContact | null {
  const valeur = (lu ?? "").replace(/\s+/g, " ").trim().slice(0, CONTACT_MAX);
  if (!valeur || !clePersonne(valeur)) return null;
  const present = (actuel ?? "").trim();
  if (!present) return { valeur, remplace: null };
  const a = clePersonne(valeur);
  const b = clePersonne(present);
  // Même personne (« Mme Lambert » / « lambert ») : rien à proposer — sauf si
  // la proposition AJOUTE une fonction que la fiche n'a pas.
  if (a === b) {
    const ajouteFonction = /\(/.test(valeur) && !/\(/.test(present);
    return ajouteFonction ? { valeur, remplace: present } : null;
  }
  return { valeur, remplace: present };
}

/** La phrase de la pastille. */
export function phraseContact(p: PropositionContact): string {
  return p.remplace
    ? `Remplacer « ${p.remplace} » par « ${p.valeur} » ?`
    : `Contact → ${p.valeur}`;
}
