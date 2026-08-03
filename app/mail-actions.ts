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
import type { ActionState } from "@/app/actions";
import type { Email, EmailIntent } from "@/lib/types";

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

type MailResponse = {
  ok?: boolean;
  error?: string;
  tested?: boolean;
  test_error?: string | null;
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
// C1 — Configuration du compte (admin)
// ---------------------------------------------------------------------------

export async function saveEmailAccountAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const email = String(fd.get("email_address") ?? "").trim();
  const password = String(fd.get("app_password") ?? "");
  const datacenter = fd.get("datacenter") === "eu" ? "eu" : "com";

  if (!email || !password) {
    return { error: "Adresse et mot de passe d'application requis." };
  }

  const res = await callMail({
    action: "save_account",
    email_address: email,
    app_password: password,
    datacenter,
  });
  if (res.error) return { error: res.error };

  revalidatePath("/reglages-email");
  if (res.tested) {
    return { success: "Compte enregistré — connexion IMAP vérifiée." };
  }
  return {
    error: `Compte enregistré, mais la connexion IMAP a échoué : ${res.test_error ?? "erreur inconnue"}. Vérifiez le centre de données (.eu / .com), que IMAP est activé dans Zoho Mail, et le mot de passe d'application.`,
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

export async function sendProspectEmailAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const { supabase, userId } = await currentUser();

  const prospectId = String(fd.get("prospect_id") ?? "");
  const to = String(fd.get("to") ?? "").trim();
  const subject = String(fd.get("subject") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim();

  if (!prospectId || !to || !subject || !body) {
    return { error: "Destinataire, sujet et message requis." };
  }

  const res = await callMail({
    action: "send",
    prospect_id: prospectId,
    to,
    subject,
    body,
  });
  if (res.error) return { error: res.error };

  // Cadence : l'envoi déclenche la relance — une tâche à J+3 si aucune
  // relance ouverte n'existe déjà (on n'écrase jamais un rappel planifié).
  const { data: prospect } = await supabase
    .from("prospects")
    .select("id, company_name")
    .eq("id", prospectId)
    .maybeSingle();
  const { data: openTasks } = await supabase
    .from("tasks")
    .select("id")
    .eq("prospect_id", prospectId)
    .eq("status", "a_faire")
    .limit(1);

  if (prospect && (openTasks ?? []).length === 0) {
    await supabase.from("tasks").insert({
      prospect_id: prospectId,
      title: `Relancer ${prospect.company_name} — email envoyé`,
      due_at: inDaysAt9(3),
      priority: 2,
      assignee_id: userId,
      created_by: userId,
    });
  }

  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
  return { success: "Email envoyé. Relance planifiée à 3 jours si aucune n'existait." };
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

  switch (intent) {
    case "interesse":
      await supabase.from("prospects").update({ status: "contacte" }).eq("id", prospectId);
      await upsertTask(`Relancer ${company} — intéressé (réponse email)`, proposedDue ?? inDaysAt9(1));
      break;
    case "demande_info":
      await supabase.from("prospects").update({ status: "contacte" }).eq("id", prospectId);
      await upsertTask(`Envoyer les informations à ${company}`, proposedDue ?? inDaysAt9(1));
      break;
    case "pas_interesse":
      await supabase
        .from("prospects")
        .update({ status: "perdu", lost_reason: "Pas intéressé (réponse email)" })
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
      await supabase.from("prospects").update({ status: "contacte" }).eq("id", prospectId);
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
