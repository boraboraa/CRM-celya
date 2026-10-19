"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ongletActif, type NavItem, type OngletMobile } from "@/lib/nav";
import { Icone } from "@/components/ui";
import { FeuilleBas } from "@/components/FeuilleBas";

const ONGLET =
  "flex min-h-[56px] min-w-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium leading-none transition active:scale-[0.98]";

/**
 * La barre d'onglets du téléphone — EN BAS, sous le pouce, fixe (19/10). Elle
 * remplace la rangée d'onglets du haut, loin de la main qui tient le
 * téléphone. Ses entrées viennent de `ongletsMobiles` (lib/nav.ts), tirée de
 * la même liste que la barre latérale : un droit ajouté là apparaît ici.
 *
 * Visible sous `lg` (là où la barre latérale n'est pas), elle tient compte de
 * la barre d'accueil de l'iPhone (`safe-area-inset-bottom`).
 */
export function BarreOnglets({ onglets }: { onglets: OngletMobile[] }) {
  const pathname = usePathname();
  const [plusOuvert, setPlusOuvert] = useState(false);

  return (
    <>
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] bg-space/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex max-w-lg items-stretch gap-1 px-2 py-1">
          {onglets.map((o) => {
            if (o.type === "ajout") {
              return (
                <Link
                  key="ajout"
                  href="/prospects/nouveau"
                  aria-label="Nouveau prospect"
                  className={`${ONGLET} text-slate-300`}
                >
                  <span className="grid h-9 w-11 place-items-center rounded-xl bg-celya-blue text-white">
                    <Icone nom="plus" className="h-5 w-5" />
                  </span>
                  <span className="sr-only">Ajouter</span>
                </Link>
              );
            }
            if (o.type === "plus") {
              const actif = o.items.some((i) => ongletActif(pathname, i.href));
              return (
                <button
                  key="plus"
                  type="button"
                  onClick={() => setPlusOuvert(true)}
                  aria-haspopup="dialog"
                  className={`${ONGLET} ${actif ? "text-slate-50" : "text-slate-400"}`}
                >
                  <Icone nom="points" className="h-5 w-5" />
                  Plus
                </button>
              );
            }
            const actif = ongletActif(pathname, o.item.href);
            return (
              <Link
                key={o.item.href}
                href={o.item.href}
                aria-current={actif ? "page" : undefined}
                className={`${ONGLET} ${actif ? "text-slate-50" : "text-slate-400"}`}
              >
                <Icone
                  nom={o.item.icon}
                  className={`h-5 w-5 ${actif ? "text-celya-blue" : ""}`}
                />
                {o.item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {onglets.map((o) =>
        o.type === "plus" ? (
          <FeuillePlus
            key="plus"
            items={o.items}
            ouvert={plusOuvert}
            onFermer={() => setPlusOuvert(false)}
          />
        ) : null
      )}
    </>
  );
}

/** « Plus » (admin) : les écrans de bureau, et la déconnexion. */
function FeuillePlus({
  items,
  ouvert,
  onFermer,
}: {
  items: NavItem[];
  ouvert: boolean;
  onFermer: () => void;
}) {
  return (
    <FeuilleBas ouvert={ouvert} onFermer={onFermer} titre="Plus">
      <ul className="-mx-2 space-y-1">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              onClick={onFermer}
              className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-sm text-slate-200 transition hover:bg-white/[0.05]"
            >
              <Icone nom={i.icon} className="h-4 w-4 text-slate-400" />
              {i.label}
            </Link>
          </li>
        ))}
        <li className="border-t border-white/[0.06] pt-1">
          <BoutonDeconnexion />
        </li>
      </ul>
    </FeuilleBas>
  );
}

/** Se déconnecter — dans « Plus » (admin) et sur « Compte » (tout le monde). */
export function BoutonDeconnexion() {
  return (
    <form action="/auth/signout" method="post">
      <button className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-sm text-slate-300 transition hover:bg-white/[0.05]">
        <Icone nom="sortie" className="h-4 w-4 text-slate-400" />
        Se déconnecter
      </button>
    </form>
  );
}
