/**
 * Le rapport d'un appel : ce que l'annexe a VU, transmis tel quel à Next.
 *
 * L'annexe ne décide de rien d'autre que du raccroché : elle rapporte des faits
 * (événements de transport, répliques, outils appelés, raison de fermeture).
 * C'est Next qui classe, écrit sur la fiche et fait avancer le cycle — une
 * seule copie de la règle.
 *
 * Partagé par l'annexe (Deno), le moteur Next et les tests node : TypeScript
 * portable, un seul import relatif.
 */

import { classerAppel, type FaitsAppel, type Tour } from "./classement.ts";
import { coteTransport } from "./transport.ts";

export type EvenementAppel = {
  /** Millisecondes depuis la création de l'appel. */
  t: number;
  type: string;
  detail?: string;
};

export type ReplicaAppel = Tour & {
  /** Millisecondes depuis la création de l'appel, début et fin de la réplique. */
  t: number;
  fin: number;
};

export type OutilAppele = {
  t: number;
  nom: string;
  arguments: unknown;
  sortie: unknown;
  ok: boolean;
  ms: number;
};

export type EtapeErreur = "preparation" | "creation" | "attache" | "transport" | "annexe";

export type ErreurAppel = {
  etape: EtapeErreur;
  /** Statut HTTP d'OpenAI, s'il y en a un. */
  statut?: number | null;
  code?: string | null;
  message: string;
};

export type RaccrochePar =
  | "prospect"
  | "serveur_machine"
  | "serveur_silence"
  | "serveur_sonnerie"
  | "serveur_plafond"
  | "serveur_fin"
  | "serveur_erreur"
  | "inconnu";

export type RapportAppel = {
  appelId: string;
  sessionId: string | null;
  /** ISO. */
  creeA: string;
  sonnerieA: string | null;
  decrocheA: string | null;
  finA: string;
  evenements: EvenementAppel[];
  tours: ReplicaAppel[];
  outils: OutilAppele[];
  /** `session.closed.reason`, s'il est arrivé. */
  raisonFermeture: string | null;
  /** `session.closed.usage.seconds`. */
  factureS: number | null;
  raccrochePar: RaccrochePar | null;
  /** Ce que l'annexe a reconnu en direct dans l'accueil. */
  machineEnDirect: "repondeur" | "standard_ivr" | null;
  erreur: ErreurAppel | null;
  /** L'âge du worker de l'edge function au début de l'appel. */
  ageWorkerS: number | null;
  /** Le plafond de durée appliqué à cet appel. */
  plafondS: number | null;
};

/**
 * Une panne de NOTRE côté : rien n'a atteint le prospect par notre faute. La
 * ligne repart en file, l'essai ne compte pas.
 *   · préparation, création ou attache refusées ;
 *   · `transport.failed` AVANT toute sonnerie, sauf quand l'erreur désigne le
 *     prospect (occupé, numéro inexistant, refusé : voir transport.ts). Une
 *     cause INCONNUE est d'abord comptée de notre côté — rien n'est brûlé ;
 *     c'est le plan de fin qui la requalifie à la seconde fois sur la même
 *     fiche (« numéro injoignable »). Après sonnerie, c'est le prospect.
 */
export function panneDeNotreCote(r: RapportAppel): boolean {
  if (!r.erreur) return false;
  if (r.erreur.etape === "preparation" || r.erreur.etape === "creation" || r.erreur.etape === "attache") return true;
  if (r.erreur.etape === "transport") return !r.sonnerieA && coteTransport(r.erreur) !== "eux";
  return false;
}

/** Un échec de ligne avant sonnerie dont on ignore le responsable. */
export function transportInconnu(r: RapportAppel): boolean {
  return r.erreur?.etape === "transport" && !r.sonnerieA && coteTransport(r.erreur) === "inconnu";
}

/**
 * Une fin LISIBLE : on sait comment l'appel s'est terminé. Sinon c'est un
 * échec NEUTRE — rien n'est écrit au journal, rien n'est deviné (une fin
 * illisible n'est JAMAIS un « pas de réponse »).
 */
export function finLisible(r: RapportAppel): boolean {
  if (r.erreur?.etape === "annexe") return false;
  if (r.erreur?.etape === "transport") return true;
  if (r.raisonFermeture) return true;
  // Nous avons raccroché nous-mêmes, et su pourquoi.
  return r.raccrochePar !== null && r.raccrochePar !== "inconnu" && r.raccrochePar !== "serveur_erreur";
}

const ACTIONS_RDV = new Set(["rdv"]);

/** Les faits du classement, tirés du rapport. */
export function faitsDepuisRapport(r: RapportAppel): FaitsAppel {
  const decroche = Boolean(r.decrocheA);
  const dureeEnLigneS = r.decrocheA
    ? Math.max(0, Math.round((Date.parse(r.finA) - Date.parse(r.decrocheA)) / 1000))
    : null;
  const finAppel = [...r.outils].reverse().find((o) => o.nom === "fin_appel" && o.ok);
  const motif =
    finAppel && finAppel.arguments && typeof finAppel.arguments === "object"
      ? String((finAppel.arguments as Record<string, unknown>).motif ?? "")
      : null;
  return {
    // Après sonnerie, ou avant quand l'erreur désigne le prospect (occupé…).
    echecTransport: r.erreur?.etape === "transport" && (Boolean(r.sonnerieA) || coteTransport(r.erreur) === "eux"),
    decroche,
    dureeEnLigneS,
    tours: r.tours.map((t) => ({ qui: t.qui, texte: t.texte })),
    machineEnDirect: r.machineEnDirect,
    finAppelJanet: motif || null,
    rdvPose: r.outils.some((o) => ACTIONS_RDV.has(o.nom) && o.ok && aReussi(o.sortie)),
    opposition: r.outils.some((o) => o.nom === "opposition" && o.ok && aReussi(o.sortie)),
  };
}

function aReussi(sortie: unknown): boolean {
  return Boolean(sortie && typeof sortie === "object" && (sortie as Record<string, unknown>).ok === true);
}

/** Un rapport sans appel : la préparation a échoué, ou l'annexe s'est arrêtée. */
export function rapportSansAppel(appelId: string, etape: "preparation" | "annexe", message: string): RapportAppel {
  const maintenant = new Date().toISOString();
  return {
    appelId,
    sessionId: null,
    creeA: maintenant,
    sonnerieA: null,
    decrocheA: null,
    finA: maintenant,
    evenements: [],
    tours: [],
    outils: [],
    raisonFermeture: null,
    factureS: null,
    raccrochePar: null,
    machineEnDirect: null,
    erreur: { etape, statut: null, code: null, message },
    ageWorkerS: null,
    plafondS: null,
  };
}

/**
 * Relit un rapport reçu (signé, donc venu de l'annexe — mais lu prudemment :
 * tout champ de la mauvaise forme est remis à vide, rien n'est deviné).
 */
export function lireRapport(brut: unknown): RapportAppel | null {
  if (!brut || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const tableau = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]).slice(0, 1000) : []);
  const appelId = s(o.appelId);
  if (!appelId || !/^[0-9a-f-]{36}$/.test(appelId)) return null;
  const e = o.erreur as Record<string, unknown> | null | undefined;
  const etapes = ["preparation", "creation", "attache", "transport", "annexe"];
  return {
    appelId,
    sessionId: s(o.sessionId),
    creeA: s(o.creeA) ?? new Date().toISOString(),
    sonnerieA: s(o.sonnerieA),
    decrocheA: s(o.decrocheA),
    finA: s(o.finA) ?? new Date().toISOString(),
    evenements: tableau<EvenementAppel>(o.evenements),
    tours: tableau<ReplicaAppel>(o.tours).filter((t) => t && (t.qui === "prospect" || t.qui === "janet") && typeof t.texte === "string"),
    outils: tableau<OutilAppele>(o.outils).filter((t) => t && typeof t.nom === "string"),
    raisonFermeture: s(o.raisonFermeture),
    factureS: n(o.factureS),
    raccrochePar: (s(o.raccrochePar) as RaccrochePar | null) ?? null,
    machineEnDirect: o.machineEnDirect === "repondeur" || o.machineEnDirect === "standard_ivr" ? o.machineEnDirect : null,
    erreur:
      e && typeof e === "object" && etapes.includes(String(e.etape))
        ? { etape: e.etape as EtapeErreur, statut: n(e.statut), code: s(e.code), message: s(e.message) ?? "" }
        : null,
    ageWorkerS: n(o.ageWorkerS),
    plafondS: n(o.plafondS),
  };
}

/** Classement direct d'un rapport (lisible). */
export function classerRapport(r: RapportAppel) {
  return classerAppel(faitsDepuisRapport(r));
}
