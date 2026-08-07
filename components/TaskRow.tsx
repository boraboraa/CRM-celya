"use client";

import Link from "next/link";
import { fmtDateTime, relative } from "@/lib/constants";
import { isoToLocalInput, localInputToISO } from "@/lib/time";

export type TaskWithProspect = {
  id: string;
  title: string;
  details: string | null;
  due_at: string;
  status: string;
  priority: number;
  prospect_id: string | null;
  prospects?: {
    id: string;
    company_name: string;
    contact_name: string | null;
    phone?: string | null;
  } | null;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Une ligne de relance — purement présentation.
 *
 * Elle ne parle plus au serveur elle-même : c'est `TaskList` qui tient l'état
 * optimiste de la liste et déclenche les server actions. Sans quoi chaque
 * ligne aurait attendu son propre aller-retour avant de bouger, et cocher une
 * relance figeait l'écran une seconde et demie.
 */
export function TaskRow({
  task,
  compact = false,
  pending = false,
  onComplete,
  onReschedule,
  onDelete,
}: {
  task: TaskWithProspect;
  /** Colonne étroite (fiche prospect) : les commandes passent sous le titre. */
  compact?: boolean;
  /** Un geste est en cours sur CETTE ligne — le spinner est ici, pas ailleurs. */
  pending?: boolean;
  onComplete?: () => void;
  /** (valeur du champ « YYYY-MM-DDTHH:mm » en heure de Bruxelles, ISO UTC) */
  onReschedule?: (dueLocal: string, dueISO: string) => void;
  onDelete?: () => void;
}) {
  const done = task.status === "fait";
  const overdue = !done && new Date(task.due_at).getTime() < Date.now();

  const dueLocal = isoToLocalInput(task.due_at); // YYYY-MM-DDTHH:mm Bruxelles
  const dueDate = dueLocal.slice(0, 10);
  const dueTime = dueLocal.slice(11, 16) || "09:00";

  /** Reprogramme à une date précise en conservant l'heure existante. */
  function reschedule(date: string) {
    if (!date || !onReschedule) return;
    const local = `${date}T${dueTime}`;
    // La date affichée tout de suite doit être la vraie : même conversion que
    // le serveur (heure de Bruxelles → UTC), par le même utilitaire.
    onReschedule(local, localInputToISO(local) ?? task.due_at);
  }

  function shiftedDate(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  return (
    <li
      className={`gap-3 px-4 py-3.5 transition-opacity duration-150 ${
        pending ? "opacity-60" : ""
      } ${
        compact
          ? "grid grid-cols-[auto_1fr] items-start"
          : "flex flex-wrap items-start sm:flex-nowrap"
      }`}
    >
      <div className="pt-0.5">
        <button
          type="button"
          onClick={onComplete}
          disabled={!onComplete}
          aria-label={done ? "Rouvrir la relance" : "Marquer comme faite"}
          className={`grid h-5 w-5 place-items-center rounded-md ring-1 transition ${
            done
              ? "bg-emerald-500/25 text-emerald-300 ring-emerald-400/30"
              : "bg-white/[0.04] text-transparent ring-white/15 hover:ring-celya-blue/60"
          }`}
        >
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
            <path d="M8 13.2 4.8 10l-1.2 1.2L8 15.6l8.4-8.4-1.2-1.2z" />
          </svg>
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${
            done ? "text-slate-500 line-through" : "text-slate-100"
          }`}
        >
          {task.priority === 1 && !done && (
            <span className="mr-1.5 text-amber-400" title="Priorité haute">
              ▲
            </span>
          )}
          {task.title}
        </p>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
          {task.prospects && (
            <>
              <Link
                href={`/prospects/${task.prospects.id}`}
                prefetch={false}
                className="text-slate-400 underline-offset-2 hover:text-celya-cyan hover:underline"
              >
                {task.prospects.company_name}
              </Link>
              {task.prospects.phone && (
                <a
                  href={`tel:${task.prospects.phone.replace(/\s/g, "")}`}
                  className="text-celya-cyan hover:underline"
                >
                  {task.prospects.phone}
                </a>
              )}
              <span aria-hidden>·</span>
            </>
          )}
          <span className={overdue ? "text-rose-400" : ""}>
            {overdue ? "En retard — " : ""}
            {fmtDateTime(task.due_at)}
          </span>
          <span aria-hidden>·</span>
          <span>{relative(task.due_at)}</span>
        </p>

        {task.details && (
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{task.details}</p>
        )}
      </div>

      {!done && (
        <div
          className={`flex flex-wrap items-center gap-1 ${
            compact ? "col-start-2 mt-2" : "shrink-0"
          }`}
        >
          {/* Champ de date réel : reprogrammer au jour près. Les raccourcis
              remplissent la même date (et l'appliquent aussitôt). */}
          <input
            type="date"
            value={dueDate}
            disabled={!onReschedule}
            onChange={(e) => reschedule(e.target.value)}
            aria-label="Reprogrammer la relance"
            className="rounded-lg bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300 ring-1 ring-white/10 outline-none focus:ring-celya-blue/60"
          />
          {[1, 3, 7].map((d) => (
            <button
              key={d}
              type="button"
              disabled={!onReschedule}
              onClick={() => reschedule(shiftedDate(d))}
              title={`Reprogrammer à dans ${d} jour${d > 1 ? "s" : ""}`}
              className="rounded-lg px-2 py-1 text-[11px] text-slate-500 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-slate-200"
            >
              +{d}j
            </button>
          ))}
          <button
            type="button"
            onClick={onDelete}
            disabled={!onDelete}
            title="Supprimer la relance"
            className="rounded-lg px-2 py-1 text-[11px] text-slate-600 transition hover:text-rose-400"
          >
            ✕
          </button>
        </div>
      )}
    </li>
  );
}
