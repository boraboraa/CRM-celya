"use client";

import { useState } from "react";
import { Icone } from "@/components/ui";

/**
 * Un bloc REPLIÉ sur téléphone, toujours ouvert sur ordinateur (19/10) — un
 * seul DOM, pas de doublon : sous `lg`, le contenu attend derrière un
 * libellé ; à partir de `lg`, le bouton disparaît et le contenu s'affiche.
 * Sert l'en-tête de la fiche (adresse, confiance), dont les 340 px
 * repoussaient PROCHAINE ACTION sous le premier écran.
 */
export function RepliMobile({
  libelle,
  children,
}: {
  libelle: string;
  children: React.ReactNode;
}) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="btn-link min-h-[44px] text-xs lg:hidden"
      >
        {libelle}
        <Icone nom="chevron" className={`h-3 w-3 transition ${ouvert ? "rotate-180" : ""}`} />
      </button>
      <div className={`${ouvert ? "block" : "hidden"} lg:block`}>{children}</div>
    </>
  );
}
