/**
 * Les gardes de la dernière seconde, avant de composer — pur, testé.
 *
 * Relues sur la fiche AU MOMENT de composer, jamais à l'inscription seule :
 * entre deux essais, la fiche vit (un mail arrive, Bora note un échange, un
 * rendez-vous se pose). Les lectures qui alimentent ces gardes échouent
 * FERMÉES : le moteur ne compose pas s'il n'a pas pu lire (lib/appelsIa/moteur.ts).
 */

import { numeroAppelable } from "./numeros.ts";

export type FaitsFiche = {
  existe: boolean;
  statut: string | null;
  phone: string | null;
  rdvAVenir: boolean;
  /** Le numéro est sur la liste d'opposition. */
  enOpposition: (numero: string) => boolean;
  /** Depuis le premier essai du cycle (absent au premier essai). */
  depuis: {
    activitesHumaines: number;
    emailsEntrants: number;
    rdvPosesHorsJanet: number;
    etapeChangeeALaMain: boolean;
  } | null;
};

export type Garde =
  | { ok: true; numero: string }
  | { ok: false; motif: string };

/** La fiche a-t-elle bougé depuis le début du cycle ? La raison, ou null. */
export function ficheABouge(d: FaitsFiche["depuis"]): string | null {
  if (!d) return null;
  if (d.activitesHumaines > 0) return "un échange ou une note a été ajouté sur la fiche";
  if (d.emailsEntrants > 0) return "un mail du prospect est arrivé";
  if (d.rdvPosesHorsJanet > 0) return "un rendez-vous a été posé";
  if (d.etapeChangeeALaMain) return "l'étape a été changée à la main";
  return null;
}

export function gardeAvantComposer(f: FaitsFiche): Garde {
  if (!f.existe) return { ok: false, motif: "fiche supprimée" };
  if (f.statut === "gagne" || f.statut === "perdu") return { ok: false, motif: "fiche gagnée ou perdue : jamais appelée" };
  const numero = numeroAppelable(f.phone);
  if (!numero) return { ok: false, motif: "plus de numéro belge appelable sur la fiche" };
  if (f.enOpposition(numero)) return { ok: false, motif: "numéro sur la liste d'opposition" };
  if (f.rdvAVenir) return { ok: false, motif: "un rendez-vous est prévu avec cette fiche" };
  const bouge = ficheABouge(f.depuis);
  if (bouge) return { ok: false, motif: `la fiche a bougé : ${bouge}` };
  return { ok: true, numero };
}
