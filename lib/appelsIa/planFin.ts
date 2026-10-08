/**
 * La fin d'un appel : ce qu'il faut écrire, et où — décidé ici, PUR, testé
 * (cycle, résultat, classement réunis). L'exécuteur (lib/appelsIa/fin.ts) ne
 * fait qu'appliquer ce plan en base.
 *
 * Trois issues, et seulement trois :
 *   1. PANNE DE NOTRE CÔTÉ (création refusée, annexe injoignable, jamais
 *      sonné) : rien sur la fiche, l'essai ne compte pas, la ligne repart en
 *      file un peu plus tard. Pause immédiate si la cause ne se répare pas
 *      seule ; sinon à la deuxième panne d'affilée.
 *   2. FIN ILLISIBLE : échec NEUTRE. Rien n'est écrit au journal, rien n'est
 *      deviné — jamais un « pas de réponse » par défaut. La ligne repart aussi,
 *      sans compter d'essai.
 *   3. FIN LISIBLE : classement, écriture sur la fiche (au nom du
 *      propriétaire), ligne apprise au brief, suite du cycle.
 * Un appel de TEST n'écrit jamais rien sur la fiche et ne fait pas avancer le
 * cycle : sa ligne de file se termine.
 */

import {
  classerAppel,
  estMachine,
  type Classement,
} from "../../supabase/functions/_shared/appels/classement.ts";
import {
  faitsDepuisRapport,
  finLisible,
  panneDeNotreCote,
  transportInconnu,
  type RapportAppel,
} from "../../supabase/functions/_shared/appels/rapport.ts";
import { causeDe } from "./causes.ts";
import { ecritureFiche, lireDeclaration, type Declaration, type ResultatAppel } from "./resultat.ts";
import { HEURE_RELANCE, suiteDuCycle, type MachinePassee, type Relance } from "./cycle.ts";
import { ligneApprise, type LigneApprise } from "./brief.ts";
import { lendemainOuvre, partiesBruxelles, type Fenetre } from "./calendrier.ts";
import { OUTCOME_LABEL_APPEL } from "./libelles.ts";

/** Une panne de notre côté : la ligne repart dans 10 min ; une fin illisible : dans 30 min. */
export const REPORT_PANNE_MS = 10 * 60_000;
export const REPORT_NEUTRE_MS = 30 * 60_000;
/** À la deuxième panne d'affilée, le moteur se met en pause. */
export const PANNES_AVANT_PAUSE = 2;

export type ContexteFin = {
  appel: {
    id: string;
    essai: number;
    mode_test: boolean;
    file_id: string | null;
    prospect_id: string | null;
  };
  /** La ligne de file et le statut de sa campagne (null pour un appel de test hors file). */
  file: { id: string; campagneStatut: "active" | "pause" | "terminee" } | null;
  fiche: { id: string; company_name: string } | null;
  rapport: RapportAppel;
  /** Réponses de machine des appels RÉELS précédents de la fiche. */
  machinesAnterieures: MachinePassee[];
  dejaHumain: boolean;
  /** Dernier contrôle, relu à l'écriture : le numéro composé est-il en opposition ? */
  opposition: boolean;
  /** La fiche a-t-elle un rendez-vous à venir, relu après l'appel ? */
  rdvAVenir: boolean;
  /** Libellé du RDV posé pendant l'appel (« mardi 13 octobre à 10h »). */
  rdvLibelle: string | null;
  /** Pannes (nous ou neutres) d'affilée juste avant cet appel. */
  pannesAvant: number;
  /**
   * La fiche a déjà eu un échec de ligne de cause inconnue (`transport_inconnu`)
   * ET un autre appel a abouti depuis : la ligne marche, c'est le numéro.
   */
  ligneProuveeDepuisEchec?: boolean;
  maintenant: Date;
  fenetre: Fenetre;
};

export type PlanFin = {
  appel: {
    statut: "termine" | "echec";
    classement: Classement | null;
    resultat: ResultatAppel | null;
    resume: string | null;
    interlocuteur: string | null;
    declaration: Declaration | null;
    fin_motif_janet: string | null;
    erreur_cote: "nous" | "neutre" | null;
    erreur_code: string | null;
    erreur_message: string | null;
    opposition: boolean;
  };
  /** L'entrée du journal de la fiche (saveExchangeCore), ou rien. */
  journal: {
    outcome: ResultatAppel;
    isExchange: boolean;
    sujet: string;
    corps: string;
    contact: string | null;
    motifRefus: string | null;
  } | null;
  relance: Relance | null;
  appris: LigneApprise | null;
  file:
    | { statut: "en_attente"; essais: number | null; pasAvant: Date; note: string }
    | { statut: "termine" | "arrete"; essais: number | null; motif: string; note: string }
    | null;
  /** La cause qui met le moteur en pause, ou rien. */
  pause: string | null;
  /** Lancer l'appel suivant tout de suite. */
  chainer: boolean;
};

function derniereDeclaration(r: RapportAppel): Declaration | null {
  const n = [...r.outils].reverse().find((o) => o.nom === "noter_resultat" && o.ok);
  if (!n) return null;
  const s = n.sortie as Record<string, unknown> | null;
  if (s && s.ok === false) return null;
  return lireDeclaration(n.arguments);
}

function motifFinJanet(r: RapportAppel): string | null {
  const f = [...r.outils].reverse().find((o) => o.nom === "fin_appel" && o.ok);
  const a = f?.arguments as Record<string, unknown> | undefined;
  return typeof a?.motif === "string" ? a.motif : null;
}

function duree(r: RapportAppel): string {
  if (!r.decrocheA) return "pas décroché";
  const s = Math.max(0, Math.round((Date.parse(r.finA) - Date.parse(r.decrocheA)) / 1000));
  return s < 60 ? `${s} s en ligne` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s en ligne`;
}

export function planifierFin(c: ContexteFin): PlanFin {
  const r = c.rapport;
  const vide = {
    classement: null,
    resultat: null,
    resume: null,
    interlocuteur: null,
    declaration: null,
    fin_motif_janet: null,
    opposition: false,
  } as const;

  // 0. Second échec de ligne inconnu sur la même fiche, alors que la ligne a
  //    prouvé qu'elle marche entre-temps : le NUMÉRO est en cause. Le cycle
  //    s'arrête, le moteur ne se met PAS en pause (les autres fiches passent),
  //    rien n'est écrit au journal (personne n'a été joint), et le propriétaire
  //    reçoit une relance pour vérifier le numéro.
  if (transportInconnu(r) && c.ligneProuveeDepuisEchec && !c.appel.mode_test && c.fiche) {
    const message = `${causeDe(r.erreur).message} Deuxième échec de ligne sur ce numéro alors que d'autres appels passent : numéro probablement injoignable.`;
    return {
      appel: { ...vide, statut: "echec", erreur_cote: null, erreur_code: "numero_injoignable", erreur_message: message.slice(0, 500) },
      journal: null,
      relance: { jour: lendemainOuvre(new Date(r.finA)), minutes: HEURE_RELANCE, titre: "Janet : numéro injoignable (deux échecs de ligne), à vérifier" },
      appris: null,
      file: c.file ? { statut: "arrete", essais: null, motif: "numéro injoignable", note: "deux échecs de ligne avant sonnerie" } : null,
      pause: null,
      chainer: true,
    };
  }

  // 1. Panne de notre côté.
  if (panneDeNotreCote(r)) {
    const cause = causeDe(r.erreur);
    const pause = cause.pauseImmediate || c.pannesAvant + 1 >= PANNES_AVANT_PAUSE ? cause.message : null;
    // Un échec de ligne inconnu est marqué pour être reconnu au passage suivant.
    const code = transportInconnu(r) ? "transport_inconnu" : (r.erreur?.code ?? r.erreur?.etape ?? null);
    return {
      appel: { ...vide, statut: "echec", erreur_cote: "nous", erreur_code: code, erreur_message: cause.message },
      journal: null,
      relance: null,
      appris: null,
      file: c.file
        ? c.appel.mode_test
          ? { statut: "termine", essais: null, motif: `appel de test : ${cause.message}`, note: cause.message }
          : { statut: "en_attente", essais: null, pasAvant: new Date(c.maintenant.getTime() + REPORT_PANNE_MS), note: `panne de notre côté — ${cause.message}` }
        : null,
      pause,
      chainer: false,
    };
  }

  // 2. Fin illisible : échec neutre, rien n'est deviné.
  if (!finLisible(r)) {
    const message = causeDe(r.erreur ?? { etape: "annexe", message: "l'appel s'est terminé sans fin connue" }).message;
    return {
      appel: { ...vide, statut: "echec", erreur_cote: "neutre", erreur_code: "fin_illisible", erreur_message: message },
      journal: null,
      relance: null,
      appris: null,
      file: c.file
        ? c.appel.mode_test
          ? { statut: "termine", essais: null, motif: "appel de test : fin illisible", note: message }
          : { statut: "en_attente", essais: null, pasAvant: new Date(c.maintenant.getTime() + REPORT_NEUTRE_MS), note: message }
        : null,
      pause: c.pannesAvant + 1 >= PANNES_AVANT_PAUSE ? `Deux appels d'affilée sans fin lisible. ${message}` : null,
      chainer: false,
    };
  }

  // 3. Fin lisible.
  const faits = faitsDepuisRapport(r);
  const verdict = classerAppel(faits);
  const declaration = verdict.classement === "repondu_humain" ? derniereDeclaration(r) : null;
  const ecriture = ecritureFiche(verdict.classement, { rdvPose: faits.rdvPose, opposition: faits.opposition, rdvLibelle: c.rdvLibelle }, declaration);
  const opposition = c.opposition || faits.opposition;
  const appel: PlanFin["appel"] = {
    statut: "termine",
    classement: verdict.classement,
    resultat: ecriture.resultat,
    resume: ecriture.sujet,
    interlocuteur: declaration?.interlocuteur ?? null,
    declaration,
    fin_motif_janet: motifFinJanet(r),
    erreur_cote: null,
    erreur_code: null,
    erreur_message: null,
    opposition,
  };

  if (c.appel.mode_test) {
    return {
      appel,
      journal: null,
      relance: null,
      appris: null,
      file: c.file ? { statut: "termine", essais: null, motif: "appel de test", note: `test : ${ecriture.sujet}` } : null,
      pause: null,
      chainer: Boolean(c.file),
    };
  }
  if (!c.fiche) {
    return {
      appel,
      journal: null,
      relance: null,
      appris: null,
      file: c.file ? { statut: "arrete", essais: c.appel.essai, motif: "fiche supprimée pendant l'appel", note: "fiche supprimée" } : null,
      pause: null,
      chainer: true,
    };
  }

  const corps = [
    `Appel de Janet — essai ${c.appel.essai}/3, ${duree(r)}.`,
    `Classement : ${verdict.raison}.`,
    declaration?.interlocuteur ? `Interlocuteur : ${declaration.interlocuteur}${declaration.decideur ? " (décideur)" : ""}.` : null,
    declaration?.resume ? `Résumé : ${declaration.resume}` : null,
    declaration?.appris ? `Appris : ${declaration.appris}` : null,
    c.rdvLibelle ? `Démonstration posée ${c.rdvLibelle}.` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const suite = suiteDuCycle({
    classement: verdict.classement,
    resultat: ecriture.resultat,
    essai: c.appel.essai,
    finEssai: new Date(r.finA),
    machinesAnterieures: c.machinesAnterieures,
    dejaHumain: c.dejaHumain,
    campagneStatut: c.file?.campagneStatut ?? "active",
    opposition,
    rdvAVenir: c.rdvAVenir,
    rappelerLe: declaration?.rappelerLe ?? null,
    resume: declaration?.resume ?? null,
    fenetre: c.fenetre,
  });

  const jour = partiesBruxelles(new Date(r.finA)).ymd;
  const appris = declaration
    ? ligneApprise({
        date: jour,
        essai: c.appel.essai,
        interlocuteur: declaration.interlocuteur,
        decideur: declaration.decideur,
        appris: declaration.appris,
        resultatLibelle: OUTCOME_LABEL_APPEL[ecriture.resultat],
      })
    : null;

  return {
    appel,
    journal: {
      outcome: ecriture.resultat,
      isExchange: ecriture.isExchange,
      sujet: ecriture.sujet,
      corps,
      contact: ecriture.contact,
      motifRefus: ecriture.motifRefus,
    },
    relance: suite.type === "fin" ? suite.relance : null,
    appris,
    file: c.file
      ? suite.type === "nouvel_essai"
        ? { statut: "en_attente", essais: c.appel.essai, pasAvant: suite.pasAvant, note: `${ecriture.sujet} — ${suite.motif}` }
        : { statut: opposition ? "arrete" : "termine", essais: c.appel.essai, motif: suite.motif, note: ecriture.sujet }
      : null,
    pause: null,
    chainer: true,
  };
}

/** Les machines précédentes d'une fiche, depuis ses appels réels. */
export function machinesDe(appels: { classement: string | null; created_at: string }[]): {
  machines: MachinePassee[];
  dejaHumain: boolean;
} {
  return {
    machines: appels.filter((a) => estMachine(a.classement)).map((a) => ({ classement: a.classement!, at: new Date(a.created_at) })),
    dejaHumain: appels.some((a) => a.classement === "repondu_humain"),
  };
}
