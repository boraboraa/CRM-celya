import type { ActivityType, ClientStatus } from "./types";

export const STATUS_ORDER: ClientStatus[] = [
  "nouveau",
  "contacte",
  "qualifie",
  "proposition",
  "negociation",
  "gagne",
  "perdu",
];

export const STATUS_LABEL: Record<ClientStatus, string> = {
  nouveau: "Nouveau",
  contacte: "Contacté",
  qualifie: "Qualifié",
  proposition: "Proposition",
  negociation: "Négociation",
  gagne: "Gagné",
  perdu: "Perdu",
};

/** Classes Tailwind statiques (pas d'interpolation : le JIT doit les voir). */
export const STATUS_CHIP: Record<ClientStatus, string> = {
  nouveau: "bg-slate-500/15 text-slate-300 ring-slate-400/25",
  contacte: "bg-cyan-500/15 text-cyan-300 ring-cyan-400/25",
  qualifie: "bg-blue-500/15 text-blue-300 ring-blue-400/25",
  proposition: "bg-indigo-500/15 text-indigo-300 ring-indigo-400/25",
  negociation: "bg-violet-500/15 text-violet-300 ring-violet-400/25",
  gagne: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/25",
  perdu: "bg-rose-500/15 text-rose-300 ring-rose-400/25",
};

export const STATUS_DOT: Record<ClientStatus, string> = {
  nouveau: "bg-slate-400",
  contacte: "bg-cyan-400",
  qualifie: "bg-blue-400",
  proposition: "bg-indigo-400",
  negociation: "bg-violet-400",
  gagne: "bg-emerald-400",
  perdu: "bg-rose-400",
};

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
