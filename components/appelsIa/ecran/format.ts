/**
 * L'écran Appels IA — ce qui se calcule avant d'être affiché. Module pur, lu
 * par la page SERVEUR (et ses sections serveur) : elle pose des CHAÎNES dans
 * les props, de sorte qu'aucun composant client ne recalcule « maintenant » à
 * l'hydratation (le texte du serveur et celui du navigateur divergeraient
 * d'une minute, et React le signalerait).
 *
 * Ne pas l'importer depuis un composant client : il tire lib/appelsIa/acces.ts,
 * module serveur.
 */

import type { AppelResume } from "@/lib/appelsIa/lectures";
import { STATUTS_ACTIFS } from "@/lib/appelsIa/acces";
import { POINT_APPEL } from "@/lib/appelsIa/libelles";
import { ajouterJours, heureFr, jourCourt, jourHeureFr, partiesBruxelles } from "@/lib/appelsIa/calendrier";

// « 45 s », « 2 min », « 2 min 14 s » : écrit une fois, dans le module pur de
// l'écran (le suivi en direct, composant client, s'en sert aussi).
export { dureeLisible } from "@/lib/appelsIa/ecran";

/** Un instant PASSÉ : « aujourd'hui à 10h30 », « hier à 16h », « 06/10 à 9h45 ». */
export function quandPasse(iso: string | null | undefined, maintenant: Date): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = partiesBruxelles(d);
  const auj = partiesBruxelles(maintenant).ymd;
  const heure = heureFr(p.minutes);
  if (p.ymd === auj) return `aujourd'hui à ${heure}`;
  if (p.ymd === ajouterJours(auj, -1)) return `hier à ${heure}`;
  return `${jourCourt(d)} à ${heure}`;
}

/** Un instant À VENIR : « aujourd'hui à 14h », « demain à 9h30 », « lundi 12 octobre à 9h30 ». */
export function quandAVenir(iso: string | null | undefined, maintenant: Date): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  if (d.getTime() <= maintenant.getTime()) return "maintenant";
  const p = partiesBruxelles(d);
  const auj = partiesBruxelles(maintenant).ymd;
  const heure = heureFr(p.minutes);
  if (p.ymd === auj) return `aujourd'hui à ${heure}`;
  if (p.ymd === ajouterJours(auj, 1)) return `demain à ${heure}`;
  return jourHeureFr(d);
}

/** Le point de couleur d'un appel (classes entières de libelles.ts). */
export function pointAppel(a: Pick<AppelResume, "statut" | "resultat" | "erreur_cote">): string {
  if ((STATUTS_ACTIFS as readonly string[]).includes(a.statut)) return POINT_APPEL.en_cours;
  if (a.statut === "echec" || a.erreur_cote) return POINT_APPEL.echec;
  if (a.resultat && POINT_APPEL[a.resultat]) return POINT_APPEL[a.resultat];
  return POINT_APPEL.sans_reponse;
}
