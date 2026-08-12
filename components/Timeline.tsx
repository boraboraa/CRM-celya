"use client";

import { useState } from "react";
import { fmtDateTime, relative } from "@/lib/constants";
import type { TimelineKind } from "@/lib/crm/nextAction";

/** Un événement de la chronologie, déjà normalisé par la page. */
export type TimelineEntry = {
  /** Clé stable : « a-<id> » (activité) ou « e-<id> » (email). */
  key: string;
  /** L'identifiant en base, pour la suppression. */
  id: string;
  source: "activity" | "email";
  kind: TimelineKind;
  at: string;
  title: string | null;
  body: string | null;
  /** Auteur (activité) ou expéditeur (email). */
  by: string | null;
  /**
   * Entrée affichée avant que le serveur ne l'ait confirmée (UI optimiste).
   * Elle se lit tout de suite, en retrait, et ne propose pas la corbeille :
   * on ne supprime pas une trace qui n'existe pas encore.
   */
  pending?: boolean;
};

/** Libellé, couleur et pictogramme — classes complètes, jamais interpolées. */
const STYLE: Record<
  TimelineKind,
  { label: string; dot: string; chip: string; icon: string }
> = {
  note: {
    label: "Échange noté",
    dot: "bg-slate-400",
    chip: "bg-white/[0.05] text-slate-300 ring-white/10",
    icon: "✎",
  },
  note_interne: {
    label: "Note interne",
    dot: "bg-slate-600",
    chip: "bg-white/[0.03] text-slate-500 ring-white/[0.08]",
    icon: "•",
  },
  appel_sans_reponse: {
    label: "Appelé — pas de réponse",
    dot: "bg-slate-500",
    chip: "bg-white/[0.04] text-slate-400 ring-white/10",
    icon: "☎",
  },
  email_sortant: {
    label: "Email envoyé",
    dot: "bg-violet-400",
    chip: "bg-violet-500/15 text-violet-300 ring-violet-400/25",
    icon: "↗",
  },
  email_entrant: {
    label: "Réponse reçue",
    dot: "bg-emerald-400",
    chip: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/25",
    icon: "↘",
  },
  rendez_vous: {
    label: "Rendez-vous",
    dot: "bg-blue-400",
    chip: "bg-celya-blue/15 text-blue-300 ring-blue-400/25",
    icon: "◆",
  },
};

/** Ce qu'on montre d'emblée ; le reste se déplie d'un clic. */
const APERCU = 10;

/**
 * CHRONOLOGIE — les échanges du plus récent au plus ancien, chaque événement
 * typé et daté, lisible d'un coup d'œil. Ce n'est pas un bloc de texte brut :
 * le fil vertical, la pastille de couleur et la puce de type donnent la nature
 * de l'échange avant même de lire.
 *
 * Les brouillons n'y figurent JAMAIS — ils vivent dans leur propre espace.
 *
 * Seules les DIX entrées les plus récentes s'affichent d'abord : sur une fiche
 * suivie depuis des mois, le fil faisait plusieurs milliers de pixels et
 * repoussait tout ce qui vient après (c'est ce qui enterrait le composeur
 * email). Le reste se déplie d'un clic.
 */
export function Timeline({
  entries,
  renderAction,
}: {
  entries: TimelineEntry[];
  /** Bouton de suppression (admin) injecté par la page — voir chantier 4. */
  renderAction?: (entry: TimelineEntry) => React.ReactNode;
}) {
  const [tout, setTout] = useState(false);
  const visibles = tout ? entries : entries.slice(0, APERCU);
  const restantes = entries.length - visibles.length;

  if (entries.length === 0) {
    return (
      <div className="card px-5 py-10 text-center text-sm text-slate-500">
        Rien d&apos;enregistré pour l&apos;instant. Consignez votre premier échange
        ci-dessus, ou écrivez-lui.
      </div>
    );
  }

  return (
    <>
      <ol className="relative animate-rise space-y-3 pl-6">
        {/* Le fil. */}
        <span
          aria-hidden
          className="absolute bottom-2 left-[7px] top-2 w-px bg-gradient-to-b from-celya-cyan/30 via-white/[0.08] to-transparent"
        />

        {visibles.map((entry) => {
          const style = STYLE[entry.kind];
          return (
            <li key={entry.key} className="relative">
              {/* La pastille sur le fil. */}
              <span
                aria-hidden
                className={`absolute -left-6 top-4 h-[15px] w-[15px] rounded-full ring-4 ring-space ${style.dot}`}
              />

              <div
                className={`card card-hover px-4 py-3.5 transition-opacity duration-200 ${
                  entry.pending ? "opacity-60" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`chip ${style.chip}`}>
                    <span aria-hidden>{style.icon}</span>
                    {style.label}
                  </span>
                  <span className="text-xs text-slate-400">
                    {fmtDateTime(entry.at)}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {relative(entry.at)}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {entry.pending ? (
                      <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-celya-cyan/70 border-t-transparent"
                        />
                        Enregistrement…
                      </span>
                    ) : (
                      <>
                        {entry.by && (
                          <span className="truncate text-xs text-slate-400">
                            {entry.by}
                          </span>
                        )}
                        {renderAction?.(entry)}
                      </>
                    )}
                  </span>
                </div>

                {entry.title && (
                  <p className="mt-2 text-sm font-medium text-slate-100">
                    {entry.title}
                  </p>
                )}
                {entry.body && (
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                    {entry.body.slice(0, 1200)}
                    {entry.body.length > 1200 && "…"}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {restantes > 0 && (
        <button
          type="button"
          onClick={() => setTout(true)}
          className="btn-ghost mt-3 w-full px-4 py-2 text-xs"
        >
          Voir les {restantes} entrée{restantes > 1 ? "s" : ""} précédente
          {restantes > 1 ? "s" : ""}
        </button>
      )}
    </>
  );
}
