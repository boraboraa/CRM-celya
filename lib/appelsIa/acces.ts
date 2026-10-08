/**
 * Les accès du moteur d'appels — SERVEUR seulement.
 *
 * Le moteur agit en `service_role` : c'est le SECOND usage sanctionné de la
 * clé dans le code Next, après le connecteur MCP (voir lib/supabase/admin.ts).
 * Il n'est appelé que par trois routes sans session utilisateur — le tick de
 * pg_cron (secret du Vault) et les deux routes de l'annexe (HMAC) — et par les
 * actions serveur de l'admin, qui vérifient le rôle avant. Il ne touche qu'à
 * la fiche de l'appel en cours.
 *
 * Les lectures qui conditionnent une composition échouent FERMÉES : elles
 * lèvent, et le moteur ne compose pas.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { estTableAbsente } from "@/lib/crm/access";
import type { ReglagesMoteur } from "@/lib/appelsIa/regles";

export const STATUTS_ACTIFS = ["reserve", "composition", "sonnerie", "en_ligne"] as const;

export type ReglagesAppels = ReglagesMoteur & {
  trunk_url: string;
  url_app: string;
  limite_compte_heure: number;
  limite_compte_jour: number;
  duree_max_s: number;
  sonnerie_max_s: number;
  voix: string;
  modele: string;
  modele_delegation: string;
  inscription_auto: boolean;
  inscription_auto_par: string | null;
  pause_at: string | null;
  updated_at: string;
};

export const REGLAGES_COLONNES =
  "actif, mode_test, gsm_test, numero_appelant, trunk_url, url_app, fenetre_debut, fenetre_fin, plafond_heure, plafond_jour, limite_compte_heure, limite_compte_jour, duree_max_s, sonnerie_max_s, voix, modele, modele_delegation, inscription_auto, inscription_auto_par, pause_cause, pause_at, updated_at";

export class MigrationAbsente extends Error {
  constructor() {
    super("La migration 025 (appels IA) n'est pas appliquée.");
  }
}

/** Les réglages. Lève si la lecture échoue : on ne compose pas sans eux. */
export async function lireReglages(client: SupabaseClient): Promise<ReglagesAppels> {
  const { data, error } = await client.from("appels_ia_reglages").select(REGLAGES_COLONNES).eq("id", 1).maybeSingle();
  if (estTableAbsente(error)) throw new MigrationAbsente();
  if (error || !data) throw new Error(`Réglages illisibles : ${error?.message ?? "ligne absente"}`);
  return data as unknown as ReglagesAppels;
}

let cacheSecret: { valeur: string; jusqua: number } | null = null;

/** Le secret interne (tick, HMAC), lu dans le Vault par le service_role. Gardé 60 s. */
export async function secretInterne(admin: SupabaseClient): Promise<string> {
  if (cacheSecret && cacheSecret.jusqua > Date.now()) return cacheSecret.valeur;
  const { data, error } = await admin.rpc("appels_ia_secret", { p_nom: "secret_interne" });
  if (error) throw new Error(`Secret interne illisible : ${error.message}`);
  const valeur = typeof data === "string" ? data : "";
  if (!valeur) throw new Error("Secret interne absent du Vault.");
  cacheSecret = { valeur, jusqua: Date.now() + 60_000 };
  return valeur;
}
