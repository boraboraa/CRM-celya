/**
 * Poser le rappel automatique après « Pas décroché » ou « Barrage » (29/10).
 * La RÈGLE est dans `decisionRappelAuto` (lib/crm/relance.ts, pure, testée par
 * `npm run test:relance`) ; ici, on lit ce qu'elle demande et on écrit par le
 * seul chemin qui sait poser une relance, `saveExchangeCore` SANS texte (aucune
 * entrée de journal : la tâche ouverte est re-datée, les surnuméraires
 * annulées, jamais de doublon).
 *
 * Partagé par l'écran (`enregistrerResultatAction`, `preciserResultatAction`)
 * et le connecteur MCP (`ajouter_note` avec `resultat`) : un « pas décroché »
 * noté par Claude pose le même rappel qu'un tap.
 *
 * Ne lève jamais : un rappel qui n'a pas pu être posé ne doit pas faire
 * échouer le résultat d'appel, déjà écrit.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decisionRappelAuto } from "@/lib/crm/relance";
import { prochainRdvAVenir } from "@/lib/crm/agenda";
import { saveExchangeCore } from "@/lib/crm/exchange";

/** L'échéance posée (ISO UTC), ou null si la règle ne demandait rien. */
export async function poserRappelAuto(
  supabase: SupabaseClient,
  userId: string,
  prospectId: string,
  outcome: string | null | undefined,
  options: { dateHumaine?: boolean; now?: Date } = {}
): Promise<string | null> {
  try {
    const [{ data: fiche }, { data: taches }, rdv] = await Promise.all([
      supabase.from("prospects").select("status").eq("id", prospectId).maybeSingle(),
      supabase.from("tasks").select("due_at").eq("prospect_id", prospectId).eq("status", "a_faire"),
      prochainRdvAVenir(supabase, prospectId),
    ]);
    if (!fiche) return null;
    const decision = decisionRappelAuto({
      outcome,
      dateHumaine: Boolean(options.dateHumaine),
      statut: fiche.status as string,
      rdvAVenir: Boolean(rdv),
      relancesOuvertes: ((taches ?? []) as { due_at: string | null }[])
        .map((t) => t.due_at)
        .filter((d): d is string => Boolean(d)),
      now: options.now ?? new Date(),
    });
    if (!decision.poser) return null;
    const res = await saveExchangeCore(supabase, userId, {
      prospectId,
      type: "note",
      dateLocale: decision.poser,
    });
    return res.error ? null : (res.scheduledAt ?? null);
  } catch {
    return null;
  }
}
