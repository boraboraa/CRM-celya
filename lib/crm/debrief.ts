/**
 * Le DÉBRIEF d'un rendez-vous — ce qu'il a donné, et ce que ça fait sur la
 * fiche. La règle, écrite UNE fois : le composant de débrief (fiche ET tableau
 * de bord), la server action, le cœur agenda (`cloturerRendezVous`) et l'outil
 * MCP `debriefer_rendez_vous` lisent tous ce module.
 *
 * Constat du 18/10/2026 : 15 rendez-vous, 0 débriefé. Le débrief n'existait
 * que dans la dernière zone du tableau de bord, avec trois boutons qui ne
 * disaient pas l'issue (« Ça s'est fait / Annulé / Reporté ») et ne pouvaient
 * pas faire bouger l'étape. Ici, l'ISSUE :
 *
 *   Intéressé — à rappeler   tenu ; relance à la date choisie (EXIGÉE) ;
 *                            l'étape suit le fait → « À rappeler » (026)
 *   Suivi par email          tenu ; relance à la date choisie (EXIGÉE) ;
 *                            l'étape suit le fait → « Suivi par email » (033)
 *   Proposition envoyée      tenu ; proposal_sent_at → « Proposition »
 *   Essai gratuit démarré    tenu ; « Essai gratuit », VERROUILLÉ (031) —
 *                            le « win » d'un étudiant ; une date « Et
 *                            ensuite ? » reste offerte (la fin de l'essai)
 *   Signé                    tenu ; « Gagné », VERROUILLÉ (geste humain)
 *   Pas intéressé            tenu ; raison EXIGÉE (lost_reason) ; « Perdu »,
 *                            VERROUILLÉ ; relances ouvertes annulées
 *   N'a pas eu lieu          Pas décroché (RDV ANNULÉ, journal « pas de
 *                            réponse », relance proposée jamais exigée — 033),
 *                            Reporter (nouvelle date connue,
 *                            deplacerRendezVous) ou Annulé (rien sur l'étape)
 *
 * Un tap suffit pour l'issue ; seules « à rappeler » et « suivi par email »
 * demandent une date, seule « pas intéressé » demande une raison. Le compte rendu reste facultatif.
 *
 * Les invariants de lib/crm/status.ts tiennent : « À rappeler » et
 * « Proposition » ne bougent que par les FAITS (jamais par-dessus un verrou) ;
 * « Gagné » et « Perdu » ne sont jamais déduits — ils sont ici DÉCIDÉS par
 * l'humain qui tape l'issue, comme un clic sur l'étape (décision de Bora,
 * 18/10).
 *
 * Module NEUTRE, imports relatifs seulement : exécuté tel quel par
 * `npm run test:debrief`.
 */

import type { IconeNom } from "../../components/ui.tsx";
import type { ProspectStatus } from "../types.ts";
import { jourHeureCourt } from "./prochaineAction.ts";

/** Ce qu'a donné un rendez-vous qui a eu lieu. */
export type IssueTenue =
  | "a_rappeler"
  | "suivi_email"
  | "proposition"
  | "essai"
  | "signe"
  | "pas_interesse";
/** …ou bien il n'a pas eu lieu. Le report passe par deplacerRendezVous. */
export type IssueNonTenue = "pas_decroche" | "annule";
export type IssueDebrief = IssueTenue | IssueNonTenue;

export const ISSUES_TENUES: IssueTenue[] = [
  "a_rappeler",
  "suivi_email",
  "proposition",
  "essai",
  "signe",
  "pas_interesse",
];

export const ISSUE_LABEL: Record<IssueDebrief, string> = {
  a_rappeler: "Intéressé — à rappeler",
  suivi_email: "Suivi par email",
  proposition: "Proposition envoyée",
  essai: "Essai gratuit démarré",
  signe: "Signé",
  pas_interesse: "Pas intéressé",
  pas_decroche: "Pas décroché",
  annule: "Annulé",
};

/** La couleur ne porte jamais seule : chaque issue a son pictogramme. */
export const ISSUE_ICON: Record<IssueDebrief, IconeNom> = {
  a_rappeler: "pouce",
  suivi_email: "arobase",
  proposition: "enveloppe",
  essai: "cadeau",
  signe: "coche",
  pas_interesse: "croix",
  pas_decroche: "telephone-barre",
  annule: "croix",
};

/** Classes complètes (règle JIT) — les teintes des étapes d'arrivée. */
export const ISSUE_CHIP: Record<IssueDebrief, string> = {
  a_rappeler: "bg-indigo-500/15 text-indigo-200 ring-indigo-400/30 hover:bg-indigo-500/25",
  suivi_email: "bg-sky-500/15 text-sky-200 ring-sky-400/30 hover:bg-sky-500/25",
  proposition: "bg-amber-500/15 text-amber-200 ring-amber-400/30 hover:bg-amber-500/25",
  essai: "bg-teal-500/15 text-teal-200 ring-teal-400/30 hover:bg-teal-500/25",
  signe: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/30 hover:bg-emerald-500/25",
  pas_interesse: "bg-rose-500/10 text-rose-200 ring-rose-400/25 hover:bg-rose-500/20",
  pas_decroche: "bg-white/[0.04] text-slate-300 ring-white/10 hover:bg-white/[0.08]",
  annule: "bg-white/[0.04] text-slate-300 ring-white/10 hover:bg-white/[0.08]",
};

/** `Object.hasOwn`, jamais `in` : « constructor » est dans tout objet. */
export function estIssueDebrief(v: unknown): v is IssueDebrief {
  return typeof v === "string" && Object.hasOwn(ISSUE_LABEL, v);
}

/** Ce que fait une issue — sans base, sans réseau. */
export type EffetsDebrief = {
  /** Le nouveau statut du rendez-vous. */
  statutRdv: "honore" | "annule";
  /** La valeur de meetings.debrief_issue (027, 033). */
  debriefIssue: IssueTenue | "pas_decroche" | null;
  /** Étape DÉCIDÉE (verrouillée) — null : l'étape suit les faits. */
  etapeDecidee: ProspectStatus | null;
  /** Marquer la proposition envoyée (le fait qui mène à « Proposition »). */
  proposition: boolean;
  /** La date de rappel est exigée. */
  exigeDate: boolean;
  /** La raison est exigée (versée dans lost_reason). */
  exigeRaison: boolean;
  /** Une date « Et ensuite ? » est offerte (jamais sur une fiche qu'on ferme). */
  suiteOfferte: boolean;
  /** Le résultat d'appel porté par la ligne de journal (la carte l'affiche). */
  outcome: "interesse" | "suivi_email" | "refus" | "sans_reponse" | null;
  /** Les relances ouvertes sont annulées (perdu : plus rien à relancer). */
  annulerRelances: boolean;
};

export function effetsDebrief(issue: IssueDebrief): EffetsDebrief {
  const base: EffetsDebrief = {
    statutRdv: "honore",
    debriefIssue: null,
    etapeDecidee: null,
    proposition: false,
    exigeDate: false,
    exigeRaison: false,
    suiteOfferte: true,
    outcome: null,
    annulerRelances: false,
  };
  switch (issue) {
    case "a_rappeler":
      return { ...base, debriefIssue: "a_rappeler", exigeDate: true, outcome: "interesse" };
    case "suivi_email":
      // On a eu la personne, qui veut l'info par mail : une RÉPONSE, et une
      // relance pour vérifier que le mail a bien été lu.
      return { ...base, debriefIssue: "suivi_email", exigeDate: true, outcome: "suivi_email" };
    case "proposition":
      return { ...base, debriefIssue: "proposition", proposition: true };
    case "essai":
      // Pas une fin de parcours : la fiche en essai garde ses relances, et
      // « Et ensuite ? » reste offert (la date de fin d'essai). Le résultat
      // d'appel « Intéressé » est celui que la carte affiche.
      return { ...base, debriefIssue: "essai", etapeDecidee: "essai_gratuit", outcome: "interesse" };
    case "signe":
      return { ...base, debriefIssue: "signe", etapeDecidee: "gagne", suiteOfferte: false };
    case "pas_interesse":
      return {
        ...base,
        debriefIssue: "pas_interesse",
        etapeDecidee: "perdu",
        exigeRaison: true,
        suiteOfferte: false,
        outcome: "refus",
        annulerRelances: true,
      };
    case "pas_decroche":
      // Un RDV téléphonique où personne n'a décroché : il n'a PAS eu lieu
      // (décision de Bora, 27/10). La ligne de journal dit « pas de réponse »
      // — c'est elle que la carte affiche ; une relance est proposée, jamais
      // exigée.
      return { ...base, statutRdv: "annule", debriefIssue: "pas_decroche", outcome: "sans_reponse" };
    case "annule":
      return { ...base, statutRdv: "annule" };
  }
}

/**
 * Le débrief est-il complet ? null si oui, sinon la phrase à afficher —
 * la même à l'écran, dans la server action et dans le connecteur MCP.
 */
export function manqueDebrief(input: {
  issue: IssueDebrief;
  suite?: string | null;
  raison?: string | null;
}): string | null {
  const e = effetsDebrief(input.issue);
  if (e.exigeDate && !input.suite?.trim()) {
    return input.issue === "suivi_email"
      ? "Quand faut-il relancer ? Choisissez une date."
      : "Quand faut-il rappeler ? Choisissez une date.";
  }
  if (e.exigeRaison && !input.raison?.trim()) {
    return "Pourquoi n'est-il pas intéressé ? Une raison courte suffit.";
  }
  return null;
}

/** Le sujet de la ligne de journal du débrief : « Débrief du RDV du 29/09 à 10h : signé ». */
export function sujetDebrief(issue: IssueDebrief, startsAt: string): string {
  const quoi =
    issue === "annule"
      ? "n'a pas eu lieu (annulé)"
      : issue === "pas_decroche"
        ? "pas décroché, n'a pas eu lieu"
        : ISSUE_LABEL[issue].toLowerCase();
  return `Débrief du RDV du ${jourHeureCourt(startsAt)} : ${quoi}`;
}

// ---------------------------------------------------------------------------
// Le débrief IMPLICITE — miroir lisible du trigger SQL
// ---------------------------------------------------------------------------

/**
 * Ce qu'une ligne de journal posée APRÈS un rendez-vous passé non débriefé
 * fait de lui. La règle s'exécute EN SQL (`activities_debrief_implicite`,
 * migration 027 — tous les écrivains y passent : écran, MCP, crm-mail, Janet) ;
 * cette fonction en est la recopie, pour que la règle se lise et se teste
 * sans base. Toute évolution se fait DES DEUX CÔTÉS — la recette
 * supabase/recettes/027_corps.sql joue les mêmes cas.
 *
 * - « Pas de réponse » et « Barrage » ne prouvent pas que le RDV a eu lieu :
 *   rien (décision de Bora, 18/10) — même un barrage attesté.
 * - Ferment : un échange attesté, un résultat « À rappeler » / « Intéressé » /
 *   « Suivi par email » / « Pas intéressé », un email envoyé. Une note de repérage, un brouillon,
 *   une activité rendez_vous ou une ligne déjà rattachée à un RDV : rien.
 * - L'issue : « À rappeler » / « Intéressé » → a_rappeler (l'étape suit le
 *   fait) ; « Suivi par email » → suivi_email (033) ; « Pas intéressé » → pas_interesse, MÊMES effets que le débrief
 *   explicite (`effetsDebrief("pas_interesse")` : Perdu verrouillé, relances
 *   annulées) ; tout le reste → suite_posee.
 *
 * null : la ligne ne ferme rien. (Les conditions de temps et d'étape — RDV
 * commencé avant la ligne, fiche ni gagnée ni perdue, RDV de prospect — sont
 * celles de `rdvADebriefer`, plus bas.)
 */
export function issueImplicite(ligne: {
  type: string;
  outcome?: string | null;
  isExchange?: boolean | null;
  isDraft?: boolean | null;
  meetingId?: string | null;
}): IssueTenue | "suite_posee" | null {
  if (ligne.isDraft || ligne.meetingId || ligne.type === "rendez_vous") return null;
  if (ligne.outcome === "sans_reponse" || ligne.outcome === "barrage") return null;
  const resultatQuiFerme =
    ligne.outcome === "rappeler" ||
    ligne.outcome === "interesse" ||
    ligne.outcome === "suivi_email" ||
    ligne.outcome === "refus";
  if (!(ligne.isExchange || resultatQuiFerme || ligne.type === "email")) return null;
  if (ligne.outcome === "rappeler" || ligne.outcome === "interesse") return "a_rappeler";
  if (ligne.outcome === "suivi_email") return "suivi_email";
  if (ligne.outcome === "refus") return "pas_interesse";
  return "suite_posee";
}

// ---------------------------------------------------------------------------
// La zone « Rendez-vous à débriefer » — ce qui attend une issue
// ---------------------------------------------------------------------------

export type RdvEnAttente = {
  id: string;
  prospect_id: string | null;
  kind: string;
  status: string;
  starts_at: string;
  debriefed_at?: string | null;
};

/**
 * Les rendez-vous qui attendent leur débrief : de PROSPECT (un RDV personnel
 * ne réclame jamais rien — le « Rdv Ephec » du 18/10), vivants, commencés,
 * non débriefés, sur une fiche ni gagnée ni perdue (023). UN SEUL par fiche :
 * le plus récent — les plus anciens seront clos « remplacés » par la base dès
 * qu'il sera débriefé (027). Plus de Nice Cars en double dans la zone.
 * Trié du plus ancien au plus récent : le plus en retard d'abord.
 */
export function rdvADebriefer<R extends RdvEnAttente>(
  meetings: R[],
  statutFiche: (prospectId: string) => string | null | undefined,
  now: number = Date.now()
): R[] {
  const parFiche = new Map<string, R>();
  for (const m of meetings) {
    if (m.kind !== "prospect" || !m.prospect_id) continue;
    if (!["prevu", "confirme", "reporte"].includes(m.status)) continue;
    if (m.debriefed_at) continue;
    if (new Date(m.starts_at).getTime() > now) continue;
    const statut = statutFiche(m.prospect_id);
    if (statut === "gagne" || statut === "perdu") continue;
    const deja = parFiche.get(m.prospect_id);
    if (!deja || new Date(m.starts_at).getTime() > new Date(deja.starts_at).getTime()) {
      parFiche.set(m.prospect_id, m);
    }
  }
  return [...parFiche.values()].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
  );
}
