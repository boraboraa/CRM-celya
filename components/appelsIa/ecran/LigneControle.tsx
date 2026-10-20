"use client";

import { useEffect, useState } from "react";
import { poserSecretAction, reglerAppelsAction } from "@/app/appels-ia-actions";
import { Icone } from "@/components/ui";
import { Retour } from "./commun";
import { useFormulaire } from "./formulaire";

export type LigneControleVue = {
  /** Le nom du champ : `numero_appelant` / `gsm_test` (réglage) ou le nom d'un secret. */
  element: string;
  genre: "numero" | "secret";
  libelle: string;
  aide: string;
  /** Ce qui est en place, lisible (« 0480 24 53 68 », « posé le 20 oct. 2026 »), ou null : à faire. */
  fait: string | null;
};

/**
 * Une ligne à régler — le GSM de test (onglet « Numéro & test »), un secret
 * (Réglages avancés → Connexion) : ✓ vert quand c'est fait, sinon le champ
 * OUVERT, juste là.
 *
 * Un numéro passe par `reglerAppelsAction` avec ce seul champ (l'action ne
 * touche que les champs présents) ; un secret par `poserSecretAction` — ÉCRITURE
 * SEULE : la valeur part au Vault et ne s'affiche plus jamais, le champ se vide
 * après l'envoi. Une ligne faite se rouvre par « Modifier » / « Remplacer ».
 */
export function LigneControle({ l }: { l: LigneControleVue }) {
  const action = l.genre === "secret" ? poserSecretAction : reglerAppelsAction;
  const { etat, onSubmit, enCours, ref } = useFormulaire(action, { viderSiOk: l.genre === "secret" });
  const [ouvert, setOuvert] = useState(false);
  const id = `controle-${l.element}`;
  const champOuvert = !l.fait || ouvert;
  // Enregistré : la ligne se referme sur son ✓ (la page revient revalidée).
  useEffect(() => {
    if (etat.ok) setOuvert(false);
  }, [etat]);

  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={
            l.fait
              ? "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30"
              : "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-300 ring-1 ring-amber-400/30"
          }
        >
          {l.fait ? <Icone nom="coche" className="h-3.5 w-3.5" /> : <Icone nom="plus" className="h-3 w-3" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <label htmlFor={id} className="text-sm font-medium text-slate-100">
              {l.libelle}
            </label>
            {l.fait && (
              <span className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
                <span className="min-w-0 truncate">{l.fait}</span>
                {!ouvert && (
                  <button type="button" onClick={() => setOuvert(true)} className="btn-link shrink-0 text-xs">
                    {l.genre === "secret" ? "Remplacer" : "Modifier"}
                  </button>
                )}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{l.aide}</p>

          {champOuvert && (
            <form ref={ref} onSubmit={onSubmit} className="mt-2.5 space-y-2">
              {l.genre === "secret" && <input type="hidden" name="nom" value={l.element} />}
              <div className="flex gap-2">
                {l.genre === "secret" ? (
                  <input
                    id={id}
                    name="valeur"
                    type="password"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore
                    placeholder={l.fait ? "Nouvelle valeur" : "Collez la valeur"}
                    className="input min-w-0 font-mono text-xs"
                  />
                ) : (
                  <input
                    id={id}
                    name={l.element}
                    type="tel"
                    inputMode="tel"
                    required
                    autoComplete="off"
                    placeholder="04xx xx xx xx"
                    className="input min-w-0"
                  />
                )}
                <button type="submit" disabled={enCours} className="btn-ghost shrink-0 px-3 py-2 text-xs">
                  {enCours ? "…" : "Enregistrer"}
                </button>
              </div>
              {l.fait && (
                <button type="button" onClick={() => setOuvert(false)} className="btn-link text-xs">
                  Annuler
                </button>
              )}
              <Retour etat={etat} />
            </form>
          )}
        </div>
      </div>
    </li>
  );
}
