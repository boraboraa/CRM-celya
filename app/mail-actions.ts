"use server";

/**
 * Boîte Zoho — actions côté Next. L'envoi et la configuration passent par
 * l'edge function crm-mail (le mot de passe d'application ne quitte jamais
 * Supabase Vault) ; le tri des réponses et son application passent par le
 * client Supabase de l'utilisateur — la RLS reste l'unique garde-fou.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
import { classifyReply } from "@/lib/ai/triage";
import { isoToLocalInput, localInputToISO, inDaysAt9 } from "@/lib/time";
import { fmtDate } from "@/lib/constants";
import { applyAutoStatus, manualStatusPatch } from "@/lib/crm/status";
import { applyEmailSentCadence } from "@/lib/crm/emailCadence";
import { recalcConfidence } from "@/lib/crm/confidence";
import { hasPlaceholder, PLACEHOLDER_ERROR } from "@/lib/crm/email";
import type { ActionState } from "@/app/actions";
import type { Email, EmailIntent } from "@/lib/types";

/**
 * Qui agit — sans aller-retour réseau (jetons ES256, signature vérifiée en
 * local contre le JWKS mis en cache). Même raison que dans app/actions.ts.
 */
async function currentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) redirect("/login");
  return { supabase, userId };
}

type MailResponse = {
  ok?: boolean;
  error?: string;
  tested?: boolean;
  test_error?: string | null;
  /** Explication lisible d'un échec IMAP — voir imapHint dans crm-mail. */
  imap_hint?: string | null;
  smtp_host?: string;
  imap_host?: string;
  hosts?: "perso" | "pro";
  message_id?: string;
  accounts?: number;
  imported?: number;
};

async function callMail(payload: Record<string, unknown>): Promise<MailResponse> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Session expirée, reconnectez-vous." };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/crm-mail`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    /* réponse non JSON */
  }
  if (!res.ok) return { error: (body.error as string) ?? `Erreur ${res.status}` };
  return body as MailResponse;
}

// ---------------------------------------------------------------------------
// C1 — Configuration de SA boîte (tout membre actif)
// ---------------------------------------------------------------------------

/**
 * Chacun connecte sa propre boîte. Aucun `user_id` n'est transmis : l'edge
 * function écrit celui du porteur du JWT. Le mot de passe d'application
 * traverse cette action pour aller droit au Vault — il n'est ni stocké côté
 * Next, ni journalisé, ni relu.
 */
export async function saveEmailAccountAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const email = String(fd.get("email_address") ?? "").trim();
  const password = String(fd.get("app_password") ?? "");
  const datacenter = fd.get("datacenter") === "eu" ? "eu" : "com";
  // « auto » (défaut) déduit le jeu d'hôtes du domaine ; les deux autres
  // valeurs le forcent, pour le cas tordu que la déduction raterait.
  const hostsRaw = String(fd.get("hosts") ?? "auto");
  const hosts = hostsRaw === "perso" || hostsRaw === "pro" ? hostsRaw : undefined;

  if (!email || !password) {
    return { error: "Adresse et mot de passe d'application requis." };
  }

  const res = await callMail({
    action: "save_account",
    email_address: email,
    app_password: password,
    datacenter,
    ...(hosts ? { hosts } : {}),
  });
  if (res.error) return { error: res.error };

  revalidatePath("/reglages-email");
  revalidatePath("/compte");
  if (res.tested) {
    return {
      success: `Boîte enregistrée — connexion IMAP vérifiée (${res.imap_host}).`,
    };
  }
  // L'erreur Zoho brute est incompréhensible : l'edge function renvoie une
  // explication utilisable, on la préfère au message d'origine.
  return {
    error:
      `Boîte enregistrée, mais la connexion IMAP a échoué. ` +
      `${res.imap_hint ?? ""} (Réponse de Zoho : ${res.test_error ?? "erreur inconnue"}.)`,
  };
}

export async function syncNowAction(): Promise<ActionState> {
  const res = await callMail({ action: "sync" });
  if (res.error) return { error: res.error };
  revalidatePath("/dashboard");
  revalidatePath("/reglages-email");
  revalidatePath("/emails");
  return {
    success: `Relève terminée : ${res.imported ?? 0} message(s) importé(s).`,
  };
}

// ---------------------------------------------------------------------------
// C3 — Envoi depuis la fiche prospect
// ---------------------------------------------------------------------------

/**
 * Le chemin d'envoi, écrit une seule fois : SMTP par l'edge function, puis
 * tout ce que l'edge function ne fait PAS — la proposition, la cadence de
 * relance, l'étape et la confiance. Partagé par l'envoi depuis le composeur
 * et par l'envoi d'un brouillon en un clic.
 */
async function sendAndFollowUp(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  input: {
    prospectId: string;
    to: string;
    subject: string;
    body: string;
    isProposal?: boolean;
  }
): Promise<ActionState> {
  const { prospectId, to, subject, body } = input;
  if (!prospectId || !to || !subject || !body) {
    return { error: "Destinataire, sujet et message requis." };
  }
  // Le trou laissé par un gabarit n'est pas un message : mieux vaut le dire
  // ici que de l'envoyer. Même garde côté composeur et côté connecteur MCP.
  if (hasPlaceholder(body) || hasPlaceholder(subject)) {
    return { error: PLACEHOLDER_ERROR };
  }

  const res = await callMail({
    action: "send",
    prospect_id: prospectId,
    to,
    subject,
    body,
  });
  if (res.error) return { error: res.error };

  if (input.isProposal) {
    await supabase
      .from("prospects")
      .update({ proposal_sent_at: new Date().toISOString() })
      .eq("id", prospectId);
  }

  // Cadence : un mail envoyé CLÔT l'action en cours — la relance ouverte
  // passe « fait » (elle ne reste plus « en retard »), et la suite est datée :
  // « Relancer … si pas de réponse » à +5 jours. La fiche passe dans la zone
  // « En attente de réponse » de À faire.
  const cadence = await applyEmailSentCadence(supabase, userId, prospectId);

  // Un email réellement envoyé est un fait fort : l'étape peut avancer
  // (« À appeler » → « Contacté », ou « Proposition » si la case est cochée).
  // applyAutoStatus n'avance jamais à rebours et respecte le verrou.
  const auto = await applyAutoStatus(supabase, prospectId);
  // Et c'est un événement : la confiance se recalcule (jamais bloquant).
  await recalcConfidence(supabase, prospectId);

  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/prospects");
  revalidatePath("/dashboard");

  const done = cadence.completedTitle ? " Relance en cours marquée faite." : "";
  const next = cadence.followUpAt
    ? ` Sans réponse, la fiche remonte le ${fmtDate(cadence.followUpAt)}.`
    : "";
  return {
    success: auto.changed
      ? `Email envoyé.${done}${next} Étape avancée automatiquement — ${auto.reason}.`
      : `Email envoyé.${done}${next}`,
  };
}

export async function sendProspectEmailAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const { supabase, userId } = await currentUser();

  return sendAndFollowUp(supabase, userId, {
    prospectId: String(fd.get("prospect_id") ?? ""),
    to: String(fd.get("to") ?? "").trim(),
    subject: String(fd.get("subject") ?? "").trim(),
    body: String(fd.get("body") ?? "").trim(),
    // Signal explicite : ce message EST la proposition. Jamais deviné dans
    // le texte — c'est la case cochée qui fait foi.
    isProposal: fd.get("is_proposal") === "1",
  });
}

/**
 * Envoyer un BROUILLON en un clic — le maillon qui manquait.
 *
 * Claude rédige, le texte atterrit dans « Brouillons » ; il fallait jusqu'ici
 * le sélectionner, le copier, dérouler le composeur et le coller. Ce geste-ci
 * l'envoie tel quel, à l'adresse de la fiche, puis retire le brouillon : la
 * chronologie garde l'email réellement parti, et rien ne reste en double.
 */
export async function sendDraftAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const { supabase, userId } = await currentUser();

  const prospectId = String(fd.get("prospect_id") ?? "");
  const draftId = String(fd.get("draft_id") ?? "");
  if (!prospectId || !draftId) return { error: "Brouillon introuvable." };

  const { data: draft } = await supabase
    .from("activities")
    .select("id, prospect_id, subject, body, is_draft")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft || draft.prospect_id !== prospectId) {
    return { error: "Brouillon introuvable." };
  }
  if (!draft.is_draft) {
    return { error: "Cette entrée n'est pas un brouillon." };
  }

  const { data: prospect } = await supabase
    .from("prospects")
    .select("id, email")
    .eq("id", prospectId)
    .maybeSingle();
  const to = (prospect?.email ?? "").trim();
  if (!to) {
    return {
      error: "Aucune adresse email sur la fiche — ajoutez-la avant d'envoyer.",
    };
  }

  const subject = (draft.subject ?? "").trim();
  const body = (draft.body ?? "").trim();
  if (!subject) {
    return {
      error:
        "Ce brouillon n'a pas d'objet — ouvrez-le avec « Modifier » pour en donner un.",
    };
  }
  if (!body) return { error: "Ce brouillon est vide." };

  const result = await sendAndFollowUp(supabase, userId, {
    prospectId,
    to,
    subject,
    body,
  });
  if (result.error) return result;

  // Le brouillon a vécu : l'activité « email » créée par l'edge function le
  // remplace dans la chronologie. Le garder ferait doublon. Un échec de
  // suppression ne fait pas échouer l'envoi (le mail, lui, est parti).
  await supabase.from("activities").delete().eq("id", draftId);
  revalidatePath(`/prospects/${prospectId}`);

  return result;
}

// ---------------------------------------------------------------------------
// C4 — Tri des réponses reçues
// ---------------------------------------------------------------------------

export async function triageAnalyzeAction(emailId: string): Promise<ActionState> {
  const { supabase } = await currentUser();

  const { data: email } = await supabase
    .from("emails")
    .select("id, subject, body_text, prospect_id")
    .eq("id", emailId)
    .maybeSingle();
  if (!email) return { error: "Message introuvable." };

  const proposal = await classifyReply({
    subject: email.subject ?? "",
    text: email.body_text ?? "",
    today: isoToLocalInput(new Date().toISOString()).slice(0, 10),
  });
  if (!proposal) {
    return { error: "Assistant indisponible — triez ce message à la main." };
  }

  const { error } = await supabase
    .from("emails")
    .update({
      intent: proposal.intent,
      intent_confidence: proposal.confidence,
      intent_summary: proposal.summary,
      proposed_due_at: proposal.date
        ? localInputToISO(`${proposal.date}T09:00`)
        : null,
    })
    .eq("id", emailId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return {};
}

/**
 * Accepter la proposition : c'est ce clic — humain — qui applique le statut,
 * annule ou décale le rappel. Cas d'absence traité explicitement : le rappel
 * n'est pas annulé, il est décalé au lendemain du retour.
 */
export async function triageAcceptAction(emailId: string): Promise<ActionState> {
  const { supabase, userId } = await currentUser();

  const { data } = await supabase
    .from("emails")
    .select("id, prospect_id, intent, proposed_due_at, prospects(id, company_name)")
    .eq("id", emailId)
    .maybeSingle();
  const email = data as unknown as
    | (Pick<Email, "id" | "prospect_id" | "intent" | "proposed_due_at"> & {
        prospects: { id: string; company_name: string } | null;
      })
    | null;
  if (!email?.prospect_id || !email.prospects) {
    return { error: "Message non rattaché à un prospect." };
  }
  if (!email.intent) return { error: "Analysez d'abord ce message." };

  const prospectId = email.prospect_id;
  const company = email.prospects.company_name;
  const intent = email.intent as EmailIntent;
  const proposedDue = email.proposed_due_at;

  const { data: openTasksRaw } = await supabase
    .from("tasks")
    .select("id, title")
    .eq("prospect_id", prospectId)
    .eq("status", "a_faire");
  // On ne touche jamais aux tâches RDV.
  const openTasks = (openTasksRaw ?? []).filter((t) => !t.title.startsWith("RDV"));

  const upsertTask = async (title: string, dueAt: string) => {
    if (openTasks.length > 0) {
      await supabase
        .from("tasks")
        .update({ title, due_at: dueAt, assignee_id: userId })
        .eq("id", openTasks[0].id);
      if (openTasks.length > 1) {
        await supabase
          .from("tasks")
          .update({ status: "annule" })
          .in("id", openTasks.slice(1).map((t) => t.id));
      }
    } else {
      await supabase.from("tasks").insert({
        prospect_id: prospectId,
        title,
        due_at: dueAt,
        priority: 2,
        assignee_id: userId,
        created_by: userId,
      });
    }
  };

  // L'étape n'est plus forcée ici : la réponse reçue est déjà un fait, et
  // c'est applyAutoStatus (appelé plus bas) qui en tire « Contacté » — sans
  // jamais reculer une fiche déjà plus avancée, ni écraser un choix humain.
  // Seul « Perdu » est écrit directement : c'est une décision humaine
  // irréversible, jamais automatique — le clic « Accepter » la vaut, et
  // elle verrouille la fiche.
  switch (intent) {
    case "interesse":
      await upsertTask(`Relancer ${company} — intéressé (réponse email)`, proposedDue ?? inDaysAt9(1));
      break;
    case "demande_info":
      await upsertTask(`Envoyer les informations à ${company}`, proposedDue ?? inDaysAt9(1));
      break;
    case "pas_interesse":
      await supabase
        .from("prospects")
        .update({
          ...manualStatusPatch("perdu"),
          lost_reason: "Pas intéressé (réponse email)",
        })
        .eq("id", prospectId);
      if (openTasks.length > 0) {
        await supabase
          .from("tasks")
          .update({ status: "annule" })
          .in("id", openTasks.map((t) => t.id));
      }
      break;
    case "rappel_plus_tard":
      // La mise en sommeil ne passe plus par un statut : c'est la date de la
      // relance qui sort la fiche de « À faire » jusqu'à l'échéance.
      await upsertTask(`Recontacter ${company} (à sa demande)`, proposedDue ?? inDaysAt9(30));
      break;
    case "absence": {
      // « Je suis en congé jusqu'au 20 » n'est pas une réponse : on décale,
      // on n'annule pas — sinon le prospect se perd par simple calendrier.
      const due = proposedDue ?? inDaysAt9(7);
      if (openTasks.length > 0) {
        await supabase
          .from("tasks")
          .update({ due_at: due })
          .in("id", openTasks.map((t) => t.id));
      } else {
        await upsertTask(`Relancer ${company}`, due);
      }
      break;
    }
    case "hors_sujet":
      break;
  }

  await supabase
    .from("emails")
    .update({ triage: "accepte", is_read: true })
    .eq("id", emailId);

  if (intent !== "pas_interesse") {
    await applyAutoStatus(supabase, prospectId);
  }
  // La réponse vient d'être traitée : la confiance se recalcule sur ce
  // nouvel élément (l'objection, l'intérêt ou l'absence pèsent dans le niveau).
  await recalcConfidence(supabase, prospectId);

  revalidatePath("/dashboard");
  revalidatePath(`/prospects/${prospectId}`);
  return {};
}

export async function triageIgnoreAction(emailId: string): Promise<ActionState> {
  const { supabase } = await currentUser();
  const { error } = await supabase
    .from("emails")
    .update({ triage: "ignore", is_read: true })
    .eq("id", emailId);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return {};
}

// ---------------------------------------------------------------------------
// C2 — Rattachement manuel des messages orphelins
// ---------------------------------------------------------------------------

export async function attachEmailAction(fd: FormData): Promise<void> {
  const { supabase } = await currentUser();
  const emailId = String(fd.get("email_id") ?? "");
  const prospectId = String(fd.get("prospect_id") ?? "");
  if (!emailId || !prospectId || prospectId === "none") return;

  await supabase.from("emails").update({ prospect_id: prospectId }).eq("id", emailId);

  revalidatePath("/emails");
  revalidatePath("/dashboard");
  revalidatePath(`/prospects/${prospectId}`);
}
