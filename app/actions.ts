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
import {
  evaluateConfidenceCore,
  recalcConfidence,
  manualConfidencePatch,
  unlockConfidencePatch,
  isConfidenceLevel,
} from "@/lib/crm/confidence";
import { createProspectCore } from "@/lib/crm/prospects";
import { saveExchangeCore, type SaveExchangeInput } from "@/lib/crm/exchange";
import {
  poserRendezVous,
  deplacerRendezVous,
  cloturerRendezVous,
  type MeetingConflit,
} from "@/lib/crm/agenda";
import { getSession } from "@/lib/auth";
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

/**
 * Qui agit — sans aller-retour réseau. Les jetons de ce projet sont signés en
 * ES256 : `getClaims()` vérifie la signature en local (JWKS mis en cache pour
 * tout le processus) là où `getUser()` interrogeait Supabase Auth à chaque
 * action. La RLS reste l'unique garde-fou des données.
 */
async function currentUserId() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) redirect("/login");
  return { supabase, userId };
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

  // La probabilité n'est plus saisie : la colonne reste en base, intouchée —
  // c'est la confiance estimée par l'IA qui la remplace à l'écran.
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
    notes: str(fd, "notes"),
    lost_reason: str(fd, "lost_reason"),
  };

  // Le vivier est fermé (migration 016) : une fiche a toujours un propriétaire.
  // Un formulaire qui n'en envoie pas (ou l'ancienne valeur « none » d'un
  // onglet resté ouvert) ne DÉSASSIGNE pas la fiche — il laisse le
  // propriétaire en place. Désassigner rendrait la fiche invisible à son
  // commercial, et à lui seul : exactement le contraire du geste attendu.
  if (assign && assign !== "none") patch.owner_id = assign;

  // Changer l'étape depuis le formulaire est une décision humaine : elle
  // verrouille. La laisser telle quelle ne verrouille rien.
  const statusChanged =
    Boolean(before) && normalizeStatus(before!.status as string) !== status;
  if (statusChanged) {
    Object.assign(patch, manualStatusPatch(status));
  } else {
    patch.status = status;
  }

  const { error } = await supabase.from("prospects").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  // Un changement d'étape est un événement : la confiance se recalcule.
  if (statusChanged) await recalcConfidence(supabase, id);

  revalidateProspect(id);
}

/**
 * Fixer l'étape à la main — depuis la fiche. Verrouille : à partir de là,
 * l'auto-classification ne réécrit plus rien, elle peut seulement suggérer.
 */
export async function setProspectStatusAction(fd: FormData): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!id || !status) return { error: "Étape introuvable." };

  const { error } = await supabase
    .from("prospects")
    .update(manualStatusPatch(normalizeStatus(status)))
    .eq("id", id);
  if (error) return { error: error.message };

  await recalcConfidence(supabase, id);
  revalidateProspect(id);
  return {};
}

/**
 * Rendre la main à l'IA : l'étape redevient déductible des faits, et on la
 * ré-évalue tout de suite pour que l'effet soit visible immédiatement.
 */
export async function unlockProspectStatusAction(
  fd: FormData
): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return { error: "Prospect introuvable." };

  const { error } = await supabase
    .from("prospects")
    .update(unlockStatusPatch())
    .eq("id", id);
  if (error) return { error: error.message };

  await applyAutoStatus(supabase, id);
  await recalcConfidence(supabase, id);

  revalidateProspect(id);
  return {};
}

/**
 * Accepter la suggestion affichée sur une fiche verrouillée (« un RDV a été
 * posé — passer en Rendez-vous ? »). C'est un clic humain : la fiche reste
 * verrouillée sur ce nouveau choix.
 */
export async function acceptStatusSuggestionAction(
  fd: FormData
): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!id || !status) return { error: "Étape introuvable." };

  const { error } = await supabase
    .from("prospects")
    .update(manualStatusPatch(normalizeStatus(status)))
    .eq("id", id);
  if (error) return { error: error.message };

  await recalcConfidence(supabase, id);
  revalidateProspect(id);
  return {};
}

// =====================================================================
// Confiance (Chaud / Tiède / Froid) — suggestion IA, dernier mot humain.
// =====================================================================

/**
 * Corriger le niveau à la main. Comme pour l'étape, la correction VERROUILLE :
 * l'assistant ne réécrira plus la confiance par-dessus le choix de Bora.
 */
export async function setConfidenceAction(fd: FormData): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const level = str(fd, "level");
  if (!id || !isConfidenceLevel(level)) return {};

  const { error } = await supabase
    .from("prospects")
    .update(manualConfidencePatch(level))
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateProspect(id);
  return {};
}

/** Rendre la main à l'assistant : déverrouille et ré-estime tout de suite. */
export async function unlockConfidenceAction(fd: FormData): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return {};

  const { error } = await supabase
    .from("prospects")
    .update(unlockConfidencePatch())
    .eq("id", id);
  if (error) return { error: error.message };

  // Geste explicite : Bora attend le nouveau niveau tout de suite, on n'en
  // diffère pas le calcul (contrairement aux recalculs d'arrière-plan).
  try {
    await evaluateConfidenceCore(supabase, id);
  } catch {
    /* jamais bloquant */
  }
  revalidateProspect(id);
  return {};
}

/** Ré-estimation à la demande (bouton ✨ de la fiche). */
export async function evaluateConfidenceAction(
  fd: FormData
): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return {};

  const result = await evaluateConfidenceCore(supabase, id);
  revalidateProspect(id);

  if (result.outcome === "indisponible") {
    return {
      error:
        "Assistant indisponible — vérifiez la configuration du fournisseur IA.",
    };
  }
  if (result.outcome === "a_evaluer") {
    return {
      error:
        "Pas encore assez d'éléments pour estimer — consignez d'abord un échange.",
    };
  }
  return {};
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
  /** Rendez-vous posé qui chevauche un autre créneau — averti, jamais bloquant. */
  conflit?: MeetingConflit | null;
};

export async function saveExchangeAction(
  input: SaveExchangeInput
): Promise<SaveExchangeState> {
  const { supabase, userId } = await currentUserId();

  const result = await saveExchangeCore(supabase, userId, input);
  if (result.error) return { error: result.error };

  revalidateProspect(input.prospectId);
  // Un échange de type rendez-vous vient de créer un créneau dans l'agenda.
  if (input.type === "rendez_vous") revalidatePath("/agenda");
  return {
    autoStatus: result.autoStatus,
    autoReason: result.autoReason,
    conflit: result.conflit ?? null,
  };
}

// =====================================================================
// Activités
// =====================================================================

/**
 * Suppression d'une entrée du journal — réservée à l'admin.
 *
 * La RLS reste l'unique garde-fou de sécurité (un commercial n'atteint de
 * toute façon que ses fiches) ; ce contrôle-ci est la règle métier demandée :
 * l'historique d'un échange ne s'efface pas d'un doigt qui glisse. La
 * confirmation est exigée explicitement (`confirm=1`), et le composant
 * client la demande en deux temps.
 */
async function requireAdmin(): Promise<
  { supabase: Awaited<ReturnType<typeof createClient>>; userId: string } | null
> {
  const { supabase, userId } = await currentUserId();
  const { data: me } = await supabase
    .from("crm_users")
    .select("role, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!me || me.role !== "admin" || !me.is_active) return null;
  return { supabase, userId };
}

export async function deleteActivityAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Suppression réservée à l'administrateur." };

  const id = str(fd, "id");
  const prospectId = str(fd, "prospect_id");
  if (!id) return { error: "Entrée introuvable." };
  if (str(fd, "confirm") !== "1") return { error: "Confirmation requise." };

  const { error } = await admin.supabase.from("activities").delete().eq("id", id);
  if (error) return { error: error.message };

  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
  return { success: "Entrée supprimée." };
}

/**
 * Suppression d'un email du journal — même règle. Un message réellement
 * envoyé ou reçu reste une trace : le composant client prévient plus
 * fermement avant de laisser cliquer.
 */
export async function deleteEmailAction(fd: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Suppression réservée à l'administrateur." };

  const id = str(fd, "id");
  const prospectId = str(fd, "prospect_id");
  if (!id) return { error: "Message introuvable." };
  if (str(fd, "confirm") !== "1") return { error: "Confirmation requise." };

  const { error } = await admin.supabase.from("emails").delete().eq("id", id);
  if (error) return { error: error.message };

  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
  revalidatePath("/emails");
  return { success: "Message supprimé." };
}

// =====================================================================
// Relances
// =====================================================================

export async function createTaskAction(fd: FormData): Promise<ActionState> {
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
  if (error) return { error: error.message };

  const prospectId = str(fd, "prospect_id");
  // Un fait a pu apparaître (le rendez-vous, lui, vit dans l'agenda) :
  // applyAutoStatus confronte l'étape aux faits, et respecte le verrou.
  if (prospectId) {
    await applyAutoStatus(supabase, prospectId);
    await recalcConfidence(supabase, prospectId);
    revalidatePath(`/prospects/${prospectId}`);
  }
  revalidatePath("/dashboard");
  return { success: "Relance planifiée." };
}

/**
 * Les trois gestes sur une relance renvoient désormais leur issue au lieu de
 * la garder pour eux : l'écran bouge tout de suite (UI optimiste) et n'a le
 * droit de revenir en arrière que si le serveur a vraiment refusé.
 */
export async function completeTaskAction(fd: FormData): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return { error: "Relance introuvable." };

  const done = str(fd, "done") === "1";
  const { error } = await supabase
    .from("tasks")
    .update({ status: done ? "fait" : "a_faire" })
    .eq("id", id);
  if (error) return { error: error.message };

  const prospectId = str(fd, "prospect_id");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
  return {};
}

/** Reprogramme une relance à une date précise (champ de date de TaskRow). */
export async function rescheduleTaskAction(fd: FormData): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const due = dateInputToISO(str(fd, "due_local"));
  if (!id || !due) return { error: "Date invalide." };

  const { error } = await supabase.from("tasks").update({ due_at: due }).eq("id", id);
  if (error) return { error: error.message };

  const prospectId = str(fd, "prospect_id");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
  return {};
}

export async function deleteTaskAction(fd: FormData): Promise<ActionState> {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return { error: "Relance introuvable." };

  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) return { error: error.message };

  const prospectId = str(fd, "prospect_id");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
  return {};
}

// =====================================================================
// Agenda — les trois gestes du rendez-vous (lib/crm/agenda.ts)
// =====================================================================

export type RendezVousState = ActionState & {
  /** Chevauchement détecté — averti, jamais bloquant. */
  conflit?: MeetingConflit | null;
};

function revalidateAgenda(prospectId?: string | null) {
  revalidatePath("/agenda");
  revalidatePath("/dashboard");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
}

export async function poserRendezVousAction(input: {
  prospectId?: string | null;
  /** true : rendez-vous personnel, sans prospect. */
  personnel?: boolean;
  title?: string | null;
  /** « YYYY-MM-DDTHH:mm » (Bruxelles) — l'heure est obligatoire. */
  startsAt: string;
  dureeMin?: number | null;
  location?: string | null;
  notes?: string | null;
}): Promise<RendezVousState> {
  const { supabase, userId } = await currentUserId();

  const r = await poserRendezVous(supabase, userId, {
    prospectId: input.personnel ? null : input.prospectId,
    kind: input.personnel ? "perso" : "prospect",
    title: input.title,
    startsAt: input.startsAt,
    dureeMin: input.dureeMin,
    location: input.location,
    notes: input.notes,
  });
  if (r.error) return { error: r.error };

  revalidateAgenda(input.personnel ? null : input.prospectId);
  return { conflit: r.conflit ?? null };
}

export async function deplacerRendezVousAction(input: {
  id: string;
  startsAt: string;
  endsAt?: string | null;
  motif?: string | null;
}): Promise<RendezVousState> {
  const session = await getSession();
  if (!session) redirect("/login");
  const supabase = await createClient();

  // Le rôle est relu en base (getSession), jamais déclaré par le client. La
  // RLS scope de toute façon la lecture ; ce drapeau ne fait qu'autoriser
  // l'admin à déplacer un rendez-vous d'un membre depuis le mode équipe.
  const r = await deplacerRendezVous(supabase, session.userId, {
    ...input,
    isAdmin: session.me?.role === "admin",
  });
  if (r.error) return { error: r.error };

  revalidateAgenda(r.prospectId);
  return { conflit: r.conflit ?? null };
}

export async function cloturerRendezVousAction(input: {
  id: string;
  resultat: "honore" | "annule";
  compteRendu?: string | null;
}): Promise<ActionState> {
  const session = await getSession();
  if (!session) redirect("/login");
  const supabase = await createClient();

  const r = await cloturerRendezVous(supabase, session.userId, {
    ...input,
    isAdmin: session.me?.role === "admin",
  });
  if (r.error) return { error: r.error };

  revalidateAgenda(r.prospectId);
  return {};
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

  await recalcConfidence(supabase, id);

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
