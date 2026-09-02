/**
 * Cœur « noter un échange » — le geste central du CRM, indépendant des cookies.
 * Note au journal, étape si elle change, relance à une date précise — jamais de
 * doublon de relance. Partagé par la server action saveExchangeAction et par le
 * connecteur MCP (ajouter_note / planifier_relance). Un seul chemin, une seule
 * cadence.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { dateInputToISO } from "@/lib/time";
import { STATUS_ORDER, isCallOutcome } from "@/lib/constants";
import { applyAutoStatus, manualStatusPatch } from "@/lib/crm/status";
import { recalcConfidence } from "@/lib/crm/confidence";
import { poserRendezVous, type MeetingConflit } from "@/lib/crm/agenda";
import type { ActivityType, CallOutcome, ProspectStatus } from "@/lib/types";

export type SaveExchangeInput = {
  prospectId: string;
  /** Type d'échange versé au journal : note, email, rendez_vous. */
  type: ActivityType;
  note?: string | null;
  resume?: string | null;
  contactName?: string | null;
  /**
   * Étape imposée par un humain. La renseigner VERROUILLE la fiche :
   * l'auto-classification ne la réécrira plus (elle pourra seulement
   * suggérer). Laisser vide pour que l'étape suive les faits.
   */
  statut?: ProspectStatus | null;
  motif?: string | null;
  /** « YYYY-MM-DD » ou « YYYY-MM-DDTHH:mm » (Bruxelles). null : pas de relance. */
  dateLocale?: string | null;
  /** Lieu du rendez-vous (type « rendez_vous » seulement) — porté par l'agenda. */
  rdvLieu?: string | null;
  /** Fin du rendez-vous « YYYY-MM-DDTHH:mm » — à défaut, début + 60 min. */
  rdvFin?: string | null;
  /**
   * Cette note atteste-t-elle d'un échange réel avec le prospect ?
   * Défaut true (la saisie humaine passe par « Noter un échange ») ; le
   * connecteur MCP doit le déclarer explicitement. Sans attestation, une
   * note de repérage ne fait pas passer la fiche en « Contacté ».
   */
  isExchange?: boolean;
  /**
   * « Appelé, pas de réponse » : l'appel a été TENTÉ mais n'a pas abouti.
   * Ce n'est pas un échange (la fiche reste « À appeler ») mais c'est un
   * résultat, tracé au journal (activities.outcome = 'sans_reponse') même
   * sans texte — c'est lui que la carte affiche.
   */
  noAnswer?: boolean;
  /**
   * Le RÉSULTAT de l'appel (migration 019) : 'sans_reponse', 'barrage',
   * 'rappeler', 'interesse', 'refus'. C'est la forme générale de `noAnswer`,
   * qui reste accepté et vaut exactement `outcome: 'sans_reponse'`.
   *
   * Seul 'sans_reponse' N'EST PAS un échange — les quatre autres attestent
   * qu'on a eu quelqu'un au bout du fil. Un résultat se trace au journal même
   * sans texte : c'est lui que la carte affiche.
   */
  outcome?: CallOutcome | null;
  /** Brouillon : versé hors chronologie, ne compte pour aucun fait. */
  isDraft?: boolean;
  /** Signal explicite : une proposition / un devis vient d'être envoyé. */
  proposalSent?: boolean;
};

export type SaveExchangeResult = {
  error?: string;
  /** Renseigné en cas de succès. */
  ok?: boolean;
  /** L'entrée de journal créée, s'il y en a une — pour la préciser ensuite. */
  activiteId?: string | null;
  prospectId?: string;
  companyName?: string;
  statusChanged?: boolean;
  newStatus?: ProspectStatus | null;
  /** ISO UTC de la relance posée / re-datée, ou null. */
  scheduledAt?: string | null;
  taskTitle?: string | null;
  /** Étape avancée automatiquement par les faits, et son motif. */
  autoStatus?: ProspectStatus | null;
  autoReason?: string | null;
  /** Rendez-vous posé qui chevauche un autre créneau — averti, jamais bloquant. */
  conflit?: MeetingConflit | null;
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

  // AUCUN rendez-vous sans date — le garde-fou vit à l'ÉCRITURE, pas
  // seulement dans la proposition du modèle (analyzeNoteAction) : c'est par
  // ici que passait l'humain pressé, et l'heure du rendez-vous se perdait.
  // Un seul endroit : interface, connecteur MCP et tout futur appelant.
  if ((newStatus === "rendez_vous" || input.type === "rendez_vous") && !dueAt) {
    return {
      error:
        "Un rendez-vous demande une date ET une heure — sans elles il ne remontera nulle part.",
    };
  }
  // Et l'heure ne se devine pas : un type « rendez_vous » avec une date sans
  // heure serait complété à 09:00 en silence — refusé AVANT toute écriture.
  if (
    input.type === "rendez_vous" &&
    dueAt &&
    !/T\d{2}:\d{2}/.test((input.dateLocale ?? "").trim())
  ) {
    return {
      error:
        "Un rendez-vous a une heure précise — pas de rendez-vous « toute la journée ».",
    };
  }

  const isDraft = input.isDraft === true;
  // Le résultat d'appel — borné en base par activities_outcome_connu (019) ;
  // une valeur inconnue est ignorée ici plutôt que refusée par Postgres. Un
  // email n'a pas de « résultat d'appel » ; une note et un rendez-vous en ont
  // un (on décroche, et on cale le rendez-vous dans la foulée).
  const outcome: CallOutcome | null =
    !isDraft && input.type !== "email" && isCallOutcome(input.outcome)
      ? input.outcome
      : null;
  // Un appel sans réponse n'est pas un échange — mais c'est un résultat.
  // `noAnswer` reste le chemin historique ; il vaut outcome='sans_reponse'.
  const noAnswer =
    !isDraft &&
    input.type === "note" &&
    (input.noAnswer === true || outcome === "sans_reponse");
  // Un brouillon n'est ni un échange, ni un fait : il ne déclenche aucune
  // relance et ne fait avancer aucune étape.
  const isExchange = isDraft || noAnswer ? false : input.isExchange !== false;

  if (
    !note &&
    !resume &&
    !statusChanged &&
    !dueAt &&
    !input.contactName?.trim() &&
    !noAnswer &&
    !outcome
  ) {
    return { error: "Rien à enregistrer." };
  }
  if (isDraft && !note && !resume) {
    return { error: "Un brouillon a besoin d'un texte." };
  }

  // 1. Fiche : étape, contact, raison de perte.
  //    Une étape explicite est une décision humaine → elle VERROUILLE la fiche.
  const patch: Record<string, unknown> = {};
  if (statusChanged) {
    Object.assign(patch, manualStatusPatch(newStatus!));
    if (newStatus === "perdu") {
      patch.lost_reason = input.motif?.trim() || "Sans précision";
    }
  }
  //    « Pas intéressé » est un RÉSULTAT d'appel, pas une décision de perte :
  //    la raison est conservée sur la fiche, mais l'étape « Perdu » reste un
  //    geste humain explicite (invariant de lib/crm/status.ts) — elle n'est
  //    que suggérée.
  if (outcome === "refus" && input.motif?.trim()) {
    patch.lost_reason = input.motif.trim().slice(0, 300);
  }
  if (input.contactName?.trim()) {
    patch.contact_name = input.contactName.trim().slice(0, 120);
  }
  // Le signal explicite d'une proposition — jamais deviné dans le texte.
  if (input.proposalSent && !isDraft) {
    patch.proposal_sent_at = new Date().toISOString();
  }
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from("prospects")
      .update(patch)
      .eq("id", prospect.id);
    if (error) return { error: error.message };
  }

  // 2. Journal — met aussi à jour last_contact_at via trigger. Un résultat
  //    d'appel se trace même sans texte : le sujet reste vide, c'est `outcome`
  //    qui parle (la chronologie et les cartes le traduisent en clair).
  let activiteId: string | null = null;
  if (note || resume || noAnswer || outcome) {
    const { data: ligne } = await supabase
      .from("activities")
      .insert({
        prospect_id: prospect.id,
        author_id: userId,
        type: input.type,
        subject: resume,
        body: note,
        outcome: outcome ?? (noAnswer ? "sans_reponse" : null),
        occurred_at: new Date().toISOString(),
        is_draft: isDraft,
        is_exchange: isExchange,
      })
      .select("id")
      .maybeSingle();
    activiteId = ligne?.id ?? null;
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
  let conflit: MeetingConflit | null = null;

  if (newStatus === "perdu") {
    if (allOpen.length > 0) {
      await supabase
        .from("tasks")
        .update({ status: "annule" })
        .in("id", allOpen.map((t) => t.id));
    }
  } else if (dueAt && !isDraft) {
    if (input.type === "rendez_vous") {
      // Le rendez-vous vit dans l'AGENDA (meetings), plus dans une tâche
      // « RDV avec … » : le créneau porte début, fin et lieu, et c'est lui
      // que lisent les faits d'étape. Le journal est déjà tenu ci-dessus
      // quand la note existe ; l'étape et la confiance suivent en 4 et 5.
      const rdv = await poserRendezVous(supabase, userId, {
        prospectId: prospect.id,
        kind: "prospect",
        startsAt: (input.dateLocale ?? "").trim().slice(0, 16),
        endsAt: input.rdvFin,
        location: input.rdvLieu,
        ecrireActivite: !(note || resume),
        avancerEtape: false,
      });
      if (rdv.error) return { error: rdv.error };
      scheduledTitle = rdv.title ?? `RDV avec ${prospect.company_name}`;
      conflit = rdv.conflit ?? null;
    } else {
      // Une simple relance — jamais de doublon : la tâche ouverte est
      // re-datée, les surnuméraires annulées. Le filtre « RDV » ne protège
      // plus que d'éventuelles tâches héritées d'avant l'agenda.
      const title = `Relancer ${prospect.company_name}`;
      const reusable = allOpen.filter((t) => !t.title.startsWith("RDV"));
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
  }

  // 4. L'étape suit les faits — sauf si Bora vient de la fixer lui-même
  //    (elle est alors verrouillée, et applyAutoStatus n'y touchera pas).
  //    N'avance que vers l'avant, et affiche toujours son motif.
  const auto = statusChanged
    ? { changed: false as const }
    : await applyAutoStatus(supabase, prospect.id);

  // 5. La confiance suit l'événement — jamais sur un brouillon (un texte
  //    jamais envoyé n'est pas un signal), et jamais bloquant.
  if (!isDraft) {
    await recalcConfidence(supabase, prospect.id);
  }

  return {
    ok: true,
    activiteId,
    prospectId: prospect.id,
    companyName: prospect.company_name,
    statusChanged,
    newStatus: statusChanged ? newStatus : null,
    scheduledAt: newStatus === "perdu" ? null : (dueAt ?? null),
    taskTitle: scheduledTitle,
    autoStatus: auto.changed ? (auto.status ?? null) : null,
    autoReason: auto.changed ? (auto.reason ?? null) : null,
    conflit,
  };
}
