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
 *     is_member() AND (is_admin() OR owner = auth.uid())
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
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Qui agit, relu en base à chaque requête — jamais déduit du seul jeton. */
export type Viewer = {
  userId: string;
  role: string;
  isAdmin: boolean;
  fullName: string | null;
};

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
  return {
    userId: data.id as string,
    role: data.role as string,
    isAdmin: data.role === "admin",
    fullName: (data.full_name as string | null) ?? null,
  };
}

/**
 * La règle, sur une ligne déjà lue. Utilisée comme dernier verrou après toute
 * lecture : même si un filtre de requête était mal formé, une fiche qui ne
 * regarde pas l'appelant ne franchit pas cette porte.
 */
export function canSeeProspect(viewer: Viewer, ownerId: string | null): boolean {
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
type Filterable<T> = { eq: (column: string, value: string) => T };

export function scopeProspects<T>(query: T, viewer: Viewer): T {
  if (viewer.isAdmin) return query;
  return (query as Filterable<T>).eq("owner_id", viewer.userId);
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
  return (query as Filterable<T>).eq(
    `${referencedTable}.owner_id`,
    viewer.userId
  );
}

/** Le message unique du refus — même formulation partout. */
export const NOT_VISIBLE =
  "Ce prospect ne fait pas partie de votre portefeuille.";
