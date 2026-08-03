"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
import { localInputToISO, inDaysAt9, slotOfISO } from "@/lib/time";
import { CALL_OUTCOMES } from "@/lib/constants";
import type { ActivityType, CallOutcome, ProspectStatus } from "@/lib/types";

export type ActionState = { error?: string; success?: string };

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
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/taches");
}

// =====================================================================
// Prospects
// =====================================================================

export async function createProspectAction(fd: FormData) {
  const { supabase, userId } = await currentUserId();

  const assign = str(fd, "owner_id");
  const { data, error } = await supabase
    .from("prospects")
    .insert({
      company_name: str(fd, "company_name") ?? "Sans nom",
      contact_name: str(fd, "contact_name"),
      email: str(fd, "email")?.toLowerCase() ?? null,
      phone: str(fd, "phone"),
      website: str(fd, "website"),
      sector: str(fd, "sector"),
      city: str(fd, "city"),
      status: (str(fd, "status") as ProspectStatus) ?? "a_appeler",
      source: str(fd, "source"),
      value_estimate: num(fd, "value_estimate"),
      owner_id: assign === "none" ? null : (assign ?? userId),
      notes: str(fd, "notes"),
      created_by: userId,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/prospects");
  revalidatePath("/pipeline");
  redirect(`/prospects/${data.id}`);
}

export async function updateProspectAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) throw new Error("Prospect introuvable");

  const assign = str(fd, "owner_id");
  const { error } = await supabase
    .from("prospects")
    .update({
      company_name: str(fd, "company_name") ?? "Sans nom",
      contact_name: str(fd, "contact_name"),
      email: str(fd, "email")?.toLowerCase() ?? null,
      phone: str(fd, "phone"),
      website: str(fd, "website"),
      sector: str(fd, "sector"),
      city: str(fd, "city"),
      status: (str(fd, "status") as ProspectStatus) ?? "a_appeler",
      source: str(fd, "source"),
      value_estimate: num(fd, "value_estimate"),
      owner_id: assign === "none" ? null : assign,
      notes: str(fd, "notes"),
      lost_reason: str(fd, "lost_reason"),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidateProspect(id);
}

export async function setProspectStatusAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const status = str(fd, "status") as ProspectStatus | null;
  if (!id || !status) return;

  await supabase.from("prospects").update({ status }).eq("id", id);

  revalidateProspect(id);
}

export async function deleteProspectAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return;

  const { error } = await supabase.from("prospects").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/prospects");
  revalidatePath("/pipeline");
  redirect("/prospects");
}

// =====================================================================
// Résultat d'appel → cadence de rappel (le cœur du poste d'appels)
// =====================================================================

export type PlanifierRappelInput = {
  prospectId: string;
  resultat: CallOutcome;
  /** Note d'appel libre, versée au journal. */
  note?: string | null;
  /** « YYYY-MM-DDTHH:mm » heure de Bruxelles — requis pour rappeler_plus_tard
   *  et rdv_fixe. */
  dateLocale?: string | null;
  /** Remplace le délai par défaut du résultat (en jours). */
  delaiJours?: number | null;
  /** Motif de perte — requis pour refus. */
  motif?: string | null;
};

/**
 * Enregistre le résultat d'un appel : statut, compteur de tentatives,
 * journal d'activité, et tâche de rappel (jamais de doublon si une tâche
 * ouverte existe déjà — elle est re-datée).
 */
export async function planifierRappelAction(
  input: PlanifierRappelInput
): Promise<ActionState> {
  const config = CALL_OUTCOMES[input.resultat];
  if (!config) return { error: "Résultat d'appel inconnu." };

  const { supabase, userId } = await currentUserId();

  const { data: prospect } = await supabase
    .from("prospects")
    .select("id, company_name, call_attempts")
    .eq("id", input.prospectId)
    .maybeSingle();
  if (!prospect) return { error: "Prospect introuvable." };

  // Échéance du rappel
  let dueAt: string | null = null;
  if (config.needsDate) {
    dueAt = localInputToISO(input.dateLocale ?? null);
    if (!dueAt) return { error: "Choisissez une date." };
  } else if (config.delayDays !== null) {
    const days = input.delaiJours ?? config.delayDays;
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      return { error: "Délai de rappel invalide." };
    }
    dueAt = inDaysAt9(days);
  }

  const lostReason =
    input.resultat === "mauvais_numero"
      ? "Numéro invalide"
      : input.resultat === "refus"
        ? (input.motif?.trim() || "Refus")
        : null;

  const now = new Date().toISOString();

  const { error: upErr } = await supabase
    .from("prospects")
    .update({
      status: config.nextStatus,
      call_attempts: prospect.call_attempts + 1,
      last_outcome: input.resultat,
      last_call_slot: slotOfISO(now),
      ...(lostReason ? { lost_reason: lostReason } : {}),
    })
    .eq("id", prospect.id);
  if (upErr) return { error: upErr.message };

  // Journal — met aussi à jour last_contact_at via trigger.
  await supabase.from("activities").insert({
    prospect_id: prospect.id,
    author_id: userId,
    type: "appel",
    subject: null,
    body: input.note?.trim() || null,
    outcome: config.label,
    duration_min: null,
    occurred_at: now,
  });

  // Tâche de rappel — on réutilise la tâche ouverte s'il y en a une.
  const { data: openTasks } = await supabase
    .from("tasks")
    .select("id")
    .eq("prospect_id", prospect.id)
    .eq("status", "a_faire")
    .order("due_at", { ascending: true });

  const openIds = (openTasks ?? []).map((t) => t.id);

  if (config.nextStatus === "perdu") {
    if (openIds.length > 0) {
      await supabase.from("tasks").update({ status: "annule" }).in("id", openIds);
    }
  } else if (dueAt) {
    const title = taskTitleFor(input.resultat, prospect.company_name);
    if (openIds.length > 0) {
      await supabase
        .from("tasks")
        .update({ title, due_at: dueAt, assignee_id: userId })
        .eq("id", openIds[0]);
      if (openIds.length > 1) {
        await supabase
          .from("tasks")
          .update({ status: "annule" })
          .in("id", openIds.slice(1));
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
  }

  revalidateProspect(prospect.id);
  return {};
}

function taskTitleFor(outcome: CallOutcome, company: string): string {
  switch (outcome) {
    case "rdv_fixe":
      return `RDV avec ${company}`;
    case "interesse":
      return `Relancer ${company} — intéressé`;
    case "rappeler_plus_tard":
      return `Rappeler ${company} (à sa demande)`;
    default:
      return `Rappeler ${company}`;
  }
}

/**
 * Archivage proposé après MAX_CALL_ATTEMPTS tentatives sans réponse.
 * Toujours déclenché par un clic humain — jamais automatique.
 */
export async function archiverProspectAction(input: {
  prospectId: string;
  motif?: string | null;
}): Promise<ActionState> {
  const { supabase, userId } = await currentUserId();

  const { data: prospect } = await supabase
    .from("prospects")
    .select("id, call_attempts")
    .eq("id", input.prospectId)
    .maybeSingle();
  if (!prospect) return { error: "Prospect introuvable." };

  const motif =
    input.motif?.trim() ||
    `Injoignable après ${prospect.call_attempts} tentatives`;

  const { error } = await supabase
    .from("prospects")
    .update({ status: "perdu", lost_reason: motif })
    .eq("id", prospect.id);
  if (error) return { error: error.message };

  await supabase.from("activities").insert({
    prospect_id: prospect.id,
    author_id: userId,
    type: "note",
    subject: null,
    body: `Archivé : ${motif}`,
    outcome: null,
    duration_min: null,
    occurred_at: new Date().toISOString(),
  });

  const { data: openTasks } = await supabase
    .from("tasks")
    .select("id")
    .eq("prospect_id", prospect.id)
    .eq("status", "a_faire");
  const openIds = (openTasks ?? []).map((t) => t.id);
  if (openIds.length > 0) {
    await supabase.from("tasks").update({ status: "annule" }).in("id", openIds);
  }

  revalidateProspect(prospect.id);
  return {};
}

// =====================================================================
// Activités (notes, emails, réunions…)
// =====================================================================

export async function addActivityAction(fd: FormData) {
  const { supabase, userId } = await currentUserId();
  const prospectId = str(fd, "prospect_id");
  if (!prospectId) throw new Error("Prospect introuvable");

  const occurred = localInputToISO(str(fd, "occurred_at")) ?? new Date().toISOString();

  const { error } = await supabase.from("activities").insert({
    prospect_id: prospectId,
    author_id: userId,
    type: (str(fd, "type") as ActivityType) ?? "note",
    subject: str(fd, "subject"),
    body: str(fd, "body"),
    outcome: str(fd, "outcome"),
    duration_min: num(fd, "duration_min"),
    occurred_at: occurred,
  });
  if (error) throw new Error(error.message);

  // Relance planifiée dans la foulée de la note ?
  const followUp = str(fd, "follow_up_days");
  if (followUp && followUp !== "none") {
    await supabase.from("tasks").insert({
      prospect_id: prospectId,
      title: str(fd, "follow_up_title") ?? "Relancer le prospect",
      due_at: inDaysAt9(Number(followUp)),
      assignee_id: userId,
      created_by: userId,
      priority: 2,
    });
  }

  revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/dashboard");
  revalidatePath("/taches");
}

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

  const dueRaw = str(fd, "due_at");
  const dueDays = str(fd, "due_days");
  const due =
    dueDays && dueDays !== "custom"
      ? inDaysAt9(Number(dueDays))
      : (localInputToISO(dueRaw) ?? inDaysAt9(1));

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
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/taches");
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
  revalidatePath("/taches");
  revalidatePath("/dashboard");
}

export async function snoozeTaskAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const days = Number(str(fd, "days") ?? 1);
  if (!id) return;

  await supabase.from("tasks").update({ due_at: inDaysAt9(days) }).eq("id", id);

  const prospectId = str(fd, "prospect_id");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/taches");
  revalidatePath("/dashboard");
}

export async function deleteTaskAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return;

  await supabase.from("tasks").delete().eq("id", id);

  const prospectId = str(fd, "prospect_id");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
  revalidatePath("/taches");
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
// Pipeline — glisser-déposer
// =====================================================================

export async function moveProspectAction(id: string, status: ProspectStatus) {
  const { supabase } = await currentUserId();

  const { error } = await supabase.from("prospects").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);

  revalidateProspect(id);
}

// =====================================================================
// Import CSV
// =====================================================================

export type ImportRow = Partial<
  Record<
    | "company_name"
    | "contact_name"
    | "email"
    | "phone"
    | "website"
    | "sector"
    | "city"
    | "status"
    | "source"
    | "value_estimate"
    | "notes",
    string
  >
>;

export type ImportResult = {
  inserted: number;
  skipped: number;
  reasons: string[];
  error?: string;
};

const STATUS_ALIASES: Record<string, ProspectStatus> = {
  a_appeler: "a_appeler",
  "à appeler": "a_appeler",
  "a appeler": "a_appeler",
  nouveau: "a_appeler",
  new: "a_appeler",
  sans_reponse: "sans_reponse",
  "sans réponse": "sans_reponse",
  "sans reponse": "sans_reponse",
  contact_etabli: "contact_etabli",
  "contact établi": "contact_etabli",
  "contact etabli": "contact_etabli",
  contacte: "contact_etabli",
  contacté: "contact_etabli",
  contacted: "contact_etabli",
  rappel_programme: "rappel_programme",
  "rappel programmé": "rappel_programme",
  "rappel programme": "rappel_programme",
  rdv: "rdv",
  "rdv fixé": "rdv",
  "rdv fixe": "rdv",
  qualifie: "rdv",
  qualifié: "rdv",
  qualified: "rdv",
  proposition: "proposition",
  devis: "proposition",
  proposal: "proposition",
  negociation: "proposition",
  négociation: "proposition",
  negotiation: "proposition",
  gagne: "gagne",
  gagné: "gagne",
  won: "gagne",
  client: "gagne",
  perdu: "perdu",
  lost: "perdu",
};

function toStatus(raw?: string): ProspectStatus {
  if (!raw) return "a_appeler";
  return STATUS_ALIASES[raw.trim().toLowerCase()] ?? "a_appeler";
}

function toNumber(raw?: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\s/g, "");
  if (!cleaned) return null;
  // « 4.800,50 » (format FR) vs « 4,800.50 » (format EN)
  const normalised =
    cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

const clean = (v?: string): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

export async function importProspectsAction(
  rows: ImportRow[],
  ownerId: string | null
): Promise<ImportResult> {
  const { supabase, userId } = await currentUserId();

  if (!Array.isArray(rows) || rows.length === 0) {
    return { inserted: 0, skipped: 0, reasons: [], error: "Aucune ligne à importer." };
  }
  if (rows.length > 2000) {
    return {
      inserted: 0,
      skipped: 0,
      reasons: [],
      error: "Maximum 2000 lignes par import. Découpez votre fichier.",
    };
  }

  // Doublons : on compare aux emails déjà présents et à ceux du fichier lui-même.
  const { data: existing } = await supabase
    .from("prospects")
    .select("email")
    .not("email", "is", null);

  const seen = new Set(
    (existing ?? [])
      .map((c) => (c.email as string | null)?.toLowerCase())
      .filter(Boolean) as string[]
  );

  const reasons: string[] = [];
  let skipped = 0;
  const payload: Record<string, unknown>[] = [];

  rows.forEach((row, index) => {
    const ligne = index + 2; // +1 en-tête, +1 pour compter à partir de 1
    const company = clean(row.company_name);

    if (!company) {
      skipped++;
      if (reasons.length < 12) reasons.push(`Ligne ${ligne} : société manquante`);
      return;
    }

    const email = clean(row.email)?.toLowerCase() ?? null;
    if (email && seen.has(email)) {
      skipped++;
      if (reasons.length < 12) reasons.push(`Ligne ${ligne} : ${email} existe déjà`);
      return;
    }
    if (email) seen.add(email);

    payload.push({
      company_name: company,
      contact_name: clean(row.contact_name),
      email,
      phone: clean(row.phone),
      website: clean(row.website),
      sector: clean(row.sector),
      city: clean(row.city),
      status: toStatus(row.status),
      source: clean(row.source) ?? "Import CSV",
      value_estimate: toNumber(row.value_estimate),
      notes: clean(row.notes),
      owner_id: ownerId === "none" || ownerId === null ? null : ownerId,
      created_by: userId,
    });
  });

  let inserted = 0;
  for (let i = 0; i < payload.length; i += 200) {
    const chunk = payload.slice(i, i + 200);
    const { error, count } = await supabase
      .from("prospects")
      .insert(chunk, { count: "exact" });

    if (error) {
      return {
        inserted,
        skipped,
        reasons,
        error: `Import interrompu après ${inserted} fiche(s) : ${error.message}`,
      };
    }
    inserted += count ?? chunk.length;
  }

  revalidatePath("/prospects");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");

  return { inserted, skipped, reasons };
}
