"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { estRevue } from "@/lib/apparition";

const CLE = "celya_pages_vues";

/**
 * Rien ne s'anime au RETOUR sur une page déjà vue (3/11) : revenir d'une
 * fiche, c'est retrouver sa liste, pas la regarder réapparaître. Pose
 * `data-revu` sur `<html>` AVANT la peinture (effet de mise en page) ; la CSS
 * (`globals.css`) coupe alors `.animate-rise`. La mémoire est celle de
 * l'onglet (`sessionStorage`), lue dans un try/catch : navigation privée ou
 * stockage bloqué, tout s'anime comme avant — rien ne casse.
 */
export function MemoireApparition() {
  const chemin = usePathname();
  useLayoutEffect(() => {
    let vues: string[] = [];
    try {
      const brut = sessionStorage.getItem(CLE);
      const lu = brut ? JSON.parse(brut) : [];
      if (Array.isArray(lu)) vues = lu.filter((v): v is string => typeof v === "string");
    } catch {
      /* stockage indisponible */
    }
    const { revue, vues: suite } = estRevue(vues, chemin ?? "/");
    if (revue) document.documentElement.setAttribute("data-revu", "");
    else document.documentElement.removeAttribute("data-revu");
    try {
      sessionStorage.setItem(CLE, JSON.stringify(suite));
    } catch {
      /* idem */
    }
  }, [chemin]);
  return null;
}
