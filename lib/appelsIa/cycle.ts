/**
 * Le cycle d'appels de Janet sur une fiche — pur, testé par cycle.test.ts.
 *
 * Repris de l'ancien sortant du produit (`heartbeat`, `nextRetryAt`,
 * `machineHistory`, `missPatch`), compté en MINUTES dans la fenêtre :
 *
 *   · 3 essais au plus, du lundi au vendredi, jours fériés exclus, dans la
 *     fenêtre (9h30–17h30 par défaut) ;
 *   · essai 2 dans le créneau 16h–17h, au moins 3 h après la fin de l'essai 1 ;
 *   · essai 3 dans le créneau 17h–fin de fenêtre, un AUTRE jour ouvré que
 *     l'essai 2, au moins 3 h après lui ;
 *   · deux réponses de machine (répondeur ou standard) à deux heures
 *     différentes, sans jamais un humain : stop, « à contacter autrement » ;
 *   · un standard automatique : stop immédiat (ancien code) ;
 *   · un humain : le cycle s'arrête. Rappeler, intéressé sans rendez-vous ou
 *     barrage : une relance pour le propriétaire, à la date donnée par le
 *     prospect, sinon le lendemain ouvré à 9h. Janet ne rappelle jamais
 *     d'elle-même. Rien après un refus, rien quand un rendez-vous est à venir ;
 *   · aucune relance orpheline : un nouvel essai n'est programmé que si la
 *     campagne est encore active ou en pause.
 */

import {
  ajouterJours,
  enMinutes,
  estOuvre,
  FENETRE_DEFAUT,
  heureFr,
  instantBruxelles,
  lendemainOuvre,
  partiesBruxelles,
  type Fenetre,
} from "./calendrier.ts";

export const MAX_ESSAIS = 3;
/** Jamais deux essais à moins de 3 h. */
export const ECART_MIN_MS = 3 * 3600_000;
/** Une relance pour le propriétaire tombe à 9h. */
export const HEURE_RELANCE = 9 * 60;

/** Le créneau d'un essai, borné par la fenêtre (minutes depuis minuit). */
export function creneauEssai(essai: 2 | 3, f: Fenetre = FENETRE_DEFAUT): [number, number] {
  const debutF = enMinutes(f.debut);
  const finF = enMinutes(f.fin);
  const [d, fin] = essai === 2 ? [16 * 60, 17 * 60] : [17 * 60, finF];
  const a = Math.max(d, debutF);
  const b = Math.min(fin, finF);
  if (a < b) return [a, b];
  // Une fenêtre qui ne couvre pas la fin d'après-midi : sa dernière heure
  // (essai 2), sa dernière demi-heure (essai 3).
  return essai === 2 ? [Math.max(debutF, finF - 60), finF] : [Math.max(debutF, finF - 30), finF];
}

/**
 * Quand composer l'essai `essai` (2 ou 3), l'essai précédent ayant fini à
 * `finPrecedent`. Le premier jour ouvré où le créneau, rogné par « au moins
 * 3 h après », n'est pas vide — et pour l'essai 3, un autre jour que l'essai 2.
 */
export function prochainEssai(essai: 2 | 3, finPrecedent: Date, f: Fenetre = FENETRE_DEFAUT): Date {
  const [debutC, finC] = creneauEssai(essai, f);
  const auPlusTot = finPrecedent.getTime() + ECART_MIN_MS;
  const jourPrecedent = partiesBruxelles(finPrecedent).ymd;
  let ymd = jourPrecedent;
  for (let i = 0; i < 30; i++, ymd = ajouterJours(ymd, 1)) {
    if (!estOuvre(ymd)) continue;
    if (essai === 3 && ymd === jourPrecedent) continue;
    const a = instantBruxelles(ymd, debutC).getTime();
    const b = instantBruxelles(ymd, finC).getTime();
    const t = Math.max(a, auPlusTot);
    if (t < b) return new Date(t);
  }
  // Filet (jamais atteint en pratique) : le lendemain ouvré, début du créneau.
  return instantBruxelles(lendemainOuvre(finPrecedent), debutC);
}

export type ResultatFiche = "sans_reponse" | "barrage" | "rappeler" | "interesse" | "refus";

export type Relance = {
  /** « YYYY-MM-DD », heure de Bruxelles. */
  jour: string;
  /** Minutes depuis minuit. */
  minutes: number;
  titre: string;
};

export type SuiteCycle =
  | { type: "nouvel_essai"; essai: 2 | 3; pasAvant: Date; motif: string }
  | { type: "fin"; motif: string; relance: Relance | null };

export type MachinePassee = { classement: string; at: Date };

export type EntreeCycle = {
  classement: "repondu_humain" | "repondeur" | "standard_ivr" | "sans_reponse" | "occupe_echec";
  resultat: ResultatFiche;
  /** L'essai qui vient d'être fait (1, 2 ou 3). */
  essai: number;
  finEssai: Date;
  /**
   * Les réponses de machine des appels RÉELS précédents de cette fiche (pas
   * celui-ci), avec leur heure — pour la règle des deux machines.
   */
  machinesAnterieures: MachinePassee[];
  /** Un humain a-t-il déjà décroché sur cette fiche, avant cet appel ? */
  dejaHumain: boolean;
  campagneStatut: "active" | "pause" | "terminee";
  /** Le numéro composé est sur la liste d'opposition (dernier contrôle). */
  opposition: boolean;
  /** La fiche a un rendez-vous à venir (posé par Janet ou par un humain). */
  rdvAVenir: boolean;
  /** La date de rappel donnée par le prospect (« YYYY-MM-DD »), s'il y en a une. */
  rappelerLe: string | null;
  /** Le résumé d'une phrase de Janet, pour le titre de la relance. */
  resume: string | null;
  fenetre?: Fenetre;
};

const TITRE_MAX = 140;

function titre(t: string): string {
  return t.length > TITRE_MAX ? `${t.slice(0, TITRE_MAX - 1)}…` : t;
}

/**
 * La date de la relance « humaine » : celle donnée par le prospect si elle est
 * valide et à venir (pas de rappel dans le passé), sinon le lendemain ouvré.
 * Un rappel demandé pour aujourd'hui tombe aujourd'hui… s'il n'est pas déjà
 * 9h passées : sinon le lendemain ouvré, jamais dans le passé.
 */
export function jourDeRelance(rappelerLe: string | null, maintenant: Date): string {
  const p = partiesBruxelles(maintenant);
  if (rappelerLe && /^\d{4}-\d{2}-\d{2}$/.test(rappelerLe)) {
    const valide = !Number.isNaN(Date.parse(`${rappelerLe}T12:00:00Z`));
    if (valide && rappelerLe > p.ymd) return rappelerLe;
    if (valide && rappelerLe === p.ymd && p.minutes < HEURE_RELANCE) return rappelerLe;
  }
  return lendemainOuvre(maintenant);
}

export function suiteDuCycle(e: EntreeCycle): SuiteCycle {
  const f = e.fenetre ?? FENETRE_DEFAUT;
  const lendemain = (t: string): Relance => ({ jour: lendemainOuvre(e.finEssai), minutes: HEURE_RELANCE, titre: titre(t) });

  if (e.opposition) {
    return { type: "fin", motif: "opposition : ne plus appeler", relance: null };
  }

  if (e.classement === "repondu_humain") {
    if (e.resultat === "refus") return { type: "fin", motif: "refus", relance: null };
    if (e.rdvAVenir) return { type: "fin", motif: "rendez-vous posé", relance: null };
    const resume = e.resume?.trim() ? ` — ${e.resume.trim()}` : "";
    const libelle =
      e.resultat === "interesse"
        ? "Janet : intéressé, sans rendez-vous"
        : e.resultat === "barrage"
          ? "Janet : barrage"
          : "Janet : à rappeler";
    return {
      type: "fin",
      motif: `décroché : ${e.resultat}`,
      relance: { jour: jourDeRelance(e.rappelerLe, e.finEssai), minutes: HEURE_RELANCE, titre: titre(`${libelle}${resume}`) },
    };
  }

  if (e.classement === "standard_ivr") {
    return { type: "fin", motif: "standard automatique", relance: lendemain("Janet : standard automatique, à contacter autrement") };
  }

  if (e.classement === "repondeur" && !e.dejaHumain) {
    const machines = [...e.machinesAnterieures, { classement: "repondeur", at: e.finEssai }];
    const heures = new Set(machines.map((m) => partiesBruxelles(m.at).heure));
    if (machines.length >= 2 && heures.size >= 2) {
      const liste = [...heures].sort((a, b) => a - b).map((h) => heureFr(h * 60)).join(", ");
      return {
        type: "fin",
        motif: "deux réponses de machine à deux heures différentes",
        relance: lendemain(`Janet : deux répondeurs (${liste}), à contacter autrement`),
      };
    }
  }

  // Personne au bout du fil : pas de réponse, occupé, répondeur.
  if (e.essai >= MAX_ESSAIS) {
    return { type: "fin", motif: "3 essais sans joindre personne", relance: lendemain("Janet : 3 essais sans réponse. À vous de voir") };
  }
  if (e.campagneStatut === "terminee") {
    return { type: "fin", motif: "campagne terminée", relance: null };
  }
  const suivant = (e.essai + 1) as 2 | 3;
  return {
    type: "nouvel_essai",
    essai: suivant,
    pasAvant: prochainEssai(suivant, e.finEssai, f),
    motif: `essai ${suivant} programmé`,
  };
}
