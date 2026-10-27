"use client";

import { startTransition, useOptimistic, useState } from "react";
import { etoilerProspectAction } from "@/app/actions";
import { Icone } from "@/components/ui";

/**
 * L'étoile d'une fiche (031) — un tap, optimiste : l'écran bouge, le serveur
 * suit, et revient seul s'il refuse.
 *
 * Sur la fiche d'un autre (lecture seule — encadrant, co-porteur), l'étoile
 * s'AFFICHE si elle est posée, en texte : on voit ce que l'étudiant juge
 * chaud, on n'y touche pas. Masquer, pas désactiver.
 */
export function BoutonEtoile({
  prospectId,
  etoilee,
  modifiable,
  nom,
  className = "",
}: {
  prospectId: string;
  etoilee: boolean;
  modifiable: boolean;
  /** Pour le libellé accessible : « Étoiler Garage Dupont ». */
  nom: string;
  className?: string;
}) {
  const [vue, appliquer] = useOptimistic(etoilee, (_: boolean, v: boolean) => v);
  const [erreur, setErreur] = useState<string>();

  if (!modifiable) {
    return vue ? (
      <span title="Étoilée par son responsable" className={`inline-flex text-amber-300 ${className}`}>
        <Icone nom="etoile" className="h-4 w-4 fill-current" />
        <span className="sr-only">Étoilée</span>
      </span>
    ) : null;
  }

  return (
    <button
      type="button"
      aria-pressed={vue}
      aria-label={vue ? `Retirer l'étoile de ${nom}` : `Étoiler ${nom}`}
      title={erreur ?? (vue ? "Retirer l'étoile" : "Étoiler : en tête de la liste et de « À faire »")}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setErreur(undefined);
        const suivant = !vue;
        startTransition(async () => {
          appliquer(suivant);
          const res = await etoilerProspectAction(prospectId, suivant);
          if (res?.error) setErreur(res.error);
        });
      }}
      className={`relative z-10 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition active:scale-95 ${
        vue ? "text-amber-300 hover:bg-amber-500/10" : "text-slate-500 hover:bg-white/[0.06] hover:text-slate-300"
      } ${erreur ? "ring-1 ring-rose-400/40" : ""} ${className}`}
    >
      <Icone nom="etoile" className={`h-4 w-4 ${vue ? "fill-current" : ""}`} />
    </button>
  );
}
