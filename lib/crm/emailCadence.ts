/**
 * Cadence d'un email SORTANT — un envoi CLÔT l'action en cours.
 *
 * Le bug d'origine (7 août) : l'envoi ne créait une relance que « si aucune
 * n'existait déjà » — l'ancienne relance « contacter par mail » restait donc
 * ouverte et la fiche s'affichait « en retard » juste après l'envoi. La règle
 * est désormais : envoyer un mail EST l'action — la relance ouverte la plus
 * proche (hors « RDV … ») passe « fait », les surnuméraires sont annulées, et
 * la suite est datée : « Relancer … si pas de réponse » à +5 jours. La fiche
 * vit alors dans « En attente de réponse » (zone calme de « À faire ») et ne
 * remonte qu'à l'échéance.
 *
 * `last_contact_at` n'est pas touché ici : l'edge function crm-mail insère
 * l'activité `type='email'` à l'envoi, et le trigger `bump_last_contact`
 * s'en charge. Si une réponse arrive, crm-mail annule la relance en attente
 * et la fiche remonte dans « Réponses reçues ».
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { inDaysAt9 } from "@/lib/time";
import { normalizeStatus } from "@/lib/constants";
import { isManualOnly } from "@/lib/crm/status";
import { estEnSommeil, rdvQuiCompte } from "@/lib/crm/prochaineAction";

/** Sans réponse au bout de 5 jours, la fiche remonte dans « À faire ». */
export const EMAIL_FOLLOWUP_DAYS = 5;

export type EmailSentCadence = {
  /** La relance accomplie par l'envoi (passée « fait »), ou null. */
  completedTitle: string | null;
  /** Relances surnuméraires annulées. */
  cancelled: number;
  /** Échéance de la relance « si pas de réponse » (ISO UTC), ou null. */
  followUpAt: string | null;
};

export async function applyEmailSentCadence(
  supabase: SupabaseClient,
  userId: string,
  prospectId: string
): Promise<EmailSentCadence> {
  const none: EmailSentCadence = {
    completedTitle: null,
    cancelled: 0,
    followUpAt: null,
  };

  const { data: prospect } = await supabase
    .from("prospects")
    .select("id, company_name, status")
    .eq("id", prospectId)
    .maybeSingle();
  if (!prospect) return none;

  // 1. L'envoi EST l'action : la relance ouverte la plus proche passe
  //    « fait » (le trigger stamp_task_completion horodate), les autres sont
  //    annulées. Les tâches « RDV … » ne sont jamais touchées — même
  //    protection que partout ailleurs.
  //    Un FILET endormi (relance repoussée derrière un rendez-vous encore
  //    vivant, migration 022) n'est pas l'action en cours : l'envoi n'y touche
  //    pas — il doit rester là si le rendez-vous tombe à l'eau.
  const [{ data: openTasks }, { data: rdvs }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, meeting_id")
      .eq("prospect_id", prospectId)
      .eq("status", "a_faire")
      .order("due_at", { ascending: true }),
    supabase
      .from("meetings")
      .select("id, starts_at, status")
      .eq("prospect_id", prospectId)
      .eq("kind", "prospect"),
  ]);
  const meetings = (rdvs ?? []) as { id: string; starts_at: string; status: string }[];
  const relances = (openTasks ?? []).filter(
    (t) => !t.title.startsWith("RDV") && !estEnSommeil(t, meetings)
  );

  let completedTitle: string | null = null;
  if (relances.length > 0) {
    await supabase
      .from("tasks")
      .update({ status: "fait" })
      .eq("id", relances[0].id);
    completedTitle = relances[0].title;
    if (relances.length > 1) {
      await supabase
        .from("tasks")
        .update({ status: "annule" })
        .in("id", relances.slice(1).map((t) => t.id));
    }
  }

  // 2. La suite est datée. Pas de nouvelle relance pour une fiche Gagné /
  //    Perdu — un prospect perdu n'a plus de relance ouverte, c'est
  //    l'invariant du projet.
  if (isManualOnly(normalizeStatus(prospect.status))) {
    return {
      completedTitle,
      cancelled: Math.max(0, relances.length - 1),
      followUpAt: null,
    };
  }

  // Un rendez-vous vivant à venir tombe AVANT l'échéance de +5 jours : c'est
  // lui, la suite (un mail avant un RDV le prépare ou le confirme). La relance
  // « si pas de réponse » ne réclamerait rien d'utile entre-temps — elle naît
  // donc directement FILET de ce rendez-vous, au premier jour ouvré qui le
  // suit (même date que le trigger de la 022, calculée par la base).
  let followUpAt = inDaysAt9(EMAIL_FOLLOWUP_DAYS);
  let meetingId: string | null = null;
  const rdv = rdvQuiCompte(meetings);
  if (
    rdv &&
    new Date(rdv.starts_at).getTime() > Date.now() &&
    new Date(followUpAt).getTime() < new Date(rdv.starts_at).getTime()
  ) {
    const { data: apres } = await supabase.rpc("premier_jour_ouvre_apres", {
      p_ts: rdv.starts_at,
    });
    if (typeof apres === "string") {
      followUpAt = new Date(apres).toISOString();
      meetingId = rdv.id;
    }
  }
  await supabase.from("tasks").insert({
    prospect_id: prospectId,
    title: `Relancer ${prospect.company_name} si pas de réponse`,
    due_at: followUpAt,
    priority: 2,
    assignee_id: userId,
    created_by: userId,
    meeting_id: meetingId,
  });

  return {
    completedTitle,
    cancelled: Math.max(0, relances.length - 1),
    followUpAt,
  };
}
