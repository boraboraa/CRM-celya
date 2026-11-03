"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  FILTRES_COOKIE,
  LISTE_PROSPECTS,
  lienListeProspects,
  lireDansCookies,
} from "@/lib/crm/filtresProspects";
import { EVENEMENT_FILTRES } from "@/components/MemoireFiltres";

/**
 * Le lien « retour à la liste » côté CLIENT (onglet Prospects, import,
 * suppression) : la liste retenue (cookie `celya_filtres`), relue à chaque
 * changement de page et à chaque changement de filtre. Au premier rendu, la
 * liste nue — la page `/prospects` reprend de toute façon la liste retenue.
 */
export function useLienListe(): string {
  const chemin = usePathname();
  const [lien, setLien] = useState(LISTE_PROSPECTS);
  useEffect(() => {
    const relire = () =>
      setLien(lienListeProspects(lireDansCookies(document.cookie, FILTRES_COOKIE), new Date()));
    relire();
    window.addEventListener(EVENEMENT_FILTRES, relire);
    return () => window.removeEventListener(EVENEMENT_FILTRES, relire);
  }, [chemin]);
  return lien;
}
