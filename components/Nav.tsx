"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/nav";

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
