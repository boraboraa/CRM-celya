"use client";

import { useMemo, useState, useTransition } from "react";
import { poserContactAction } from "@/app/actions";
import { lireRaccourcis } from "@/lib/crm/raccourcis";
import { phraseContact, propositionContact } from "@/lib/crm/contactPropose";
import { Icone } from "@/components/ui";

/**
 * Le nom de la personne, au bon endroit — sous le compte rendu d'un résultat
 * d'appel ou d'un débrief. Lu à la frappe par le parseur de raccourcis
 * (déterministe, sans réseau), PROPOSÉ en pastille : « Contact → Mme Lambert
 * (gérante) » — gardée d'un tap (écrite alors, et seulement alors), retirée
 * d'une croix. Un contact déjà présent n'est jamais remplacé sans que la
 * pastille le dise (lib/crm/contactPropose.ts).
 *
 * `demander` : la fiche n'a pas de contact et rien n'est lu — un petit champ
 * « Nom de la personne » s'offre (après un résultat où l'on a eu quelqu'un).
 */
export function PastilleContact({
  prospectId,
  texte,
  contactActuel,
  demander = false,
}: {
  prospectId: string;
  texte: string;
  contactActuel: string | null | undefined;
  demander?: boolean;
}) {
  const [retire, setRetire] = useState<string | null>(null);
  const [enregistre, setEnregistre] = useState<string | null>(null);
  const [saisie, setSaisie] = useState("");
  const [erreur, setErreur] = useState<string>();
  const [pending, startTransition] = useTransition();

  const actuel = enregistre ?? contactActuel ?? null;
  const proposition = useMemo(() => {
    if (!texte.trim()) return null;
    return propositionContact(lireRaccourcis(texte, new Date()).contact ?? null, actuel);
  }, [texte, actuel]);

  function garder(nom: string, remplace: string | null) {
    setErreur(undefined);
    startTransition(async () => {
      const res = await poserContactAction({ prospectId, nom, remplace });
      if (res.error) {
        setErreur(res.error);
        return;
      }
      setEnregistre(nom);
      setSaisie("");
    });
  }

  if (enregistre && !proposition) {
    return (
      <p className="flex items-center gap-1 text-[11px] text-emerald-300">
        <Icone nom="personne" className="h-3 w-3" /> Contact enregistré : {enregistre}
      </p>
    );
  }

  if (proposition && retire !== proposition.valeur) {
    return (
      <div className="space-y-1">
        <span className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-celya-blue/10 py-0.5 pl-2.5 pr-1 text-[11px] text-blue-100 ring-1 ring-celya-blue/30">
          <Icone nom="personne" className="h-3 w-3" />
          {phraseContact(proposition)}
          <button
            type="button"
            disabled={pending}
            onClick={() => garder(proposition.valeur, proposition.remplace)}
            className="ml-1 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 font-medium text-blue-100 transition hover:bg-celya-blue/20 disabled:opacity-50"
          >
            <Icone nom="coche" className="h-3 w-3" />
            {proposition.remplace ? "Remplacer" : "Garder"}
          </button>
          <button
            type="button"
            onClick={() => setRetire(proposition.valeur)}
            aria-label="Ne pas l'enregistrer comme contact"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100"
          >
            <Icone nom="croix" className="h-3 w-3" />
          </button>
        </span>
        {erreur && <p role="alert" className="text-[11px] text-rose-300">{erreur}</p>}
      </div>
    );
  }

  if (demander && !actuel) {
    return (
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (saisie.trim()) garder(saisie.trim(), null);
        }}
      >
        <input
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder="Nom de la personne (facultatif)"
          aria-label="Nom de la personne"
          className="input min-h-[44px] min-w-0 flex-1 py-1.5 text-xs"
        />
        <button
          type="submit"
          disabled={pending || !saisie.trim()}
          className="btn-ghost min-h-[44px] px-3 text-xs disabled:opacity-40"
        >
          OK
        </button>
        {erreur && <p role="alert" className="basis-full text-[11px] text-rose-300">{erreur}</p>}
      </form>
    );
  }

  return null;
}
