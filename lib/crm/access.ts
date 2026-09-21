/**
 * La règle « qui voit quel prospect », écrite une seule fois — pour le seul
 * endroit du code qui ne peut pas s'appuyer sur la RLS.
 *
 * Partout ailleurs, la cloison entre les fichiers de Bora et du commercial est
 * tenue par Postgres : `can_see_prospect(owner_id)` s'applique au client
 * Supabase de l'utilisateur, et même une page qui oublierait un filtre ne
 * verrait rien de plus. Le connecteur MCP est l'exception sanctionnée : son
 * jeton OAuth est un JWT maison que Supabase Auth ne sait pas vérifier, il ne
 * peut donc pas ouvrir de session utilisateur et agit en `service_role` —
 * RLS contournée.
 *
 * Ce module rejoue donc la règle en TypeScript, à l'identique :
 *
 *   can_see_prospect(owner) =
 *     is_member() AND (is_admin() OR owner = auth.uid() OR partage_equipe(owner))
 *
 * Toute évolution de la policy SQL doit être répercutée ici — et inversement.
 * C'est le prix de l'exception, et la raison pour laquelle elle tient en un
 * seul fichier plutôt qu'éparpillée dans dix outils.
 *
 * Le vivier (`owner_id is null`, visible par tous) a été FERMÉ le 25 août,
 * migration `016` — décision de Bora. Avec deux commerciaux sur deux marchés
 * différents il n'avait pas de sens métier, et il était la dernière brèche
 * d'une cloison par ailleurs étanche : un clic sur « Non assigné » publiait la
 * fiche à toute l'équipe sans le dire. Une fiche a désormais toujours un
 * propriétaire (trigger `prospects_set_owner`, migration `015`), et seul
 * l'admin voit celles des autres.
 *
 * ---------------------------------------------------------------------------
 * L'INTERRUPTEUR « TRAVAILLE EN ÉQUIPE » (migration `020`, 19 septembre)
 * ---------------------------------------------------------------------------
 * Collins et Nathan travaillent sur LE MÊME marché : cloisonnés l'un de
 * l'autre, ils appellent les mêmes sociétés sans pouvoir le savoir. Une case
 * par personne, RÉCIPROQUE (`crm_users.voit_equipe`) : cochée, elle donne le
 * droit ET expose. Rémi, non coché, reste cloisonné DANS LES DEUX SENS sans
 * qu'on ait à écrire une exception à son nom ; l'admin ne la porte pas.
 *
 * DEUX PRÉDICATS, ET C'EST LE POINT IMPORTANT. La lecture est partagée,
 * l'écriture reste personnelle — il ne suffit donc plus de savoir si une fiche
 * est VISIBLE :
 *
 *   · `canSeeProspect`  → lire (moi, l'équipe qui partage, ou admin) ;
 *   · `canEditProspect` → écrire (moi, ou admin — JAMAIS l'équipe).
 *
 * Côté Postgres, les policies d'écriture ont été rebasées sur le propriétaire
 * dans la même migration. Côté connecteur MCP il n'y a pas de Postgres pour
 * rattraper l'oubli : tout outil qui ÉCRIT doit appeler `canEditProspect`, et
 * pas seulement `resolveProspect`. Sans ça, l'assistant de Collins modifierait
 * les fiches de Nathan que son écran affiche en lecture seule.
 *
 * ---------------------------------------------------------------------------
 * L'ENCADREMENT (migration `021`, 21 septembre)
 * ---------------------------------------------------------------------------
 * Quatre étudiants arrivent. Collins, Nathan et Bora doivent voir ce qu'ils
 * font ; un étudiant ne doit voir QUE ce qu'il a mis lui-même.
 *
 * `voit_equipe` ne peut pas exprimer ça : elle est RÉCIPROQUE par construction
 * — la même expression accorde le droit ET expose. D'où une seconde notion,
 * ORIENTÉE, portée par la table `supervision(encadrant_id, commercial_id)` :
 *
 *   encadre(owner) = exists(supervision où encadrant = moi et commercial = owner)
 *
 * À SENS UNIQUE (l'étudiant ne gagne rien) et SANS RÉCURSION : une seule
 * lecture de la table, donc si Nathan encadre Collins et Collins un étudiant,
 * Nathan ne voit PAS l'étudiant. Les deux notions cohabitent sans se connaître.
 *
 * ET L'ÉCRITURE, ELLE, NE BOUGE PAS D'UN POUCE. `canEditProspect` ignore
 * l'encadrement exactement comme il ignore l'équipe : un encadrant VOIT le
 * travail de son étudiant, il ne le modifie jamais. C'est vérifié en base (les
 * neuf policies de la 020 testent la fiche de DESTINATION, pas l'appelant) et
 * c'est vérifié ici — sans quoi l'assistant de Collins irait consigner des
 * appels sur les fiches de ses étudiants, là où aucune RLS ne le rattraperait.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Qui agit, relu en base à chaque requête — jamais déduit du seul jeton. */
export type Viewer = {
  userId: string;
  role: string;
  isAdmin: boolean;
  fullName: string | null;
  /** Porte l'interrupteur « travaille en équipe » (migration 020). */
  voitEquipe: boolean;
  /**
   * Les commerciaux que ce compte ENCADRE (migration 021) — sens unique : eux
   * ne voient rien de lui. Vide pour un admin, qui voit déjà tout.
   */
  encadreIds: readonly string[];
  /**
   * Les propriétaires dont ce compte peut LIRE les fiches — lui-même, plus les
   * autres porteurs s'il est porteur, plus ceux qu'il encadre. Jamais vide pour
   * un non-admin. Vide pour un admin, qui n'est pas filtré du tout (comme
   * `is_admin()` dans la policy).
   *
   * ⚠ LIRE, et rien d'autre. Ne jamais s'en servir comme test d'écriture :
   * c'est `canEditProspect` qui répond à cette question-là.
   */
  visiblesIds: readonly string[];
};

/**
 * Les comptes qui portent l'interrupteur — actifs et commerciaux, exactement
 * comme `partage_equipe` en SQL. La liste tient en cinq lignes : une requête,
 * une fois par appel, et on en déduit à la fois « suis-je porteur » et « qui
 * partage avec moi ».
 *
 * TOLÉRANTE À L'ABSENCE DE LA COLONNE, et c'est volontaire : la règle du projet
 * veut que le code parte AVANT la migration (il doit tourner contre la base en
 * production, qui n'a pas encore `voit_equipe`). Une erreur PostgREST — 42703
 * avant la 020, ou n'importe quoi d'autre — vaut donc « personne ne partage ».
 * L'échec est FERMÉ : on ne voit jamais plus que soi, on peut voir moins.
 */
export async function lirePorteurs(client: SupabaseClient): Promise<string[]> {
  const membres = await lireMembresActifs(client);
  return membres.filter((m) => m.voitEquipe).map((m) => m.id);
}

/**
 * Les commerciaux actifs et leur interrupteur — la lecture dont dérivent À LA
 * FOIS « qui partage » et « qui j'ai le droit d'encadrer ».
 *
 * Elle existe pour que la condition « actif ET commercial » ne soit écrite
 * qu'UNE fois côté TypeScript, comme elle l'est une fois côté SQL (les jointures
 * de `partage_equipe` et d'`encadre`). Une règle recopiée deux fois est une
 * règle qu'on corrigera une fois — leçon d'`estHoteMaps`.
 *
 * Même TOLÉRANCE que ci-dessous : toute erreur vaut « personne », jamais
 * « tout le monde ».
 */
async function lireMembresActifs(
  client: SupabaseClient
): Promise<{ id: string; voitEquipe: boolean }[]> {
  const { data, error } = await client
    .from("crm_users")
    .select("id, voit_equipe")
    .eq("is_active", true)
    .eq("role", "commercial");
  if (error) return [];
  return (data ?? []).map((r) => {
    const row = r as { id: string; voit_equipe?: boolean | null };
    return { id: row.id, voitEquipe: row.voit_equipe === true };
  });
}

/**
 * Les commerciaux que `userId` ENCADRE (migration 021) — le pendant TypeScript
 * exact de `public.encadre()`, à ceci près qu'on résout la liste au lieu de
 * tester un propriétaire à la fois.
 *
 * Trois choses à ne pas perdre en la réécrivant :
 *
 *   · ELLE EST ORIENTÉE : on filtre sur `encadrant_id = userId` et on renvoie
 *     des `commercial_id`. Jamais l'inverse, jamais les deux.
 *   · ELLE NE SAUTE QU'UNE FOIS : aucune récursion sur le résultat. Encadrer
 *     Collins ne donne pas les étudiants de Collins.
 *   · ELLE INTERSECTE avec les commerciaux ACTIFS, comme la jointure du SQL
 *     (`c.is_active and c.role = 'commercial'`). Sans ça, un compte désactivé
 *     resterait visible par son encadrant via le connecteur alors que la RLS
 *     le cache déjà à l'écran — et les deux chemins divergeraient en silence.
 *
 * TOLÉRANTE À L'ABSENCE DE LA TABLE, pour la même raison que `lirePorteurs` :
 * le code doit tourner contre la base d'AVANT la 021 (un 42P01 vaut « je
 * n'encadre personne »). L'échec est FERMÉ.
 */
export async function lireEncadres(
  client: SupabaseClient,
  userId: string | null | undefined,
  membresActifs?: { id: string }[]
): Promise<string[]> {
  if (!userId) return [];
  const { data, error } = await client
    .from("supervision")
    .select("commercial_id")
    .eq("encadrant_id", userId);
  if (error) return [];
  const actifs = new Set(
    (membresActifs ?? (await lireMembresActifs(client))).map((m) => m.id)
  );
  return (data ?? [])
    .map((r) => (r as { commercial_id: string }).commercial_id)
    .filter((id) => actifs.has(id));
}

/**
 * TOUS les liens d'encadrement, pour l'écran d'équipe (admin).
 *
 * La policy `supervision_select` ne sert à un non-admin que les lignes qui le
 * désignent : appelée par quelqu'un d'autre que Bora, cette fonction ne rend
 * donc pas le graphe complet — c'est voulu, et c'est pourquoi l'appelant reste
 * un écran déjà réservé à l'admin.
 */
export async function lireLiensEncadrement(
  client: SupabaseClient
): Promise<{ encadrantId: string; commercialId: string }[]> {
  const { data, error } = await client
    .from("supervision")
    .select("encadrant_id, commercial_id");
  if (error) return [];
  return (data ?? []).map((r) => {
    const row = r as { encadrant_id: string; commercial_id: string };
    return { encadrantId: row.encadrant_id, commercialId: row.commercial_id };
  });
}

/**
 * Charge le porteur du jeton depuis `crm_users`.
 *
 * Relu à CHAQUE requête, et pas une fois pour toutes à l'émission du jeton :
 * un jeton d'accès vit une heure et son jeton de rafraîchissement quatre-vingt-
 * dix jours. Sans cette relecture, désactiver un commercial dans /equipe le
 * laisserait agir jusqu'à trois mois. C'est exactement ce que fait déjà
 * `getSession()` côté application (voir lib/auth.ts).
 *
 * Renvoie null si le compte n'existe pas ou n'est plus actif.
 */
export async function loadViewer(
  admin: SupabaseClient,
  userId: string | null | undefined
): Promise<Viewer | null> {
  if (!userId) return null;
  const { data } = await admin
    .from("crm_users")
    .select("id, role, is_active, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (!data || !data.is_active) return null;

  const id = data.id as string;
  const isAdmin = data.role === "admin";

  // L'admin n'est pas filtré : inutile de payer la lecture des porteurs ni
  // celle des liens d'encadrement.
  const membres = isAdmin ? [] : await lireMembresActifs(admin);
  const porteurs = membres.filter((m) => m.voitEquipe).map((m) => m.id);
  const voitEquipe = porteurs.includes(id);
  const encadreIds = isAdmin ? [] : await lireEncadres(admin, id, membres);

  return {
    userId: id,
    role: data.role as string,
    isAdmin,
    fullName: (data.full_name as string | null) ?? null,
    voitEquipe,
    encadreIds,
    // L'UNION des trois branches de `can_see_prospect`, moins `is_admin()` :
    // moi, l'équipe qui partage, ceux que j'encadre. Dédupliquée — quelqu'un
    // peut être à la fois porteur et encadré, et un `in` qui répète une valeur
    // n'est pas faux, seulement bavard.
    visiblesIds: isAdmin
      ? []
      : [...new Set([id, ...(voitEquipe ? porteurs : []), ...encadreIds])],
  };
}

/**
 * La règle, sur une ligne déjà lue. Utilisée comme dernier verrou après toute
 * lecture : même si un filtre de requête était mal formé, une fiche qui ne
 * regarde pas l'appelant ne franchit pas cette porte.
 */
export function canSeeProspect(viewer: Viewer, ownerId: string | null): boolean {
  return (
    viewer.isAdmin ||
    (ownerId !== null && viewer.visiblesIds.includes(ownerId))
  );
}

/**
 * Le DROIT D'ÉCRIRE, qui n'est pas le droit de voir.
 *
 * « Lecture partagée, écriture perso » : un porteur voit les fiches de son
 * binôme et n'en modifie aucune. L'équipe n'entre donc PAS dans ce prédicat —
 * seuls le propriétaire et l'admin. C'est le pendant exact des policies
 * d'écriture rebasées sur `owner_id` par la migration 020.
 *
 * L'ENCADREMENT (021) N'Y ENTRE PAS DAVANTAGE, et c'est la moitié du lot : un
 * encadrant voit les fiches de son étudiant, il ne les modifie pas, n'y
 * consigne pas d'appel, n'y pose ni relance ni rendez-vous. Mesuré en base —
 * les neuf policies de la 020 refusent les quinze écritures correspondantes.
 * Ce prédicat est ce qui fait tenir la même frontière côté connecteur, où il
 * n'y a pas de RLS du tout.
 *
 * Ne JAMAIS l'écrire à partir de `visiblesIds` : voir et écrire sont deux
 * questions, et c'est exactement la confusion que la 020 a coûté cher à
 * démêler.
 *
 * À appeler par tout outil MCP qui écrit : là, aucune RLS ne rattrapera
 * l'oubli.
 */
export function canEditProspect(viewer: Viewer, ownerId: string | null): boolean {
  return viewer.isAdmin || (ownerId !== null && ownerId === viewer.userId);
}

/**
 * La même frontière, mais sur une RELANCE : le pendant exact de `tasks_update`,
 * rebasée sur `assignee_id` par la migration 020.
 *
 * « Lecture partagée, écriture perso » s'applique aussi au tableau de bord : en
 * périmètre d'équipe, la relance d'un collègue s'AFFICHE (savoir qu'il l'a en
 * main) et ne s'actionne pas. Cocher « Fait » sur la sienne déplacerait SON
 * « À faire », et `activities_insert` refuserait le résultat d'appel qui va
 * avec — la base tiendrait, mais après le clic : on masque, on ne désactive
 * pas.
 *
 * Volontairement typée sur la forme MINIMALE `{ userId, isAdmin }` : `Viewer`
 * (connecteur MCP) comme `PerimetreViewer` (les écrans) la satisfont, et la
 * règle n'a pas besoin d'en savoir plus. Une relance LIBRE (`assignee_id` nul,
 * le pense-bête du tableau de bord) reste à qui la regarde.
 */
export function relanceEnLecture(
  viewer: { userId: string; isAdmin: boolean },
  assigneeId: string | null | undefined
): boolean {
  // `Boolean` et non `!== null` : iso-comportement avec le prédicat qui vivait
  // en ligne dans le tableau de bord, une chaîne vide valant « pas d'assigné ».
  return !viewer.isAdmin && Boolean(assigneeId) && assigneeId !== viewer.userId;
}

/**
 * La même règle, poussée dans la requête PostgREST — pour que le filtrage se
 * fasse en base et non après un `limit` qui aurait déjà tronqué les bonnes
 * lignes.
 *
 * L'admin n'est pas filtré : il voit tout, comme `is_admin()` dans la policy.
 */
// `T` n'est volontairement PAS contraint par `{ eq(...): T }` : les types de
// PostgrestFilterBuilder se ré-instancient à chaque filtre, et la contrainte
// récursive fait exploser le compilateur (TS2589). Le transtypage local est
// borné à l'appel et le type de retour reste celui de la requête d'entrée.
type Filterable<T> = {
  eq: (column: string, value: string) => T;
  in: (column: string, values: readonly string[]) => T;
};

/**
 * `in` et non `eq`, depuis l'interrupteur d'équipe : un porteur voit plusieurs
 * propriétaires. La liste est celle de `visiblesIds` — jamais vide pour un
 * non-admin, donc le filtre MORD toujours. Un `in` à une seule valeur vaut un
 * `eq` : un seul chemin de code, une seule chose à relire.
 */
export function scopeProspects<T>(query: T, viewer: Viewer): T {
  if (viewer.isAdmin) return query;
  return (query as Filterable<T>).in("owner_id", viewer.visiblesIds);
}

/**
 * La même règle encore, mais sur une requête qui part d'une AUTRE table et
 * rejoint `prospects` (activités, relances, emails). L'embed `!inner` rend la
 * jointure filtrante ; `referencedTable` applique le `or` à la table jointe.
 *
 * À utiliser conjointement avec `canSeeProspect` sur les lignes renvoyées :
 * si jamais ce filtre ne mordait pas, on obtiendrait moins de lignes, jamais
 * plus — mais la vérification en mémoire garantit que « moins » soit aussi
 * « rien qui ne nous regarde pas ».
 */
export function scopeJoinedProspects<T>(
  query: T,
  viewer: Viewer,
  referencedTable = "prospects"
): T {
  if (viewer.isAdmin) return query;
  return (query as Filterable<T>).in(
    `${referencedTable}.owner_id`,
    viewer.visiblesIds
  );
}

/** Le message unique du refus — même formulation partout. */
export const NOT_VISIBLE =
  "Ce prospect ne fait pas partie de votre portefeuille.";

/**
 * Le refus d'ÉCRIRE sur une fiche qu'on voit sans la posséder. Il nomme le
 * propriétaire, contrairement à `NOT_VISIBLE` : ici la fiche est visible, il
 * n'y a rien à cacher — et savoir à qui elle est, c'est justement ce que
 * l'interrupteur apporte.
 */
export const NOT_EDITABLE = (proprietaire: string | null) =>
  `Cette fiche appartient à ${proprietaire ?? "un autre commercial"} : vous la voyez, vous ne la modifiez pas. Demandez-lui, ou passez par Bora.`;
