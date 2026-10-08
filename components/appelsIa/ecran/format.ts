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
import type { ReglagesAppels } from "@/lib/appelsIa/acces";
import { STATUTS_ACTIFS } from "@/lib/appelsIa/acces";
import { POINT_APPEL, STATUT_APPEL_LABEL } from "@/lib/appelsIa/libelles";
import { numeroLisible } from "@/lib/appelsIa/numeros";
import { ajouterJours, heureFr, jourCourt, jourHeureFr, partiesBruxelles } from "@/lib/appelsIa/calendrier";

/** « 45 s », « 2 min », « 2 min 14 s ». */
export function dureeLisible(s: number | null | undefined): string | null {
  if (s === null || s === undefined || !Number.isFinite(s) || s < 0) return null;
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

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

export type TonEtat = "marche" | "calme" | "attention";

export type PhraseEtat = { ton: TonEtat; titre: string; detail: string | null };

/**
 * L'état du moteur en UNE phrase. L'ordre suit celui de `refusMoteur` : ce qui
 * se dit d'abord est ce qui empêche d'abord.
 *
 *   · un appel en cours                     → « Appel en cours — … »
 *   · une pause (panne de notre côté)       → ambre, la cause est dans le bandeau
 *   · l'interrupteur coupé                  → calme : c'est l'état de naissance
 *   · hors de la fenêtre                    → calme : c'est la nuit, pas une panne
 *   · tout autre refus (numéro, plafonds…)  → ambre
 *   · rien ne l'empêche                     → en marche
 */
export function phraseEtat(e: {
  reglages: ReglagesAppels;
  refus: string | null;
  enCours: AppelResume | null;
  fileTotal: number;
}): PhraseEtat {
  const { reglages: r, refus, enCours, fileTotal } = e;
  if (enCours) {
    const qui = enCours.societe ?? (enCours.prospect_id ? "une fiche" : "fiche fictive");
    return {
      ton: "marche",
      titre: `Appel en cours — ${qui}`,
      detail: `${STATUT_APPEL_LABEL[enCours.statut] ?? enCours.statut} · ${numeroLisible(enCours.numero_compose)}${
        enCours.mode_test ? " (appel de test)" : ""
      }`,
    };
  }
  if (r.pause_cause) {
    return {
      ton: "attention",
      titre: "En pause",
      detail: "Plus rien ne part tant que la pause n'est pas levée.",
    };
  }
  if (!r.actif) {
    return {
      ton: "calme",
      titre: "À l'arrêt",
      detail: "L'interrupteur général est coupé : Janet ne compose rien. L'appel de test reste possible.",
    };
  }
  if (refus && refus.startsWith("Hors de la fenêtre")) {
    return { ton: "calme", titre: "En attente de la fenêtre d'appel", detail: refus };
  }
  if (refus) return { ton: "attention", titre: "Le moteur ne compose pas", detail: refus };
  if (fileTotal === 0) {
    return { ton: "marche", titre: "En marche", detail: "La file est vide : rien à composer pour l'instant." };
  }
  return {
    ton: "marche",
    titre: "En marche",
    detail: `Janet compose dès qu'une fiche de la file est prête — ${fileTotal} fiche${fileTotal > 1 ? "s" : ""} en file.`,
  };
}
