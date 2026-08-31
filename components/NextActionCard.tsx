"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  completeTaskAction,
  rescheduleTaskAction,
} from "@/app/actions";
import { relative } from "@/lib/constants";
import { isoToLocalInput, localInputToISO } from "@/lib/time";
import { deriveNextAction, type NextAction } from "@/lib/crm/nextAction";
import { openComposer, openNote } from "@/lib/crm/composer";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date locale décalée de N jours (le navigateur de Bora est à Bruxelles). */
function shiftedDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * PROCHAINE ACTION — la première chose que Bora voit en ouvrant une fiche :
 * ce qu'il y a à faire, et pour quand. Dérivé de la relance ouverte, sans
 * aucun appel à un modèle (lib/crm/nextAction.ts).
 *
 * Actions rapides : consigner un échange, reporter, marquer fait.
 */
export function NextActionCard({
  action,
  prospectId,
  canEmail = false,
}: {
  action: NextAction;
  prospectId: string;
  /** La fiche porte une adresse : proposer d'écrire tout de suite. */
  canEmail?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string>();

  /**
   * L'action telle qu'elle s'affiche MAINTENANT. Reporter ou marquer fait
   * repeint le bloc immédiatement ; à la fin de la transition, `useOptimistic`
   * rend la main aux données du serveur — donc en cas d'échec le bloc revient
   * tout seul à son état d'origine.
   */
  const [vue, appliquer] = useOptimistic(
    action,
    (etat: NextAction, patch: { due_at?: string; fait?: true }): NextAction => {
      if (!etat.task) return etat;
      // On repasse par deriveNextAction — la même fonction que le serveur —
      // pour que la phrase affichée soit exactement celle qui arrivera. Le
      // contexte, lui, vient du journal : aucun de ces deux gestes ne le
      // change, on le garde tel quel.
      const taches = patch.fait
        ? []
        : [{ ...etat.task, due_at: patch.due_at ?? etat.task.due_at }];
      return { ...deriveNextAction(taches, null, null), context: etat.context };
    }
  );

  const { task, meeting, context, when, overdue, isMeeting } = vue;

  // Reporter en conservant l'heure (un RDV à 14:00 le reste).
  const dueTime = task ? isoToLocalInput(task.due_at).slice(11, 16) || "09:00" : "09:00";

  function champs(extra: Record<string, string>) {
    const fd = new FormData();
    fd.set("id", action.task!.id);
    fd.set("prospect_id", prospectId);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  }

  function reschedule(date: string) {
    if (!action.task || !date) return;
    const local = `${date}T${dueTime}`;
    setErreur(undefined);
    startTransition(async () => {
      appliquer({ due_at: localInputToISO(local) ?? action.task!.due_at });
      const res = await rescheduleTaskAction(champs({ due_local: local }));
      if (res?.error) setErreur(res.error);
    });
  }

  function complete() {
    if (!action.task) return;
    setErreur(undefined);
    startTransition(async () => {
      appliquer({ fait: true });
      const res = await completeTaskAction(champs({ done: "1" }));
      if (res?.error) setErreur(res.error);
    });
  }

  const accent = overdue
    ? "ring-rose-400/35 bg-rose-500/[0.07]"
    : isMeeting
      ? "ring-blue-400/35 bg-celya-blue/[0.07]"
      : "ring-celya-cyan/30 bg-celya-cyan/[0.05]";

  return (
    <section
      className={`card p-5 ring-1 transition-opacity duration-200 ${accent} ${
        pending ? "opacity-60" : ""
      }`}
      aria-label="Prochaine action"
    >
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            overdue ? "bg-rose-400" : isMeeting ? "bg-blue-400" : "bg-celya-cyan"
          }`}
        />
        Prochaine action
        {overdue && (
          <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-rose-300">
            en retard
          </span>
        )}
      </p>

      {meeting ? (
        <>
          {/* Un rendez-vous d'agenda : il se déplace ou se clôt depuis
              l'agenda et la zone « À débriefer » — pas d'un « marquer fait »
              qui le ferait disparaître sans compte rendu. */}
          <p className="mt-2 font-display text-lg font-semibold leading-snug text-slate-50">
            {meeting.title}
          </p>
          {when && (
            <p className="mt-1.5 text-sm font-medium text-slate-200">
              {when.charAt(0).toUpperCase()}
              {when.slice(1)} ({relative(meeting.starts_at)}).
            </p>
          )}
          {meeting.location && (
            <p className="mt-1 text-sm text-slate-300">
              <span aria-hidden>📍</span> {meeting.location}
            </p>
          )}
          <p className="mt-1 text-sm leading-relaxed text-slate-400">{context}</p>
        </>
      ) : task ? (
        <>
          <p className="mt-2 font-display text-lg font-semibold leading-snug text-slate-50">
            {task.title}
          </p>
          {when && (
            <p
              className={`mt-1.5 text-sm font-medium ${
                overdue ? "text-rose-300" : "text-slate-200"
              }`}
            >
              {/* Majuscule initiale : « relance prévue le … » ouvre la phrase. */}
              {when.charAt(0).toUpperCase()}
              {when.slice(1)} ({relative(task.due_at)}).
            </p>
          )}
          {/* Où on en est — dérivé du dernier événement du journal. */}
          <p className="mt-1 text-sm leading-relaxed text-slate-400">{context}</p>
        </>
      ) : (
        <>
          <p className="mt-2 font-display text-lg font-semibold leading-snug text-slate-50">
            Aucune action planifiée
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
            {context} Sans date, cette fiche ne remontera pas dans «&nbsp;À
            faire&nbsp;».
          </p>
        </>
      )}

      {erreur && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-rose-500/10 px-3.5 py-2 text-xs text-rose-300 ring-1 ring-rose-400/20"
        >
          {erreur}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* Les deux gestes qui font avancer une fiche, côte à côte : ils
            déplient le bloc « Agir » sur le bon onglet et y font défiler. */}
        <button
          type="button"
          onClick={() => openNote()}
          className="btn-primary px-3.5 py-2 text-xs"
        >
          Consigner un échange
        </button>

        {canEmail && (
          <button
            type="button"
            onClick={() => openComposer()}
            className="btn-ghost px-3.5 py-2 text-xs"
          >
            ✉ Email
          </button>
        )}

        {task && (
          <>
            <button
              type="button"
              onClick={complete}
              disabled={pending}
              className="btn-ghost px-3.5 py-2 text-xs"
            >
              ✓ Marquer fait
            </button>

            <span className="flex items-center gap-1 rounded-xl bg-white/[0.03] px-1.5 py-1 ring-1 ring-white/[0.08]">
              <span className="pl-1 pr-0.5 text-[11px] text-slate-500">Reporter</span>
              {[
                [1, "+1j"],
                [3, "+3j"],
                [7, "+1sem"],
              ].map(([days, label]) => (
                <button
                  key={label}
                  type="button"
                  disabled={pending}
                  onClick={() => reschedule(shiftedDate(days as number))}
                  className="rounded-lg px-2 py-1 text-[11px] text-slate-400 transition hover:bg-white/[0.08] hover:text-slate-100"
                >
                  {label}
                </button>
              ))}
              {/* Toujours modifiable à la main : « le 14 octobre » reste possible. */}
              <input
                type="date"
                disabled={pending}
                defaultValue={isoToLocalInput(task.due_at).slice(0, 10)}
                onChange={(e) => reschedule(e.target.value)}
                aria-label="Reporter à une date précise"
                className="rounded-lg bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300 ring-1 ring-white/10 outline-none transition focus:ring-celya-blue/60"
              />
            </span>
          </>
        )}
      </div>
    </section>
  );
}
