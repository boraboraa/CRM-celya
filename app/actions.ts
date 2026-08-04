"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
import { localInputToISO, dateInputToISO, inDaysAt9 } from "@/lib/time";
import { normalizeStatus } from "@/lib/constants";
import type { ProspectStatus } from "@/lib/types";
import {
  manualStatusPatch,
  unlockStatusPatch,
  applyAutoStatus,
} from "@/lib/crm/status";
import { createProspectCore } from "@/lib/crm/prospects";
import { saveExchangeCore, type SaveExchangeInput } from "@/lib/crm/exchange";
import {
  importProspectsCore,
  type ImportRow,
  type ImportResult,
} from "@/lib/crm/prospects";

export type ActionState = { error?: string; success?: string };

// Types réexportés depuis le cœur partagé (lib/crm) pour ne pas rompre les
// imports existants des composants.
export type { SaveExchangeInput, ImportRow, ImportResult };

const str = (fd: FormData, k: string): string | null => {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

const num = (fd: FormData, k: string): number | null => {
  const v = str(fd, k);
  if (v === null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

async function currentUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

function revalidateProspect(id?: string | null) {
  if (id) revalidatePath(`/prospects/${id}`);
  revalidatePath("/prospects");
  revalidatePath("/dashboard");
}

// =====================================================================
// Prospects
// =====================================================================

export async function createProspectAction(fd: FormData) {
  const { supabase, userId } = await currentUserId();

  // Passe par le cœur partagé (même insertion que le connecteur MCP). Le
  // formulaire ne force ni dédup ni normalisation « +32 » : la saisie manuelle
  // est conservée telle quelle (la dédup a déjà été proposée à l'extraction).
  const result = await createProspectCore(
    supabase,
    userId,
    {
      company_name: str(fd, "company_name"),
      contact_name: str(fd, "contact_name"),
      email: str(fd, "email"),
      phone: str(fd, "phone"),
      website: str(fd, "website"),
      sector: str(fd, "sector"),
      city: str(fd, "city"),
      status: str(fd, "status"),
      source: str(fd, "source"),
      value_estimate: num(fd, "value_estimate"),
      probability: num(fd, "probability"),
      owner_id: str(fd, "owner_id"),
      notes: str(fd, "notes"),
    }
  );

  if (result.error) throw new Error(result.error);

  revalidatePath("/prospects");
  redirect(`/prospects/${result.id}`);
}

export async function updateProspectAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) throw new Error("Prospect introuvable");

  const { data: before } = await supabase
    .from("prospects")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  const status = normalizeStatus(str(fd, "status"));
  const assign = str(fd, "owner_id");
  const probability = num(fd, "probability");

  const patch: Record<string, unknown> = {
    company_name: str(fd, "company_name") ?? "Sans nom",
    contact_name: str(fd, "contact_name"),
    email: str(fd, "email")?.toLowerCase() ?? null,
    phone: str(fd, "phone"),
    website: str(fd, "website"),
    sector: str(fd, "sector"),
    city: str(fd, "city"),
    source: str(fd, "source"),
    value_estimate: num(fd, "value_estimate"),
    probability:
      probability === null
        ? null
        : Math.min(100, Math.max(0, Math.round(probability))),
    owner_id: assign === "none" ? null : assign,
    notes: str(fd, "notes"),
    lost_reason: str(fd, "lost_reason"),
  };

  // Changer l'étape depuis le formulaire est une décision humaine : elle
  // verrouille. La laisser telle quelle ne verrouille rien.
  if (before && normalizeStatus(before.status as string) !== status) {
    Object.assign(patch, manualStatusPatch(status));
  } else {
    patch.status = status;
  }

  const { error } = await supabase.from("prospects").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  revalidateProspect(id);
}

/**
 * Fixer l'étape à la main — depuis la fiche. Verrouille : à partir de là,
 * l'auto-classification ne réécrit plus rien, elle peut seulement suggérer.
 */
export async function setProspectStatusAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!id || !status) return;

  await supabase
    .from("prospects")
    .update(manualStatusPatch(normalizeStatus(status)))
    .eq("id", id);

  revalidateProspect(id);
}

/**
 * Rendre la main à l'IA : l'étape redevient déductible des faits, et on la
 * ré-évalue tout de suite pour que l'effet soit visible immédiatement.
 */
export async function unlockProspectStatusAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return;

  await supabase.from("prospects").update(unlockStatusPatch()).eq("id", id);
  await applyAutoStatus(supabase, id);

  revalidateProspect(id);
}

/**
 * Accepter la suggestion affichée sur une fiche verrouillée (« un RDV a été
 * posé — passer en Rendez-vous ? »). C'est un clic humain : la fiche reste
 * verrouillée sur ce nouveau choix.
 */
export async function acceptStatusSuggestionAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!id || !status) return;

  await supabase
    .from("prospects")
    .update(manualStatusPatch(normalizeStatus(status)))
    .eq("id", id);

  revalidateProspect(id);
}

export async function deleteProspectAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return;

  const { error } = await supabase.from("prospects").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/prospects");
  redirect("/prospects");
}

// =====================================================================
// Noter un échange — le geste central : note + étape + prochaine action.
// Remplace l'ancienne mécanique de résultats d'appel : plus de cadence,
// c'est la date qui décide de tout.
// =====================================================================

export type SaveExchangeState = ActionState & {
  /** Étape avancée automatiquement par les faits, et son motif. */
  autoStatus?: ProspectStatus | null;
  autoReason?: string | null;
};

export async function saveExchangeAction(
  input: SaveExchangeInput
): Promise<SaveExchangeState> {
  const { supabase, userId } = await currentUserId();

  const result = await saveExchangeCore(supabase, userId, input);
  if (result.error) return { error: result.error };

  revalidateProspect(input.prospectId);
  return { autoStatus: result.autoStatus, autoReason: result.autoReason };
}

// =====================================================================
// Activités
// =====================================================================

export async function deleteActivityAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const prospectId = str(fd, "prospect_id");
  if (!id) return;

  await supabase.from("activities").delete().eq("id", id);
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
}

// =====================================================================
// Relances
// =====================================================================

export async function createTaskAction(fd: FormData) {
  const { supabase, userId } = await currentUserId();

  const due =
    dateInputToISO(str(fd, "due_local")) ??
    localInputToISO(str(fd, "due_at")) ??
    inDaysAt9(1);

  const assignee = str(fd, "assignee_id");

  const { error } = await supabase.from("tasks").insert({
    prospect_id: str(fd, "prospect_id"),
    title: str(fd, "title") ?? "Relance",
    details: str(fd, "details"),
    due_at: due,
    priority: Number(str(fd, "priority") ?? 2),
    assignee_id: assignee === "none" ? null : (assignee ?? userId),
    created_by: userId,
  });
  if (error) throw new Error(error.message);

  const prospectId = str(fd, "prospect_id");
  // Une relance « RDV avec … » posée à la main est un fait : l'étape peut
  // avancer vers « Rendez-vous ». applyAutoStatus respecte le verrou.
  if (prospectId) {
    await applyAutoStatus(supabase, prospectId);
    revalidatePath(`/prospects/${prospectId}`);
  }
  revalidatePath("/dashboard");
}

export async function completeTaskAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return;

  const done = str(fd, "done") === "1";
  await supabase
    .from("tasks")
    .update({ status: done ? "fait" : "a_faire" })
    .eq("id", id);

  const prospectId = str(fd, "prospect_id");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
}

/** Reprogramme une relance à une date précise (champ de date de TaskRow). */
export async function rescheduleTaskAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const due = dateInputToISO(str(fd, "due_local"));
  if (!id || !due) return;

  await supabase.from("tasks").update({ due_at: due }).eq("id", id);

  const prospectId = str(fd, "prospect_id");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
}

export async function deleteTaskAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return;

  await supabase.from("tasks").delete().eq("id", id);

  const prospectId = str(fd, "prospect_id");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
}

// =====================================================================
// Compte
// =====================================================================

export async function updateMyProfileAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const { supabase, userId } = await currentUserId();

  const { error } = await supabase
    .from("crm_users")
    .update({ full_name: str(fd, "full_name"), phone: str(fd, "phone") })
    .eq("id", userId);

  if (error) return { error: error.message };
  revalidatePath("/compte");
  return { success: "Profil mis à jour." };
}

export async function changeMyPasswordAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const { supabase, userId } = await currentUserId();

  const password = fd.get("password");
  const confirm = fd.get("confirm");

  if (typeof password !== "string" || password.length < 10) {
    return { error: "Le mot de passe doit contenir au moins 10 caractères." };
  }
  if (password !== confirm) {
    return { error: "Les deux mots de passe ne correspondent pas." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  await supabase.from("crm_users").update({ must_change_password: false }).eq("id", userId);

  revalidatePath("/compte");
  return { success: "Mot de passe modifié." };
}

// =====================================================================
// Administration de l'équipe (via edge function crm-admin)
// =====================================================================

async function callAdmin(payload: Record<string, unknown>): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return { error: "Session expirée, reconnectez-vous." };

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/crm-admin`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    }
  );

  let body: { error?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* réponse non JSON */
  }

  if (!res.ok) return { error: body.error ?? `Erreur ${res.status}` };
  return {};
}

export async function adminCreateUserAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const password = String(fd.get("password") ?? "");
  if (password.length < 10) {
    return { error: "Le mot de passe provisoire doit faire au moins 10 caractères." };
  }

  const result = await callAdmin({
    action: "create_user",
    email: str(fd, "email"),
    full_name: str(fd, "full_name"),
    role: str(fd, "role") ?? "commercial",
    password,
  });

  if (result.error) return result;
  revalidatePath("/equipe");
  return { success: `Compte créé. Mot de passe provisoire : ${password}` };
}

export async function adminUpdateUserAction(fd: FormData) {
  const action = String(fd.get("op") ?? "");
  const userId = str(fd, "user_id");
  if (!userId) return;

  if (action === "set_active") {
    await callAdmin({
      action: "set_active",
      user_id: userId,
      is_active: str(fd, "is_active") === "1",
    });
  } else if (action === "set_role") {
    await callAdmin({ action: "set_role", user_id: userId, role: str(fd, "role") });
  } else if (action === "delete_user") {
    await callAdmin({ action: "delete_user", user_id: userId });
  }

  revalidatePath("/equipe");
}

export async function adminResetPasswordAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const password = String(fd.get("password") ?? "");
  if (password.length < 10) {
    return { error: "Minimum 10 caractères." };
  }

  const result = await callAdmin({
    action: "set_password",
    user_id: str(fd, "user_id"),
    password,
  });

  if (result.error) return result;
  revalidatePath("/equipe");
  return { success: `Nouveau mot de passe : ${password}` };
}

// =====================================================================
// Vue en colonnes — glisser-déposer
// =====================================================================

/**
 * Glisser-déposer d'une colonne à l'autre : c'est une correction humaine,
 * au même titre que le sélecteur de la fiche. Elle verrouille l'étape.
 */
export async function moveProspectAction(id: string, status: ProspectStatus) {
  const { supabase } = await currentUserId();

  const { error } = await supabase
    .from("prospects")
    .update(manualStatusPatch(normalizeStatus(status)))
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidateProspect(id);
}

// =====================================================================
// Import CSV
// =====================================================================

export async function importProspectsAction(
  rows: ImportRow[],
  ownerId: string | null
): Promise<ImportResult> {
  const { supabase, userId } = await currentUserId();

  const result = await importProspectsCore(supabase, userId, rows, ownerId);

  if (result.inserted > 0) {
    revalidatePath("/prospects");
    revalidatePath("/dashboard");
  }
  return result;
}
