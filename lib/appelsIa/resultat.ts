/**
 * Ce qu'un appel de Janet écrit sur la fiche — pur, testé.
 *
 * L'ORDRE DES PREUVES (cahier des charges) :
 *   1. ce que Janet a FAIT : un rendez-vous posé → « intéressé » ; une
 *      opposition → « refus » ;
 *   2. personne au bout du fil : répondeur, pas de réponse, occupé → « pas de
 *      réponse » (pas un échange) ; standard automatique → « barrage », mais
 *      SANS compter comme un échange (dans le CRM, un barrage est un humain
 *      qui filtre : la fiche passerait sinon en « Contacté ») ;
 *   3. ce que Janet DÉCLARE par `noter_resultat` ;
 *   4. à défaut, « à rappeler ». Une fin illisible n'arrive jamais ici : elle
 *      est un échec neutre, rien n'est écrit (lib/appelsIa/fin.ts).
 */

import type { Classement } from "../../supabase/functions/_shared/appels/classement.ts";

export type ResultatAppel = "sans_reponse" | "barrage" | "rappeler" | "interesse" | "refus";

export type Declaration = {
  resultat: "interesse" | "rappeler" | "refus" | "barrage";
  resume: string;
  interlocuteur: string | null;
  /** Janet a-t-elle eu le DÉCIDEUR (pas une secrétaire) ? */
  decideur: boolean;
  motifRefus: string | null;
  appris: string | null;
  /** « YYYY-MM-DD ». */
  rappelerLe: string | null;
};

export type EcritureFiche = {
  resultat: ResultatAppel;
  /** Atteste-t-il d'un échange réel avec quelqu'un ? */
  isExchange: boolean;
  /** Le texte de la dernière action sur la carte — SANS préfixe « Appel IA · ». */
  sujet: string;
  /** Le nom du contact de la fiche, seulement si Janet a eu le décideur. */
  contact: string | null;
  /** La raison du refus, versée aussi dans `prospects.lost_reason`. */
  motifRefus: string | null;
};

const SUJET_MAX = 280;

function court(t: string | null | undefined): string {
  const v = (t ?? "").replace(/\s+/g, " ").trim();
  return v.length > SUJET_MAX ? `${v.slice(0, SUJET_MAX - 1)}…` : v;
}

const SUJET_MACHINE: Record<string, string> = {
  repondeur: "Répondeur",
  sans_reponse: "Pas décroché",
  occupe_echec: "Occupé ou injoignable",
  standard_ivr: "Standard automatique",
};

export function ecritureFiche(
  classement: Classement,
  faits: { rdvPose: boolean; opposition: boolean; rdvLibelle?: string | null },
  declaration: Declaration | null
): EcritureFiche {
  const contact =
    declaration?.decideur && declaration.interlocuteur?.trim() ? declaration.interlocuteur.trim().slice(0, 120) : null;

  if (faits.rdvPose) {
    return {
      resultat: "interesse",
      isExchange: true,
      sujet: court(declaration?.resume || (faits.rdvLibelle ? `Démo posée ${faits.rdvLibelle}` : "Démo posée")),
      contact,
      motifRefus: null,
    };
  }
  if (faits.opposition) {
    return {
      resultat: "refus",
      isExchange: true,
      sujet: court(declaration?.resume || "Ne veut plus être appelé"),
      contact,
      motifRefus: "Ne veut plus être appelé",
    };
  }
  if (classement === "standard_ivr") {
    return { resultat: "barrage", isExchange: false, sujet: SUJET_MACHINE.standard_ivr, contact: null, motifRefus: null };
  }
  if (classement !== "repondu_humain") {
    return { resultat: "sans_reponse", isExchange: false, sujet: SUJET_MACHINE[classement] ?? "Pas de réponse", contact: null, motifRefus: null };
  }
  if (declaration) {
    return {
      resultat: declaration.resultat,
      isExchange: true,
      sujet: court(declaration.resume) || "Appel de Janet",
      contact,
      motifRefus: declaration.resultat === "refus" ? court(declaration.motifRefus) || "Sans précision" : null,
    };
  }
  return { resultat: "rappeler", isExchange: true, sujet: "Décroché, conclusion non notée — à rappeler", contact: null, motifRefus: null };
}

/**
 * Lit la déclaration de `noter_resultat` telle que Janet l'a envoyée. Rien
 * n'est deviné : une valeur inconnue ou absente rend `null`.
 */
export function lireDeclaration(brut: unknown): Declaration | null {
  if (!brut || typeof brut !== "object") return null;
  const a = brut as Record<string, unknown>;
  const r = String(a.resultat ?? "");
  if (r !== "interesse" && r !== "rappeler" && r !== "refus" && r !== "barrage") return null;
  const texte = (v: unknown, max: number) => {
    const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
    return s ? s.slice(0, max) : null;
  };
  const date = typeof a.rappeler_le === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.rappeler_le) ? a.rappeler_le : null;
  return {
    resultat: r,
    resume: texte(a.resume, 280) ?? "",
    interlocuteur: texte(a.interlocuteur, 120),
    decideur: a.decideur === true,
    motifRefus: texte(a.motif_refus, 300),
    appris: texte(a.appris, 500),
    rappelerLe: date,
  };
}
