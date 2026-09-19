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
   * Les propriétaires dont ce compte peut LIRE les fiches — lui-même, plus les
   * autres porteurs s'il est porteur. Jamais vide pour un non-admin. Vide pour
   * un admin, qui n'est pas filtré du tout (comme `is_admin()` dans la policy).
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
  const { data, error } = await client
    .from("crm_users")
    .select("id")
    .eq("is_active", true)
    .eq("role", "commercial")
    .eq("voit_equipe", true);
  if (error) return [];
  return (data ?? []).map((r) => (r as { id: string }).id);
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

  const isAdmin = data.role === "admin";
  // L'admin n'est pas filtré : inutile de payer la lecture des porteurs.
  const porteurs = isAdmin ? [] : await lirePorteurs(admin);
  const voitEquipe = porteurs.includes(data.id as string);

  return {
    userId: data.id as string,
    role: data.role as string,
    isAdmin,
    fullName: (data.full_name as string | null) ?? null,
    voitEquipe,
    visiblesIds: isAdmin ? [] : voitEquipe ? porteurs : [data.id as string],
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
 * À appeler par tout outil MCP qui écrit : là, aucune RLS ne rattrapera
 * l'oubli.
 */
export function canEditProspect(viewer: Viewer, ownerId: string | null): boolean {
  return viewer.isAdmin || (ownerId !== null && ownerId === viewer.userId);
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
