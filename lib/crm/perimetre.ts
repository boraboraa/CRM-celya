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
 *   · depuis l'interrupteur d'équipe (migration 020), un PORTEUR en a le droit
 *     lui aussi — mais borné aux autres porteurs : « equipe » ne veut pas dire
 *     « tout le monde », il veut dire « ceux qui partagent avec moi » ;
 *   · un commercial sans interrupteur reste « moi », quoi qu'il y ait dans
 *     l'URL — ce n'est pas lui qui tient la cloison (la RLS s'en charge), mais
 *     il n'a aucune raison de voir un sélecteur mensonger.
 *
 * NE PAS mélanger avec `lib/crm/access.ts` : `scopeProspects` / `canSeeProspect`
 * tiennent la SÉCURITÉ du connecteur MCP (service_role, RLS contournée). Le
 * périmètre est du confort et se pose APRÈS ; les fusionner, c'est un jour
 * désactiver le confort et ouvrir la sécurité avec.
 *
 * Le mode « equipe » pose d'ailleurs exactement ce piège : il ne filtre RIEN
 * (`perimetreUserId` renvoie null). Sur une page, la RLS borne quand même le
 * résultat. Dans le connecteur MCP il n'y a pas de RLS — c'est `scopeProspects`
 * qui borne, et il doit donc être appliqué AVANT, à chaque outil, sans
 * exception. Voir l'outil `agenda`, qui a dû gagner son propre `in`.
 */

export type Perimetre =
  | { mode: "moi" }
  | { mode: "equipe" }
  | { mode: "membre"; id: string };

/**
 * Le minimum à savoir de qui regarde. `Viewer` (access.ts) et la session de
 * l'app le satisfont tous deux structurellement.
 *
 * `voitEquipe` / `partageIds` sont optionnels : un appelant qui les ignore
 * obtient le comportement d'avant l'interrupteur (admin seul élargit).
 */
export type PerimetreViewer = {
  userId: string;
  isAdmin: boolean;
  voitEquipe?: boolean;
  /** Les porteurs de l'interrupteur, soi inclus. Le seul élargissement permis. */
  partageIds?: readonly string[];
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A-t-on le droit de sortir de « moi » ? L'admin, ou un porteur. */
export function peutElargir(viewer: PerimetreViewer): boolean {
  return viewer.isAdmin || viewer.voitEquipe === true;
}

/**
 * Lit `?perimetre=` — « moi » (défaut), « equipe », ou l'uuid d'un membre.
 *
 * Un commercial sans interrupteur obtient TOUJOURS « moi », quoi qu'il y ait
 * dans l'URL. Un PORTEUR peut demander « equipe » ou l'uuid d'un autre porteur
 * — et rien d'autre : viser l'uuid de Bora ou de Rémi retombe sur « moi », pour
 * que l'URL ne serve pas de sonde (« mon écran change, donc cette personne
 * existe et partage »).
 */
export function lirePerimetre(
  searchParams: { perimetre?: string | string[] },
  viewer: PerimetreViewer
): Perimetre {
  if (!peutElargir(viewer)) return { mode: "moi" };

  const raw = Array.isArray(searchParams.perimetre)
    ? searchParams.perimetre[0]
    : searchParams.perimetre;
  if (!raw || raw === "moi") return { mode: "moi" };
  if (raw === "equipe") return { mode: "equipe" };
  if (!UUID_RE.test(raw)) return { mode: "moi" };
  if (viewer.isAdmin) return { mode: "membre", id: raw };
  return (viewer.partageIds ?? []).includes(raw)
    ? { mode: "membre", id: raw }
    : { mode: "moi" };
}

/**
 * Les membres qu'on a le droit de PROPOSER dans le sélecteur.
 *
 * `crm_users_select` laisse tout membre lire toute la table d'équipe : la
 * requête des pages remonte donc Bora et Rémi même pour Collins. Les afficher
 * révélerait qui existe, et un clic rendrait un écran vide sans un mot. Un
 * admin propose tout le monde ; un porteur, les seuls porteurs.
 *
 * Écrit ici et pas dans les trois pages : une liste blanche recopiée trois fois
 * est une liste blanche qu'on corrigera deux fois (leçon d'`estHoteMaps`).
 */
export function membresProposables<M extends { id: string }>(
  membres: M[],
  viewer: PerimetreViewer
): M[] {
  if (viewer.isAdmin) return membres;
  if (!viewer.voitEquipe) return [];
  const permis = viewer.partageIds ?? [];
  return membres.filter((m) => permis.includes(m.id));
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
