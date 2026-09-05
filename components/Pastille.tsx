"use client";

import { Icone } from "@/components/ui";

/**
 * Une pastille de raccourci : ce qui SERA enregistré, retirable d'un clic.
 * La croix, c'est « non » — jamais une correction du texte, qui part au
 * journal tel quel.
 *
 * Extraite de QuickNote pour être partagée avec ResultatAppel : deux endroits
 * lisent les mêmes raccourcis, ils doivent les montrer de la même façon.
 */
export function Pastille({
  children,
  tone = "neutre",
  onRetirer,
}: {
  children: React.ReactNode;
  tone?: "neutre" | "bleu" | "ambre";
  onRetirer?: () => void;
}) {
  const classes =
    tone === "ambre"
      ? "bg-amber-500/15 text-amber-300 ring-amber-400/30"
      : tone === "bleu"
        ? "bg-celya-blue/15 text-blue-300 ring-blue-400/30"
        : "bg-white/[0.06] text-slate-200 ring-white/15";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium ring-1 ${classes}`}
    >
      {children}
      {onRetirer && (
        <button
          type="button"
          onClick={onRetirer}
          aria-label="Retirer cette pastille"
          title="Ne pas enregistrer cet élément"
          className="inline-flex opacity-60 transition hover:opacity-100"
        >
          <Icone nom="croix" className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
