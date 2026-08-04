import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";

/**
 * Client Supabase en `service_role` — réservé au serveur, jamais au navigateur.
 *
 * Contourne la RLS : c'est délibéré et strictement encadré. Seuls deux usages
 * l'appellent, tous deux hors du parcours utilisateur classique :
 *  1. le connecteur MCP (app/[transport]) — qui impose lui-même que toute
 *     opération est rattachée à Bora (author_id / created_by renseignés) et
 *     ne touche QUE les tables CRM (prospects, activities, tasks, emails) ;
 *  2. le serveur OAuth du connecteur (app/api/oauth) — pour lire/écrire les
 *     tables `mcp_oauth_*`, fermées à tous les rôles clients (RLS sans policy).
 *
 * La clé n'est JAMAIS dans le dépôt ni dans une variable NEXT_PUBLIC_* : elle
 * est injectée côté serveur via la variable d'environnement Vercel
 * SUPABASE_SERVICE_ROLE_KEY. Le module jette si elle manque.
 */
let cached: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (cached) return cached;

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY manquante — le connecteur MCP ne peut pas agir. " +
        "Définissez-la dans les variables d'environnement Vercel (jamais NEXT_PUBLIC_*)."
    );
  }

  cached = createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** True si la clé service_role est configurée (sans révéler sa valeur). */
export function adminConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
