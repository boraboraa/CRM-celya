"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  completeTaskAction,
  rescheduleTaskAction,
  saveExchangeAction,
} from "@/app/actions";
import { RACCOURCIS_RELANCE, relative } from "@/lib/constants";
import { isoToLocalInput, localInputToISO } from "@/lib/time";
import {
  deriveNextAction,
  type NextAction,
  type OpenTask,
} from "@/lib/crm/nextAction";
import { openComposer } from "@/lib/crm/composer";
import { Icone } from "@/components/ui";
import { ResultatAppel } from "@/components/ResultatAppel";

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
 * PROCHAINE ACTION — c'est ici qu'on arrive en raccrochant.
 *
 * La carte dit ce qu'il y a à faire et pour quand (dérivé de la relance
 * ouverte et du journal, sans aucun appel à un modèle : lib/crm/nextAction.ts),
 * puis tient les trois gestes qui suivent un appel : le résultat, « Fait »,
 * « Relancer » — et « Email » quand il y a une adresse.
 *
 * Un geste, un endroit : on ne consigne plus ici pour reporter trois écrans
 * plus bas.
 */
export function NextActionCard({
  action,
  prospectId,
  companyName,
  canEmail = false,
}: {
  action: NextAction;
  prospectId: string;
  /** Le nom de la société — le titre de la relance qu'on crée d'un clic. */
  companyName: string;
  /** La fiche porte une adresse : proposer d'écrire tout de suite. */
  canEmail?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string>();
  /** « À rappeler » vient d'être tapé : la ligne Relancer réclame une date. */
  const [pourQuand, setPourQuand] = useState(false);

  /**
   * L'action telle qu'elle s'affiche MAINTENANT. Reporter, marquer fait ou
   * poser une relance repeint le bloc immédiatement ; à la fin de la
   * transition, `useOptimistic` rend la main aux données du serveur — donc en
   * cas d'échec le bloc revient tout seul à son état d'origine.
   */
  const [vue, appliquer] = useOptimistic(
    action,
    (
      etat: NextAction,
      patch: { due_at?: string; fait?: true; relance?: string }
    ): NextAction => {
      // On repasse par deriveNextAction — la même fonction que le serveur —
      // pour que la phrase affichée soit exactement celle qui arrivera. Le
      // contexte, lui, vient du journal : aucun de ces gestes ne le change,
      // on le garde tel quel.
      if (patch.relance) {
        // Aucune relance ouverte : on en synthétise une, exactement celle que
        // `saveExchangeAction` va créer (« Relancer <société> », 09:00).
        const tache: OpenTask = {
          id: "provisoire",
          title: `Relancer ${companyName}`,
          due_at: patch.relance,
          priority: 2,
          prospect_id: prospectId,
        };
        // `etat.meeting` reste dans la balance : un rendez-vous plus proche
        // que la relance qu'on vient de poser garde la vedette — c'est
        // deriveNextAction qui tranche, pas cette carte.
        return {
          ...deriveNextAction([tache], null, null, etat.meeting),
          context: etat.context,
        };
      }
      if (!etat.task) return etat;
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

  /**
   * Relancer le jour dit. Deux chemins, un seul bouton :
   *   · une relance est ouverte → on la re-date (l'heure est conservée) ;
   *   · aucune (ou la prochaine action est un rendez-vous) → on en crée une,
   *     par le même chemin que `planifier_relance` : une note sans texte, qui
   *     n'atteste d'aucun échange et ne laisse que sa cadence.
   */
  function relancer(date: string) {
    if (!date) return;
    setPourQuand(false);
    setErreur(undefined);

    if (action.task) {
      const local = `${date}T${dueTime}`;
      startTransition(async () => {
        appliquer({ due_at: localInputToISO(local) ?? action.task!.due_at });
        const res = await rescheduleTaskAction(champs({ due_local: local }));
        if (res?.error) setErreur(res.error);
      });
      return;
    }

    const due = localInputToISO(`${date}T09:00`);
    if (!due) return;
    startTransition(async () => {
      appliquer({ relance: due });
      const res = await saveExchangeAction({
        prospectId,
        type: "note",
        dateLocale: date,
        isExchange: false,
      });
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
    ? "ring-amber-400/35 bg-amber-500/[0.06]"
    : isMeeting
      ? "ring-blue-400/35 bg-celya-blue/[0.07]"
      : "ring-white/[0.08]";

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
            overdue ? "bg-amber-400" : isMeeting ? "bg-blue-400" : "bg-slate-500"
          }`}
        />
        Prochaine action
        {overdue && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-amber-300">
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
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-300">
              <Icone nom="epingle" /> {meeting.location}
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
                overdue ? "text-amber-300" : "text-slate-200"
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

      {/* Le résultat de l'appel, SOUS LE POUCE — c'est ici qu'on arrive après
          avoir raccroché, pas dans un formulaire trois écrans plus bas. */}
      <div className="mt-4 border-t border-white/[0.06] pt-3">
        <ResultatAppel
          prospectId={prospectId}
          onRappeler={() => setPourQuand(true)}
        />
      </div>

      {/* Les gestes qui suivent le résultat : c'est fait, ou c'est à relancer,
          ou on écrit. Rien d'autre. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {vue.task && (
          <button
            type="button"
            onClick={complete}
            disabled={pending}
            className="btn-ghost min-h-[44px] px-3.5 text-xs"
          >
            <Icone nom="coche" />
            Fait
          </button>
        )}

        <span className="flex flex-wrap items-center gap-1 rounded-xl bg-white/[0.03] px-1.5 py-1 ring-1 ring-white/[0.08]">
          <span className="pl-1 pr-0.5 text-[11px] text-slate-500">Relancer</span>
          {pourQuand && (
            <span className="pr-0.5 text-[11px] text-amber-300">Pour quand&nbsp;?</span>
          )}
          {RACCOURCIS_RELANCE.map((r) => (
            <button
              key={r.label}
              type="button"
              disabled={pending}
              onClick={() => relancer(shiftedDate(r.jours))}
              className="min-h-[44px] rounded-lg px-2.5 text-[11px] text-slate-400 transition hover:bg-celya-blue/15 hover:text-blue-200"
            >
              {r.label}
            </button>
          ))}
          {/* Toujours modifiable à la main : « le 14 octobre » reste possible. */}
          <input
            type="date"
            disabled={pending}
            defaultValue={task ? isoToLocalInput(task.due_at).slice(0, 10) : undefined}
            onChange={(e) => relancer(e.target.value)}
            aria-label="Relancer à une date précise"
            className="min-h-[44px] rounded-lg bg-white/[0.04] px-2 text-[11px] text-slate-300 ring-1 ring-white/10 outline-none transition focus:ring-celya-blue/60"
          />
        </span>

        {canEmail && (
          <button
            type="button"
            onClick={() => openComposer()}
            className="btn-link text-xs"
          >
            <Icone nom="enveloppe" />
            Email
          </button>
        )}
      </div>
    </section>
  );
}
