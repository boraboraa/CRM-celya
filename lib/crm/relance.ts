/**
 * Dater une relance — en un geste, AVEC l'heure (27/10, retours de Bora).
 *
 * Avant : trois raccourcis (« Demain / +3 j / +1 sem ») qui posaient TOUJOURS
 * 9h, et un champ de date. Un étudiant qui raccroche à 15h sur « rappelez-moi
 * en fin d'après-midi » n'avait aucun moyen de le dire. Désormais, partout où
 * l'on date une relance (carte PROCHAINE ACTION, ligne de « À faire », après un
 * résultat d'appel, débrief, « Planifier une relance ») :
 *
 *   le jour   une liste — Plus tard aujourd'hui · Demain · Dans 2 jours ·
 *             Dans 3 jours · Dans 1 semaine · Autre date…
 *   l'heure   un tap — 9h · 11h · 14h · 16h · Autre heure
 *
 * Sans heure choisie : 9h, comme avant. « Plus tard aujourd'hui » disparaît
 * après 17h (c'est « Demain » qu'on propose), et pour aujourd'hui seules les
 * heures À VENIR sont proposées.
 *
 * UNE table de choix, UN composant (`components/ChoixRelance.tsx`) : personne
 * ne réécrit ces mots ailleurs. Module NEUTRE, imports relatifs : joué tel
 * quel par `npm run test:relance`. Tout se calcule en heure de BRUXELLES, à
 * partir d'un instant (`now`) — jamais l'horloge du navigateur.
 *
 * La valeur produite est une date LOCALE « YYYY-MM-DDTHH:mm », celle que
 * comprennent déjà `dateInputToISO` / `localInputToISO` (lib/time.ts), les
 * server actions et l'outil MCP `planifier_relance`.
 */

import { isoToLocalInput, localInputToISO } from "../time.ts";

export type JourRelance = "aujourdhui" | "demain" | "2j" | "3j" | "1sem" | "autre";

export const JOURS_RELANCE: { id: JourRelance; label: string; jours?: number }[] = [
  { id: "aujourdhui", label: "Plus tard aujourd'hui", jours: 0 },
  { id: "demain", label: "Demain", jours: 1 },
  { id: "2j", label: "Dans 2 jours", jours: 2 },
  { id: "3j", label: "Dans 3 jours", jours: 3 },
  { id: "1sem", label: "Dans 1 semaine", jours: 7 },
  { id: "autre", label: "Autre date…" },
];

/** Les heures en un tap. « Autre heure » ouvre un champ. */
export const HEURES_RELANCE = ["09:00", "11:00", "14:00", "16:00"] as const;

/** Sans heure choisie : 9h, comme les relances d'avant. */
export const HEURE_DEFAUT = "09:00";

/** Après cette heure, « Plus tard aujourd'hui » n'est plus proposé. */
export const FIN_PLUS_TARD = "17:00";

/** Le jour proposé d'office : demain. */
export const JOUR_DEFAUT: JourRelance = "demain";

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;
const RE_HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Le jour et l'heure de Bruxelles à cet instant. */
export function maintenantLocal(now: Date): { ymd: string; hm: string } {
  const local = isoToLocalInput(now.toISOString());
  return { ymd: local.slice(0, 10), hm: local.slice(11, 16) };
}

/** « YYYY-MM-DD » + n jours, sur le calendrier (sans fuseau, sans DST). */
export function ajouterJours(ymd: string, n: number): string {
  const [a, m, j] = ymd.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + n));
  return d.toISOString().slice(0, 10);
}

/** Les jours proposés à cet instant — sans « Plus tard aujourd'hui » après 17h. */
export function joursProposes(now: Date): typeof JOURS_RELANCE {
  const { hm } = maintenantLocal(now);
  return JOURS_RELANCE.filter((j) => j.id !== "aujourdhui" || hm < FIN_PLUS_TARD);
}

/** `Object.hasOwn`-sûr : une valeur venue d'un `<select>` reste suspecte. */
export function estJourRelance(v: unknown): v is JourRelance {
  return typeof v === "string" && JOURS_RELANCE.some((j) => j.id === v);
}

/**
 * La date d'un choix de jour. `autre` : la date saisie (« YYYY-MM-DD »), à
 * défaut null. Jamais dans le passé : une « autre date » antérieure à
 * aujourd'hui est refusée (null).
 */
export function dateDuChoix(choix: JourRelance, now: Date, autre?: string | null): string | null {
  const { ymd } = maintenantLocal(now);
  if (choix === "autre") {
    const v = (autre ?? "").trim();
    if (!RE_YMD.test(v)) return null;
    return v < ymd ? null : v;
  }
  const j = JOURS_RELANCE.find((x) => x.id === choix);
  return ajouterJours(ymd, j?.jours ?? 1);
}

/**
 * « Plus tard aujourd'hui » sans heure : l'heure pleine qui suit maintenant
 * + 1 h (15h10 → 17h00), au plus tard 20h. Jamais une heure déjà passée.
 */
export function heurePlusTard(now: Date): string {
  const { hm } = maintenantLocal(now);
  const [h, m] = hm.split(":").map(Number);
  const cible = Math.min(20, h + 1 + (m > 0 ? 1 : 0));
  return `${String(cible).padStart(2, "0")}:00`;
}

/**
 * Les heures proposées pour ce jour. Un jour à venir : 9h · 11h · 14h · 16h.
 * Aujourd'hui : seulement celles qui ne sont pas passées (au moins 30 min
 * devant) — à défaut, l'heure « plus tard » calculée.
 */
export function heuresProposees(ymd: string, now: Date): string[] {
  const ici = maintenantLocal(now);
  if (ymd !== ici.ymd) return [...HEURES_RELANCE];
  const [h, m] = ici.hm.split(":").map(Number);
  const seuil = h * 60 + m + 30;
  const restantes = HEURES_RELANCE.filter((x) => {
    const [hh, mm] = x.split(":").map(Number);
    return hh * 60 + mm >= seuil;
  });
  return restantes.length > 0 ? restantes : [heurePlusTard(now)];
}

/** L'heure posée quand on n'en choisit pas : 9h, ou « plus tard » aujourd'hui. */
export function heureParDefaut(ymd: string, now: Date): string {
  return ymd === maintenantLocal(now).ymd ? heuresProposees(ymd, now)[0] : HEURE_DEFAUT;
}

/** La valeur locale « YYYY-MM-DDTHH:mm » — 9h sans heure, une heure invalide aussi. */
export function valeurRelance(ymd: string, hm?: string | null): string {
  const h = hm && RE_HM.test(hm) ? hm : HEURE_DEFAUT;
  return `${ymd}T${h}`;
}

/** « 9h », « 14h30 ». */
function heureDite(hm: string): string {
  const [h, m] = hm.split(":");
  return `${Number(h)}h${m && m !== "00" ? m : ""}`;
}

const JOURS_SEMAINE = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/**
 * Ce que le bouton dit avant d'envoyer : « aujourd'hui à 16h », « demain à
 * 9h », « jeu. 30/10 à 14h ».
 */
export function libelleRelance(valeur: string, now: Date): string {
  const ymd = valeur.slice(0, 10);
  const hm = valeur.slice(11, 16) || HEURE_DEFAUT;
  const ici = maintenantLocal(now).ymd;
  let jour: string;
  if (ymd === ici) jour = "aujourd'hui";
  else if (ymd === ajouterJours(ici, 1)) jour = "demain";
  else {
    const [a, m, j] = ymd.split("-").map(Number);
    const d = new Date(Date.UTC(a, m - 1, j));
    jour = `${JOURS_SEMAINE[d.getUTCDay()]} ${String(j).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
  }
  return `${jour} à ${heureDite(hm)}`;
}

/** L'instant UTC d'une valeur locale — la même conversion que le serveur. */
export function instantRelance(valeur: string): string | null {
  return localInputToISO(valeur);
}

/**
 * La relance tombe-t-elle AVANT le prochain rendez-vous ? (024 : on informe,
 * on ne bloque pas — la fiche dira toujours le RDV.)
 */
export function relanceAvantRdv(valeur: string, rdvStartsAt: string | null | undefined): boolean {
  if (!rdvStartsAt) return false;
  const iso = instantRelance(valeur);
  if (!iso) return false;
  return new Date(iso).getTime() < new Date(rdvStartsAt).getTime();
}
