/**
 * Cœur « prospects » — indépendant des cookies et de Next. C'est l'unique
 * chemin d'insertion d'un prospect : le formulaire (app/actions.ts) comme le
 * connecteur MCP passent par ici. Un prospect créé par le connecteur est donc
 * indiscernable d'un prospect créé à la main.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeStatus } from "@/lib/constants";
import { findDuplicates, normalizeBelgianPhone, type DuplicateHit } from "./dedup";
import { ADRESSE_MAX } from "./maps";
import type { Viewer } from "./access";

export type NewProspectInput = {
  company_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  sector?: string | null;
  /** Adresse libre OU lien Google Maps collé — stockée telle quelle. */
  address?: string | null;
  city?: string | null;
  status?: string | null;
  source?: string | null;
  value_estimate?: number | null;
  /** Probabilité de conclure en % (0–100). null = non renseignée. */
  probability?: number | null;
  /** « none » → vivier non assigné · absent/null → assigné à l'auteur. */
  owner_id?: string | null;
  notes?: string | null;
};

/** Ramène une probabilité à un entier 0–100, ou null. */
export function cleanProbability(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export type CreateProspectResult = {
  error?: string;
  /** Renseigné si la création a abouti. */
  id?: string;
  /**
   * Renseigné (sans insertion) quand la dédup a détecté des fiches proches et
   * que `force` n'est pas demandé : on prévient, on ne crée pas en double.
   */
  duplicates?: DuplicateHit[];
};

const trimOrNull = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
};

/**
 * Insère un prospect.
 *  - `checkDuplicates` : compare aux fiches existantes (téléphone / email /
 *    société) et, si `force` est faux, renvoie les doublons sans créer.
 *  - `normalizePhone` : applique la normalisation « +32 » déterministe (le
 *    connecteur MCP l'active ; le formulaire conserve la saisie telle quelle).
 */
export async function createProspectCore(
  supabase: SupabaseClient,
  userId: string,
  input: NewProspectInput,
  opts: {
    checkDuplicates?: boolean;
    normalizePhone?: boolean;
    force?: boolean;
    /** Renseigné par le connecteur MCP seul : il agit en service_role, donc
     *  la dédup doit être bornée à son portefeuille à la main. Voir access.ts. */
    scope?: Viewer | null;
  } = {}
): Promise<CreateProspectResult> {
  const rawPhone = trimOrNull(input.phone);
  const phone = opts.normalizePhone ? normalizeBelgianPhone(rawPhone) : rawPhone;
  const company = trimOrNull(input.company_name) ?? "Sans nom";
  const email = trimOrNull(input.email)?.toLowerCase() ?? null;

  if (opts.checkDuplicates && !opts.force) {
    const duplicates = await findDuplicates(
      supabase,
      { company_name: company, phone, email },
      opts.scope
    );
    if (duplicates.length > 0) return { duplicates };
  }

  const owner = input.owner_id;
  const { data, error } = await supabase
    .from("prospects")
    .insert({
      company_name: company,
      contact_name: trimOrNull(input.contact_name, 120),
      email,
      phone,
      website: trimOrNull(input.website),
      sector: trimOrNull(input.sector, 80),
      address: trimOrNull(input.address, ADRESSE_MAX),
      city: trimOrNull(input.city, 80),
      status: normalizeStatus(trimOrNull(input.status)),
      source: trimOrNull(input.source),
      value_estimate:
        typeof input.value_estimate === "number" && Number.isFinite(input.value_estimate)
          ? input.value_estimate
          : null,
      probability: cleanProbability(input.probability),
      // Vivier fermé : « none » ne vaut plus « personne » mais « moi ». Le
      // trigger en base rattraperait un null de toute façon (migration 015),
      // mais mieux vaut que le propriétaire soit posé ici, sciemment.
      owner_id: owner === "none" ? userId : (trimOrNull(owner) ?? userId),
      notes: trimOrNull(input.notes, 4000),
      created_by: userId,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: data.id as string };
}

// ---------------------------------------------------------------------------
// Import en lot — dédup ligne par ligne (email), insertion par paquets.
// ---------------------------------------------------------------------------

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
  /** Nombre de fiches qui *seraient* créées — renseigné en simulation. */
  pending?: number;
  error?: string;
};

import type { ProspectStatus } from "@/lib/types";

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

/**
 * Import en lot. `dryRun` calcule le résumé (créés / doublons ignorés /
 * erreurs) sans rien écrire — le connecteur MCP l'utilise pour proposer avant
 * d'agir. Ne s'arrête jamais au premier problème de ligne : les lignes fautives
 * sont comptées et expliquées, les bonnes sont insérées.
 */
export async function importProspectsCore(
  supabase: SupabaseClient,
  userId: string,
  rows: ImportRow[],
  ownerId: string | null,
  opts: { dryRun?: boolean } = {}
): Promise<ImportResult> {
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
      // Idem : un import appartient à quelqu'un. « none »/null retombent sur
      // l'auteur de l'import plutôt que dans un vivier qui n'existe plus.
      owner_id: ownerId === "none" || ownerId === null ? userId : ownerId,
      created_by: userId,
    });
  });

  // Simulation : on renvoie ce qui serait fait, sans écrire.
  if (opts.dryRun) {
    return { inserted: 0, skipped, reasons, pending: payload.length };
  }

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

  return { inserted, skipped, reasons };
}
