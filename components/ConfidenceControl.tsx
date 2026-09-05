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
} from "@/lib/constants";
import { ConfidenceBadge, Icone } from "@/components/ui";
import type { ConfidenceLevel } from "@/lib/types";

/**
 * La confiance, en tête de fiche : le niveau estimé (Chaud / Tiède / Froid),
 * sa raison courte, et la main de Bora.
 *
 * Ce qui se voit est une LECTURE — le badge, la raison. Les trois niveaux de
 * correction se déplient d'un clic, EN PLACE, parce que corriger n'est pas
 * consulter : cliquer un niveau VERROUILLE (`confidence_locked`) et l'IA ne
 * réécrit plus rien, même logique que le verrou d'étape. Les trois cibles
 * offertes en permanence transformaient un frôlement en décision.
 *
 * « Rendre la main » déverrouille. Sans estimation possible, le badge dit
 * « À évaluer » et rien ne se bloque.
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
  /** Les trois niveaux de correction sont-ils montrés ? Rien de flottant : la
   * ligne pousse le reste de l'en-tête, et se referme après une correction. */
  const [deplie, setDeplie] = useState(false);

  /**
   * Le niveau tel qu'il s'affiche MAINTENANT. Corriger la confiance est un
   * clic : la pastille se sélectionne à l'instant, verrou compris. Un refus
   * du serveur ramène l'affichage à la valeur enregistrée tout seul
   * (useOptimistic rend la main aux props à la fin de la transition).
   *
   * « Réévaluer » n'est PAS optimiste : le nouveau niveau est justement ce
   * qu'on ignore avant la réponse — on l'attend au lieu de l'inventer. C'est
   * aussi le seul geste qui laisse la ligne ouverte : la réponse s'y regarde.
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* Sans étiquette, un badge « Tiède » ne dit pas de quoi il parle : la
            fiche se lit d'abord, le mot vient avant le signal. */}
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Confiance
        </span>
        {/* Le badge se lit ; il ouvre la correction si on le touche. */}
        <button
          type="button"
          onClick={() => setDeplie((d) => !d)}
          aria-expanded={deplie}
          className="inline-flex items-center gap-1 text-slate-400 transition hover:text-slate-200"
        >
          <ConfidenceBadge level={vue.level} reason={reason} locked={vue.locked} />
          <Icone
            nom="chevron"
            className={`h-3 w-3 transition-transform duration-200 ${deplie ? "rotate-180" : ""}`}
          />
        </button>

        {/* Pourquoi l'assistant estime ce niveau — ou qui l'a fixé. Le badge
            porte déjà le cadenas : la phrase n'a pas à le répéter. */}
        {vue.locked ? (
          <span className="text-[11px] text-slate-500">Confiance fixée par vous</span>
        ) : (
          reason && (
            <span className="text-[11px] leading-relaxed text-slate-400">
              {reason.charAt(0).toUpperCase() + reason.slice(1)}
            </span>
          )
        )}
      </div>

      {/* La correction, une fois demandée. Un clic = une décision humaine,
          donc un verrou — et la ligne se referme aussitôt. */}
      {deplie && (
        <div className="flex flex-wrap items-center gap-1.5">
          {CONFIDENCE_ORDER.map((l) => {
            const active = l === vue.level;
            return (
              <button
                key={l}
                type="button"
                disabled={pending || active}
                onClick={() => {
                  setDeplie(false);
                  submit(setConfidenceAction, { level: l }, { level: l, locked: true });
                }}
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
                <Icone nom={CONFIDENCE_ICON[l]} className="h-3 w-3" />
                {CONFIDENCE_LABEL[l]}
              </button>
            );
          })}

          {/* Les gestes rares, au même endroit que la correction. */}
          {vue.locked ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setDeplie(false);
                submit(unlockConfidenceAction, {}, { locked: false });
              }}
              className="btn-link text-[11px]"
            >
              Rendre la main à l&apos;assistant
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => submit(evaluateConfidenceAction)}
              title="Ré-estimer la confiance à partir des échanges enregistrés"
              className="btn-link text-[11px]"
            >
              <Icone nom="etincelle" className="h-3 w-3" />
              Réévaluer
            </button>
          )}
        </div>
      )}

      {notice && <p className="text-[11px] text-amber-300">{notice}</p>}
    </div>
  );
}
