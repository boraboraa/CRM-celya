/**
 * Les trois onglets de l'écran Appels IA — Mise en route, Campagnes, Suivi —
 * dans cet ordre, chacun avec son état (✓ fait, « à faire », ou un mot).
 *
 * Des LIENS (`?onglet=`), rendus côté serveur : un onglet se partage, se
 * recharge et revient avec le bouton Retour, comme le sélecteur de périmètre.
 * Module NEUTRE, sans état.
 */

import Link from "next/link";
import { Icone } from "@/components/ui";

export const ONGLETS = ["mise-en-route", "campagnes", "suivi"] as const;
export type Onglet = (typeof ONGLETS)[number];

export function lireOnglet(brut: string | string[] | undefined, parDefaut: Onglet): Onglet {
  const v = Array.isArray(brut) ? brut[0] : brut;
  return (ONGLETS as readonly string[]).includes(v ?? "") ? (v as Onglet) : parDefaut;
}

const LIBELLE: Record<Onglet, string> = {
  "mise-en-route": "Mise en route",
  campagnes: "Campagnes",
  suivi: "Suivi",
};

/** `fait` : ✓ ; `a_faire` : ambre ; `info` : neutre (un mot, un compte). Classes entières (règle JIT). */
export type EtatOnglet = { ton: "fait" | "a_faire" | "info"; texte: string };

const PUCE: Record<EtatOnglet["ton"], string> = {
  fait: "inline-flex items-center gap-1 text-[11px] font-normal text-emerald-300",
  a_faire: "inline-flex items-center gap-1 text-[11px] font-normal text-amber-300",
  info: "inline-flex items-center gap-1 text-[11px] font-normal text-slate-400",
};
const ONGLET: Record<"actif" | "inactif", string> = {
  actif:
    "flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl bg-celya-blue/15 px-2 py-2 text-center text-sm font-medium text-slate-50 ring-1 ring-blue-400/40 sm:flex-row sm:gap-2",
  inactif:
    "flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2 text-center text-sm font-medium text-slate-300 ring-1 ring-white/10 transition hover:bg-white/[0.04] hover:text-slate-100 sm:flex-row sm:gap-2",
};

export function OngletsAppels({ actuel, etats }: { actuel: Onglet; etats: Record<Onglet, EtatOnglet> }) {
  return (
    <nav aria-label="Étapes des appels IA" className="mb-6">
      <ol className="flex gap-2">
        {ONGLETS.map((o, i) => {
          const e = etats[o];
          return (
            <li key={o} className="flex min-w-0 flex-1">
              <Link
                href={`/appels-ia?onglet=${o}`}
                aria-current={o === actuel ? "page" : undefined}
                className={ONGLET[o === actuel ? "actif" : "inactif"]}
              >
                <span className="truncate">
                  <span className="text-slate-500">{i + 1}.</span> {LIBELLE[o]}
                </span>
                <span className={PUCE[e.ton]}>
                  {e.ton === "fait" && <Icone nom="coche" className="h-3 w-3" />}
                  {e.ton === "a_faire" && <Icone nom="alerte" className="h-3 w-3" />}
                  {e.texte}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
