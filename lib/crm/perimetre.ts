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
 *   · défaut « Toute l'équipe » pour l'ADMIN, « moi » pour tous les autres
 *     (décision de Bora, 18/10 : l'admin arrivait sur « moi », non mémorisé,
 *     et ne trouvait pas les fiches de ses commerciaux) ;
 *   · le DERNIER choix est mémorisé (cookie `celya_perimetre`, posé par le
 *     middleware) pour tous ceux qui peuvent élargir — il repasse par la même
 *     validation que l'URL, il n'ouvre donc rien de plus ;
 *   · l'admin peut élargir (?perimetre=equipe) ou viser un membre
 *     (?perimetre=<uuid>) ;
 *   · depuis l'interrupteur d'équipe (migration 020), un PORTEUR en a le droit
 *     lui aussi — mais borné aux autres porteurs : « equipe » ne veut pas dire
 *     « tout le monde », il veut dire « ceux qui partagent avec moi » ;
 *   · depuis l'encadrement (migration 021), un ENCADRANT aussi — borné, de la
 *     même façon, aux gens qu'il encadre. Un encadrant qui ne serait pas
 *     porteur doit avoir le sélecteur : sans lui, il verrait les fiches de ses
 *     étudiants en base sans aucun moyen de les afficher ;
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
 * `voitEquipe` / `encadreIds` / `partageIds` sont optionnels : un appelant qui
 * les ignore obtient le comportement d'avant l'interrupteur (admin seul
 * élargit).
 */
export type PerimetreViewer = {
  userId: string;
  isAdmin: boolean;
  voitEquipe?: boolean;
  /** Les commerciaux qu'on encadre (migration 021). Sens unique. */
  encadreIds?: readonly string[];
  /**
   * L'UNION de ce qu'on a le droit d'afficher : soi, les autres porteurs de
   * l'interrupteur si on est porteur, et ceux qu'on encadre. Le seul
   * élargissement permis — `lirePerimetre` refuse tout uuid qui n'y est pas.
   */
  partageIds?: readonly string[];
};

/**
 * Le cookie qui mémorise le dernier périmètre choisi. Un simple RAPPEL : sa
 * valeur repasse par `lirePerimetre`, exactement comme `?perimetre=` — un
 * cookie trafiqué ne vaut pas plus qu'une URL trafiquée.
 *
 * Depuis le 27/10, il est écrit par le NAVIGATEUR (`MemoirePerimetre`), plus
 * par le middleware sur chaque navigation : une réponse RSC qui porte un
 * `Set-Cookie` n'est jamais resservie par le cache du routeur — chaque
 * bascule (« Toute l'équipe » → un étudiant → retour) refaisait un rendu
 * serveur complet, même pour revenir à un écran vu deux secondes plus tôt
 * (mesuré en production : 0,47 à 0,77 s par geste). D'où un NOUVEAU nom, non
 * `httpOnly` : le navigateur ne peut pas réécrire l'ancien, qui l'était.
 * L'ancien est encore LU en repli, le temps qu'il expire.
 */
export const PERIMETRE_COOKIE = "celya_perim";
export const ANCIEN_PERIMETRE_COOKIE = "celya_perimetre";

/**
 * La valeur à mémoriser pour une URL : le `?perimetre=` d'un écran qui porte
 * le sélecteur, borné (un mot ou un uuid) — sinon null, et rien n'est écrit.
 */
export function perimetreAMemoriser(chemin: string, valeur: string | null | undefined): string | null {
  if (!valeur || valeur.length > 40 || !/^[a-z0-9-]+$/i.test(valeur)) return null;
  return (PAGES_PERIMETRE as readonly string[]).includes(chemin) ? valeur : null;
}

/** Les écrans qui portent le sélecteur — et donc ceux où le choix se mémorise. */
export const PAGES_PERIMETRE = ["/dashboard", "/prospects", "/agenda"] as const;

/** Le périmètre quand rien n'est demandé ni mémorisé. */
export function perimetreParDefaut(viewer: PerimetreViewer): "moi" | "equipe" {
  return viewer.isAdmin ? "equipe" : "moi";
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A-t-on le droit de sortir de « moi » ? L'admin, un porteur, ou un encadrant.
 *
 * Le troisième cas ne se déduit PAS des deux autres : un encadrant peut très
 * bien ne pas porter l'interrupteur (il voit ses étudiants, personne ne le
 * voit). Sans cette branche, il aurait les fiches en base et aucun écran pour
 * les afficher.
 */
export function peutElargir(viewer: PerimetreViewer): boolean {
  return (
    viewer.isAdmin ||
    viewer.voitEquipe === true ||
    (viewer.encadreIds?.length ?? 0) > 0
  );
}

/**
 * Lit `?perimetre=` — « moi », « equipe », ou l'uuid d'un membre. À défaut,
 * le choix MÉMORISÉ (cookie) ; à défaut encore, `perimetreParDefaut`.
 *
 * Un commercial sans interrupteur ni encadrement obtient TOUJOURS « moi », quoi
 * qu'il y ait dans l'URL. Un PORTEUR ou un ENCADRANT peut demander « equipe »,
 * ou l'uuid de quelqu'un de son partage — et rien d'autre : viser l'uuid de
 * Bora ou de Rémi retombe sur « moi », pour que l'URL ne serve pas de sonde
 * (« mon écran change, donc cette personne existe et je la vois »).
 *
 * Le repli sur « moi » est un repli SILENCIEUX, et c'est voulu : dire « vous
 * n'avez pas accès à ce périmètre » confirmerait que l'uuid désigne quelqu'un.
 */
export function lirePerimetre(
  searchParams: { perimetre?: string | string[] },
  viewer: PerimetreViewer,
  memorise?: string | null
): Perimetre {
  if (!peutElargir(viewer)) return { mode: "moi" };

  const demande = Array.isArray(searchParams.perimetre)
    ? searchParams.perimetre[0]
    : searchParams.perimetre;
  const raw = demande || memorise || perimetreParDefaut(viewer);
  if (raw === "moi") return { mode: "moi" };
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
 * admin propose tout le monde ; tout autre compte, les seuls noms de son
 * partage — ses co-porteurs (020) et ses encadrés (021), jamais la liste
 * complète.
 *
 * Écrit ici et pas dans les trois pages : une liste blanche recopiée trois fois
 * est une liste blanche qu'on corrigera deux fois (leçon d'`estHoteMaps`).
 */
export function membresProposables<M extends { id: string }>(
  membres: M[],
  viewer: PerimetreViewer
): M[] {
  if (viewer.isAdmin) return membres;
  if (!peutElargir(viewer)) return [];
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
