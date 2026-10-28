"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icone } from "@/components/ui";

/**
 * La feuille du bas — UNE pour tout le mobile : « Plus », filtres, débrief,
 * rendez-vous, ajout rapide. Elle monte depuis le bord, sous le pouce.
 *
 * Trois choses qu'on oublierait en la refaisant à chaque écran :
 *  - le PORTAIL vers `body` : un `.card` porte un `backdrop-filter`, qui fait
 *    de lui le repère des `position: fixed` qu'il contient — une feuille ouverte
 *    depuis une ligne de « À faire » se serait collée dans la carte ;
 *  - le CLAVIER : sur iPhone, il recouvre le bas de l'écran sans réduire la
 *    fenêtre. La feuille suit `visualViewport` pour que son bouton reste
 *    au-dessus des touches ;
 *  - la zone sûre (`env(safe-area-inset-bottom)`) : la barre d'accueil de
 *    l'iPhone mange sinon le bouton du bas.
 *
 * Échap, un tap sur le fond ou « Fermer » la referment ; la page derrière ne
 * défile pas tant qu'elle est ouverte.
 */
export function FeuilleBas({
  ouvert,
  onFermer,
  titre,
  children,
  pied,
}: {
  ouvert: boolean;
  onFermer: () => void;
  titre: string;
  children: React.ReactNode;
  /** Le geste principal, collé en bas de la feuille (au-dessus du clavier). */
  pied?: React.ReactNode;
}) {
  const id = useId();
  const boite = useRef<HTMLDivElement>(null);
  const [monte, setMonte] = useState(false);
  /** La hauteur que le clavier masque sous la fenêtre visible (iOS). */
  const [clavier, setClavier] = useState(0);
  // `onFermer` change à chaque rendu du parent : on garde la dernière.
  const fermer = useRef(onFermer);
  fermer.current = onFermer;

  useEffect(() => setMonte(true), []);

  useEffect(() => {
    if (!ouvert) return;
    const avant = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const echap = (e: KeyboardEvent) => {
      if (e.key === "Escape") fermer.current();
    };
    window.addEventListener("keydown", echap);

    const vv = window.visualViewport;
    const suivre = () => {
      if (!vv) return;
      setClavier(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    };
    suivre();
    vv?.addEventListener("resize", suivre);
    vv?.addEventListener("scroll", suivre);

    // Le focus entre dans la feuille : sur le premier champ s'il y en a un
    // (le clavier sort tout de suite), sinon sur la feuille elle-même.
    const champ = boite.current?.querySelector<HTMLElement>("[data-autofocus]");
    (champ ?? boite.current)?.focus();

    return () => {
      document.body.style.overflow = avant;
      window.removeEventListener("keydown", echap);
      vv?.removeEventListener("resize", suivre);
      vv?.removeEventListener("scroll", suivre);
    };
  }, [ouvert]);

  if (!monte || !ouvert) return null;

  return createPortal(
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        aria-label="Fermer"
        tabIndex={-1}
        onClick={() => fermer.current()}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-[2px]"
      />
      <div
        ref={boite}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        style={{ bottom: clavier }}
        className="animate-feuille absolute inset-x-0 flex max-h-[88dvh] flex-col rounded-t-[15px] bg-space-800 shadow-2xl outline-none ring-1 ring-white/10 sm:mx-auto sm:max-w-lg"
      >
        <div className="flex items-center gap-2 border-b border-white/[0.06] py-1 pl-5 pr-1">
          <h2 id={id} title={titre} className="min-w-0 flex-1 truncate font-display text-base font-semibold text-slate-50">
            {titre}
          </h2>
          <button
            type="button"
            onClick={() => fermer.current()}
            aria-label="Fermer"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100"
          >
            <Icone nom="croix" className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>
        <div
          className={pied ? "border-t border-white/[0.06] px-5 pt-3" : ""}
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          {pied}
        </div>
      </div>
    </div>,
    document.body
  );
}
