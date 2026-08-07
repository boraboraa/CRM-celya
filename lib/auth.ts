import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export type Session = {
  userId: string;
  email: string;
  me: Profile | null;
};

/** Les colonnes de la fiche équipe — jamais `*` : un aller-retour se paie. */
const PROFILE_COLUMNS =
  "id, email, full_name, role, is_active, must_change_password, phone, created_at";

/**
 * Utilisateur connecté + sa fiche CRM (null si le compte n'existe pas encore).
 *
 * `getClaims()` et non `getUser()` : ce projet signe ses jetons en **ES256**
 * (clés asymétriques), donc la signature se vérifie EN LOCAL contre le JWKS,
 * mis en cache pour tout le processus par auth-js. Là où `getUser()` payait un
 * aller-retour réseau vers Supabase Auth à chaque rendu de page — et un
 * deuxième dans le middleware — il n'en reste aucun.
 *
 * Le modèle de sécurité est intact, et même resserré :
 *   · la signature du jeton est vérifiée cryptographiquement (elle l'était
 *     déjà côté Postgres, qui reste l'autorité) ;
 *   · l'autorisation réelle ne vient PAS du jeton mais de `crm_users`, relu en
 *     base à chaque rendu : désactiver un commercial le coupe immédiatement,
 *     exactement comme avant ;
 *   · la RLS reste l'unique garde-fou des données.
 * Seule nuance : un jeton révoqué reste valide jusqu'à son expiration (1 h)
 * pour la *redirection*, mais ne donne accès à aucune donnée — `is_member()`
 * s'appuie sur `crm_users`, pas sur le jeton.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;

  const { data: me } = await supabase
    .from("crm_users")
    .select(PROFILE_COLUMNS)
    .eq("id", claims.sub)
    .maybeSingle();

  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    me: (me as Profile) ?? null,
  };
});

export async function requireMember(): Promise<Session & { me: Profile }> {
  const session = await getSession();
  if (!session) redirect("/login");
  // Compte auth.users sans fiche crm_users active (ex. compte de l'app
  // comptable qui partage ce projet Supabase) : page dédiée, pas de 500.
  if (!session.me?.is_active) redirect("/acces-refuse");
  return session as Session & { me: Profile };
}
