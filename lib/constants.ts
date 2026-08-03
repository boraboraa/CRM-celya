import type { ActivityType, EmailIntent, ProspectStatus } from "./types";

export const STATUS_ORDER: ProspectStatus[] = [
  "a_appeler",
  "contacte",
  "rendez_vous",
  "proposition",
  "gagne",
  "perdu",
];

export const STATUS_LABEL: Record<ProspectStatus, string> = {
  a_appeler: "À appeler",
  contacte: "Contacté",
  rendez_vous: "Rendez-vous",
  proposition: "Proposition",
  gagne: "Gagné",
  perdu: "Perdu",
};

/** Classes Tailwind statiques (pas d'interpolation : le JIT doit les voir). */
export const STATUS_CHIP: Record<ProspectStatus, string> = {
  a_appeler: "bg-slate-500/15 text-slate-300 ring-slate-400/25",
  contacte: "bg-cyan-500/15 text-cyan-300 ring-cyan-400/25",
  rendez_vous: "bg-blue-500/15 text-blue-300 ring-blue-400/25",
  proposition: "bg-indigo-500/15 text-indigo-300 ring-indigo-400/25",
  gagne: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/25",
  perdu: "bg-rose-500/15 text-rose-300 ring-rose-400/25",
};

export const STATUS_DOT: Record<ProspectStatus, string> = {
  a_appeler: "bg-slate-400",
  contacte: "bg-cyan-400",
  rendez_vous: "bg-blue-400",
  proposition: "bg-indigo-400",
  gagne: "bg-emerald-400",
  perdu: "bg-rose-400",
};

/**
 * Ramène n'importe quelle valeur de statut (y compris les anciennes, encore
 * possibles dans des données pas encore migrées) vers l'une des six étapes.
 * Garde-fou permanent : l'affichage ne casse jamais sur un statut inconnu.
 */
const LEGACY_STATUS: Record<string, ProspectStatus> = {
  sans_reponse: "contacte",
  contact_etabli: "contacte",
  rappel_programme: "contacte",
  rdv: "rendez_vous",
  nouveau: "a_appeler",
  qualifie: "rendez_vous",
  negociation: "proposition",
};

export function normalizeStatus(raw: string | null | undefined): ProspectStatus {
  if (!raw) return "a_appeler";
  if ((STATUS_ORDER as string[]).includes(raw)) return raw as ProspectStatus;
  return LEGACY_STATUS[raw] ?? "a_appeler";
}

// ---------------------------------------------------------------------------
// Tri des réponses email (boîte Zoho)
// ---------------------------------------------------------------------------

export const INTENT_LABEL: Record<EmailIntent, string> = {
  interesse: "Intéressé",
  demande_info: "Demande d'information",
  pas_interesse: "Pas intéressé",
  rappel_plus_tard: "Recontacter plus tard",
  absence: "Absence (réponse automatique)",
  hors_sujet: "Hors sujet",
};

// ---------------------------------------------------------------------------

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  note: "Note",
  email: "Email",
  rendez_vous: "Rendez-vous",
};

export const PRIORITY_LABEL: Record<number, string> = {
  1: "Haute",
  2: "Normale",
  3: "Basse",
};

export const SOURCES = [
  "Prospection",
  "Contact entrant",
  "Site web",
  "LinkedIn",
  "Recommandation",
  "Salon / événement",
  "Janette (agent IA)",
  "Autre",
];

const TZ = "Europe/Brussels";

export function fmtDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-BE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-BE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

export function fmtMoney(value?: number | null, currency = "EUR"): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("fr-BE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

/** « il y a 3 jours » / « dans 2 h » */
export function relative(value?: string | null): string {
  if (!value) return "—";
  const diff = new Date(value).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000000],
    ["month", 2592000000],
    ["day", 86400000],
    ["hour", 3600000],
    ["minute", 60000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") {
      return rtf.format(Math.round(diff / ms), unit);
    }
  }
  return "à l'instant";
}

export function initials(name?: string | null, fallback = "?"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || fallback;
}
