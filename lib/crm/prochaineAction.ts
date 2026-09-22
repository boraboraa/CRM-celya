/**
 * La prochaine action d'une fiche — le côté TypeScript de la migration 022.
 *
 * « La prochaine action, c'est le prochain rendez-vous de la fiche tant qu'il
 *   n'est pas débriefé ; sinon, sa relance la plus proche. »
 * Poser (ou déplacer) un rendez-vous CLÔTURE les relances ouvertes qui
 * tombaient avant lui, avec une ligne au journal : après un rendez-vous, c'est
 * le débrief qui décide de la suite. Une relance posée ENSUITE et tombant avant
 * le RDV (« confirmer la veille ») n'est jamais touchée : elle passe devant, la
 * fiche dit la relance, puis le RDV.
 *
 * La DONNÉE est tenue en SQL (`recalc_next_action`, triggers sur tasks et
 * meetings) : c'est là que vit la règle, pour l'écran comme pour le connecteur
 * MCP et le SQL direct. Ce module ne fait que la LIRE et la DIRE, avec des
 * miroirs purs de la même règle — `rdvVivant`, `rdvQuiCompte`,
 * `relancePasseDevant` — pour les écrans qui ont déjà les lignes en main (la
 * fiche). Toute évolution de la 022 se répercute ici, et inversement.
 *
 * Module NEUTRE (ni serveur, ni client), imports relatifs seulement : il est
 * exécuté tel quel par `npm run test:prochaine-action`.
 */

export const TZ = "Europe/Brussels";

export type NextActionKind = "rendez_vous" | "relance";
export type StatutRdv = "prevu" | "confirme" | "honore" | "annule" | "reporte";

/** Miroir de `public.rdv_vivant` : ni honoré ni annulé — passé compris. */
export function rdvVivant(status: string | null | undefined): boolean {
  return status === "prevu" || status === "confirme" || status === "reporte";
}

/** Le rendez-vous qui compte : le plus proche des rendez-vous VIVANTS. */
export function rdvQuiCompte<M extends { starts_at: string; status: string }>(
  meetings: M[]
): M | null {
  let best: M | null = null;
  for (const m of meetings) {
    if (!rdvVivant(m.status)) continue;
    if (!best || new Date(m.starts_at).getTime() < new Date(best.starts_at).getTime()) {
      best = m;
    }
  }
  return best;
}

/**
 * Qui passe devant ? Miroir de la comparaison de `recalc_next_action` : la
 * relance ne gagne que si elle tombe STRICTEMENT avant le rendez-vous.
 */
export function relancePasseDevant(
  relanceDue: string | null | undefined,
  rdvDebut: string | null | undefined
): boolean {
  if (!relanceDue) return false;
  if (!rdvDebut) return true;
  return new Date(relanceDue).getTime() < new Date(rdvDebut).getTime();
}

function parts(iso: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("fr-BE", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso))) {
    out[p.type] = p.value;
  }
  return out;
}

/** « 28/09 à 12h » · « 28/09 à 12h30 » — heure de Bruxelles. */
export function jourHeureCourt(iso: string): string {
  const p = parts(iso);
  const h = String(Number(p.hour));
  return `${p.day}/${p.month} à ${h}h${p.minute === "00" ? "" : p.minute}`;
}

/** « RDV le 28/09 à 12h ». */
export function libelleRdv(iso: string): string {
  return `RDV le ${jourHeureCourt(iso)}`;
}

export type LectureProchaineAction = {
  /** Ce qu'on écrit : « RDV le 28/09 à 12h », « À débriefer — RDV du 28/09 à 12h », ou null (relance : l'appelant garde son format de date). */
  texte: string | null;
  /** Pictogramme : le calendrier pour un rendez-vous. */
  icone: "calendrier" | null;
  /** En retard — JAMAIS pour un rendez-vous, passé ou non. */
  retard: boolean;
  /** Le rendez-vous est passé : il attend son débrief. */
  aDebriefer: boolean;
  estRdv: boolean;
};

/**
 * Lit `prospects.next_action_at` + `next_action_kind` pour une liste, une
 * carte de pipeline ou une ligne du tableau de bord. Un rendez-vous n'est
 * jamais « en retard » : à venir, il se dit ; passé, il demande son débrief.
 * `kind` absent (base d'avant la 022) = relance, le comportement d'avant.
 */
export function lireProchaineAction(
  at: string | null | undefined,
  kind: string | null | undefined,
  now: number = Date.now()
): LectureProchaineAction {
  if (!at) {
    return { texte: null, icone: null, retard: false, aDebriefer: false, estRdv: false };
  }
  if (kind === "rendez_vous") {
    const passe = new Date(at).getTime() < now;
    return {
      texte: passe ? `À débriefer — RDV du ${jourHeureCourt(at)}` : libelleRdv(at),
      icone: "calendrier",
      retard: false,
      aDebriefer: passe,
      estRdv: true,
    };
  }
  return {
    texte: null,
    icone: null,
    retard: new Date(at).getTime() < now,
    aDebriefer: false,
    estRdv: false,
  };
}

/** Une relance que la pose (ou le report) d'un rendez-vous a clôturée. */
export type RelanceAnnulee = { id: string; title: string; due_at: string };

/**
 * La phrase qui DIT ce que le rendez-vous a fait aux relances — sans rien
 * demander (décision de Bora : poser un RDV est un geste rapide, souvent au
 * téléphone). null quand il n'a rien clôturé. Le journal de la fiche porte la
 * même trace, ligne par ligne.
 */
export function phraseAnnulees(annulees: RelanceAnnulee[] | null | undefined): string | null {
  if (!annulees || annulees.length === 0) return null;
  if (annulees.length === 1) {
    return `Relance « ${annulees[0].title} » annulée : le rendez-vous devient la prochaine action, la suite se décidera au débrief.`;
  }
  return `${annulees.length} relances annulées : le rendez-vous devient la prochaine action, la suite se décidera au débrief.`;
}

/**
 * Le garde-fou ZÉRO TAP du débrief sans suite. Les relances d'avant un
 * rendez-vous sont clôturées à sa pose ; un rendez-vous clos (honoré ou
 * annulé) sans « Et ensuite ? » laisse donc la fiche sans prochaine action —
 * elle sort de « À faire ». Elle doit au moins le DIRE, partout où on la
 * croise (fiche, liste, colonnes), sans rien demander ni rien créer.
 *
 * Réservé aux fiches qui ONT EU un rendez-vous clos : une fiche « À appeler »
 * jamais planifiée n'a pas « plus rien » de prévu, elle n'a encore rien eu.
 * Gagné / Perdu : la fiche est close, le message n'aurait pas de sens.
 */
export const PLUS_RIEN = "Plus rien de prévu sur cette fiche";
export const PLUS_RIEN_COURT = "Plus rien de prévu";

export function plusRienDePrevu(p: {
  nextActionAt: string | null | undefined;
  status: string | null | undefined;
  aEuUnRdvClos: boolean;
}): boolean {
  if (p.nextActionAt) return false;
  if (p.status === "gagne" || p.status === "perdu") return false;
  return p.aEuUnRdvClos;
}

/** Un rendez-vous CLOS : débriefé honoré ou annulé. */
export function rdvClos(status: string | null | undefined): boolean {
  return status === "honore" || status === "annule";
}
