"use client";

import { useOptimistic, useState, useTransition } from "react";
import { basculerAppelsAction } from "@/app/appels-ia-actions";

/** Classes entières (règle JIT) : la piste et la pastille, allumé / éteint. */
const PISTE: Record<"oui" | "non", string> = {
  oui: "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-celya-blue transition-colors duration-200 disabled:opacity-60",
  non: "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-white/[0.12] ring-1 ring-white/10 transition-colors duration-200 disabled:opacity-60",
};
const PASTILLE: Record<"oui" | "non", string> = {
  oui: "inline-block h-5 w-5 translate-x-[22px] rounded-full bg-white shadow transition-transform duration-200",
  non: "inline-block h-5 w-5 translate-x-0.5 rounded-full bg-slate-300 shadow transition-transform duration-200",
};
/** L'état écrit sous le libellé : neutre, ou ambre (attention). */
const TON: Record<"normal" | "attention", string> = {
  normal: "text-slate-400",
  attention: "text-amber-300",
};

/**
 * Un interrupteur des appels de Janet : l'interrupteur général, le mode test,
 * l'inscription automatique. OPTIMISTE : il bascule au clic, le serveur suit,
 * et s'il refuse, `useOptimistic` rend la main à la valeur serveur à la fin de
 * la transition — l'interrupteur revient seul, le message dit pourquoi.
 *
 * `confirmation` : basculer VERS cette valeur demande d'abord un « oui », en
 * place (sortir du mode test, c'est appeler de vrais prospects).
 */
export function Interrupteur({
  champ,
  valeur,
  libelle,
  texteOui,
  texteNon,
  attentionSi,
  confirmation,
}: {
  champ: "actif" | "mode_test" | "inscription_auto";
  valeur: boolean;
  libelle: string;
  /** Ce que veut dire « allumé ». */
  texteOui: string;
  /** Ce que veut dire « éteint ». */
  texteNon: string;
  /** L'état qui s'écrit en ambre (le mode test mis, par exemple). */
  attentionSi?: boolean;
  confirmation?: { versValeur: boolean; texte: string; bouton: string } | null;
}) {
  const [vue, appliquer] = useOptimistic(valeur);
  const [enCours, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string>();
  const [demande, setDemande] = useState(false);

  function basculer(v: boolean) {
    setDemande(false);
    setErreur(undefined);
    startTransition(async () => {
      appliquer(v);
      const res = await basculerAppelsAction(champ, v);
      if (res?.error) setErreur(res.error);
    });
  }

  function auClic() {
    const cible = !vue;
    if (confirmation && confirmation.versValeur === cible) {
      setDemande((d) => !d);
      return;
    }
    basculer(cible);
  }

  const attention = attentionSi !== undefined && vue === attentionSi;

  return (
    <div className="min-w-0">
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={vue}
          aria-label={libelle}
          onClick={auClic}
          disabled={enCours}
          className={PISTE[vue ? "oui" : "non"]}
        >
          <span aria-hidden className={PASTILLE[vue ? "oui" : "non"]} />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-100">
            {libelle}
            <span className="ml-2 text-xs font-normal text-slate-500">{vue ? "allumé" : "coupé"}</span>
          </p>
          <p className={`mt-0.5 text-xs leading-relaxed ${TON[attention ? "attention" : "normal"]}`}>
            {vue ? texteOui : texteNon}
          </p>
        </div>
      </div>

      {demande && confirmation && (
        <div className="mt-3 rounded-xl bg-amber-500/[0.08] px-3.5 py-3 ring-1 ring-amber-400/25">
          <p className="text-xs leading-relaxed text-amber-200">{confirmation.texte}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => basculer(confirmation.versValeur)}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              {confirmation.bouton}
            </button>
            <button type="button" onClick={() => setDemande(false)} className="btn-link text-xs">
              Annuler
            </button>
          </div>
        </div>
      )}

      {erreur && (
        <p
          role="alert"
          className="mt-2 rounded-xl bg-rose-500/10 px-3.5 py-2 text-xs text-rose-300 ring-1 ring-rose-400/20"
        >
          {erreur}
        </p>
      )}
    </div>
  );
}
