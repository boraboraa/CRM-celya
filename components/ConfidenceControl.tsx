"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  setConfidenceAction,
  unlockConfidenceAction,
  evaluateConfidenceAction,
} from "@/app/actions";
import {
  CONFIDENCE_ORDER,
  CONFIDENCE_LABEL,
  CONFIDENCE_CHIP,
  CONFIDENCE_ICON,
  CONFIDENCE_PENDING_LABEL,
  CONFIDENCE_PENDING_CHIP,
  CONFIDENCE_PENDING_ICON,
} from "@/lib/constants";
import type { ConfidenceLevel } from "@/lib/types";

/**
 * La confiance, en tête de fiche : le niveau estimé (Chaud / Tiède / Froid),
 * sa raison courte, et la main de Bora.
 *
 * Suggestion, pas vérité : cliquer un niveau est une correction humaine —
 * elle VERROUILLE (confidence_locked), et l'IA ne réécrit plus rien, même
 * logique que le verrou d'étape. « Rendre la main » déverrouille et relance
 * une estimation. Sans estimation possible, le badge dit « À évaluer » et
 * rien ne se bloque.
 */
export function ConfidenceControl({
  prospectId,
  level,
  reason,
  locked,
}: {
  prospectId: string;
  level: ConfidenceLevel | null;
  reason: string | null;
  locked: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string>();

  /**
   * Le niveau tel qu'il s'affiche MAINTENANT. Corriger la confiance est un
   * clic : la pastille se sélectionne à l'instant, verrou compris. Un refus
   * du serveur ramène l'affichage à la valeur enregistrée tout seul
   * (useOptimistic rend la main aux props à la fin de la transition).
   *
   * « ✨ Réévaluer » n'est PAS optimiste : le nouveau niveau est justement ce
   * qu'on ignore avant la réponse — on l'attend au lieu de l'inventer.
   */
  const [vue, appliquer] = useOptimistic(
    { level, locked },
    (
      etat: { level: ConfidenceLevel | null; locked: boolean },
      patch: Partial<{ level: ConfidenceLevel | null; locked: boolean }>
    ) => ({ ...etat, ...patch })
  );

  function submit(
    action: (fd: FormData) => Promise<{ error?: string; success?: string } | void>,
    fields: Record<string, string> = {},
    optimiste?: Partial<{ level: ConfidenceLevel | null; locked: boolean }>
  ) {
    const fd = new FormData();
    fd.set("id", prospectId);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    setNotice(undefined);
    startTransition(async () => {
      if (optimiste) appliquer(optimiste);
      const res = await action(fd);
      if (res && "error" in res && res.error) setNotice(res.error);
    });
  }

  return (
    <div className={`space-y-1.5 ${pending ? "opacity-60" : ""} transition-opacity`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Confiance
        </span>

        {/* Les trois niveaux, cliquables — un clic est une décision humaine. */}
        {CONFIDENCE_ORDER.map((l) => {
          const active = l === vue.level;
          return (
            <button
              key={l}
              type="button"
              disabled={pending || active}
              onClick={() =>
                submit(setConfidenceAction, { level: l }, { level: l, locked: true })
              }
              aria-pressed={active}
              title={
                active
                  ? `Confiance actuelle : ${CONFIDENCE_LABEL[l]}`
                  : `Corriger en « ${CONFIDENCE_LABEL[l]} »`
              }
              className={`chip transition duration-200 ${
                active
                  ? `${CONFIDENCE_CHIP[l]} scale-[1.03] animate-pop`
                  : "bg-white/[0.03] text-slate-400 ring-white/[0.08] hover:bg-white/[0.07] hover:text-slate-200 hover:ring-white/20"
              } disabled:cursor-default`}
            >
              <span aria-hidden className="text-[10px] leading-none">
                {CONFIDENCE_ICON[l]}
              </span>
              {CONFIDENCE_LABEL[l]}
            </button>
          );
        })}

        {vue.level === null && (
          <span className={`chip ${CONFIDENCE_PENDING_CHIP}`}>
            <span aria-hidden className="text-[10px] leading-none">
              {CONFIDENCE_PENDING_ICON}
            </span>
            {CONFIDENCE_PENDING_LABEL}
          </span>
        )}
      </div>

      {/* La raison courte — pourquoi l'assistant estime ce niveau. */}
      {!vue.locked && reason && (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
          <span aria-hidden className="text-celya-cyan">
            ✦
          </span>
          <span>{reason.charAt(0).toUpperCase() + reason.slice(1)}</span>
        </p>
      )}

      {vue.locked ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          <span aria-hidden>🔒</span>
          <span>Confiance fixée par vous — l&apos;assistant n&apos;y touchera plus.</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => submit(unlockConfidenceAction, {}, { locked: false })}
            className="underline decoration-dotted underline-offset-2 transition hover:text-slate-300"
          >
            Rendre la main à l&apos;assistant
          </button>
        </p>
      ) : (
        <p className="text-[11px] text-slate-500">
          <button
            type="button"
            disabled={pending}
            onClick={() => submit(evaluateConfidenceAction)}
            title="Ré-estimer la confiance à partir des échanges enregistrés"
            className="underline decoration-dotted underline-offset-2 transition hover:text-slate-300"
          >
            ✨ Réévaluer
          </button>
        </p>
      )}

      {notice && <p className="text-[11px] text-amber-300">{notice}</p>}
    </div>
  );
}
