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

/**
 * Une couleur franche par étape, la même partout où l'étape apparaît (badge,
 * bandeau de colonne, liseré de carte). Progression froid → chaud à mesure que
 * l'affaire avance — ardoise, cyan, bleu, ambre — puis le vert/rouge sémantique.
 * Classes Tailwind statiques (pas d'interpolation : le JIT doit les voir).
 */
export const STATUS_CHIP: Record<ProspectStatus, string> = {
  a_appeler: "bg-slate-500/15 text-slate-300 ring-slate-400/25",
  contacte: "bg-cyan-500/15 text-cyan-300 ring-cyan-400/25",
  rendez_vous: "bg-blue-500/15 text-blue-300 ring-blue-400/25",
  proposition: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  gagne: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/25",
  perdu: "bg-rose-500/15 text-rose-300 ring-rose-400/25",
};

export const STATUS_DOT: Record<ProspectStatus, string> = {
  a_appeler: "bg-slate-400",
  contacte: "bg-cyan-400",
  rendez_vous: "bg-blue-400",
  proposition: "bg-amber-400",
  gagne: "bg-emerald-400",
  perdu: "bg-rose-400",
};

/** Pictogramme d'étape — la couleur ne porte jamais seule (daltonisme). */
export const STATUS_ICON: Record<ProspectStatus, string> = {
  a_appeler: "☎",
  contacte: "✎",
  rendez_vous: "◆",
  proposition: "✉",
  gagne: "✓",
  perdu: "✕",
};

/** Liseré gauche des cartes du pipeline, dans la couleur de l'étape. */
export const STATUS_EDGE: Record<ProspectStatus, string> = {
  a_appeler: "border-l-slate-400/70",
  contacte: "border-l-cyan-400/80",
  rendez_vous: "border-l-blue-400/80",
  proposition: "border-l-amber-400/80",
  gagne: "border-l-emerald-400/80",
  perdu: "border-l-rose-400/70",
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

// ---------------------------------------------------------------------------
// Probabilité de conclure & valeur pondérée
// ---------------------------------------------------------------------------

/** Raccourcis de saisie — la saisie libre reste possible (0 à 100). */
export const PROBABILITY_PRESETS = [10, 25, 50, 75, 90] as const;

/**
 * Valeur pondérée = valeur estimée × probabilité (4 000 € à 50 % = 2 000 €).
 * C'est l'indicateur de priorisation. Sans probabilité renseignée, il n'y a
 * pas de valeur pondérée : le CRM n'invente pas un pressentiment.
 *
 * Miroir exact de la colonne générée `prospects.weighted_value` — utilisée
 * pour l'aperçu en direct des formulaires, la base restant la référence.
 */
export function weightedValue(
  value?: number | null,
  probability?: number | null
): number | null {
  if (value === null || value === undefined) return null;
  if (probability === null || probability === undefined) return null;
  if (!Number.isFinite(value) || !Number.isFinite(probability)) return null;
  return Math.round(value * probability) / 100;
}

export function fmtProbability(probability?: number | null): string {
  return probability === null || probability === undefined ? "—" : `${probability} %`;
}

/**
 * La « chaleur » d'une affaire, lue d'un coup d'œil : froid (bleu/ardoise)
 * en dessous de 40 %, ambre autour de 50 %, orange puis rouge au-delà.
 * Classes complètes, jamais interpolées (règle JIT).
 */
const HEAT = {
  froid: { bar: "bg-sky-400", text: "text-sky-300" },
  tiede: { bar: "bg-amber-400", text: "text-amber-300" },
  chaud: { bar: "bg-orange-400", text: "text-orange-300" },
  brulant: { bar: "bg-red-400", text: "text-red-300" },
} as const;

export function probabilityHeat(probability: number): {
  bar: string;
  text: string;
} {
  if (probability >= 85) return HEAT.brulant;
  if (probability >= 65) return HEAT.chaud;
  if (probability >= 40) return HEAT.tiede;
  return HEAT.froid;
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
