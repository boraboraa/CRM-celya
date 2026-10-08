/**
 * Le moteur a-t-il le droit de composer, maintenant ? — pur, testé.
 *
 * Ce sont les gardes GÉNÉRALES (celles d'une fiche sont dans garde.ts) :
 * l'interrupteur, la pause, le numéro appelant, le GSM de test, la fenêtre
 * (du lundi au vendredi, fériés exclus, 9h30–17h30 par défaut) et les
 * plafonds, toujours sous les limites du compte Telnyx (contrainte en base).
 * Chaque refus se dit en français : c'est ce que l'écran Appels IA affiche.
 */

import { dansFenetre, prochaineOuverture, jourHeureFr, type Fenetre } from "./calendrier.ts";

export type ReglagesMoteur = {
  actif: boolean;
  mode_test: boolean;
  gsm_test: string | null;
  numero_appelant: string | null;
  fenetre_debut: string;
  fenetre_fin: string;
  plafond_heure: number;
  plafond_jour: number;
  pause_cause: string | null;
};

export function fenetreDe(r: Pick<ReglagesMoteur, "fenetre_debut" | "fenetre_fin">): Fenetre {
  return { debut: (r.fenetre_debut ?? "09:30").slice(0, 5), fin: (r.fenetre_fin ?? "17:30").slice(0, 5) };
}

export type CompteurAppels = {
  /** Appels composés dans les 60 dernières minutes (tests compris : Telnyx les compte). */
  derniereHeure: number;
  /** Appels composés depuis minuit, heure de Bruxelles. */
  aujourdhui: number;
};

/**
 * Pourquoi le moteur ne compose pas — ou null s'il peut. `test` : un appel de
 * test lancé à la main (bouton « Appel de test vers mon GSM ») ignore
 * l'interrupteur et la fenêtre — c'est Bora qu'on appelle — mais jamais les
 * plafonds ni le numéro appelant.
 */
export function refusMoteur(
  r: ReglagesMoteur,
  maintenant: Date,
  c: CompteurAppels,
  o: { test?: boolean } = {}
): string | null {
  if (!o.test && !r.actif) return "L'interrupteur général est coupé.";
  if (!o.test && r.pause_cause) return `Moteur en pause : ${r.pause_cause}`;
  if (!r.numero_appelant) return "Le numéro appelant n'est pas réglé : le moteur refuse de composer.";
  if ((o.test || r.mode_test) && !r.gsm_test) return "Mode test : le GSM de test n'est pas réglé.";
  if (!o.test && !dansFenetre(maintenant, fenetreDe(r))) {
    return `Hors de la fenêtre d'appel — reprise ${jourHeureFr(prochaineOuverture(maintenant, fenetreDe(r)))}.`;
  }
  if (c.aujourdhui >= r.plafond_jour) return `Plafond du jour atteint (${r.plafond_jour} appels).`;
  if (c.derniereHeure >= r.plafond_heure) return `Plafond de l'heure atteint (${r.plafond_heure} appels).`;
  return null;
}
