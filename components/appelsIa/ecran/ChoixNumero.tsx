"use client";

import { useState, useTransition } from "react";
import { reglerAppelsAction, type EtatAction } from "@/app/appels-ia-actions";
import type { NumeroPropose } from "@/lib/appelsIa/ecran";
import { Icone } from "@/components/ui";
import { Retour } from "./commun";

/** Classes entières (règle JIT) : le numéro choisi, les autres. */
const PUCE: Record<"choisi" | "autre", string> = {
  choisi:
    "inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-celya-blue/15 px-3.5 py-2 text-sm font-medium text-slate-50 ring-1 ring-blue-400/50",
  autre:
    "inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3.5 py-2 text-sm text-slate-200 ring-1 ring-white/10 transition hover:bg-white/[0.04] disabled:opacity-60",
};

/**
 * Le numéro appelant : choisi d'un tap parmi les numéros que le CRM connaît
 * (`numerosProposes` : celui qui est réglé, celui du compte, le GSM de test),
 * ou saisi. Un tap enregistre (`reglerAppelsAction`, ce seul champ). Pas
 * optimiste, et c'est voulu : un numéro refusé par le juge (`numeroAppelable`)
 * ne doit jamais paraître réglé.
 */
export function ChoixNumero({ proposes, actuel }: { proposes: NumeroPropose[]; actuel: string | null }) {
  const [enCours, startTransition] = useTransition();
  const [etat, setEtat] = useState<EtatAction>();
  const [autre, setAutre] = useState(proposes.length === 0);
  const [saisie, setSaisie] = useState("");

  function regler(numero: string) {
    const fd = new FormData();
    fd.set("numero_appelant", numero);
    setEtat(undefined);
    startTransition(async () => {
      const res = await reglerAppelsAction({}, fd);
      setEtat(res.ok ? { ok: true, message: "Numéro appelant enregistré." } : res);
      if (res.ok) {
        setAutre(false);
        setSaisie("");
      }
    });
  }

  return (
    <div className="space-y-3">
      {proposes.length > 0 && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Numéro appelant">
          {proposes.map((n) => {
            const choisi = n.e164 === actuel;
            return (
              <button
                key={n.e164}
                type="button"
                role="radio"
                aria-checked={choisi}
                disabled={enCours || choisi}
                onClick={() => regler(n.e164)}
                className={PUCE[choisi ? "choisi" : "autre"]}
              >
                {choisi && <Icone nom="coche" className="h-3.5 w-3.5 text-emerald-300" />}
                <span>{n.lisible}</span>
                <span className="text-[11px] font-normal text-slate-500">{n.source}</span>
              </button>
            );
          })}
          {!autre && (
            <button type="button" onClick={() => setAutre(true)} className="btn-link min-h-[44px] px-2 text-sm">
              Autre numéro…
            </button>
          )}
        </div>
      )}

      {autre && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (saisie.trim()) regler(saisie);
          }}
          className="flex gap-2"
        >
          <label htmlFor="numero-appelant-saisi" className="sr-only">
            Autre numéro appelant
          </label>
          <input
            id="numero-appelant-saisi"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder="0480 …"
            className="input min-w-0"
          />
          <button type="submit" disabled={enCours || !saisie.trim()} className="btn-ghost shrink-0 px-3 py-2 text-xs">
            {enCours ? "…" : "Enregistrer"}
          </button>
        </form>
      )}

      <Retour etat={etat} />
    </div>
  );
}
