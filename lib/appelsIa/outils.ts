/**
 * Les outils de Janet pendant l'appel — définitions, lecture des arguments,
 * créneaux libres. Pur, testé par outils.test.ts.
 *
 * Les outils agissent TOUJOURS sur la fiche de l'appel en cours, désignée par
 * l'id d'appel que l'annexe signe (HMAC) — jamais sur un id venu du modèle :
 * aucun outil n'a de paramètre « fiche » ou « prospect ».
 *
 * Le nom d'outil se cherche avec `Object.hasOwn` : avec `in` ou un accès
 * direct, « constructor » ou « toString » passeraient pour des outils.
 */

import {
  ajouterJours,
  enMinutes,
  estOuvre,
  FENETRE_DEFAUT,
  instantBruxelles,
  jourHeureFr,
  partiesBruxelles,
  type Fenetre,
} from "./calendrier.ts";

export type NomOutil = "creneaux" | "rdv" | "opposition" | "noter_resultat" | "fin_appel";

export type DefinitionOutil = {
  type: "function";
  name: NomOutil;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
};

export const OUTILS: Record<NomOutil, DefinitionOutil> = {
  creneaux: {
    type: "function",
    name: "creneaux",
    description:
      "Donne jusqu'à quatre créneaux libres de 30 minutes pour la démonstration, dans l'agenda du responsable. Appelle-le AVANT de proposer une date ; ne propose jamais un créneau qui ne vient pas de cet outil.",
    parameters: {
      type: "object",
      properties: {
        jour: { type: "string", description: "Jour souhaité par le prospect, au format YYYY-MM-DD, seulement s'il en a donné un." },
        moment: { type: "string", enum: ["matin", "apres-midi", "indifferent"], description: "Moment de la journée préféré par le prospect." },
      },
      additionalProperties: false,
    },
  },
  rdv: {
    type: "function",
    name: "rdv",
    description:
      "Pose la démonstration de 30 minutes dans l'agenda, sur un créneau rendu par « creneaux », et seulement après un oui clair du prospect.",
    parameters: {
      type: "object",
      properties: {
        debut: { type: "string", description: "Début du créneau, YYYY-MM-DDTHH:MM, heure de Belgique, exactement comme rendu par « creneaux »." },
        interlocuteur: { type: "string", description: "Nom de la personne qui assistera à la démonstration." },
        email: { type: "string", description: "Son adresse email, si elle l'a donnée." },
        notes: { type: "string", description: "Ce qu'il faut savoir pour la démonstration, en une ou deux phrases." },
      },
      required: ["debut"],
      additionalProperties: false,
    },
  },
  opposition: {
    type: "function",
    name: "opposition",
    description:
      "La personne ne veut plus être appelée (« ne m'appelez plus », « retirez-moi », « pas de démarchage ») : enregistre-le IMMÉDIATEMENT, avant de saluer.",
    parameters: {
      type: "object",
      properties: { motif: { type: "string", description: "Ce que la personne a dit, en quelques mots." } },
      additionalProperties: false,
    },
  },
  noter_resultat: {
    type: "function",
    name: "noter_resultat",
    description:
      "Avant de raccrocher avec une PERSONNE (jamais sur un répondeur), note le résultat de l'appel.",
    parameters: {
      type: "object",
      properties: {
        resultat: {
          type: "string",
          enum: ["interesse", "rappeler", "refus", "barrage"],
          description:
            "interesse : intérêt réel ; rappeler : il faut rappeler (le décideur absent, pas le moment) ; refus : pas intéressé ; barrage : quelqu'un a filtré sans vous passer le décideur.",
        },
        resume: { type: "string", description: "Ce qui s'est dit, en une phrase." },
        interlocuteur: { type: "string", description: "Qui vous avez eu : nom et fonction si connus (« Marie, secrétaire »)." },
        decideur: { type: "boolean", description: "Vrai seulement si vous avez parlé au décideur (gérant, patron, titulaire)." },
        motif_refus: { type: "string", description: "La raison du refus, s'il y en a une." },
        appris: { type: "string", description: "Ce qui servira au prochain appel : horaires, nom du décideur, moment pour rappeler, outil actuel." },
        rappeler_le: { type: "string", description: "Date de rappel donnée par la personne, YYYY-MM-DD, seulement si elle en a donné une." },
      },
      required: ["resultat", "resume", "decideur"],
      additionalProperties: false,
    },
  },
  fin_appel: {
    type: "function",
    name: "fin_appel",
    description:
      "Termine l'appel. Répondeur ou messagerie, menu « tapez 1 » ou serveur vocal : appelle-le TOUT DE SUITE, sans rien dire, avec le motif. Après une conversation : après avoir noté le résultat et salué.",
    parameters: {
      type: "object",
      properties: {
        motif: { type: "string", enum: ["repondeur", "standard", "conversation_terminee", "hors_cible"] },
      },
      required: ["motif"],
      additionalProperties: false,
    },
  },
};

export function estOutil(nom: string): nom is NomOutil {
  return typeof nom === "string" && Object.hasOwn(OUTILS, nom);
}

export function definitionsOutils(): DefinitionOutil[] {
  return Object.values(OUTILS);
}

export type ArgsCreneaux = { jour: string | null; moment: "matin" | "apres-midi" | "indifferent" };
export type ArgsRdv = { debut: string; interlocuteur: string | null; email: string | null; notes: string | null };
export type ArgsOpposition = { motif: string | null };
export type ArgsNoter = Record<string, unknown>;
export type ArgsFin = { motif: "repondeur" | "standard" | "conversation_terminee" | "hors_cible" };

export type LectureArgs =
  | { ok: true; nom: "creneaux"; args: ArgsCreneaux }
  | { ok: true; nom: "rdv"; args: ArgsRdv }
  | { ok: true; nom: "opposition"; args: ArgsOpposition }
  | { ok: true; nom: "noter_resultat"; args: ArgsNoter }
  | { ok: true; nom: "fin_appel"; args: ArgsFin }
  | { ok: false; erreur: string };

function texte(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s ? s.slice(0, max) : null;
}

/** Lit les arguments d'un appel d'outil (chaîne JSON ou objet), sans rien deviner. */
export function lireArguments(nom: string, brut: unknown): LectureArgs {
  if (!estOutil(nom)) return { ok: false, erreur: `Outil inconnu : ${String(nom).slice(0, 40)}` };
  let a: Record<string, unknown> = {};
  if (typeof brut === "string") {
    if (brut.trim()) {
      try {
        const v = JSON.parse(brut);
        if (v && typeof v === "object" && !Array.isArray(v)) a = v as Record<string, unknown>;
        else return { ok: false, erreur: "Arguments illisibles." };
      } catch {
        return { ok: false, erreur: "Arguments illisibles." };
      }
    }
  } else if (brut && typeof brut === "object" && !Array.isArray(brut)) {
    a = brut as Record<string, unknown>;
  }
  switch (nom) {
    case "creneaux": {
      const jour = typeof a.jour === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.jour) ? a.jour : null;
      const m = a.moment === "matin" || a.moment === "apres-midi" ? a.moment : "indifferent";
      return { ok: true, nom, args: { jour, moment: m } };
    }
    case "rdv": {
      const debut = typeof a.debut === "string" ? a.debut.trim().slice(0, 16) : "";
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(debut)) {
        return { ok: false, erreur: "Il faut le début exact du créneau, au format YYYY-MM-DDTHH:MM, tel que rendu par « creneaux »." };
      }
      return {
        ok: true,
        nom,
        args: { debut, interlocuteur: texte(a.interlocuteur, 120), email: texte(a.email, 160), notes: texte(a.notes, 500) },
      };
    }
    case "opposition":
      return { ok: true, nom, args: { motif: texte(a.motif, 300) } };
    case "noter_resultat":
      return { ok: true, nom, args: a };
    case "fin_appel": {
      const m = a.motif;
      if (m !== "repondeur" && m !== "standard" && m !== "conversation_terminee" && m !== "hors_cible") {
        return { ok: false, erreur: "Motif inconnu : repondeur, standard, conversation_terminee ou hors_cible." };
      }
      return { ok: true, nom, args: { motif: m } };
    }
  }
  return { ok: false, erreur: "Outil inconnu." };
}

// ---------------------------------------------------------------------------
// Les créneaux libres
// ---------------------------------------------------------------------------

export type Occupation = { debut: Date; fin: Date };
export type Creneau = { debut: string; libelle: string };

export const DUREE_DEMO_MIN = 30;
/** Pas de démonstration à moins de 2 h : le propriétaire doit pouvoir s'y préparer. */
export const DELAI_MIN_MS = 2 * 3600_000;
/** Une marge autour des rendez-vous existants. */
const MARGE_MS = 15 * 60_000;

export type OptionsCreneaux = {
  fenetre?: Fenetre;
  /** Jours ouvrés regardés. */
  jours?: number;
  max?: number;
  jourSouhaite?: string | null;
  moment?: "matin" | "apres-midi" | "indifferent";
};

function libre(debut: Date, occupations: Occupation[]): boolean {
  const a = debut.getTime() - MARGE_MS;
  const b = debut.getTime() + DUREE_DEMO_MIN * 60_000 + MARGE_MS;
  return !occupations.some((o) => o.debut.getTime() < b && o.fin.getTime() > a);
}

function aLHeure(d: Date): string {
  const p = partiesBruxelles(d);
  return `${p.ymd}T${String(p.heure).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * Jusqu'à `max` créneaux de 30 min dans la fenêtre des jours ouvrés à venir,
 * jamais dans le passé ni à moins de 2 h, jamais sur un rendez-vous existant.
 * Étalés : un le matin et un l'après-midi par jour, sur plusieurs jours.
 */
export function creneauxLibres(occupations: Occupation[], maintenant: Date, o: OptionsCreneaux = {}): Creneau[] {
  const f = o.fenetre ?? FENETRE_DEFAUT;
  const max = o.max ?? 4;
  const debutF = enMinutes(f.debut);
  const finF = enMinutes(f.fin);
  const premier = Math.ceil(debutF / 30) * 30;
  const auPlusTot = maintenant.getTime() + DELAI_MIN_MS;

  const jours: string[] = [];
  const souhait = o.jourSouhaite && estOuvre(o.jourSouhaite) ? o.jourSouhaite : null;
  if (souhait) jours.push(souhait);
  let ymd = partiesBruxelles(maintenant).ymd;
  for (let i = 0; jours.length < (o.jours ?? 10) + (souhait ? 1 : 0) && i < 40; i++, ymd = ajouterJours(ymd, 1)) {
    if (estOuvre(ymd) && ymd !== souhait) jours.push(ymd);
  }

  const resultat: Creneau[] = [];
  for (const j of jours) {
    if (resultat.length >= max) break;
    const parMoment: Record<"matin" | "apres-midi", Date | null> = { matin: null, "apres-midi": null };
    for (let m = premier; m + DUREE_DEMO_MIN <= finF; m += 30) {
      const d = instantBruxelles(j, m);
      if (d.getTime() < auPlusTot || !libre(d, occupations)) continue;
      const moment = m < 12 * 60 ? "matin" : m >= 13 * 60 ? "apres-midi" : null;
      if (!moment) continue;
      if (!parMoment[moment]) parMoment[moment] = d;
    }
    const voulus =
      o.moment === "matin" ? [parMoment.matin] : o.moment === "apres-midi" ? [parMoment["apres-midi"]] : [parMoment.matin, parMoment["apres-midi"]];
    for (const d of voulus) {
      if (d && resultat.length < max) resultat.push({ debut: aLHeure(d), libelle: jourHeureFr(d) });
    }
  }
  return resultat;
}

/**
 * Un début de démonstration est-il posable ? Jamais dans le passé, jamais à
 * moins de 2 h, un jour ouvré, dans la fenêtre, sur un créneau libre, dans les
 * 30 jours. Renvoie la raison du refus, ou null.
 */
export function refusRdv(debutLocal: string, occupations: Occupation[], maintenant: Date, f: Fenetre = FENETRE_DEFAUT): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(debutLocal);
  if (!m) return "Format attendu : YYYY-MM-DDTHH:MM.";
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  const debut = instantBruxelles(m[1], minutes);
  if (Number.isNaN(debut.getTime())) return "Date invalide.";
  if (debut.getTime() <= maintenant.getTime()) return "Ce créneau est dans le passé : redemandez les créneaux.";
  if (debut.getTime() < maintenant.getTime() + DELAI_MIN_MS) return "Trop tôt : la démonstration se pose au moins deux heures à l'avance.";
  if (debut.getTime() > maintenant.getTime() + 30 * 86400_000) return "Trop loin : proposez un créneau dans les 30 jours.";
  if (!estOuvre(m[1])) return "Ce jour n'est pas ouvré : redemandez les créneaux.";
  if (minutes < enMinutes(f.debut) || minutes + DUREE_DEMO_MIN > enMinutes(f.fin)) return "Hors des heures de démonstration : redemandez les créneaux.";
  if (!libre(debut, occupations)) return "Ce créneau vient d'être pris : redemandez les créneaux.";
  return null;
}
