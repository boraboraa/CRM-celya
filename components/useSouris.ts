"use client";

import { useSyncExternalStore } from "react";
import { estSouris, REQUETE_SOURIS } from "@/lib/pointeur";

/**
 * Le pointeur est-il une souris ? Écouté EN DIRECT : une souris branchée sur
 * un iPad, ou débranchée d'un portable tactile, change la réponse sans
 * recharger. Côté serveur (et au premier rendu d'hydratation), la réponse est
 * « non » : on part du doigt — une carte reste un lien tant qu'on ne sait pas.
 */
function abonner(rappel: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(REQUETE_SOURIS);
  mq.addEventListener?.("change", rappel);
  return () => mq.removeEventListener?.("change", rappel);
}

const lire = () => (typeof window === "undefined" ? false : estSouris((q) => window.matchMedia(q)));
const lireServeur = () => false;

export function useSouris(): boolean {
  return useSyncExternalStore(abonner, lire, lireServeur);
}
