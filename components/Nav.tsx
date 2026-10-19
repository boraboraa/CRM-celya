"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/nav";
import { Icone } from "@/components/ui";

export function NavLinks({
  items,
  orientation = "vertical",
}: {
  items: NavItem[];
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();

  // Barre mobile : TOUS les onglets visibles (18/10). En ligne et défilante,
  // elle coupait « Appels IA » au bord de l'écran de 390 px — un onglet qu'on
  // ne voit pas n'existe pas. Une colonne égale par onglet, l'icône au-dessus
  // d'un libellé court.
  if (orientation === "horizontal") {
    return (
      <nav className="grid grid-flow-col auto-cols-fr gap-1">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-0 flex-col items-center gap-0.5 rounded-lg px-0.5 py-1.5 text-[10px] font-medium leading-tight transition ${
                active
                  ? "bg-white/[0.08] text-slate-50"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
              }`}
            >
              <Icone nom={item.icon} className="h-4 w-4 opacity-80" />
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link ${active ? "nav-link-active" : ""}`}
          >
            <Icone nom={item.icon} className="h-4 w-4 opacity-70" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
