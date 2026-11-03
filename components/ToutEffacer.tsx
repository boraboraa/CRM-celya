"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ligneEffacerFiltres } from "@/lib/crm/filtresProspects";
import { EVENEMENT_FILTRES } from "@/components/MemoireFiltres";

/**
 * « Tout effacer » (3/11) : vide le cookie `celya_filtres` LUI-MÊME, tout de
 * suite, puis ouvre la liste sans filtre (vue et périmètre gardés). Le
 * marqueur `?filtres=aucun` n'est qu'un secours, si le cookie résistait.
 */
export function ToutEffacer({ href }: { href: string }) {
  const router = useRouter();
  const [enCours, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={enCours}
      onClick={() => {
        const sur = window.location.protocol === "https:";
        document.cookie = ligneEffacerFiltres(sur);
        window.dispatchEvent(new Event(EVENEMENT_FILTRES));
        startTransition(() => router.push(href, { scroll: false }));
      }}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-xs text-slate-300 ring-1 ring-white/10 transition hover:bg-white/[0.05] hover:text-slate-100"
    >
      Tout effacer
    </button>
  );
}
