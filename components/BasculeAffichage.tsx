"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Icone, type IconeNom } from "@/components/ui";
import { VUES, VUE_COOKIE, type Vue } from "@/lib/crm/filtresProspects";

const ICONE: Record<Vue, IconeNom> = { liste: "taches", colonnes: "dossier" };

/**
 * « Liste | Pipeline » — les deux affichages des MÊMES fiches, visibles par
 * tous (27/10). Le dernier choix est retenu dans le navigateur (cookie
 * `celya_vue`, comme le périmètre : aucune réponse serveur ne porte de
 * `Set-Cookie`), et la page le relit en le validant comme une URL
 * (`lireVue`). Les liens viennent de la page : `hrefProspects`, qui garde la
 * recherche, l'étape et le périmètre.
 */
export function BasculeAffichage({
  vue,
  liens,
}: {
  vue: Vue;
  /** [vue, href] — calculés par la page serveur. */
  liens: [Vue, string][];
}) {
  useEffect(() => {
    const actuel = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${VUE_COOKIE}=`))
      ?.slice(VUE_COOKIE.length + 1);
    if (actuel === vue) return;
    const sur = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${VUE_COOKIE}=${vue}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${sur}`;
  }, [vue]);

  return (
    <div
      className="inline-flex rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/10"
      role="group"
      aria-label="Affichage"
    >
      {liens.map(([v, href]) => (
        <Link
          key={v}
          href={href}
          prefetch={false}
          aria-current={v === vue ? "page" : undefined}
          className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-xs font-medium transition ${
            v === vue
              ? "bg-white/[0.09] text-slate-50 ring-1 ring-white/15"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Icone nom={ICONE[v]} className="h-3.5 w-3.5" />
          {VUES[v]}
        </Link>
      ))}
    </div>
  );
}
