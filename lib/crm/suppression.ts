/**
 * Supprimer une fiche (28/10/2026) — qui peut, et ce qu'on dit avant / après.
 *
 * La suppression existait, cachée sous « Modifier la fiche » et SANS
 * confirmation : un clic suffisait. Désormais :
 *   · sur la fiche : « Supprimer la fiche », en deux temps ;
 *   · dans la liste : les fiches cochées, en lot — l'ADMIN seul (décision de
 *     Bora : un étudiant supprime une fiche à la fois, depuis la fiche).
 *
 * Qui peut supprimer une fiche : son responsable, ou l'admin — la même règle
 * que la policy `prospects_delete` (la base refuse de toute façon). Un
 * encadrant ou un collègue d'équipe VOIT la fiche, il ne la supprime pas.
 *
 * Ce qui part avec elle (FK, migration 035) : journal, relances, rendez-vous,
 * file et brief de Janet. Les mails restent, détachés (« Non rattachés »).
 *
 * Module NEUTRE et pur : le test l'exécute tel quel sous node.
 */

export type QuiSupprime = { userId: string | null; isAdmin: boolean };

/** Plafond d'un lot — comme l'attribution. */
export const LOT_MAX = 500;

export function peutSupprimer(qui: QuiSupprime, ownerId: string | null | undefined): boolean {
  if (!qui.userId) return false;
  return qui.isAdmin || (!!ownerId && ownerId === qui.userId);
}

/** Plusieurs fiches d'un coup : l'admin seul. Une seule : la règle de la fiche (revérifiée en base). */
export function peutSupprimerEnLot(qui: QuiSupprime, combien: number): boolean {
  if (!qui.userId || combien < 1 || combien > LOT_MAX) return false;
  return combien === 1 || qui.isAdmin;
}

/** Garde des identifiants propres, sans doublon (un corps de server action se rejoue). */
export function idsPropres(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && re.test(x)))];
}

const CE_QUI_PART = "Son journal, ses relances et ses rendez-vous disparaissent. Action définitive.";
const CE_QUI_PART_LOT = "Leur journal, leurs relances et leurs rendez-vous disparaissent. Action définitive.";

/** La question, avant. */
export function questionSuppression(noms: string[]): string {
  if (noms.length === 1) return `Supprimer définitivement « ${noms[0]} » ? ${CE_QUI_PART}`;
  return `Supprimer définitivement ${noms.length} fiches ? ${CE_QUI_PART_LOT}`;
}

/** Ce qu'on dit, après. */
export function resultatSuppression(demandees: number, supprimees: number): { ok: boolean; texte: string } {
  if (supprimees === 0) {
    return {
      ok: false,
      texte: demandees > 1 ? "Aucune de ces fiches n'a été supprimée : elles ne sont pas à vous." : "Cette fiche n'est pas à vous : elle n'a pas été supprimée.",
    };
  }
  const base = `${supprimees} fiche${supprimees > 1 ? "s" : ""} supprimée${supprimees > 1 ? "s" : ""}.`;
  const reste = demandees - supprimees;
  if (reste <= 0) return { ok: true, texte: base };
  return { ok: true, texte: `${base} ${reste} n'${reste > 1 ? "ont" : "a"} pas pu l'être (pas à vous).` };
}
