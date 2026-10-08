"use client";

import { useOptimistic, useState, useTransition } from "react";
import { retirerDeLaFileAction, retirerOppositionAction } from "@/app/appels-ia-actions";
import { Retour } from "./commun";

/**
 * Une ligne de liste qu'on peut retirer : une fiche en attente dans la file,
 * un numéro de la liste d'opposition. Le CONTENU est rendu par le serveur et
 * passé en `children` (un nœud React traverse la frontière, une fonction non) ;
 * ce composant n'ajoute que le geste.
 *
 * Optimiste : la ligne disparaît au clic ; si le serveur refuse, elle revient
 * avec le message. `confirmation` : un « oui » d'abord, en place.
 */
export function LigneRetirable({
  genre,
  cle,
  bouton,
  confirmation,
  children,
}: {
  genre: "file" | "opposition";
  /** L'id de la ligne de file, ou le numéro en E.164. */
  cle: string;
  bouton: string;
  confirmation?: { texte: string; bouton: string } | null;
  children: React.ReactNode;
}) {
  const [retiree, retirer] = useOptimistic(false);
  const [enCours, startTransition] = useTransition();
  const [demande, setDemande] = useState(false);
  const [erreur, setErreur] = useState<string>();

  function go() {
    setDemande(false);
    setErreur(undefined);
    startTransition(async () => {
      retirer(true);
      const res = genre === "file" ? await retirerDeLaFileAction(cle) : await retirerOppositionAction(cle);
      if (res?.error) setErreur(res.error);
    });
  }

  if (retiree) return null;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">{children}</div>
        <button
          type="button"
          onClick={() => (confirmation ? setDemande((d) => !d) : go())}
          disabled={enCours}
          className="btn-link shrink-0 text-[11px]"
        >
          {bouton}
        </button>
      </div>
      {demande && confirmation && (
        <div className="mt-2.5 rounded-xl bg-amber-500/[0.08] px-3.5 py-3 ring-1 ring-amber-400/25">
          <p className="text-xs leading-relaxed text-amber-200">{confirmation.texte}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={go} className="btn-ghost px-3 py-1.5 text-xs">
              {confirmation.bouton}
            </button>
            <button type="button" onClick={() => setDemande(false)} className="btn-link text-xs">
              Annuler
            </button>
          </div>
        </div>
      )}
      {erreur && (
        <div className="mt-2">
          <Retour etat={{ error: erreur }} />
        </div>
      )}
    </li>
  );
}
