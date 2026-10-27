"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TRIS, depuisValeurEtape } from "@/lib/crm/filtresProspects";

/**
 * La ligne de filtres de /prospects (27/10, au soir) : la recherche, puis UNE
 * ligne de listes déroulantes — QUI (le périmètre, pour qui peut élargir) ·
 * ÉTAPE (avec les raccourcis « À débriefer » et « Emails envoyés ») · TRI
 * (en liste). Plus de rangée de puces d'étape.
 *
 * Recherche, étape et tri — À LA FRAPPE (18/10). Il fallait
 * taper puis cliquer « Filtrer » : la liste ne réagissait à rien.
 *
 * Le filtre reste dans l'URL (`?q=&statut=&tri=`) et la REQUÊTE reste celle du
 * serveur (page.tsx, `filtreRecherche`) : ce composant ne filtre rien
 * lui-même, il réécrit l'URL après 300 ms de calme, en conservant les autres
 * paramètres (vue, filtre, périmètre). `replace` et non `push` : une frappe
 * n'est pas une page de l'historique.
 */
export function FiltresProspects({
  q,
  etape,
  tri,
  etapes,
  raccourcis = [],
  qui = null,
  avecTri,
  seulementRecherche = false,
}: {
  q: string;
  /** La valeur du menu « Étape » : une étape, `f:<raccourci>` ou `tous` (valeurEtape). */
  etape: string;
  tri: string;
  /** [valeur, libellé] — des chaînes seulement (frontière serveur → client). */
  etapes: [string, string][];
  /** [raccourci, libellé] — « À débriefer », « Emails envoyés ». */
  raccourcis?: [string, string][];
  /** Le périmètre : des liens tout faits (optionsPerimetre) — null : pas de menu. */
  qui?: { href: string; label: string; actif: boolean }[] | null;
  avecTri: boolean;
  /**
   * Téléphone : la recherche seule, sans libellé — l'étape et le tri passent
   * dans la feuille « Filtres ». Même champ, même délai, même URL.
   */
  seulementRecherche?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [texte, setTexte] = useState(q);
  const [enCours, startTransition] = useTransition();
  const premier = useRef(true);

  function aller(maj: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(maj)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    const qs = sp.toString();
    startTransition(() => {
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    });
  }

  useEffect(() => {
    if (premier.current) {
      premier.current = false;
      return;
    }
    const t = setTimeout(() => aller({ q: texte.trim() || null }), 300);
    return () => clearTimeout(t);
    // `aller` lit les paramètres du moment ; seule la frappe déclenche.
  }, [texte]);

  if (seulementRecherche) {
    return (
      <div className="relative min-w-0 flex-1">
        <input
          id="q-mobile"
          type="search"
          enterKeyHint="search"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          className="input min-h-[44px]"
          placeholder="Société, contact, téléphone…"
          aria-label="Rechercher une fiche"
          autoComplete="off"
        />
        {enCours && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">…</span>
        )}
      </div>
    );
  }

  const quiActif = qui?.find((o) => o.actif)?.href ?? "";
  const menu = "input min-h-[40px] w-auto py-1.5 text-xs";

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <input
          id="q"
          type="search"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          className="input min-h-[40px] py-1.5"
          placeholder="Rechercher : société, contact, téléphone, ville…"
          aria-label="Rechercher une fiche"
          autoComplete="off"
        />
        {enCours && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">…</span>
        )}
      </div>

      {qui && qui.length > 0 && (
        <select
          value={quiActif}
          onChange={(e) => startTransition(() => router.push(e.target.value, { scroll: false }))}
          aria-label="Qui"
          className={menu}
        >
          {qui.map((o) => (
            <option key={o.href} value={o.href}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      <select
        value={etape || "tous"}
        onChange={(e) => aller(depuisValeurEtape(e.target.value))}
        aria-label="Étape"
        className={menu}
      >
        <option value="tous">Toutes les étapes</option>
        {etapes.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
        {raccourcis.length > 0 && (
          <optgroup label="Raccourcis">
            {raccourcis.map(([v, label]) => (
              <option key={v} value={`f:${v}`}>
                {label}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {avecTri && (
        <select
          value={tri || "priorite"}
          onChange={(e) => aller({ tri: e.target.value === "priorite" ? null : e.target.value })}
          aria-label="Trier par"
          className={menu}
        >
          {Object.entries(TRIS).map(([v, label]) => (
            <option key={v} value={v}>
              Tri : {label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
