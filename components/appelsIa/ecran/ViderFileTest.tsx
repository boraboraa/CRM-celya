"use client";

import { useState, useTransition } from "react";
import { viderFileTestAction, type EtatAction } from "@/app/appels-ia-actions";
import { Retour } from "./commun";

/**
 * « Vider la file de test » : arrête toutes les lignes de TEST en attente.
 * Une ligne de test ne devient jamais un vrai appel — en sortant du mode test,
 * on les vide plutôt que de les laisser dormir. Un « oui » d'abord, avec le
 * nombre.
 */
export function ViderFileTest({ nombre }: { nombre: number }) {
  const [enCours, startTransition] = useTransition();
  const [demande, setDemande] = useState(false);
  const [etat, setEtat] = useState<EtatAction>();

  function vider() {
    setDemande(false);
    startTransition(async () => setEtat(await viderFileTestAction()));
  }

  if (nombre === 0 && !etat) return null;

  return (
    <div className="space-y-2">
      {nombre > 0 && (
        <button
          type="button"
          onClick={() => setDemande((d) => !d)}
          disabled={enCours}
          className="btn-ghost px-3 py-1.5 text-xs"
        >
          {enCours ? "Vidage…" : "Vider la file de test"}
        </button>
      )}
      {demande && (
        <div className="rounded-xl bg-amber-500/[0.08] px-3.5 py-3 ring-1 ring-amber-400/25">
          <p className="text-xs leading-relaxed text-amber-200">
            {nombre} ligne{nombre > 1 ? "s" : ""} de test en attente {nombre > 1 ? "seront arrêtées" : "sera arrêtée"}. Les
            lignes réelles ne bougent pas.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={vider} className="btn-ghost px-3 py-1.5 text-xs">
              Vider
            </button>
            <button type="button" onClick={() => setDemande(false)} className="btn-link text-xs">
              Annuler
            </button>
          </div>
        </div>
      )}
      <Retour etat={etat} />
    </div>
  );
}
