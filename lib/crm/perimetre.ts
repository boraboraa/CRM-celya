/**
 * Le PÉRIMÈTRE d'affichage — un filtre de CONFORT, distinct de la SÉCURITÉ.
 *
 * La RLS cloisonne correctement (`can_see_prospect`) : un commercial ne peut
 * pas voir les fiches d'un autre, quoi que demande l'écran. Mais l'admin, lui,
 * voit TOUT — et les écrans qui requêtent `tasks` et `prospects` sans filtre
 * lui servaient l'union des portefeuilles : son tableau de bord mélangeait ses
 * relances avec celles de ses commerciaux.
 *
 * Ce module pose donc un filtre PAR-DESSUS la sécurité :
 *
 *   · défaut « moi » POUR TOUT LE MONDE, admin compris ;
 *   · l'admin peut élargir (?perimetre=equipe) ou viser un membre
 *     (?perimetre=<uuid>) ;
 *   · un non-admin reste « moi », quoi qu'il y ait dans l'URL — ce n'est pas
 *     lui qui tient la cloison (la RLS s'en charge), mais il n'a aucune raison
 *     de voir un sélecteur mensonger.
 *
 * NE PAS mélanger avec `lib/crm/access.ts` : `scopeProspects` / `canSeeProspect`
 * tiennent la SÉCURITÉ du connecteur MCP (service_role, RLS contournée). Le
 * périmètre est du confort et se pose APRÈS ; les fusionner, c'est un jour
 * désactiver le confort et ouvrir la sécurité avec.
 */

export type Perimetre =
  | { mode: "moi" }
  | { mode: "equipe" }
  | { mode: "membre"; id: string };

/** Le minimum à savoir de qui regarde. `Viewer` (access.ts) et la session de
 *  l'app le satisfont tous deux structurellement. */
export type PerimetreViewer = { userId: string; isAdmin: boolean };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lit `?perimetre=` — « moi » (défaut), « equipe », ou l'uuid d'un membre.
 * Un non-admin obtient TOUJOURS « moi », quoi qu'il y ait dans l'URL.
 */
export function lirePerimetre(
  searchParams: { perimetre?: string | string[] },
  viewer: PerimetreViewer
): Perimetre {
  if (!viewer.isAdmin) return { mode: "moi" };

  const raw = Array.isArray(searchParams.perimetre)
    ? searchParams.perimetre[0]
    : searchParams.perimetre;
  if (!raw || raw === "moi") return { mode: "moi" };
  if (raw === "equipe") return { mode: "equipe" };
  if (UUID_RE.test(raw)) return { mode: "membre", id: raw };
  return { mode: "moi" };
}

/** L'identifiant sur lequel filtrer — null en mode « equipe » (pas de filtre). */
export function perimetreUserId(
  perimetre: Perimetre,
  viewer: PerimetreViewer
): string | null {
  switch (perimetre.mode) {
    case "equipe":
      return null;
    case "membre":
      return perimetre.id;
    case "moi":
      return viewer.userId;
  }
}

// `T` n'est volontairement PAS contraint par `{ eq(...): T }` : les types de
// PostgrestFilterBuilder se ré-instancient à chaque filtre, et la contrainte
// récursive fait exploser le compilateur (TS2589). Même astuce que access.ts.
type Filterable<T> = { eq: (column: string, value: string) => T };

/** Relances du périmètre : une relance appartient à son assigné. */
export function filtrerTaches<T>(
  query: T,
  perimetre: Perimetre,
  viewer: PerimetreViewer
): T {
  const id = perimetreUserId(perimetre, viewer);
  if (!id) return query;
  return (query as Filterable<T>).eq("assignee_id", id);
}

/** Fiches du périmètre : une fiche appartient à son responsable. */
export function filtrerProspects<T>(
  query: T,
  perimetre: Perimetre,
  viewer: PerimetreViewer
): T {
  const id = perimetreUserId(perimetre, viewer);
  if (!id) return query;
  return (query as Filterable<T>).eq("owner_id", id);
}

/**
 * Même filtre, sur une requête qui part d'une autre table et rejoint
 * `prospects` (emails, activités). L'embed doit être `!inner` pour que le
 * filtre soit réellement filtrant.
 */
export function filtrerJointProspects<T>(
  query: T,
  perimetre: Perimetre,
  viewer: PerimetreViewer,
  table = "prospects"
): T {
  const id = perimetreUserId(perimetre, viewer);
  if (!id) return query;
  return (query as Filterable<T>).eq(`${table}.owner_id`, id);
}

/**
 * Le périmètre sur des lignes DÉJÀ lues, pour les sources qui ne savent pas
 * le porter en base : la vue `prospect_action_state` n'expose pas `owner_id`
 * et PostgREST ne sait pas la joindre à `prospects` (PGRST200, vérifié) —
 * on la restreint donc à l'ensemble des fiches du périmètre, chargées par la
 * même page. En mode « equipe », rien à restreindre.
 */
export function restreindreAuxProspects<R extends { prospect_id: string }>(
  rows: R[],
  idsVisibles: ReadonlySet<string>,
  perimetre: Perimetre
): R[] {
  if (perimetre.mode === "equipe") return rows;
  return rows.filter((r) => idsVisibles.has(r.prospect_id));
}
