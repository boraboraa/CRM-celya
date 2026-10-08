/**
 * La mise en forme des appels de Janet pour les écrans existants (colonne
 * « Appels » du tableau de bord, suivi d'appel de la fiche, brief).
 *
 * Module NEUTRE (ni serveur ni client) et PUR : aucune lecture, aucun état.
 * Les composants serveur comme clients peuvent l'importer — il ne porte que
 * des fonctions qui RESTENT de leur côté de la frontière (on n'en passe
 * jamais une en prop).
 */

import type { AppelResume, LigneFileResume } from "@/lib/appelsIa/lectures";
import {
  CLASSEMENT_LABEL,
  OUTCOME_LABEL_APPEL,
  STATUT_APPEL_LABEL,
} from "@/lib/appelsIa/libelles";
import { heureFr, jourCourt, jourHeureFr, partiesBruxelles } from "@/lib/appelsIa/calendrier";

/**
 * Les statuts d'un appel VIVANT. Recopie de `STATUTS_ACTIFS`
 * (lib/appelsIa/acces.ts) : ce module-là est réservé au serveur, celui-ci est
 * lu par des composants clients. Les deux listes doivent rester identiques.
 */
export const STATUTS_APPEL_VIVANT = ["reserve", "composition", "sonnerie", "en_ligne"] as const;

export function appelVivant(statut: string | null | undefined): boolean {
  return (STATUTS_APPEL_VIVANT as readonly string[]).includes(statut ?? "");
}

export function appelFini(statut: string | null | undefined): boolean {
  return statut === "termine" || statut === "echec";
}

/** Une ligne de file qui attend encore son tour (ou le tient). */
export function fileVivante(f: Pick<LigneFileResume, "statut"> | null | undefined): boolean {
  return f?.statut === "en_attente" || f?.statut === "en_cours";
}

/**
 * La clé de `POINT_APPEL` (lib/appelsIa/libelles.ts) : le résultat déclaré
 * s'il y en a un, sinon l'état de l'appel. Un appel terminé sans résultat
 * (répondeur, personne) prend le gris du silence.
 */
export function pointAppel(a: Pick<AppelResume, "statut" | "resultat">): string {
  if (appelVivant(a.statut)) return "en_cours";
  if (a.statut === "echec") return "echec";
  return a.resultat ?? "sans_reponse";
}

/** Ce qu'a donné l'appel, en un ou deux mots : résultat, sinon classement, sinon état. */
export function libelleAppel(a: Pick<AppelResume, "statut" | "resultat" | "classement">): string {
  if (a.resultat && a.resultat in OUTCOME_LABEL_APPEL) {
    return OUTCOME_LABEL_APPEL[a.resultat as keyof typeof OUTCOME_LABEL_APPEL];
  }
  if (a.classement && CLASSEMENT_LABEL[a.classement]) return CLASSEMENT_LABEL[a.classement];
  return STATUT_APPEL_LABEL[a.statut] ?? a.statut;
}

/** « 14h05 » aujourd'hui (heure de Bruxelles), « 07/10 14h05 » un autre jour. */
export function heureCourte(iso: string, maintenant: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = partiesBruxelles(d);
  const heure = heureFr(p.minutes);
  return p.ymd === partiesBruxelles(new Date(maintenant)).ymd ? heure : `${jourCourt(d)} ${heure}`;
}

/**
 * Quand la ligne de file passera : « à 14h30 », « le 09/10 à 9h30 » — ou
 * « dès que possible » quand son heure est déjà venue (le moteur dit alors,
 * à part, pourquoi il ne compose pas).
 */
export function quandFile(pasAvant: string, maintenant: number = Date.now()): string {
  const t = Date.parse(pasAvant);
  if (Number.isNaN(t) || t <= maintenant) return "dès que possible";
  const d = new Date(t);
  const p = partiesBruxelles(d);
  return p.ymd === partiesBruxelles(new Date(maintenant)).ymd
    ? `à ${heureFr(p.minutes)}`
    : `le ${jourCourt(d)} à ${heureFr(p.minutes)}`;
}

/** Même chose, en toutes lettres, pour la fiche : « jeudi 8 octobre à 10h30 ». */
export function quandFileLong(pasAvant: string, maintenant: number = Date.now()): string {
  const t = Date.parse(pasAvant);
  if (Number.isNaN(t) || t <= maintenant) return "dès que le moteur peut composer";
  return `pas avant ${jourHeureFr(new Date(t))}`;
}

/**
 * « 2026-10-08 » → « 08/10/2026 » (les dates du brief sont des jours, sans
 * heure). La date par défaut de la lecture tolérante (`1970-01-01`, « date
 * inconnue ») ne s'affiche pas : mieux vaut rien qu'une date inventée.
 */
export function dateBrief(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || ymd === "1970-01-01") return "";
  return ymd.split("-").reverse().join("/");
}
