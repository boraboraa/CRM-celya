"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Recherche, étape et tri de /prospects — À LA FRAPPE (18/10). Il fallait
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
  statut,
  tri,
  etapes,
  avecTri,
  seulementRecherche = false,
}: {
  q: string;
  statut: string;
  tri: string;
  /** [valeur, libellé] — des chaînes seulement (frontière serveur → client). */
  etapes: [string, string][];
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

  return (
    <div className="flex flex-1 flex-wrap items-end gap-3">
      <div className="min-w-[200px] flex-1">
        <label className="label" htmlFor="q">
          Rechercher {enCours && <span className="text-slate-500">…</span>}
        </label>
        <input
          id="q"
          type="search"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          className="input"
          placeholder="Société, contact, téléphone, email, ville…"
          autoComplete="off"
        />
      </div>

      <div>
        <label className="label" htmlFor="statut">
          Étape
        </label>
        <select
          id="statut"
          value={statut || "tous"}
          onChange={(e) => aller({ statut: e.target.value === "tous" ? null : e.target.value })}
          className="input"
        >
          <option value="tous">Toutes</option>
          {etapes.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {avecTri && (
        <div>
          <label className="label" htmlFor="tri">
            Trier par
          </label>
          <select
            id="tri"
            value={tri || "recent"}
            onChange={(e) => aller({ tri: e.target.value === "recent" ? null : e.target.value })}
            className="input"
          >
            <option value="recent">Activité récente</option>
            <option value="relance">Prochaine action</option>
            <option value="nom">Nom</option>
          </select>
        </div>
      )}
    </div>
  );
}
