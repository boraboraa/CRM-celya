/**
 * Le nombre de fiches par métier — le chiffre du menu « Métier » de
 * /prospects (3 novembre 2026). Module NEUTRE et pur, testé par
 * `npm run test:filtres` (contre un faux client qui enregistre chaque requête).
 *
 * Deux règles, décidées avec Bora :
 * - **jamais rapatrier les fiches pour les compter** : PostgREST plafonne une
 *   lecture à 1 000 lignes, un compte « en mémoire » serait FAUX au-delà, sans
 *   le dire. Ici, quinze comptages `count: "exact", head: true` — la base
 *   compte, aucune ligne ne voyage — partent EN PARALLÈLE ;
 * - **le même périmètre que la liste** : chaque comptage passe par `borner`,
 *   la fonction qui borne la liste elle-même (le périmètre du commercial, les
 *   perdues masquées). Un commercial ne compte que ses fiches — et la RLS,
 *   dessous, le garantit de toute façon.
 *
 * Un comptage qui échoue ne casse rien : le menu s'affiche sans chiffres.
 */
import { SECTEURS, type SecteurFixe } from "./secteurs.ts";

/** Ce qu'il faut d'un client Supabase pour compter : `from().select(…, { count, head })`. */
export type ClientCompte<Q> = {
  from(table: "prospects"): { select(colonnes: string, options: { count: "exact"; head: true }): Q };
};

/** Une requête qu'on peut filtrer par égalité et attendre. */
export type RequeteCompte = {
  eq(colonne: string, valeur: string): PromiseLike<{ count: number | null; error: unknown }>;
};

/** UNE requête de comptage, bornée comme la liste, pour UN métier. */
export function requeteCompteSecteur<Q extends RequeteCompte>(
  client: ClientCompte<Q>,
  borner: (q: Q) => Q,
  secteur: SecteurFixe
): PromiseLike<{ count: number | null; error: unknown }> {
  return borner(client.from("prospects").select("id", { count: "exact", head: true })).eq("sector", secteur);
}

/**
 * Les quinze comptages, en parallèle. `null` si l'un échoue (le menu se passe
 * alors de chiffres plutôt que d'en montrer de faux).
 */
export async function comptesParSecteur<Q extends RequeteCompte>(
  client: ClientCompte<Q>,
  borner: (q: Q) => Q,
  secteurs: readonly SecteurFixe[] = SECTEURS
): Promise<Partial<Record<SecteurFixe, number>> | null> {
  try {
    const reponses = await Promise.all(secteurs.map((s) => requeteCompteSecteur(client, borner, s)));
    if (reponses.some((r) => r.error || r.count === null)) return null;
    return Object.fromEntries(secteurs.map((s, i) => [s, reponses[i].count ?? 0]));
  } catch {
    return null;
  }
}

/** Le libellé d'un choix du menu : « Garage / carrosserie (12) ». */
export function libelleSecteur(secteur: SecteurFixe, comptes: Partial<Record<SecteurFixe, number>> | null): string {
  const n = comptes?.[secteur];
  return typeof n === "number" ? `${secteur} (${n})` : secteur;
}
