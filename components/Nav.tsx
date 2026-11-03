"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { lienOnglet, ongletActif, type NavItem } from "@/lib/nav";
import { useLienListe } from "@/components/useLienListe";
import { Icone } from "@/components/ui";

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const lienListe = useLienListe();

  // La barre latérale (ordinateur). Le téléphone a sa barre du bas,
  // components/BarreOnglets.tsx — tirée de la même liste (lib/nav.ts).
  return (
    <nav className="space-y-1">
      {items.map((item) => {
        const active = ongletActif(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={lienOnglet(item.href, lienListe)}
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
