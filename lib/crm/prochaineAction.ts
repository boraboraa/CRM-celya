/**
 * La prochaine action d'une fiche — le côté TypeScript des migrations 022 à 024.
 *
 * « La prochaine action, c'est le prochain rendez-vous de la fiche tant qu'il
 *   n'est pas débriefé ; sinon, sa relance la plus proche. »
 * Poser (ou déplacer) un rendez-vous CLÔTURE les relances ouvertes qui
 * tombaient avant lui, avec une ligne au journal : après un rendez-vous, c'est
 * le débrief qui décide de la suite.
 *
 * Depuis la 024 (décision de Bora, 23/09) : tant qu'une fiche a un rendez-vous
 * vivant, c'est LUI la prochaine action — TOUJOURS. Une relance datée avant lui
 * reste une tâche (elle remonte dans « À appeler » le jour venu) mais ne le
 * remplace jamais sur la fiche ni dans la liste. L'ancienne exception
 * (« confirmer la veille » passait devant) venait d'une mauvaise lecture : la
 * relance d'Alain docteur avait été re-datée par une tâche automatique.
 *
 * Une fiche gagnée ou perdue ne réclame jamais rien (migration 023) : elle
 * n'affiche que ce que l'utilisateur a planifié — un RDV à venir, une relance
 * ouverte même en retard —, jamais le débrief d'un RDV passé.
 *
 * La DONNÉE est tenue en SQL (`recalc_next_action`, triggers sur tasks et
 * meetings) : c'est là que vit la règle, pour l'écran comme pour le connecteur
 * MCP et le SQL direct. Ce module ne fait que la LIRE et la DIRE, avec des
 * miroirs purs de la même règle — `rdvVivant`, `rdvQuiCompte` — pour les écrans
 * qui ont déjà les lignes en main (la fiche). Toute évolution de
 * `prochaine_action_de` (023, 024) se répercute ici, et inversement.
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
 * Une fiche CLOSE (gagnée ou perdue) ne réclame jamais rien : elle n'affiche
 * que ce que l'utilisateur a lui-même planifié — un rendez-vous À VENIR, une
 * relance ouverte (même en retard). Le débrief d'un rendez-vous passé, lui,
 * est ce que le système réclame : il n'existe pas sur une fiche close
 * (migration 023).
 */
export function ficheClose(status: string | null | undefined): boolean {
  return status === "gagne" || status === "perdu";
}

/** Un rendez-vous a-t-il commencé ? Miroir de `starts_at > now()` (023). */
function aCommence(startsAt: string, now: number): boolean {
  return !(new Date(startsAt).getTime() > now);
}

/**
 * Le rendez-vous qui compte : le plus proche des rendez-vous VIVANTS — passé
 * compris sur une fiche ouverte (il attend son débrief), À VENIR seulement sur
 * une fiche close. Miroir de `prochaine_action_de` (023).
 */
export function rdvQuiCompte<M extends { starts_at: string; status: string }>(
  meetings: M[],
  statutFiche?: string | null,
  now: number = Date.now()
): M | null {
  const close = ficheClose(statutFiche);
  let best: M | null = null;
  for (const m of meetings) {
    if (!rdvVivant(m.status)) continue;
    if (close && aCommence(m.starts_at, now)) continue;
    if (!best || new Date(m.starts_at).getTime() < new Date(best.starts_at).getTime()) {
      best = m;
    }
  }
  return best;
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

function heureCourte(hour: string, minute: string): string {
  return `${Number(hour)}h${minute === "00" ? "" : minute}`;
}

/**
 * « RDV lun. 28/09 · 12h » — la liste et les colonnes (024) : le jour de la
 * semaine d'abord, parce que c'est ce qu'on cherche d'un coup d'œil.
 */
export function libelleRdvListe(iso: string): string {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("fr-BE", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso))) {
    out[p.type] = p.value;
  }
  return `RDV ${out.weekday} ${out.day}/${out.month} · ${heureCourte(out.hour, out.minute)}`;
}

/** « Lundi 28 septembre à 12h » — la carte de la fiche (024). */
export function jourLong(iso: string): string {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("fr-BE", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso))) {
    out[p.type] = p.value;
  }
  const jour = out.weekday.charAt(0).toUpperCase() + out.weekday.slice(1);
  return `${jour} ${out.day} ${out.month} à ${heureCourte(out.hour, out.minute)}`;
}

/** Le jour de Bruxelles, « 2026-09-28 » — pour `/agenda?vue=jour&jour=…`. */
export function jourAgenda(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Le lien « Voir dans l'agenda » : l'agenda ouvert sur le jour du RDV. */
export function lienAgenda(iso: string): string {
  return `/agenda?vue=jour&jour=${jourAgenda(iso)}`;
}

/**
 * « Un rendez-vous est prévu le 28/09 à 12h » — la ligne d'information des
 * écrans où un humain pose une relance (024). Elle informe, elle ne bloque
 * rien : un humain a le droit de poser une relance avant un rendez-vous.
 */
export function infoRdvPrevu(iso: string): string {
  return `Un rendez-vous est prévu le ${jourHeureCourt(iso)}`;
}

/**
 * Le refus des chemins AUTOMATIQUES (connecteur MCP, 024) : une relance datée
 * avant un rendez-vous à venir de la fiche n'est pas posée. null = rien à
 * refuser (pas de rendez-vous à venir, ou relance au moment du RDV ou après).
 */
export function refusRelanceAvantRdv(
  dueISO: string,
  rdvDebutISO: string | null | undefined
): string | null {
  if (!rdvDebutISO) return null;
  if (!(new Date(dueISO).getTime() < new Date(rdvDebutISO).getTime())) return null;
  return `Un rendez-vous est déjà prévu le ${jourHeureCourt(rdvDebutISO)} : c'est lui la prochaine action. Aucune relance posée.`;
}

/** Une relance tombe-t-elle avant ce rendez-vous ? (chemins automatiques, 024) */
export function relanceAvantRdv(
  dueISO: string,
  rdvDebutISO: string | null | undefined
): boolean {
  return refusRelanceAvantRdv(dueISO, rdvDebutISO) !== null;
}

export type LectureProchaineAction = {
  /** Ce qu'on écrit : « RDV lun. 28/09 · 12h », « À débriefer — RDV du 28/09 à 12h », ou null (relance : l'appelant garde son format de date). */
  texte: string | null;
  /** Pictogramme : le calendrier pour un rendez-vous. */
  icone: "calendrier" | null;
  /** En retard — JAMAIS pour un rendez-vous, passé ou non. */
  retard: boolean;
  /** Le rendez-vous est passé : il attend son débrief. */
  aDebriefer: boolean;
  estRdv: boolean;
  /**
   * Rien à dire : pas de prochaine action — ou le rendez-vous d'une fiche
   * close vient de commencer et la base ne l'a pas encore recalculée (la tâche
   * horaire de la 023 le fera). On écrit alors ce qu'on écrit sans date.
   */
  rien: boolean;
};

const RIEN: LectureProchaineAction = {
  texte: null,
  icone: null,
  retard: false,
  aDebriefer: false,
  estRdv: false,
  rien: true,
};

/**
 * Lit `prospects.next_action_at` + `next_action_kind` pour une liste, une
 * carte de pipeline ou une ligne du tableau de bord. Un rendez-vous n'est
 * jamais « en retard » : à venir, il se dit ; passé, il demande son débrief —
 * sauf sur une fiche close (`statut` gagné / perdu), qui ne réclame jamais
 * rien (023) : le débrief n'y est pas dit.
 * `kind` absent (base d'avant la 022) = relance, le comportement d'avant.
 */
export function lireProchaineAction(
  at: string | null | undefined,
  kind: string | null | undefined,
  now: number = Date.now(),
  statut?: string | null
): LectureProchaineAction {
  if (!at) return RIEN;
  if (kind === "rendez_vous" && ficheClose(statut) && aCommence(at, now)) return RIEN;
  if (kind === "rendez_vous") {
    const passe = new Date(at).getTime() < now;
    return {
      texte: passe ? `À débriefer — RDV du ${jourHeureCourt(at)}` : libelleRdvListe(at),
      icone: "calendrier",
      retard: false,
      aDebriefer: passe,
      estRdv: true,
      rien: false,
    };
  }
  return {
    texte: null,
    icone: null,
    retard: new Date(at).getTime() < now,
    aDebriefer: false,
    estRdv: false,
    rien: false,
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
