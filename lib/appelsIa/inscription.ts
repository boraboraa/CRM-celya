/**
 * Mettre une fiche dans la file de Janet — à la main (fiche, écran Appels IA)
 * ou par Claude (connecteur MCP). La règle vit EN BASE, une seule fois
 * (`appels_ia_inscrire` → `appels_ia_refus_inscription`, migration 025) ; ce
 * module ne fait que l'appeler et dire le refus en français.
 *
 * Indifférent au client : la session de l'admin (la fonction vérifie
 * `is_admin()`), ou le service_role (le connecteur MCP vérifie l'admin en
 * code, et passe `parId`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type Origine = "manuel" | "mcp" | "fiche";

export async function campagneSysteme(client: SupabaseClient, systeme: "auto" | "fiche", parId: string): Promise<string> {
  const { data, error } = await client.rpc("appels_ia_campagne_systeme", { p_systeme: systeme, p_par: parId });
  if (error || typeof data !== "string") throw new Error(`Campagne « ${systeme} » illisible : ${error?.message ?? "absente"}`);
  return data;
}

/** Inscrit la fiche. Renvoie la raison du refus, ou null si elle est dans la file. */
export async function inscrire(
  client: SupabaseClient,
  e: { prospectId: string; campagneId: string; origine: Origine; parId: string; priorite?: number; pasAvant?: Date | null }
): Promise<string | null> {
  const { data, error } = await client.rpc("appels_ia_inscrire", {
    p_prospect: e.prospectId,
    p_campagne: e.campagneId,
    p_origine: e.origine,
    p_par: e.parId,
    p_priorite: e.priorite ?? 0,
    p_pas_avant: e.pasAvant ? e.pasAvant.toISOString() : null,
  });
  if (error) return error.code === "42501" ? "Réservé à l'administrateur." : `Inscription impossible : ${error.message}`;
  return typeof data === "string" ? data : null;
}
