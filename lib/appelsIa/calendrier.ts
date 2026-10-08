/**
 * Le temps de Janet : heure de Bruxelles, jours ouvrés, jours fériés belges,
 * fenêtre d'appel. Module pur, sans alias `@/` : testé tel quel sous node.
 *
 * Tout se compte en MINUTES (fenêtre 9h30–17h30). L'ancien sortant du produit
 * comptait en heures entières : avec 9h30–17h30, il aurait rendu 17h pour
 * l'essai 2 comme pour l'essai 3, et des minutes hors fenêtre.
 */

export const TZ = "Europe/Brussels";

export type Fenetre = {
  /** « HH:MM », heure de Bruxelles. */
  debut: string;
  fin: string;
};

export const FENETRE_DEFAUT: Fenetre = { debut: "09:30", fin: "17:30" };

export type PartiesBruxelles = {
  ymd: string;
  annee: number;
  mois: number;
  jour: number;
  heure: number;
  minute: number;
  /** Minutes depuis minuit, heure de Bruxelles. */
  minutes: number;
  /** 1 = lundi … 7 = dimanche. */
  jourSemaine: number;
};

const FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});

const JOURS_EN: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function partiesBruxelles(d: Date): PartiesBruxelles {
  const p = Object.fromEntries(FORMAT.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  const heure = p.hour === "24" ? 0 : Number(p.hour);
  const minute = Number(p.minute);
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    annee: Number(p.year),
    mois: Number(p.month),
    jour: Number(p.day),
    heure,
    minute,
    minutes: heure * 60 + minute,
    jourSemaine: JOURS_EN[p.weekday] ?? 0,
  };
}

/** « HH:MM » → minutes depuis minuit. */
export function enMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function decalageMinutes(d: Date): number {
  const p = partiesBruxelles(d);
  const commeUtc = Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute);
  const tronque = d.getTime() - d.getUTCSeconds() * 1000 - d.getUTCMilliseconds();
  return (commeUtc - tronque) / 60000;
}

/** L'instant UTC d'une heure murale de Bruxelles (« 2026-10-08 », 600 → 10:00). */
export function instantBruxelles(ymd: string, minutes: number): Date {
  const [a, mo, j] = ymd.split("-").map(Number);
  const naif = Date.UTC(a, mo - 1, j, Math.floor(minutes / 60), minutes % 60);
  let t = naif - decalageMinutes(new Date(naif)) * 60000;
  t = naif - decalageMinutes(new Date(t)) * 60000;
  return new Date(t);
}

export function ajouterJours(ymd: string, n: number): string {
  const [a, mo, j] = ymd.split("-").map(Number);
  const d = new Date(Date.UTC(a, mo - 1, j + n));
  return d.toISOString().slice(0, 10);
}

function jourSemaineDe(ymd: string): number {
  const [a, mo, j] = ymd.split("-").map(Number);
  const js = new Date(Date.UTC(a, mo - 1, j)).getUTCDay(); // 0 = dimanche
  return js === 0 ? 7 : js;
}

/** Dimanche de Pâques (algorithme grégorien anonyme). */
function paques(annee: number): string {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return `${annee}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
}

const cacheFeries = new Map<number, Map<string, string>>();

/** Les dix jours fériés légaux belges d'une année : date → nom. */
export function joursFeries(annee: number): Map<string, string> {
  const deja = cacheFeries.get(annee);
  if (deja) return deja;
  const p = paques(annee);
  const f = new Map<string, string>([
    [`${annee}-01-01`, "Nouvel An"],
    [ajouterJours(p, 1), "lundi de Pâques"],
    [`${annee}-05-01`, "fête du Travail"],
    [ajouterJours(p, 39), "Ascension"],
    [ajouterJours(p, 50), "lundi de Pentecôte"],
    [`${annee}-07-21`, "fête nationale"],
    [`${annee}-08-15`, "Assomption"],
    [`${annee}-11-01`, "Toussaint"],
    [`${annee}-11-11`, "Armistice"],
    [`${annee}-12-25`, "Noël"],
  ]);
  cacheFeries.set(annee, f);
  return f;
}

export function ferieDe(ymd: string): string | null {
  return joursFeries(Number(ymd.slice(0, 4))).get(ymd) ?? null;
}

/** Du lundi au vendredi, et pas un jour férié belge. */
export function estOuvre(ymd: string): boolean {
  const js = jourSemaineDe(ymd);
  return js >= 1 && js <= 5 && !ferieDe(ymd);
}

/** L'instant tombe-t-il dans la fenêtre d'appel d'un jour ouvré ? */
export function dansFenetre(d: Date, f: Fenetre = FENETRE_DEFAUT): boolean {
  const p = partiesBruxelles(d);
  return estOuvre(p.ymd) && p.minutes >= enMinutes(f.debut) && p.minutes < enMinutes(f.fin);
}

/** Le prochain instant où l'on peut composer (l'instant lui-même s'il l'est). */
export function prochaineOuverture(d: Date, f: Fenetre = FENETRE_DEFAUT): Date {
  if (dansFenetre(d, f)) return d;
  const p = partiesBruxelles(d);
  let ymd = p.ymd;
  if (estOuvre(ymd) && p.minutes < enMinutes(f.debut)) return instantBruxelles(ymd, enMinutes(f.debut));
  for (let i = 0; i < 20; i++) {
    ymd = ajouterJours(ymd, 1);
    if (estOuvre(ymd)) return instantBruxelles(ymd, enMinutes(f.debut));
  }
  return instantBruxelles(ajouterJours(p.ymd, 1), enMinutes(f.debut));
}

/** Le premier jour ouvré APRÈS celui de l'instant (« YYYY-MM-DD »). */
export function lendemainOuvre(d: Date): string {
  let ymd = partiesBruxelles(d).ymd;
  for (let i = 0; i < 20; i++) {
    ymd = ajouterJours(ymd, 1);
    if (estOuvre(ymd)) return ymd;
  }
  return ymd;
}

const JOURS_FR = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MOIS_FR = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « 10h », « 10h30 ». */
export function heureFr(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** « jeudi 8 octobre ». */
export function jourFr(d: Date): string {
  const p = partiesBruxelles(d);
  return `${JOURS_FR[p.jourSemaine]} ${p.jour} ${MOIS_FR[p.mois]}`;
}

/** « jeudi 8 octobre à 10h30 ». */
export function jourHeureFr(d: Date): string {
  return `${jourFr(d)} à ${heureFr(partiesBruxelles(d).minutes)}`;
}

/** « 08/10 ». */
export function jourCourt(d: Date): string {
  const p = partiesBruxelles(d);
  return `${String(p.jour).padStart(2, "0")}/${String(p.mois).padStart(2, "0")}`;
}
