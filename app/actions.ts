"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
import { localInputToISO, inDaysAt9 } from "@/lib/time";
import type { ActivityType, ClientStatus } from "@/lib/types";

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

// =====================================================================
// Clients
// =====================================================================

export async function createClientAction(fd: FormData) {
  const { supabase, userId } = await currentUserId();

  const assign = str(fd, "owner_id");
  const { data, error } = await supabase
    .from("clients")
    .insert({
      company_name: str(fd, "company_name") ?? "Sans nom",
      contact_name: str(fd, "contact_name"),
      email: str(fd, "email")?.toLowerCase() ?? null,
      phone: str(fd, "phone"),
      website: str(fd, "website"),
      sector: str(fd, "sector"),
      city: str(fd, "city"),
      status: (str(fd, "status") as ClientStatus) ?? "nouveau",
      source: str(fd, "source"),
      value_estimate: num(fd, "value_estimate"),
      owner_id: assign === "none" ? null : (assign ?? userId),
      notes: str(fd, "notes"),
      created_by: userId,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/clients");
  revalidatePath("/pipeline");
  redirect(`/clients/${data.id}`);
}

export async function updateClientAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) throw new Error("Client introuvable");

  const assign = str(fd, "owner_id");
  const { error } = await supabase
    .from("clients")
    .update({
      company_name: str(fd, "company_name") ?? "Sans nom",
      contact_name: str(fd, "contact_name"),
      email: str(fd, "email")?.toLowerCase() ?? null,
      phone: str(fd, "phone"),
      website: str(fd, "website"),
      sector: str(fd, "sector"),
      city: str(fd, "city"),
      status: (str(fd, "status") as ClientStatus) ?? "nouveau",
      source: str(fd, "source"),
      value_estimate: num(fd, "value_estimate"),
      owner_id: assign === "none" ? null : assign,
      notes: str(fd, "notes"),
      lost_reason: str(fd, "lost_reason"),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  revalidatePath("/pipeline");
}

export async function setClientStatusAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const status = str(fd, "status") as ClientStatus | null;
  if (!id || !status) return;

  await supabase.from("clients").update({ status }).eq("id", id);

  revalidatePath(`/clients/${id}`);
  revalidatePath("/clients");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
}

export async function deleteClientAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return;

  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/clients");
  revalidatePath("/pipeline");
  redirect("/clients");
}

// =====================================================================
// Activités (notes d'appel, emails, réunions…)
// =====================================================================

export async function addActivityAction(fd: FormData) {
  const { supabase, userId } = await currentUserId();
  const clientId = str(fd, "client_id");
  if (!clientId) throw new Error("Client introuvable");

  const occurred = localInputToISO(str(fd, "occurred_at")) ?? new Date().toISOString();

  const { error } = await supabase.from("activities").insert({
    client_id: clientId,
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
      client_id: clientId,
      title: str(fd, "follow_up_title") ?? "Relancer le client",
      due_at: inDaysAt9(Number(followUp)),
      assignee_id: userId,
      created_by: userId,
      priority: 2,
    });
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  revalidatePath("/taches");
}

export async function deleteActivityAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const clientId = str(fd, "client_id");
  if (!id) return;

  await supabase.from("activities").delete().eq("id", id);
  if (clientId) revalidatePath(`/clients/${clientId}`);
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
    client_id: str(fd, "client_id"),
    title: str(fd, "title") ?? "Relance",
    details: str(fd, "details"),
    due_at: due,
    priority: Number(str(fd, "priority") ?? 2),
    assignee_id: assignee === "none" ? null : (assignee ?? userId),
    created_by: userId,
  });
  if (error) throw new Error(error.message);

  const clientId = str(fd, "client_id");
  if (clientId) revalidatePath(`/clients/${clientId}`);
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

  const clientId = str(fd, "client_id");
  if (clientId) revalidatePath(`/clients/${clientId}`);
  revalidatePath("/taches");
  revalidatePath("/dashboard");
}

export async function snoozeTaskAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  const days = Number(str(fd, "days") ?? 1);
  if (!id) return;

  await supabase.from("tasks").update({ due_at: inDaysAt9(days) }).eq("id", id);

  const clientId = str(fd, "client_id");
  if (clientId) revalidatePath(`/clients/${clientId}`);
  revalidatePath("/taches");
  revalidatePath("/dashboard");
}

export async function deleteTaskAction(fd: FormData) {
  const { supabase } = await currentUserId();
  const id = str(fd, "id");
  if (!id) return;

  await supabase.from("tasks").delete().eq("id", id);

  const clientId = str(fd, "client_id");
  if (clientId) revalidatePath(`/clients/${clientId}`);
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

export async function moveClientAction(id: string, status: ClientStatus) {
  const { supabase } = await currentUserId();

  const { error } = await supabase.from("clients").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/pipeline");
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  revalidatePath("/dashboard");
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

const STATUS_ALIASES: Record<string, ClientStatus> = {
  nouveau: "nouveau",
  new: "nouveau",
  contacte: "contacte",
  contacté: "contacte",
  contacted: "contacte",
  qualifie: "qualifie",
  qualifié: "qualifie",
  qualified: "qualifie",
  proposition: "proposition",
  devis: "proposition",
  proposal: "proposition",
  negociation: "negociation",
  négociation: "negociation",
  negotiation: "negociation",
  gagne: "gagne",
  gagné: "gagne",
  won: "gagne",
  client: "gagne",
  perdu: "perdu",
  lost: "perdu",
};

function toStatus(raw?: string): ClientStatus {
  if (!raw) return "nouveau";
  return STATUS_ALIASES[raw.trim().toLowerCase()] ?? "nouveau";
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

export async function importClientsAction(
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
    .from("clients")
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
      .from("clients")
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

  revalidatePath("/clients");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");

  return { inserted, skipped, reasons };
}
