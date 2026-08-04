"use client";

import { useTransition } from "react";
import {
  setProspectStatusAction,
  unlockProspectStatusAction,
  acceptStatusSuggestionAction,
} from "@/app/actions";
import { STATUS_LABEL, STATUS_ORDER, STATUS_CHIP, STATUS_DOT } from "@/lib/constants";
import type { ProspectStatus } from "@/lib/types";

/**
 * L'étape, et qui la décide.
 *
 * Deux voies de correction, aussi fluides l'une que l'autre : glisser la
 * fiche dans le pipeline, ou cliquer une étape ici. Dans les deux cas le
 * choix est VERROUILLÉ — l'auto-classification ne réécrira plus rien
 * par-dessus, sans quoi le système se battrait contre Bora : il corrige,
 * l'IA remet l'erreur au tour suivant.
 *
 * Une fiche verrouillée peut encore recevoir une suggestion discrète
 * (« un RDV a été posé — passer en Rendez-vous ? »), à accepter ou ignorer.
 * Et « rendre la main à l'IA » reste possible, en petit.
 */
export function StatusControl({
  prospectId,
  status,
  locked,
  autoReason,
  suggestion,
}: {
  prospectId: string;
  status: ProspectStatus;
  locked: boolean;
  autoReason: string | null;
  suggestion: { status: ProspectStatus; reason: string | null } | null;
}) {
  const [pending, startTransition] = useTransition();

  function submit(action: (fd: FormData) => Promise<void>, fields: Record<string, string>) {
    const fd = new FormData();
    fd.set("id", prospectId);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    startTransition(() => action(fd));
  }

  return (
    <div className={`space-y-2.5 ${pending ? "opacity-60" : ""} transition-opacity`}>
      {/* Les six étapes, cliquables. Un clic = une décision humaine. */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_ORDER.map((s) => {
          const active = s === status;
          return (
            <button
              key={s}
              type="button"
              disabled={pending || active}
              onClick={() => submit(setProspectStatusAction, { status: s })}
              aria-pressed={active}
              title={active ? `Étape actuelle : ${STATUS_LABEL[s]}` : `Passer en « ${STATUS_LABEL[s]} »`}
              className={`chip transition duration-200 ${
                active
                  ? `${STATUS_CHIP[s]} scale-[1.03] animate-pop`
                  : "bg-white/[0.03] text-slate-400 ring-white/[0.08] hover:bg-white/[0.07] hover:text-slate-200 hover:ring-white/20"
              } disabled:cursor-default`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${active ? STATUS_DOT[s] : "bg-slate-600"}`} />
              {STATUS_LABEL[s]}
            </button>
          );
        })}
      </div>

      {/* Pourquoi l'étape a bougé toute seule — la transparence exigée. */}
      {!locked && autoReason && (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
          <span aria-hidden className="text-celya-cyan">
            ✦
          </span>
          <span>Étape déduite automatiquement : {autoReason}.</span>
        </p>
      )}

      {/* Fiche verrouillée : l'IA ne peut plus que proposer. */}
      {locked && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          <span aria-hidden>🔒</span>
          <span>Étape fixée par vous — l&apos;assistant n&apos;y touchera plus.</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => submit(unlockProspectStatusAction, {})}
            className="underline decoration-dotted underline-offset-2 transition hover:text-slate-300"
          >
            Rendre la main à l&apos;assistant
          </button>
        </p>
      )}

      {/* La suggestion discrète, quand les faits ont dépassé le choix figé. */}
      {locked && suggestion && (
        <div className="rounded-xl bg-celya-blue/[0.08] px-3.5 py-2.5 ring-1 ring-celya-blue/25">
          <p className="text-[11px] leading-relaxed text-slate-300">
            {suggestion.reason
              ? `${suggestion.reason.charAt(0).toUpperCase()}${suggestion.reason.slice(1)} — `
              : ""}
            passer en «&nbsp;{STATUS_LABEL[suggestion.status]}&nbsp;» ?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                submit(acceptStatusSuggestionAction, { status: suggestion.status })
              }
              className="rounded-lg bg-white/[0.07] px-2.5 py-1 text-[11px] font-medium text-slate-100 ring-1 ring-white/15 transition hover:bg-white/[0.12]"
            >
              Oui, passer en {STATUS_LABEL[suggestion.status]}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
