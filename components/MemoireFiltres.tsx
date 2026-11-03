"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  cleDefilement,
  ligneCookieFiltres,
  type ParamsProspects,
} from "@/lib/crm/filtresProspects";

/** L'événement qui dit aux liens « retour à la liste » de se relire. */
export const EVENEMENT_FILTRES = "celya:filtres";

/**
 * Retient les filtres de /prospects, DANS LE NAVIGATEUR (3/11) — même
 * mécanisme que la vue (`celya_vue`) et le périmètre (`celya_perim`) : aucune
 * réponse serveur ne porte de `Set-Cookie`, le cache du routeur reste utile.
 * Le cookie expire à minuit, heure de Bruxelles ; une liste sans filtre
 * l'efface. La valeur repasse par la validation de l'URL côté serveur
 * (`lireCookieFiltres`) : rien n'est plus sûr ici qu'une URL.
 *
 * Retient AUSSI la position de défilement de la liste (par URL, dans
 * `sessionStorage`) et la rend au retour, avant la peinture : on retrouve la
 * fiche d'où l'on venait, sans saut.
 */
export function MemoireFiltres() {
  const chemin = usePathname();
  const sp = useSearchParams();
  const recherche = sp.toString();

  useEffect(() => {
    const params: ParamsProspects = Object.fromEntries(new URLSearchParams(recherche));
    const sur = window.location.protocol === "https:";
    document.cookie = ligneCookieFiltres(params, new Date(), sur);
    window.dispatchEvent(new Event(EVENEMENT_FILTRES));
  }, [recherche]);

  // La position de défilement : rendue à l'arrivée, retenue en continu.
  useLayoutEffect(() => {
    const cle = cleDefilement(chemin ?? "/prospects", recherche);
    let cible: number | null = null;
    try {
      const lu = Number(sessionStorage.getItem(cle));
      if (Number.isFinite(lu) && lu > 0) cible = lu;
    } catch {
      /* stockage indisponible : on part du haut, comme avant */
    }
    const rendre = () => {
      if (cible !== null && Math.abs(window.scrollY - cible) > 2) window.scrollTo(0, cible);
    };
    rendre();
    // Le routeur peut encore remonter la page après nous : une seconde fois,
    // avant la peinture.
    const raf = requestAnimationFrame(rendre);

    let minuterie: ReturnType<typeof setTimeout> | undefined;
    const retenir = () => {
      try {
        sessionStorage.setItem(cle, String(Math.round(window.scrollY)));
      } catch {
        /* idem */
      }
    };
    const auDefilement = () => {
      clearTimeout(minuterie);
      minuterie = setTimeout(retenir, 120);
    };
    window.addEventListener("scroll", auDefilement, { passive: true });
    window.addEventListener("pagehide", retenir);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(minuterie);
      retenir();
      window.removeEventListener("scroll", auDefilement);
      window.removeEventListener("pagehide", retenir);
    };
  }, [chemin, recherche]);

  return null;
}
