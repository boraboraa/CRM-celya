/**
 * Les fiches PERDUES ne s'affichent plus par défaut (29/10, décision de Bora).
 *
 * « Ce qui est perdu, on ne le montre plus — ni dans À faire, ni dans la liste.
 * Si quelqu'un veut les voir, il choisit la catégorie. » Une seule règle, pour
 * tous les écrans qui en ont besoin : la liste des prospects, « À faire » et
 * l'outil MCP `a_faire`. Le PIPELINE n'est pas concerné : sa colonne « Perdu »
 * est déjà repliée (27/10).
 *
 * Module NEUTRE et pur (ni React, ni Supabase) — `npm run test:perdues`.
 *
 * Et « Pas intéressé » (le résultat d'appel) fait désormais passer la fiche en
 * Perdu, à l'écran comme depuis Claude : une fiche dont on a entendu « non »
 * est une fiche perdue, et doit disparaître comme les autres. Une correction
 * immédiate (la mauvaise pastille) rend l'étape et les relances d'avant —
 * `annulationRefus`. Janet, elle, ne met jamais une fiche en Perdu (appels IA).
 */

/** Les étapes masquées tant qu'on ne les demande pas. */
export const ETAPES_MASQUEES = ["perdu"] as const;

/** Le choix du menu « Étape » qui montre TOUT, perdues comprises. */
export const AVEC_PERDUES = "avec_perdues";
export const LIBELLE_SANS_PERDUES = "Toutes sauf perdues";
export const LIBELLE_AVEC_PERDUES = "Toutes, perdues comprises";

/**
 * Faut-il écarter les perdues de la liste ? Oui tant que l'URL ne nomme pas
 * d'étape (le défaut) — pas quand elle demande « Perdu », une autre étape
 * (elle exclut déjà les perdues), ou « Toutes, perdues comprises ».
 */
export function masquerPerdues(statut: string | null | undefined): boolean {
  return !statut || statut === "tous";
}

/** L'étape vaut-elle « perdue » — une valeur venue de la base, en clair. */
export function estPerdue(statut: string | null | undefined): boolean {
  return (ETAPES_MASQUEES as readonly string[]).includes(statut ?? "");
}

/**
 * Les relances de « À faire » sans celles des fiches perdues. Une relance sans
 * fiche (impossible depuis la 028, mais lue en tolérance) reste.
 */
export function sansPerdues<T extends { prospects?: { status?: string | null } | null }>(
  taches: T[]
): T[] {
  return taches.filter((t) => !estPerdue(t.prospects?.status));
}

/**
 * Ce qu'il faut pour défaire un « Pas intéressé » tapé par erreur : l'étape
 * et le verrou d'AVANT, et les relances que le passage en Perdu a annulées.
 * Le serveur le renvoie au composant, qui le rend s'il corrige.
 */
export type AnnulationRefus = {
  etape: string;
  verrou: boolean;
  relances: string[];
};

/**
 * Valide ce que le navigateur renvoie avant de défaire : une étape connue,
 * jamais « perdu » (on défait une perte), des identifiants en forme d'uuid,
 * vingt au plus. Tout le reste → null (on ne défait rien).
 */
export function lireAnnulation(
  brut: unknown,
  etapesConnues: readonly string[]
): AnnulationRefus | null {
  if (!brut || typeof brut !== "object") return null;
  const a = brut as Record<string, unknown>;
  if (typeof a.etape !== "string" || !etapesConnues.includes(a.etape) || estPerdue(a.etape)) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const relances = Array.isArray(a.relances)
    ? a.relances.filter((r): r is string => typeof r === "string" && uuid.test(r)).slice(0, 20)
    : [];
  return { etape: a.etape, verrou: a.verrou === true, relances };
}
