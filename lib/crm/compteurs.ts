/**
 * Les COMPTEURS de l'équipe — objectifs et classement (27/10/2026). Module pur.
 *
 * La règle s'exécute EN SQL (`compteurs_pour`, migration 031) : le
 * classement doit compter le travail de chacun sans que personne ne lise les
 * fiches des autres. Cette fonction en est la RECOPIE, pour que la règle se
 * lise et se teste sans base ; les deux jouent le même jeu de cas
 * (`compteurs.cas.json` : test:objectifs et la recette 031). Toute évolution
 * se fait DES DEUX CÔTÉS.
 *
 *   appels      une activité non brouillon, avec un résultat d'appel, SANS
 *               rendez-vous rattaché (un débrief porte « intéressé » ou
 *               « refus » : ce n'est pas un appel) — à l'auteur ;
 *   réponses    rappeler · intéressé · suivi par email (033) · refus — on a eu le décideur ; un
 *               barrage reste un appel, pas une réponse (Bora, 27/10) ;
 *   intéressés  intéressé · rappeler ;
 *   rdv         RDV de prospect créés dans la période, non annulés — à qui
 *               les a posés ;
 *   essais      fiches entrées en essai gratuit dans la période — au
 *               responsable ;
 *   numéros     fiches créées dans la période — à qui les a créées.
 *
 * Imports relatifs avec extension : exécuté tel quel sous node.
 */

import { localInputToISO, isoToLocalInput } from "../time.ts";

/** Le premier jour du Sales Trophy — « depuis le 2 novembre ». */
export const DEBUT_SALES_TROPHY = "2026-11-02";

export type Compteurs = {
  appels: number;
  reponses: number;
  interesses: number;
  rdv: number;
  essais: number;
  numeros: number;
};

export const ZERO: Compteurs = { appels: 0, reponses: 0, interesses: 0, rdv: 0, essais: 0, numeros: 0 };

const REPONSES = new Set(["rappeler", "interesse", "suivi_email", "refus"]);
const INTERESSES = new Set(["interesse", "rappeler"]);

// ---------------------------------------------------------------------------
// Les dates — en jours de Bruxelles
// ---------------------------------------------------------------------------

/** « 2026-11-04 » — le jour, à Bruxelles, d'un instant. */
export function jourBruxelles(instant: Date | string | number = new Date()): string {
  return isoToLocalInput(new Date(instant).toISOString()).slice(0, 10);
}

/** Ajoute n jours à une date « YYYY-MM-DD » (sans fuseau). */
export function ajouterJours(ymd: string, n: number): string {
  const [a, m, j] = ymd.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

/** Le LUNDI de la semaine d'un jour « YYYY-MM-DD ». */
export function lundiDe(ymd: string): string {
  const [a, m, j] = ymd.split("-").map(Number);
  const jour = new Date(Date.UTC(a, m - 1, j)).getUTCDay(); // 0 = dimanche
  return ajouterJours(ymd, -((jour + 6) % 7));
}

/** Minuit à Bruxelles, en millisecondes UTC. */
export function minuitBruxelles(ymd: string): number {
  return new Date(localInputToISO(`${ymd}T00:00`)!).getTime();
}

// ---------------------------------------------------------------------------
// La règle — recopie de `compteurs_pour`
// ---------------------------------------------------------------------------

export type LignesCompteurs = {
  activites: {
    author_id: string | null;
    outcome: string | null;
    is_draft?: boolean | null;
    meeting_id?: string | null;
    occurred_at: string;
  }[];
  rdv: {
    created_by: string | null;
    owner_id: string | null;
    kind: string;
    status: string;
    created_at: string;
  }[];
  fiches: {
    owner_id: string | null;
    created_by: string | null;
    created_at: string;
    essai_gratuit_at: string | null;
  }[];
};

/** [début, fin) en dates de Bruxelles. */
export function compter(l: LignesCompteurs, userId: string, debut: string, fin: string): Compteurs {
  const d = minuitBruxelles(debut);
  const f = minuitBruxelles(fin);
  const dans = (iso: string | null | undefined) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= d && t < f;
  };
  const c = { ...ZERO };
  for (const a of l.activites) {
    if (a.author_id !== userId || a.is_draft || !a.outcome || a.meeting_id || !dans(a.occurred_at)) continue;
    c.appels++;
    if (REPONSES.has(a.outcome)) c.reponses++;
    if (INTERESSES.has(a.outcome)) c.interesses++;
  }
  for (const m of l.rdv) {
    if ((m.created_by ?? m.owner_id) !== userId) continue;
    if (m.kind === "prospect" && m.status !== "annule" && dans(m.created_at)) c.rdv++;
  }
  for (const p of l.fiches) {
    if (p.owner_id === userId && dans(p.essai_gratuit_at)) c.essais++;
    if (p.created_by === userId && dans(p.created_at)) c.numeros++;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Ce que l'écran en dit
// ---------------------------------------------------------------------------

export type Objectifs = {
  appels: number | null;
  reponses: number | null;
  rdv: number | null;
  /** L'objectif d'essais porte sur la PÉRIODE, pas sur la semaine. */
  essaisPeriode: number | null;
};

/** Valeurs PROPOSÉES par le formulaire de /equipe — Bora les ajuste. */
export const OBJECTIFS_PROPOSES = { appels: 60, reponses: 15, rdv: 3, essaisPeriode: 2 } as const;

/**
 * « 23/60 appels · 6/15 réponses · 1/3 RDV · 0/2 essais » — sans objectif
 * posé, le compte seul (« 23 appels »). Les essais sont ceux de la période.
 */
export function phraseObjectifs(semaine: Compteurs, essaisPeriode: number, o: Objectifs | null): string {
  const bout = (n: number, cible: number | null | undefined, un: string, plusieurs: string) =>
    cible != null && cible > 0
      ? `${n}/${cible} ${cible > 1 ? plusieurs : un}`
      : `${n} ${n > 1 ? plusieurs : un}`;
  return [
    bout(semaine.appels, o?.appels, "appel", "appels"),
    bout(semaine.reponses, o?.reponses, "réponse", "réponses"),
    bout(semaine.rdv, o?.rdv, "RDV", "RDV"),
    bout(essaisPeriode, o?.essaisPeriode, "essai", "essais"),
  ].join(" · ");
}

/** La part atteinte, bornée à 100 % — null sans objectif. */
export function avancement(n: number, cible: number | null | undefined): number | null {
  if (cible == null || cible <= 0) return null;
  return Math.min(100, Math.round((n / cible) * 100));
}

/** L'ordre du classement — le même qu'en SQL : essais, RDV, réponses, appels, nom. */
export function ordreClassement<T extends Compteurs & { nom: string }>(lignes: T[]): T[] {
  return [...lignes].sort(
    (a, b) =>
      b.essais - a.essais ||
      b.rdv - a.rdv ||
      b.reponses - a.reponses ||
      b.appels - a.appels ||
      a.nom.localeCompare(b.nom, "fr")
  );
}
