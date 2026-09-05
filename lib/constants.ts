import type { IconeNom } from "@/components/ui";
import type {
  ActivityType,
  CallOutcome,
  ConfidenceLevel,
  EmailIntent,
  ProspectStatus,
} from "./types";

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
export const STATUS_ICON: Record<ProspectStatus, IconeNom> = {
  a_appeler: "telephone",
  contacte: "note",
  rendez_vous: "calendrier",
  proposition: "enveloppe",
  gagne: "coche",
  perdu: "croix",
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
// Résultat d'appel — cinq issues, deux taps
// ---------------------------------------------------------------------------

/**
 * L'ordre des pastilles, du plus fréquent au plus définitif. Il ne change pas
 * d'un écran à l'autre : le pouce apprend une position, pas une liste.
 */
export const OUTCOME_ORDER: CallOutcome[] = [
  "sans_reponse",
  "barrage",
  "rappeler",
  "interesse",
  "refus",
];

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  sans_reponse: "Pas de réponse",
  barrage: "Barrage",
  rappeler: "À rappeler",
  interesse: "Intéressé",
  refus: "Pas intéressé",
};

/** Le pictogramme accompagne toujours le libellé — la couleur ne porte jamais seule. */
export const OUTCOME_ICON: Record<CallOutcome, IconeNom> = {
  sans_reponse: "telephone-barre",
  barrage: "barriere",
  rappeler: "retour",
  interesse: "pouce",
  refus: "croix",
};

/**
 * Aucune couleur nouvelle : on reprend celles déjà employées ailleurs —
 * rose pour un refus (comme l'étape « Perdu »), ambre pour un barrage (comme
 * « Proposition », ce qui demande de l'attention), émeraude pour un intérêt
 * (comme « Gagné »), cyan pour un rappel à poser, ardoise pour un silence.
 * Classes complètes, jamais interpolées (règle JIT).
 */
export const OUTCOME_CHIP: Record<CallOutcome, string> = {
  sans_reponse: "bg-slate-500/15 text-slate-300 ring-slate-400/25",
  barrage: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  rappeler: "bg-cyan-500/15 text-cyan-300 ring-cyan-400/25",
  interesse: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/25",
  refus: "bg-rose-500/15 text-rose-300 ring-rose-400/25",
};

/** La couleur du texte seul, pour la ligne « dernière action » des cartes. */
export const OUTCOME_TEXT: Record<CallOutcome, string> = {
  sans_reponse: "text-slate-300",
  barrage: "text-amber-300",
  rappeler: "text-cyan-300",
  interesse: "text-emerald-300",
  refus: "text-rose-300",
};

/** Une valeur inconnue (donnée ancienne) ne casse jamais l'affichage. */
export function isCallOutcome(raw: unknown): raw is CallOutcome {
  return typeof raw === "string" && (OUTCOME_ORDER as string[]).includes(raw);
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

/**
 * Les trois raccourcis de relance, dans le même ordre et avec les mêmes mots
 * partout où l'on repousse une date (carte PROCHAINE ACTION, ligne du tableau
 * « À faire », champ de date). Un seul endroit : « +3 j » ici et « +3 jours »
 * ailleurs, c'était déjà deux vocabulaires pour un seul geste.
 */
export const RACCOURCIS_RELANCE: { label: string; jours: number }[] = [
  { label: "Demain", jours: 1 },
  { label: "+3 j", jours: 3 },
  { label: "+1 sem", jours: 7 },
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
// Confiance commerciale (Chaud / Tiède / Froid) — estimée par l'IA
// ---------------------------------------------------------------------------

export const CONFIDENCE_ORDER: ConfidenceLevel[] = ["chaud", "tiede", "froid"];

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  chaud: "Chaud",
  tiede: "Tiède",
  froid: "Froid",
};

/**
 * Chaud = orange/rouge (« ça brûle »), tiède = ambre, froid = bleu/ardoise.
 * La couleur ne porte jamais seule : libellé + pictogramme l'accompagnent.
 * Classes complètes, jamais interpolées (règle JIT).
 */
export const CONFIDENCE_CHIP: Record<ConfidenceLevel, string> = {
  chaud: "bg-orange-500/15 text-orange-300 ring-orange-400/30",
  tiede: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  froid: "bg-sky-500/15 text-sky-300 ring-sky-400/25",
};

export const CONFIDENCE_ICON: Record<ConfidenceLevel, IconeNom> = {
  chaud: "flamme",
  tiede: "demi",
  froid: "flocon",
};

/** L'état honnête quand rien n'a (encore) pu être estimé. */
export const CONFIDENCE_PENDING_LABEL = "À évaluer";
export const CONFIDENCE_PENDING_CHIP =
  "bg-white/[0.04] text-slate-400 ring-white/10";
export const CONFIDENCE_PENDING_ICON: IconeNom = "attente";

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
