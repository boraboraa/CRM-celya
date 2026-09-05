"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  setProspectStatusAction,
  unlockProspectStatusAction,
  acceptStatusSuggestionAction,
} from "@/app/actions";
import { STATUS_LABEL, STATUS_ORDER, STATUS_CHIP, STATUS_ICON } from "@/lib/constants";
import { Icone } from "@/components/ui";
import type { ProspectStatus } from "@/lib/types";

/**
 * L'étape, et qui la décide.
 *
 * Une seule pastille est visible : l'étape actuelle. Les cinq autres se
 * déplient d'un clic, EN PLACE — parce qu'un clic sur une étape VERROUILLE la
 * fiche (l'auto-classification ne réécrira plus rien par-dessus, sans quoi le
 * système se battrait contre Bora : il corrige, l'IA remet l'erreur au tour
 * suivant). Six cibles offertes en permanence à côté d'un pouce, c'était un
 * verrou posé par accident ; il en faut désormais deux gestes, et l'en-tête se
 * lit d'abord au lieu de proposer.
 *
 * Une fiche verrouillée peut encore recevoir une suggestion discrète
 * (« un RDV a été posé — passer en Rendez-vous ? »), à accepter ou ignorer.
 * Et « rendre la main à l'assistant » reste possible, derrière le même clic.
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
  const [erreur, setErreur] = useState<string>();
  /** Les cinq autres étapes sont-elles montrées ? Rien de flottant : la ligne
   * pousse le reste de l'en-tête vers le bas, et se replie après un choix. */
  const [deplie, setDeplie] = useState(false);

  /**
   * L'étape telle qu'elle s'affiche MAINTENANT. Cliquer une étape la
   * sélectionne à l'instant, avec son verrou : Bora n'attend plus l'aller-
   * retour pour voir sa décision prise. Si le serveur refuse, `useOptimistic`
   * rend la main à la valeur serveur à la fin de la transition — la pastille
   * revient d'elle-même, et le message dit pourquoi.
   */
  const [vue, appliquer] = useOptimistic(
    { status, locked },
    (
      etat: { status: ProspectStatus; locked: boolean },
      patch: Partial<{ status: ProspectStatus; locked: boolean }>
    ) => ({ ...etat, ...patch })
  );

  function submit(
    action: (fd: FormData) => Promise<{ error?: string }>,
    fields: Record<string, string>,
    optimiste: Partial<{ status: ProspectStatus; locked: boolean }>
  ) {
    const fd = new FormData();
    fd.set("id", prospectId);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    setErreur(undefined);
    startTransition(async () => {
      appliquer(optimiste);
      const res = await action(fd);
      if (res?.error) setErreur(res.error);
    });
  }

  const autres = STATUS_ORDER.filter((s) => s !== vue.status);

  return (
    <div className={`space-y-2.5 ${pending ? "opacity-60" : ""} transition-opacity`}>
      {/* L'étape actuelle. Elle se lit ; elle ouvre les autres si on la touche.
          Le bouton, lui, reste MONTÉ : une clé posée dessus le remontait à
          chaque choix, et le clavier perdait le focus juste après. C'est le
          contenu qui porte la clé — `animate-pop` rejoue donc sur la nouvelle
          valeur sans que le bouton disparaisse sous le doigt. */}
      <button
        type="button"
        onClick={() => setDeplie((d) => !d)}
        aria-expanded={deplie}
        title={`Étape actuelle : ${STATUS_LABEL[vue.status]} — cliquer pour en changer`}
        className={`chip min-h-[36px] transition duration-200 ${STATUS_CHIP[vue.status]}`}
      >
        <span key={vue.status} className="inline-flex items-center gap-1.5 animate-pop">
          <Icone nom={STATUS_ICON[vue.status]} className="h-3 w-3" />
          {STATUS_LABEL[vue.status]}
        </span>
        <Icone
          nom="chevron"
          className={`h-3 w-3 transition-transform duration-200 ${deplie ? "rotate-180" : ""}`}
        />
      </button>

      {/* Les cinq autres étapes, une fois demandées. Un clic = une décision
          humaine, donc un verrou — et la ligne se referme aussitôt. */}
      {deplie && (
        <div className="flex flex-wrap items-center gap-1.5">
          {autres.map((s) => (
            <button
              key={s}
              type="button"
              disabled={pending}
              onClick={() => {
                setDeplie(false);
                submit(setProspectStatusAction, { status: s }, { status: s, locked: true });
              }}
              title={`Passer en « ${STATUS_LABEL[s]} »`}
              className="chip min-h-[36px] bg-white/[0.03] text-slate-400 ring-white/[0.08] transition duration-200 hover:bg-white/[0.07] hover:text-slate-200 hover:ring-white/20 disabled:opacity-50"
            >
              <Icone nom={STATUS_ICON[s]} className="h-3 w-3" />
              {STATUS_LABEL[s]}
            </button>
          ))}

          {/* Déverrouiller est rare, et vit au même endroit que le choix. */}
          {vue.locked && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setDeplie(false);
                submit(unlockProspectStatusAction, {}, { locked: false });
              }}
              className="btn-link text-[11px]"
            >
              Rendre la main à l&apos;assistant
            </button>
          )}
        </div>
      )}

      {/* Pourquoi l'étape a bougé toute seule — la transparence exigée. */}
      {!vue.locked && autoReason && (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
          <Icone nom="etincelle" className="mt-0.5 h-3 w-3 text-celya-blue" />
          <span>Étape déduite automatiquement : {autoReason}.</span>
        </p>
      )}

      {/* Fiche verrouillée : l'IA ne peut plus que proposer. Ligne de lecture —
          le geste de déverrouillage est dans la ligne dépliée. */}
      {vue.locked && (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
          <Icone nom="cadenas" className="mt-0.5 h-3 w-3" />
          <span>Étape fixée par vous — l&apos;assistant n&apos;y touchera plus.</span>
        </p>
      )}

      {/* La suggestion discrète, quand les faits ont dépassé le choix figé. */}
      {vue.locked && suggestion && (
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
                submit(
                  acceptStatusSuggestionAction,
                  { status: suggestion.status },
                  { status: suggestion.status, locked: true }
                )
              }
              className="btn-ghost px-2.5 py-1 text-[11px]"
            >
              Oui, passer en {STATUS_LABEL[suggestion.status]}
            </button>
          </div>
        </div>
      )}

      {erreur && (
        <p
          role="alert"
          className="rounded-xl bg-rose-500/10 px-3.5 py-2 text-[11px] text-rose-300 ring-1 ring-rose-400/20"
        >
          {erreur}
        </p>
      )}
    </div>
  );
}
