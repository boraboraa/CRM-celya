"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PERIMETRE_COOKIE, perimetreAMemoriser } from "@/lib/crm/perimetre";

/**
 * Mémorise le dernier périmètre choisi, DANS LE NAVIGATEUR (27/10). Le
 * middleware le faisait sur chaque navigation : sa réponse portait alors un
 * `Set-Cookie`, et le cache du routeur ne la resservait jamais — chaque
 * bascule de périmètre coûtait un rendu serveur complet, même pour revenir à
 * un écran vu deux secondes plus tôt. Ici, l'écriture ne touche à aucune
 * réponse : revenir à « Toute l'équipe » sort du cache (30 s, next.config).
 *
 * UNE instance, dans le layout. La valeur repasse par `lirePerimetre` côté
 * serveur, exactement comme `?perimetre=` : rien n'est plus sûr ici qu'une URL.
 */
export function MemoirePerimetre() {
  const chemin = usePathname();
  const params = useSearchParams();
  const valeur = perimetreAMemoriser(chemin, params.get("perimetre"));
  useEffect(() => {
    if (!valeur) return;
    const actuel = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${PERIMETRE_COOKIE}=`))
      ?.slice(PERIMETRE_COOKIE.length + 1);
    if (actuel === valeur) return;
    const sur = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${PERIMETRE_COOKIE}=${valeur}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${sur}`;
  }, [valeur]);
  return null;
}
