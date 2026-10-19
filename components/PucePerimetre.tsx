"use client";

import { useState } from "react";
import Link from "next/link";
import { Icone } from "@/components/ui";
import { FeuilleBas } from "@/components/FeuilleBas";

type Option = { href: string; label: string; actif: boolean; personne: boolean };

/**
 * Le périmètre sur téléphone : UNE puce (« Toute l'équipe ▾ ») au lieu de la
 * rangée de boutons et du menu — elle ouvre la feuille du bas. Les liens
 * arrivent tout construits (`optionsPerimetre`) : rien n'est recalculé ici.
 */
export function PucePerimetre({ options }: { options: Option[] }) {
  const [ouvert, setOuvert] = useState(false);
  const actif = options.find((o) => o.actif) ?? options[0];
  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-haspopup="dialog"
        aria-label={`Périmètre : ${actif.label}`}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-white/[0.04] px-3.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 transition active:scale-[0.98]"
      >
        <Icone nom="equipe" className="h-3.5 w-3.5 text-slate-400" />
        {actif.label}
        <Icone nom="chevron" className="h-3 w-3 text-slate-400" />
      </button>
      <FeuilleBas ouvert={ouvert} onFermer={() => setOuvert(false)} titre="Voir les fiches de…">
        <ListeOptionsPerimetre options={options} onChoisir={() => setOuvert(false)} />
      </FeuilleBas>
    </>
  );
}

/** Les choix du périmètre, en liste au pouce — la puce et la feuille « Filtres ». */
export function ListeOptionsPerimetre({
  options,
  onChoisir,
}: {
  options: Option[];
  onChoisir?: () => void;
}) {
  return (
    <ul className="-mx-2 space-y-0.5">
      {options.map((o) => (
        <li key={o.href}>
          <Link
            href={o.href}
            prefetch={false}
            onClick={onChoisir}
            aria-current={o.actif ? "true" : undefined}
            className={`flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-sm transition ${
              o.actif ? "bg-white/[0.07] text-slate-50" : "text-slate-300 hover:bg-white/[0.04]"
            }`}
          >
            <Icone
              nom={o.personne ? "personne" : o.label === "Moi" ? "personne" : "equipe"}
              className="h-4 w-4 text-slate-400"
            />
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.actif && <Icone nom="coche" className="h-4 w-4 text-celya-blue" />}
          </Link>
        </li>
      ))}
    </ul>
  );
}
