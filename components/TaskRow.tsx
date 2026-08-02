import Link from "next/link";
import { completeTaskAction, snoozeTaskAction, deleteTaskAction } from "@/app/actions";
import { fmtDateTime, relative } from "@/lib/constants";

export type TaskWithClient = {
  id: string;
  title: string;
  details: string | null;
  due_at: string;
  status: string;
  priority: number;
  client_id: string | null;
  clients?: { id: string; company_name: string; contact_name: string | null } | null;
};

export function TaskRow({ task }: { task: TaskWithClient }) {
  const done = task.status === "fait";
  const overdue = !done && new Date(task.due_at).getTime() < Date.now();

  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3.5 sm:flex-nowrap">
      <form action={completeTaskAction} className="pt-0.5">
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="client_id" value={task.client_id ?? ""} />
        <input type="hidden" name="done" value={done ? "0" : "1"} />
        <button
          type="submit"
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
      </form>

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

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          {task.clients && (
            <>
              <Link
                href={`/clients/${task.clients.id}`}
                className="text-slate-400 underline-offset-2 hover:text-celya-cyan hover:underline"
              >
                {task.clients.company_name}
              </Link>
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
        <div className="flex shrink-0 items-center gap-1">
          {[1, 3, 7].map((d) => (
            <form key={d} action={snoozeTaskAction}>
              <input type="hidden" name="id" value={task.id} />
              <input type="hidden" name="client_id" value={task.client_id ?? ""} />
              <input type="hidden" name="days" value={d} />
              <button
                type="submit"
                title={`Reporter de ${d} jour${d > 1 ? "s" : ""}`}
                className="rounded-lg px-2 py-1 text-[11px] text-slate-500 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-slate-200"
              >
                +{d}j
              </button>
            </form>
          ))}
          <form action={deleteTaskAction}>
            <input type="hidden" name="id" value={task.id} />
            <input type="hidden" name="client_id" value={task.client_id ?? ""} />
            <button
              type="submit"
              title="Supprimer la relance"
              className="rounded-lg px-2 py-1 text-[11px] text-slate-600 transition hover:text-rose-400"
            >
              ✕
            </button>
          </form>
        </div>
      )}
    </li>
  );
}
