"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: string };

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Aujourd'hui", icon: "◉" },
  { href: "/pipeline", label: "Pipeline", icon: "▤" },
  { href: "/clients", label: "Clients", icon: "◇" },
  { href: "/taches", label: "Relances", icon: "◷" },
];

export const ADMIN_ITEM: NavItem = { href: "/equipe", label: "Équipe", icon: "◍" };
export const ACCOUNT_ITEM: NavItem = { href: "/compte", label: "Mon compte", icon: "⚙" };

export function NavLinks({
  items,
  orientation = "vertical",
}: {
  items: NavItem[];
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();

  return (
    <nav
      className={
        orientation === "vertical"
          ? "space-y-1"
          : "flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]"
      }
    >
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link ${active ? "nav-link-active" : ""} ${
              orientation === "horizontal" ? "shrink-0 whitespace-nowrap" : ""
            }`}
          >
            <span aria-hidden className="text-base leading-none opacity-70">
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
