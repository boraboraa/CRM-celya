"use client";

/**
 * Le sondage des appels de Janet — un seul rythme, partagé par la colonne
 * « Appels » du tableau de bord et le suivi d'appel de la fiche :
 *
 *   · toutes les 6 s pendant les 5 premières minutes (un appel se joue là) ;
 *   · puis toutes les 20 s ;
 *   · arrêt au bout de 50 minutes, quoi qu'il arrive ;
 *   · rien tant que l'onglet est caché — un sondage reprend dès qu'il revient.
 *
 * Il ne tourne QUE si `actif` : l'appelant décide (un appel en cours, une file
 * qui attend). Sans quoi la page n'émet aucune requête.
 *
 * Une panne réseau, une session expirée (le middleware répond alors par la page
 * de connexion, en HTML) ou une réponse illisible ne cassent rien : on garde la
 * dernière valeur connue et l'on retente au tour suivant.
 */

import { useEffect, useRef } from "react";

const SONDAGE_RAPIDE_MS = 6_000;
const SONDAGE_LENT_MS = 20_000;
const SONDAGE_RAPIDE_PENDANT_MS = 5 * 60_000;
const SONDAGE_MAX_MS = 50 * 60_000;

/**
 * @param url     la route GET à sonder (sous la session de l'utilisateur)
 * @param actif   faux → aucun sondage
 * @param recevoir appelé avec chaque réponse JSON lue
 * @param relance changer cette valeur RELANCE la fenêtre de 50 min (après un clic)
 */
export function useSondage<T>(
  url: string,
  actif: boolean,
  recevoir: (donnees: T) => void,
  relance: number = 0
): void {
  // Le dernier `recevoir` sans relancer l'effet à chaque rendu.
  const rappel = useRef(recevoir);
  useEffect(() => {
    rappel.current = recevoir;
  });

  useEffect(() => {
    if (!actif) return;
    const debut = Date.now();
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    let arrete = false;
    let enVol = false;

    const ecoule = () => Date.now() - debut;
    const cache = () => document.visibilityState === "hidden";

    const programmer = () => {
      clearTimeout(minuterie);
      if (arrete || cache() || ecoule() >= SONDAGE_MAX_MS) return;
      minuterie = setTimeout(
        sonder,
        ecoule() < SONDAGE_RAPIDE_PENDANT_MS ? SONDAGE_RAPIDE_MS : SONDAGE_LENT_MS
      );
    };

    async function sonder() {
      if (arrete || enVol || ecoule() >= SONDAGE_MAX_MS) return;
      enVol = true;
      try {
        const r = await fetch(url, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const type = r.headers.get("content-type") ?? "";
        if (r.ok && type.includes("application/json")) {
          const donnees = (await r.json()) as T;
          if (!arrete) rappel.current(donnees);
        }
      } catch {
        // Réseau coupé : la dernière valeur reste affichée, on retente.
      } finally {
        enVol = false;
      }
      programmer();
    }

    const visibilite = () => {
      clearTimeout(minuterie);
      // De retour sur l'onglet : une lecture tout de suite, puis le rythme.
      if (!cache()) void sonder();
    };

    document.addEventListener("visibilitychange", visibilite);
    programmer();
    return () => {
      arrete = true;
      clearTimeout(minuterie);
      document.removeEventListener("visibilitychange", visibilite);
    };
  }, [url, actif, relance]);
}
