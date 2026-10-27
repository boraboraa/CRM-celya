/**
 * L'ORDRE des fiches — module pur (27/10/2026), testé par test:filtres.
 *
 * La liste des prospects s'ouvrait sur « Activité récente » : la dernière
 * fiche modifiée en tête, qu'il y ait quelque chose à y faire ou non. Un
 * étudiant qui démarre la journée veut l'inverse :
 *
 *   1. ses fiches ÉTOILÉES (celles qu'il juge les plus chaudes) ;
 *   2. puis ce qui est dû — en retard, ou aujourd'hui ;
 *   3. puis le reste, par prochaine action ;
 *   4. et en dernier les fiches sans rien de prévu.
 *
 * Les étoilées suivent elles-mêmes cet ordre (une étoilée en retard passe
 * devant une étoilée de la semaine prochaine). Égalité : le nom, pour que
 * deux affichages de la même liste donnent le même ordre.
 *
 * « À faire » garde ses zones (jamais mélangées) : seule `etoileesDabord`
 * s'applique à chacune — les étoilées en tête, l'ordre de la zone ensuite.
 */

export type RangProspect = {
  company_name: string;
  starred_at?: string | null;
  next_action_at?: string | null;
};

/** 0 = dû (en retard ou aujourd'hui), 1 = plus tard, 2 = rien de prévu. */
export function echeance(at: string | null | undefined, finDuJour: number): 0 | 1 | 2 {
  if (!at) return 2;
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return 2;
  return t <= finDuJour ? 0 : 1;
}

/**
 * `finDuJour` : la fin du jour à Bruxelles, en millisecondes (la page la
 * calcule par `todayBounds()`). Renvoie une COPIE triée.
 */
export function ordonnerProspects<T extends RangProspect>(rows: T[], finDuJour: number): T[] {
  const temps = (at: string | null | undefined) => (at ? new Date(at).getTime() : Infinity);
  return [...rows].sort((a, b) => {
    const ea = a.starred_at ? 0 : 1;
    const eb = b.starred_at ? 0 : 1;
    if (ea !== eb) return ea - eb;
    const da = echeance(a.next_action_at, finDuJour);
    const db = echeance(b.next_action_at, finDuJour);
    if (da !== db) return da - db;
    const ta = temps(a.next_action_at);
    const tb = temps(b.next_action_at);
    if (ta !== tb) return ta - tb;
    return a.company_name.localeCompare(b.company_name, "fr");
  });
}

/**
 * Les étoilées en tête, l'ordre d'origine conservé de part et d'autre
 * (partition STABLE) — pour les zones de « À faire », qui ont chacune leur
 * propre ordre.
 */
export function etoileesDabord<T>(rows: T[], estEtoilee: (r: T) => boolean): T[] {
  const oui: T[] = [];
  const non: T[] = [];
  for (const r of rows) (estEtoilee(r) ? oui : non).push(r);
  return [...oui, ...non];
}
