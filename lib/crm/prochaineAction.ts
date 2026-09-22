/**
 * La prochaine action d'une fiche — le côté TypeScript de la migration 022.
 *
 * « La prochaine action, c'est le prochain rendez-vous de la fiche tant qu'il
 *   n'est pas débriefé ; sinon, sa relance la plus proche. »
 * Exception voulue : une relance posée SCIEMMENT avant le rendez-vous
 * (« confirmer la veille ») passe devant lui — la fiche affiche la relance,
 * puis le RDV.
 *
 * La DONNÉE est tenue en SQL (`recalc_next_action`, triggers sur tasks et
 * meetings) : c'est là que vit la règle, pour l'écran comme pour le connecteur
 * MCP et le SQL direct. Ce module ne fait que la LIRE et la DIRE, avec deux
 * miroirs purs de la même règle — `rdvVivant` et `estEnSommeil` — pour les
 * écrans qui ont déjà les lignes en main (la fiche) et n'ont pas à relire la
 * base. Toute évolution de la 022 se répercute ici, et inversement.
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

/**
 * Miroir de `public.en_sommeil` : la relance est le FILET d'un rendez-vous
 * encore vivant. Elle ne réclame rien tant qu'il n'est pas clos.
 */
export function estEnSommeil(
  task: { meeting_id?: string | null },
  meetings: { id: string; status: string }[]
): boolean {
  if (!task.meeting_id) return false;
  const m = meetings.find((x) => x.id === task.meeting_id);
  return !!m && rdvVivant(m.status);
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
 * relance (déjà débarrassée de ses filets endormis) ne gagne que si elle tombe
 * STRICTEMENT avant le rendez-vous.
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

/** « mar. 29/09 » — le jour d'une relance reportée, heure de Bruxelles. */
export function jourCourt(iso: string): string {
  const d = new Date(iso);
  const jour = new Intl.DateTimeFormat("fr-BE", { timeZone: TZ, weekday: "short" }).format(d);
  const p = parts(iso);
  return `${jour} ${p.day}/${p.month}`;
}

/** Une relance repoussée derrière un rendez-vous (son filet). */
export type RelanceReportee = { id: string; title: string; due_at: string };

/**
 * La phrase qui DIT ce que le rendez-vous a fait aux relances — sans rien
 * demander (décision de Bora : poser un RDV est un geste rapide, souvent au
 * téléphone). null quand il n'a rien déplacé.
 */
export function phraseReportees(reportees: RelanceReportee[] | null | undefined): string | null {
  if (!reportees || reportees.length === 0) return null;
  if (reportees.length === 1) {
    const r = reportees[0];
    return `Relance « ${r.title} » reportée au ${jourCourt(r.due_at)}, après le rendez-vous — elle attend son débrief, et revient seule s'il tombe à l'eau.`;
  }
  return `${reportees.length} relances reportées au ${jourCourt(reportees[0].due_at)}, après le rendez-vous — elles attendent son débrief, et reviennent seules s'il tombe à l'eau.`;
}
