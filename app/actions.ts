"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
import { localInputToISO, dateInputToISO, inDaysAt9 } from "@/lib/time";
import { normalizeStatus, STATUS_ORDER } from "@/lib/constants";
import type { ActivityType, ProspectStatus } from "@/lib/types";

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
  revalidatePath("/dashboard");
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
      status: normalizeStatus(str(fd, "status")),
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
      status: normalizeStatus(str(fd, "status")),
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
  const status = str(fd, "status");
  if (!id || !status) return;

  await supabase
    .from("prospects")
    .update({ status: normalizeStatus(status) })
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

export type SaveExchangeInput = {
  prospectId: string;
  /** Type d'échange versé au journal : note, email, rendez_vous. */
  type: ActivityType;
  /** Texte libre de l'échange. */
  note?: string | null;
  /** Résumé court (proposé par l'assistant ou saisi), versé en sujet. */
  resume?: string | null;
  /** Nom de contact à mettre à jour sur la fiche (validé par l'humain). */
  contactName?: string | null;
  /** Nouvelle étape — null : inchangée. */
  statut?: ProspectStatus | null;
  /** Raison de la perte — utilisée quand statut = perdu. */
  motif?: string | null;
  /** Prochaine action : « YYYY-MM-DD » ou « YYYY-MM-DDTHH:mm » (Bruxelles).
   *  null : aucune relance créée ni re-datée. */
  dateLocale?: string | null;
};

export async function saveExchangeAction(
  input: SaveExchangeInput
): Promise<ActionState> {
  const { supabase, userId } = await currentUserId();

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
    .select("id")
    .eq("prospect_id", prospect.id)
    .eq("status", "a_faire")
    .order("due_at", { ascending: true });
  const openIds = (openTasks ?? []).map((t) => t.id);

  if (newStatus === "perdu") {
    if (openIds.length > 0) {
      await supabase.from("tasks").update({ status: "annule" }).in("id", openIds);
    }
  } else if (dueAt) {
    const effective = newStatus ?? normalizeStatus(prospect.status);
    const title =
      input.type === "rendez_vous" || effective === "rendez_vous"
        ? `RDV avec ${prospect.company_name}`
        : `Relancer ${prospect.company_name}`;

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
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
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

export async function moveProspectAction(id: string, status: ProspectStatus) {
  const { supabase } = await currentUserId();

  const { error } = await supabase
    .from("prospects")
    .update({ status: normalizeStatus(status) })
    .eq("id", id);
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
  contacte: "contacte",
  contacté: "contacte",
  contacted: "contacte",
  contact_etabli: "contacte",
  "contact établi": "contacte",
  "contact etabli": "contacte",
  sans_reponse: "contacte",
  "sans réponse": "contacte",
  "sans reponse": "contacte",
  rappel_programme: "contacte",
  "rappel programmé": "contacte",
  "rappel programme": "contacte",
  rendez_vous: "rendez_vous",
  "rendez-vous": "rendez_vous",
  "rendez vous": "rendez_vous",
  rdv: "rendez_vous",
  "rdv fixé": "rendez_vous",
  "rdv fixe": "rendez_vous",
  qualifie: "rendez_vous",
  qualifié: "rendez_vous",
  qualified: "rendez_vous",
  meeting: "rendez_vous",
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
  revalidatePath("/dashboard");

  return { inserted, skipped, reasons };
}
