/**
 * Cœur « noter un échange » — le geste central du CRM, indépendant des cookies.
 * Note au journal, étape si elle change, relance à une date précise — jamais de
 * doublon de relance. Partagé par la server action saveExchangeAction et par le
 * connecteur MCP (ajouter_note / planifier_relance). Un seul chemin, une seule
 * cadence.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { dateInputToISO } from "@/lib/time";
import { STATUS_ORDER } from "@/lib/constants";
import type { ActivityType, ProspectStatus } from "@/lib/types";

export type SaveExchangeInput = {
  prospectId: string;
  /** Type d'échange versé au journal : note, email, rendez_vous. */
  type: ActivityType;
  note?: string | null;
  resume?: string | null;
  contactName?: string | null;
  statut?: ProspectStatus | null;
  motif?: string | null;
  /** « YYYY-MM-DD » ou « YYYY-MM-DDTHH:mm » (Bruxelles). null : pas de relance. */
  dateLocale?: string | null;
};

export type SaveExchangeResult = {
  error?: string;
  /** Renseigné en cas de succès. */
  ok?: boolean;
  prospectId?: string;
  companyName?: string;
  statusChanged?: boolean;
  newStatus?: ProspectStatus | null;
  /** ISO UTC de la relance posée / re-datée, ou null. */
  scheduledAt?: string | null;
  taskTitle?: string | null;
};

export async function saveExchangeCore(
  supabase: SupabaseClient,
  userId: string,
  input: SaveExchangeInput
): Promise<SaveExchangeResult> {
  const { data: prospect } = await supabase
    .from("prospects")
    .select("id, company_name, status")
    .eq("id", input.prospectId)
    .maybeSingle();
  if (!prospect) return { error: "Prospect introuvable." };

  const note = input.note?.trim() || null;
  const resume = input.resume?.trim().slice(0, 300) || null;
  const newStatus =
    input.statut && (STATUS_ORDER as string[]).includes(input.statut)
      ? input.statut
      : null;
  const statusChanged = newStatus !== null && newStatus !== prospect.status;

  const dueAt = dateInputToISO(input.dateLocale ?? null);
  if (input.dateLocale && !dueAt) return { error: "Date invalide." };

  if (!note && !resume && !statusChanged && !dueAt && !input.contactName?.trim()) {
    return { error: "Rien à enregistrer." };
  }

  // 1. Fiche : étape, contact, raison de perte.
  const patch: Record<string, unknown> = {};
  if (statusChanged) {
    patch.status = newStatus;
    if (newStatus === "perdu") {
      patch.lost_reason = input.motif?.trim() || "Sans précision";
    }
  }
  if (input.contactName?.trim()) {
    patch.contact_name = input.contactName.trim().slice(0, 120);
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from("prospects")
      .update(patch)
      .eq("id", prospect.id);
    if (error) return { error: error.message };
  }

  // 2. Journal — met aussi à jour last_contact_at via trigger.
  if (note || resume) {
    await supabase.from("activities").insert({
      prospect_id: prospect.id,
      author_id: userId,
      type: input.type,
      subject: resume,
      body: note,
      occurred_at: new Date().toISOString(),
    });
  }

  // 3. Relance — jamais de doublon : la tâche ouverte est re-datée, les
  //    surnuméraires annulées. Un prospect perdu n'a plus de relance.
  const { data: openTasks } = await supabase
    .from("tasks")
    .select("id, title")
    .eq("prospect_id", prospect.id)
    .eq("status", "a_faire")
    .order("due_at", { ascending: true });
  const allOpen = openTasks ?? [];

  let scheduledTitle: string | null = null;

  if (newStatus === "perdu") {
    if (allOpen.length > 0) {
      await supabase
        .from("tasks")
        .update({ status: "annule" })
        .in("id", allOpen.map((t) => t.id));
    }
  } else if (dueAt) {
    // « RDV avec … » uniquement quand l'échange enregistré EST un rendez-vous
    // (le titre commande la protection côté email : une tâche « RDV » n'est
    // jamais annulée ni re-datée par une réponse). Une simple relance ne
    // touche pas aux tâches RDV existantes.
    const planningRdv = input.type === "rendez_vous";
    const title = planningRdv
      ? `RDV avec ${prospect.company_name}`
      : `Relancer ${prospect.company_name}`;
    const reusable = planningRdv
      ? allOpen
      : allOpen.filter((t) => !t.title.startsWith("RDV"));
    const reusableIds = reusable.map((t) => t.id);

    if (reusableIds.length > 0) {
      await supabase
        .from("tasks")
        .update({ title, due_at: dueAt, assignee_id: userId })
        .eq("id", reusableIds[0]);
      if (reusableIds.length > 1) {
        await supabase
          .from("tasks")
          .update({ status: "annule" })
          .in("id", reusableIds.slice(1));
      }
    } else {
      await supabase.from("tasks").insert({
        prospect_id: prospect.id,
        title,
        due_at: dueAt,
        priority: 2,
        assignee_id: userId,
        created_by: userId,
      });
    }
    scheduledTitle = title;
  }

  return {
    ok: true,
    prospectId: prospect.id,
    companyName: prospect.company_name,
    statusChanged,
    newStatus: statusChanged ? newStatus : null,
    scheduledAt: newStatus === "perdu" ? null : (dueAt ?? null),
    taskTitle: scheduledTitle,
  };
}
