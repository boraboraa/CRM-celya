"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  rechercherProspectsAction,
  type ResultatRecherche,
} from "@/app/actions";
import { STATUS_CHIP, STATUS_ICON, STATUS_LABEL } from "@/lib/constants";
import { Icone } from "@/components/ui";

/**
 * La recherche globale — sur tous les écrans, ⌘K / Ctrl+K ou « / » (18/10).
 * Société, contact, téléphone : un nom tapé, Entrée, et la fiche s'ouvre.
 * Avant, il fallait aller sur /prospects, taper, cliquer « Filtrer », trouver
 * la ligne.
 *
 * La règle de correspondance vit dans lib/crm/recherche.ts (la même que la
 * liste) ; la requête part sur le client de l'utilisateur (RLS) : on ne
 * retrouve que ce qu'on voit déjà.
 *
 * UNE SEULE instance (dans le layout) tient le raccourci et la fenêtre ; les
 * boutons — barre latérale et barre mobile — ne font que l'ouvrir, par un
 * événement de fenêtre (même motif que lib/crm/composer.ts). Deux instances
 * ouvriraient deux fenêtres au même ⌘K.
 */
const OUVRIR = "celya:recherche";

/** Le bouton qui ouvre la recherche. `compact` : une loupe seule (mobile). */
export function BoutonRecherche({ compact = false }: { compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OUVRIR))}
      aria-label="Rechercher une fiche (⌘K)"
      className={
        compact
          ? "inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 ring-1 ring-white/10 transition hover:bg-white/[0.06]"
          : "flex w-full items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-sm text-slate-400 ring-1 ring-white/10 transition hover:text-slate-200"
      }
    >
      <Icone nom="loupe" className="h-4 w-4" />
      {!compact && (
        <>
          <span className="flex-1 text-left">Rechercher…</span>
          <kbd className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-400">
            ⌘K
          </kbd>
        </>
      )}
    </button>
  );
}

export function RechercheGlobale() {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [q, setQ] = useState("");
  const [resultats, setResultats] = useState<ResultatRecherche[]>([]);
  const [actif, setActif] = useState(0);
  const [cherche, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  /** La dernière frappe : une réponse plus ancienne ne l'écrase jamais. */
  const derniere = useRef("");

  // ⌘K / Ctrl+K partout ; « / » quand on n'est pas déjà en train d'écrire.
  useEffect(() => {
    function raccourci(e: KeyboardEvent) {
      const cible = e.target as HTMLElement | null;
      const ecrit =
        cible?.tagName === "INPUT" ||
        cible?.tagName === "TEXTAREA" ||
        cible?.tagName === "SELECT" ||
        cible?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOuvert(true);
      } else if (e.key === "/" && !ecrit && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOuvert(true);
      }
    }
    const parBouton = () => setOuvert(true);
    window.addEventListener("keydown", raccourci);
    window.addEventListener(OUVRIR, parBouton);
    return () => {
      window.removeEventListener("keydown", raccourci);
      window.removeEventListener(OUVRIR, parBouton);
    };
  }, []);

  useEffect(() => {
    if (ouvert) input.current?.focus();
  }, [ouvert]);

  // La recherche part à la frappe, après 200 ms de calme.
  useEffect(() => {
    if (!ouvert) return;
    const t = q.trim();
    derniere.current = t;
    if (!t) {
      setResultats([]);
      return;
    }
    const minuterie = setTimeout(() => {
      startTransition(async () => {
        const res = await rechercherProspectsAction(t);
        if (derniere.current !== t) return;
        setResultats(res.resultats);
        setActif(0);
      });
    }, 200);
    return () => clearTimeout(minuterie);
  }, [q, ouvert]);

  function fermer() {
    setOuvert(false);
    setQ("");
    setResultats([]);
  }

  function ouvrir(r: ResultatRecherche | undefined) {
    if (!r) return;
    fermer();
    router.push(`/prospects/${r.id}`);
  }

  return (
    <>
      {ouvert && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) fermer();
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Rechercher une fiche"
        >
          <div className="card w-full max-w-lg overflow-hidden p-0 shadow-2xl">
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-4">
              <Icone nom="loupe" className="h-4 w-4 text-slate-400" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") fermer();
                  else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActif((a) => Math.min(a + 1, resultats.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActif((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    ouvrir(resultats[actif]);
                  }
                }}
                placeholder="Société, contact, téléphone…"
                aria-label="Société, contact ou téléphone"
                className="min-h-[52px] flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
              />
              {cherche && <span className="text-[11px] text-slate-500">…</span>}
              <button
                type="button"
                onClick={fermer}
                className="rounded-md px-1.5 py-0.5 text-[10px] text-slate-400 ring-1 ring-white/10"
              >
                Échap
              </button>
            </div>

            {q.trim() && (
              <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
                {resultats.length === 0 && !cherche && (
                  <li className="px-4 py-4 text-sm text-slate-500">Aucune fiche ne correspond.</li>
                )}
                {resultats.map((r, i) => (
                  <li key={r.id} role="option" aria-selected={i === actif}>
                    <button
                      type="button"
                      onMouseEnter={() => setActif(i)}
                      onClick={() => ouvrir(r)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                        i === actif ? "bg-white/[0.06]" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-100">
                          {r.company_name}
                        </span>
                        <span className="block truncate text-xs text-slate-400">
                          {[r.contact_name, r.phone, r.city].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ring-1 ${STATUS_CHIP[r.status]}`}
                      >
                        <Icone nom={STATUS_ICON[r.status]} className="h-3 w-3" />
                        {STATUS_LABEL[r.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
