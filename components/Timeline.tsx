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

/**
 * CHRONOLOGIE — les échanges du plus récent au plus ancien, chaque événement
 * typé et daté, lisible d'un coup d'œil. Ce n'est pas un bloc de texte brut :
 * le fil vertical, la pastille de couleur et la puce de type donnent la nature
 * de l'échange avant même de lire.
 *
 * Les brouillons n'y figurent JAMAIS — ils vivent dans leur propre espace.
 */
export function Timeline({
  entries,
  renderAction,
}: {
  entries: TimelineEntry[];
  /** Bouton de suppression (admin) injecté par la page — voir chantier 4. */
  renderAction?: (entry: TimelineEntry) => React.ReactNode;
}) {
  if (entries.length === 0) {
    return (
      <div className="card px-5 py-10 text-center text-sm text-slate-500">
        Rien d&apos;enregistré pour l&apos;instant. Consignez votre premier échange
        ci-dessous.
      </div>
    );
  }

  return (
    <ol className="relative animate-rise space-y-3 pl-6">
      {/* Le fil. */}
      <span
        aria-hidden
        className="absolute bottom-2 left-[7px] top-2 w-px bg-gradient-to-b from-celya-cyan/30 via-white/[0.08] to-transparent"
      />

      {entries.map((entry) => {
        const style = STYLE[entry.kind];
        return (
          <li key={entry.key} className="relative">
            {/* La pastille sur le fil. */}
            <span
              aria-hidden
              className={`absolute -left-6 top-4 h-[15px] w-[15px] rounded-full ring-4 ring-space ${style.dot}`}
            />

            <div className="card card-hover px-4 py-3.5">
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
                  {entry.by && (
                    <span className="truncate text-xs text-slate-400">{entry.by}</span>
                  )}
                  {renderAction?.(entry)}
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
  );
}
