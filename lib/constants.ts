import type {
  ActivityType,
  CallOutcome,
  CallSlot,
  EmailIntent,
  ProspectStatus,
} from "./types";

export const STATUS_ORDER: ProspectStatus[] = [
  "a_appeler",
  "sans_reponse",
  "contact_etabli",
  "rappel_programme",
  "rdv",
  "proposition",
  "gagne",
  "perdu",
];

export const STATUS_LABEL: Record<ProspectStatus, string> = {
  a_appeler: "À appeler",
  sans_reponse: "Sans réponse",
  contact_etabli: "Contact établi",
  rappel_programme: "Rappel programmé",
  rdv: "RDV fixé",
  proposition: "Proposition",
  gagne: "Gagné",
  perdu: "Perdu",
};

/** Classes Tailwind statiques (pas d'interpolation : le JIT doit les voir). */
export const STATUS_CHIP: Record<ProspectStatus, string> = {
  a_appeler: "bg-slate-500/15 text-slate-300 ring-slate-400/25",
  sans_reponse: "bg-amber-500/15 text-amber-300 ring-amber-400/25",
  contact_etabli: "bg-cyan-500/15 text-cyan-300 ring-cyan-400/25",
  rappel_programme: "bg-violet-500/15 text-violet-300 ring-violet-400/25",
  rdv: "bg-blue-500/15 text-blue-300 ring-blue-400/25",
  proposition: "bg-indigo-500/15 text-indigo-300 ring-indigo-400/25",
  gagne: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/25",
  perdu: "bg-rose-500/15 text-rose-300 ring-rose-400/25",
};

export const STATUS_DOT: Record<ProspectStatus, string> = {
  a_appeler: "bg-slate-400",
  sans_reponse: "bg-amber-400",
  contact_etabli: "bg-cyan-400",
  rappel_programme: "bg-violet-400",
  rdv: "bg-blue-400",
  proposition: "bg-indigo-400",
  gagne: "bg-emerald-400",
  perdu: "bg-rose-400",
};

// ---------------------------------------------------------------------------
// Résultats d'appel et cadence de rappel
// ---------------------------------------------------------------------------

export type CallOutcomeConfig = {
  label: string;
  /** Délai de rappel par défaut en jours — modifiable à la main au moment de
   *  l'enregistrement. null : pas de délai par défaut (date à choisir, ou perdu). */
  delayDays: number | null;
  nextStatus: ProspectStatus;
  /** Demande une date au lieu d'un délai (rappel à sa demande, RDV). */
  needsDate?: boolean;
  /** Demande un motif (refus). */
  needsReason?: boolean;
};

export const CALL_OUTCOMES: Record<CallOutcome, CallOutcomeConfig> = {
  pas_repondu: { label: "Pas répondu", delayDays: 2, nextStatus: "sans_reponse" },
  repondeur: { label: "Répondeur", delayDays: 3, nextStatus: "sans_reponse" },
  barrage_secretaire: {
    label: "Barrage secrétaire",
    delayDays: 4,
    nextStatus: "sans_reponse",
  },
  mauvais_numero: {
    label: "Mauvais numéro",
    delayDays: null,
    nextStatus: "perdu",
  },
  refus: { label: "Refus", delayDays: null, nextStatus: "perdu", needsReason: true },
  rappeler_plus_tard: {
    label: "Rappeler plus tard",
    delayDays: null,
    nextStatus: "rappel_programme",
    needsDate: true,
  },
  interesse: { label: "Intéressé", delayDays: 2, nextStatus: "contact_etabli" },
  rdv_fixe: { label: "RDV fixé", delayDays: null, nextStatus: "rdv", needsDate: true },
};

export const CALL_OUTCOME_ORDER: CallOutcome[] = [
  "pas_repondu",
  "repondeur",
  "barrage_secretaire",
  "interesse",
  "rappeler_plus_tard",
  "rdv_fixe",
  "refus",
  "mauvais_numero",
];

/** Au-delà de ce nombre d'appels sans réponse, on propose l'archivage
 *  (jamais de bascule automatique en Perdu : décision humaine). */
export const MAX_CALL_ATTEMPTS = 6;

export const CALL_SLOT_LABEL: Record<CallSlot, string> = {
  matin: "le matin",
  midi: "sur le temps de midi",
  apres_midi: "l'après-midi",
  fin_journee: "en fin de journée",
};

/** Créneau à proposer quand les 3 dernières tentatives ont eu lieu dans le
 *  même créneau — on ne joint jamais personne en appelant à la même heure. */
export const OTHER_SLOT: Record<CallSlot, CallSlot> = {
  matin: "fin_journee",
  midi: "matin",
  apres_midi: "matin",
  fin_journee: "midi",
};

// ---------------------------------------------------------------------------
// Tri des réponses email (phase Zoho)
// ---------------------------------------------------------------------------

export const INTENT_LABEL: Record<EmailIntent, string> = {
  interesse: "Intéressé",
  demande_info: "Demande d'information",
  pas_interesse: "Pas intéressé",
  rappel_plus_tard: "Rappeler plus tard",
  absence: "Absence (réponse automatique)",
  hors_sujet: "Hors sujet",
};

// ---------------------------------------------------------------------------

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  appel: "Appel",
  email: "Email",
  note: "Note",
  reunion: "Réunion",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
};

export const ACTIVITY_ICON: Record<ActivityType, string> = {
  appel: "📞",
  email: "✉",
  note: "✎",
  reunion: "◷",
  whatsapp: "◍",
  linkedin: "in",
};

export const PRIORITY_LABEL: Record<number, string> = {
  1: "Haute",
  2: "Normale",
  3: "Basse",
};

export const SOURCES = [
  "Appel sortant",
  "Appel entrant",
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
