/**
 * Normalisation et détection de doublons — déterministe, jamais déléguée au
 * modèle. Ce module est neutre (ni "use server", ni "use client") : c'est la
 * *seule* source de vérité, partagée par la saisie assistée (app/ai-actions.ts),
 * les server actions (app/actions.ts) et le connecteur MCP (app/[transport]).
 *
 * Déplacé depuis app/ai-actions.ts le 4 août sans changement de comportement :
 * un prospect créé par le connecteur applique exactement la même normalisation
 * « +32 » et la même dédup qu'un prospect créé à la main.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopeProspects, canSeeProspect, type Viewer } from "./access";
import { cleSociete, cleTelephone } from "./doublons";

// La normalisation « +32 » vit dans le module pur ./telephone (27/10) : le
// test de « Ma liste » l'exécute sous node. Ré-exportée ici pour les appelants.
export { normalizeBelgianPhone } from "./telephone";

/**
 * Les clés de comparaison — écrites UNE fois dans `./doublons` (module pur,
 * recopié en SQL par la 031 pour le dédoublonnage d'équipe). L'ancienne clé de
 * téléphone (les 9 derniers chiffres) ratait les fixes : voir `cleTelephone`.
 */
export const phoneKey = cleTelephone;
export const companyKey = cleSociete;

export type DuplicateHit = {
  id: string;
  company_name: string;
  phone: string | null;
  email: string | null;
  status: string;
  reason: string;
};

/**
 * Détection de doublon avant création : téléphone, email et nom de société
 * normalisés, comparés aux prospects existants. On prévient, on ne bloque pas.
 *
 * `scope` n'est renseigné que par le connecteur MCP, qui agit en service_role
 * (RLS contournée) : sans lui, l'avertissement de doublon renvoyé à un
 * commercial nommerait les sociétés de Bora — une fuite par le canal le plus
 * discret qui soit. Depuis l'interface, le client Supabase de l'utilisateur
 * applique déjà `can_see_prospect`, et `scope` reste absent.
 */
export async function findDuplicates(
  supabase: SupabaseClient,
  fields: { company_name: string | null; phone: string | null; email: string | null },
  scope?: Viewer | null
): Promise<DuplicateHit[]> {
  let q = supabase
    .from("prospects")
    .select("id, company_name, phone, email, status, owner_id")
    .limit(2000);
  if (scope) q = scopeProspects(q, scope);
  const { data } = await q;

  const rows = data ?? [];
  const hits: DuplicateHit[] = [];
  const targetPhone = phoneKey(fields.phone);
  const targetEmail = fields.email?.toLowerCase() ?? null;
  const targetName = companyKey(fields.company_name);

  for (const r of rows) {
    // Dernier verrou : même si le filtre de requête n'avait pas mordu, une
    // fiche qui ne regarde pas l'appelant ne franchit pas cette porte.
    if (scope && !canSeeProspect(scope, (r.owner_id as string | null) ?? null)) {
      continue;
    }
    const reasons: string[] = [];
    if (targetPhone && phoneKey(r.phone) === targetPhone) reasons.push("même téléphone");
    if (targetEmail && r.email?.toLowerCase() === targetEmail) reasons.push("même email");
    if (targetName) {
      const rowName = companyKey(r.company_name);
      if (
        rowName &&
        (rowName === targetName ||
          rowName.includes(targetName) ||
          targetName.includes(rowName))
      ) {
        reasons.push("nom de société proche");
      }
    }
    if (reasons.length > 0) {
      hits.push({
        id: r.id,
        company_name: r.company_name,
        phone: r.phone,
        email: r.email,
        status: r.status,
        reason: reasons.join(", "),
      });
    }
    if (hits.length >= 5) break;
  }
  return hits;
}
