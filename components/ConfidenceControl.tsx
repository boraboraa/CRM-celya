"use client";

import { useState, useTransition } from "react";
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

  function submit(
    action: (fd: FormData) => Promise<{ error?: string; success?: string } | void>,
    fields: Record<string, string> = {}
  ) {
    const fd = new FormData();
    fd.set("id", prospectId);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    setNotice(undefined);
    startTransition(async () => {
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
          const active = l === level;
          return (
            <button
              key={l}
              type="button"
              disabled={pending || active}
              onClick={() => submit(setConfidenceAction, { level: l })}
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

        {level === null && (
          <span className={`chip ${CONFIDENCE_PENDING_CHIP}`}>
            <span aria-hidden className="text-[10px] leading-none">
              {CONFIDENCE_PENDING_ICON}
            </span>
            {CONFIDENCE_PENDING_LABEL}
          </span>
        )}
      </div>

      {/* La raison courte — pourquoi l'assistant estime ce niveau. */}
      {!locked && reason && (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
          <span aria-hidden className="text-celya-cyan">
            ✦
          </span>
          <span>{reason.charAt(0).toUpperCase() + reason.slice(1)}</span>
        </p>
      )}

      {locked ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          <span aria-hidden>🔒</span>
          <span>Confiance fixée par vous — l&apos;assistant n&apos;y touchera plus.</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => submit(unlockConfidenceAction)}
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
