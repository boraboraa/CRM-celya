/**
 * Dater une relance — en un geste, AVEC l'heure (27/10, retours de Bora).
 *
 * Avant : trois raccourcis (« Demain / +3 j / +1 sem ») qui posaient TOUJOURS
 * 9h, et un champ de date. Un étudiant qui raccroche à 15h sur « rappelez-moi
 * en fin d'après-midi » n'avait aucun moyen de le dire. Désormais, partout où
 * l'on date une relance (carte PROCHAINE ACTION, ligne de « À faire », après un
 * résultat d'appel, débrief, « Planifier une relance ») :
 *
 *   le jour   « − / + » (28/10 : « pas assez tactile » — c'était une liste
 *             déroulante) ; un tap sur la date ouvre le calendrier ;
 *   l'heure   de grosses pastilles — 9h · 10h · 11h · 14h · 15h · 16h ·
 *             17h · Autre ; puis « Valider · demain à 9h ».
 *
 * D'office : demain à 9h (un tap). Aujourd'hui reste proposé tant qu'une
 * pastille y est possible (au moins 30 min devant), et ses heures passées
 * sont grisées.
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
import { lendemainOuvre } from "../appelsIa/calendrier.ts";

/** Sans heure choisie : 9h. */
export const HEURE_DEFAUT = "09:00";

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

// ---------------------------------------------------------------------------
// Le choix TACTILE (28/10, retour de Bora : « pas assez tactile ») — le jour
// se règle par « − / + » (et un tap sur la date ouvre le calendrier du
// téléphone), l'heure en grosses pastilles, puis UN bouton qui dit ce qui
// partira (« Valider · demain à 9h »). « Demain à 9h » reste à un tap.
// ---------------------------------------------------------------------------

/** Les heures en pastilles. « Autre » ouvre l'horloge du téléphone. */
export const HEURES_TACTILES = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"] as const;

/** Une heure est-elle encore possible ce jour-là ? Aujourd'hui : au moins 30 min devant. */
export function heureDisponible(ymd: string, hm: string, now: Date): boolean {
  if (!RE_YMD.test(ymd) || !RE_HM.test(hm)) return false;
  const ici = maintenantLocal(now);
  if (ymd > ici.ymd) return true;
  if (ymd < ici.ymd) return false;
  const [h, m] = ici.hm.split(":").map(Number);
  const [hh, mm] = hm.split(":").map(Number);
  return hh * 60 + mm >= h * 60 + m + 30;
}

/**
 * Le premier jour proposable : aujourd'hui tant qu'une pastille d'heure y
 * reste (avant 16h30), sinon demain. On ne recule jamais avant lui.
 */
export function jourMinimum(now: Date): string {
  const { ymd } = maintenantLocal(now);
  return HEURES_TACTILES.some((hm) => heureDisponible(ymd, hm, now)) ? ymd : ajouterJours(ymd, 1);
}

/** « − / + » sur le jour : jamais avant le premier jour proposable. */
export function decalerJour(ymd: string, delta: number, now: Date): string {
  const min = jourMinimum(now);
  const base = RE_YMD.test(ymd) && ymd >= min ? ymd : min;
  const cible = ajouterJours(base, Math.trunc(delta));
  return cible < min ? min : cible;
}

/** Une date tapée au calendrier : acceptée si elle n'est pas avant le premier jour proposable. */
export function jourSaisi(v: string | null | undefined, now: Date): string | null {
  const t = (v ?? "").trim();
  if (!RE_YMD.test(t)) return null;
  return t < jourMinimum(now) ? null : t;
}

const JOURS_LONGS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/**
 * Ce que dit le jour au milieu du « − / + » : « Demain » + « jeudi 29 oct. »,
 * « Lundi 2 nov. » (sans second mot quand il n'y a rien à ajouter).
 */
export function libelleJour(ymd: string, now: Date): { principal: string; detail: string | null } {
  const [a, m, j] = ymd.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  const nom = JOURS_LONGS[d.getUTCDay()];
  const date = `${nom} ${j} ${MOIS_COURTS[m - 1]}`;
  const ici = maintenantLocal(now).ymd;
  const relatif =
    ymd === ici ? "Aujourd'hui" : ymd === ajouterJours(ici, 1) ? "Demain" : ymd === ajouterJours(ici, 2) ? "Après-demain" : null;
  return relatif ? { principal: relatif, detail: date } : { principal: date[0].toUpperCase() + date.slice(1), detail: null };
}

/**
 * L'heure retenue pour ce jour : celle demandée si elle est encore possible,
 * sinon la première pastille possible, sinon l'heure « plus tard ».
 */
export function heurePourJour(ymd: string, voulue: string | null, now: Date): string {
  if (voulue && heureDisponible(ymd, voulue, now)) return voulue;
  const premiere = HEURES_TACTILES.find((hm) => heureDisponible(ymd, hm, now));
  return premiere ?? heurePlusTard(now);
}

/** Le choix proposé d'office : demain à 9h. */
export function choixParDefaut(now: Date): { ymd: string; hm: string } {
  const ymd = decalerJour(ajouterJours(maintenantLocal(now).ymd, 1), 0, now);
  return { ymd, hm: heurePourJour(ymd, HEURE_DEFAUT, now) };
}

// ---------------------------------------------------------------------------
// Le rappel AUTOMATIQUE après « Pas décroché » ou « Barrage » (29/10, décision
// de Bora : « quand la personne n'a pas décroché, c'est de toute façon une
// relance à faire »). Avant, ces deux résultats n'écrivaient que le journal :
// une relance du jour passait « en retard » le lendemain, et une fiche sans
// relance sortait de « À faire » sans un mot.
//
//   quand    le PROCHAIN JOUR OUVRÉ (lundi–vendredi, fériés belges exclus —
//            le calendrier de Janet) ;
//   à quelle heure   l'AUTRE moitié de la journée : appelé le matin (avant
//            13h) → 14h ; l'après-midi → 10h. On ne joint pas le matin ?
//            on essaie l'après-midi, et l'inverse ;
//   jamais   par-dessus une date humaine (le texte dit « rappeler jeudi »),
//            une relance déjà prévue APRÈS aujourd'hui (posée par quelqu'un),
//            un rendez-vous à venir (024 : rien d'automatique avant un RDV),
//            une fiche gagnée ou perdue.
//
// Une relance du jour ou en retard n'est pas « prévue » : elle est re-datée
// (saveExchangeCore ne crée jamais de doublon). La règle est ICI, une fois ;
// `poserRappelAuto` (lib/crm/rappelAuto.ts) la joue pour l'écran ET le MCP.
// ---------------------------------------------------------------------------

/** Les résultats d'appel qui posent un rappel tout seuls. */
export const RESULTATS_RAPPEL_AUTO = ["sans_reponse", "barrage"] as const;

export function declencheRappelAuto(outcome: string | null | undefined): boolean {
  return (RESULTATS_RAPPEL_AUTO as readonly string[]).includes(outcome ?? "");
}

/** « YYYY-MM-DDTHH:mm » : le prochain jour ouvré, l'autre moitié de journée. */
export function rappelAutomatique(now: Date): string {
  const { hm } = maintenantLocal(now);
  return valeurRelance(lendemainOuvre(now), hm < "13:00" ? "14:00" : "10:00");
}

export type RaisonSansRappel =
  | "pas_concerne"
  | "date_humaine"
  | "fiche_close"
  | "rdv_a_venir"
  | "relance_prevue";

/** Faut-il poser le rappel, et à quelle date ? Pur : l'appelant lit la base. */
export function decisionRappelAuto(input: {
  outcome: string | null | undefined;
  /** Une date a déjà été dite par l'humain (texte, choix « Pour quand ? »). */
  dateHumaine: boolean;
  statut: string | null | undefined;
  rdvAVenir: boolean;
  /** Les échéances (ISO) des relances OUVERTES de la fiche. */
  relancesOuvertes: string[];
  now: Date;
}): { poser: string } | { poser: null; raison: RaisonSansRappel } {
  if (!declencheRappelAuto(input.outcome)) return { poser: null, raison: "pas_concerne" };
  if (input.dateHumaine) return { poser: null, raison: "date_humaine" };
  if (input.statut === "gagne" || input.statut === "perdu") return { poser: null, raison: "fiche_close" };
  if (input.rdvAVenir) return { poser: null, raison: "rdv_a_venir" };
  const aujourdhui = maintenantLocal(input.now).ymd;
  const prevue = input.relancesOuvertes.some((iso) => isoToLocalInput(iso).slice(0, 10) > aujourdhui);
  if (prevue) return { poser: null, raison: "relance_prevue" };
  return { poser: rappelAutomatique(input.now) };
}
