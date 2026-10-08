"use client";

import { ajouterOppositionAction } from "@/app/appels-ia-actions";
import { Retour } from "./commun";
import { useFormulaire } from "./formulaire";

/** Ajouter un numéro à la liste d'opposition : Janet ne le composera plus jamais. */
export function AjoutOpposition() {
  const { etat, onSubmit, enCours, ref } = useFormulaire(ajouterOppositionAction, { viderSiOk: true });
  return (
    <form ref={ref} onSubmit={onSubmit} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <label htmlFor="opposition-numero" className="sr-only">
            Numéro
          </label>
          <input
            id="opposition-numero"
            name="numero"
            type="tel"
            inputMode="tel"
            required
            autoComplete="off"
            placeholder="Numéro (081 22 33 44)"
            className="input"
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="opposition-motif" className="sr-only">
            Motif
          </label>
          <input
            id="opposition-motif"
            name="motif"
            maxLength={300}
            autoComplete="off"
            placeholder="Motif (facultatif)"
            className="input"
          />
        </div>
        <button type="submit" disabled={enCours} className="btn-ghost px-3 py-2 text-xs">
          {enCours ? "Ajout…" : "Ajouter"}
        </button>
      </div>
      <Retour etat={etat} />
    </form>
  );
}
