/**
 * Les briques de l'écran Appels IA — module NEUTRE (ni "use client" ni
 * serveur), sans état : les sections serveur et les formulaires clients s'en
 * servent pareil.
 *
 * Classes Tailwind ENTIÈRES, jamais interpolées (règle JIT).
 */

import { Icone, type IconeNom } from "@/components/ui";

/** Le titre d'une carte : petit, en capitales, comme « Créer un accès » sur /equipe. */
export function TitreCarte({
  icone,
  children,
  aside,
}: {
  icone?: IconeNom;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex min-w-0 items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
        {icone && <Icone nom={icone} className="h-4 w-4 text-slate-500" />}
        <span className="min-w-0">{children}</span>
      </h2>
      {aside}
    </div>
  );
}

/**
 * Une section repliable : le résumé dit ce qu'il y a dedans (et combien),
 * avant qu'on l'ouvre. `ouvert` : déplié au chargement.
 */
export function Repliable({
  titre,
  compte,
  icone,
  ouvert = false,
  children,
}: {
  titre: string;
  compte?: string;
  icone?: IconeNom;
  ouvert?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="card group p-4 sm:p-5" open={ouvert}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-baseline gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
          {icone && <Icone nom={icone} className="h-4 w-4 shrink-0 self-center text-slate-500" />}
          <span className="shrink-0">{titre}</span>
          {compte && (
            <span className="min-w-0 truncate font-sans text-xs font-normal normal-case tracking-normal text-slate-500">
              {compte}
            </span>
          )}
        </span>
        <Icone
          nom="chevron"
          className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

/** L'issue d'une action : erreur (rose), ou confirmation (émeraude). */
export function Retour({
  etat,
}: {
  etat: { ok?: boolean; error?: string; message?: string } | null | undefined;
}) {
  if (!etat) return null;
  if (etat.error) {
    return (
      <p
        role="alert"
        className="rounded-xl bg-rose-500/10 px-3.5 py-2 text-xs leading-relaxed text-rose-300 ring-1 ring-rose-400/20"
      >
        {etat.error}
      </p>
    );
  }
  if (etat.ok && etat.message) {
    return (
      <p
        role="status"
        className="rounded-xl bg-emerald-500/10 px-3.5 py-2 text-xs leading-relaxed text-emerald-300 ring-1 ring-emerald-400/20"
      >
        {etat.message}
      </p>
    );
  }
  return null;
}

/** Une ligne d'aide sous un champ. `attention` : ambre (ce qui empêche de composer). */
export function Aide({
  children,
  attention = false,
}: {
  children: React.ReactNode;
  attention?: boolean;
}) {
  return (
    <p
      className={
        attention
          ? "mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300"
          : "mt-1.5 text-[11px] leading-relaxed text-slate-500"
      }
    >
      {attention && <Icone nom="alerte" className="mt-0.5 h-3 w-3" />}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Les puces de mode d'un appel ou d'une ligne de file. */
export const PUCE_MODE: Record<"test" | "reel", string> = {
  test: "chip bg-amber-500/15 text-amber-300 ring-amber-400/25",
  reel: "chip bg-white/[0.05] text-slate-300 ring-white/10",
};

export function PuceMode({ test }: { test: boolean }) {
  return test ? (
    <span className={PUCE_MODE.test} title="Appel de test : vers le GSM de test, rien n'est écrit sur la fiche">
      Test
    </span>
  ) : (
    <span className={PUCE_MODE.reel} title="Appel réel : vers le numéro de la fiche">
      Réel
    </span>
  );
}
