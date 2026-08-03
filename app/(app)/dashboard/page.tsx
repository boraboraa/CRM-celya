import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { todayBounds } from "@/lib/time";
import { PageHeader, EmptyState } from "@/components/ui";
import { TaskRow, type TaskWithProspect } from "@/components/TaskRow";
import { ReplyCard, type ReplyCardEmail } from "@/components/ReplyCard";
import { DateField } from "@/components/DateField";
import { createTaskAction } from "@/app/actions";

export const dynamic = "force-dynamic";

/**
 * À faire — ce qui échoit aujourd'hui et ce qui est en retard, tous prospects
 * confondus. C'est la date qui décide : une relance posée au 14 octobre ne
 * remonte ici que le 14 octobre. S'y ajoutent les réponses email reçues.
 */
export default async function TodoPage() {
  const supabase = await createClient();
  const session = await getSession();
  const { start, end } = todayBounds();

  const TASK_SELECT =
    "id, title, details, due_at, status, priority, prospect_id, prospects(id, company_name, contact_name, phone)";

  const [overdueRes, todayRes, repliesRes] = await Promise.all([
    // En retard — les plus anciennes d'abord.
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("status", "a_faire")
      .lt("due_at", start)
      .order("due_at", { ascending: true })
      .limit(100),

    // Aujourd'hui.
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("status", "a_faire")
      .gte("due_at", start)
      .lte("due_at", end)
      .order("due_at", { ascending: true })
      .limit(100),

    // Réponses reçues — emails entrants rattachés, en attente de tri.
    supabase
      .from("emails")
      .select(
        "id, from_email, subject, body_text, received_at, intent, intent_confidence, intent_summary, proposed_due_at, prospects(id, company_name)"
      )
      .eq("direction", "entrant")
      .eq("triage", "a_traiter")
      .not("prospect_id", "is", null)
      .order("received_at", { ascending: false })
      .limit(20),
  ]);

  const overdue = (overdueRes.data ?? []) as unknown as TaskWithProspect[];
  const today = (todayRes.data ?? []) as unknown as TaskWithProspect[];
  const replies = (repliesRes.data ?? []) as unknown as ReplyCardEmail[];

  const firstName = session?.me?.full_name?.split(" ")[0];
  const empty = overdue.length + today.length === 0;

  return (
    <>
      <PageHeader
        title={firstName ? `Bonjour ${firstName}` : "À faire"}
        subtitle="Ce qui échoit aujourd'hui et ce qui est en retard — tous prospects confondus."
        action={
          <Link href="/prospects/nouveau" className="btn-primary">
            + Nouveau prospect
          </Link>
        }
      />

      {empty ? (
        <EmptyState
          title="Rien à faire aujourd'hui"
          hint="Posez une relance ou un rendez-vous sur une fiche prospect : il remontera ici à sa date."
          href="/prospects"
          cta="Voir les prospects"
        />
      ) : (
        <div className="space-y-8">
          <TaskSection title="En retard" tone="late" tasks={overdue} />
          <TaskSection title="Aujourd'hui" tasks={today} />
        </div>
      )}

      {/* Nouvelle relance libre (avec ou sans prospect) */}
      <form action={createTaskAction} className="card mt-8 flex flex-wrap items-end gap-4 p-4">
        <div className="min-w-[240px] flex-1">
          <label className="label" htmlFor="title">
            Nouvelle relance
          </label>
          <input
            id="title"
            name="title"
            required
            className="input"
            placeholder="Préparer la proposition pour lundi"
          />
        </div>
        <div>
          <span className="label">Échéance</span>
          <DateField name="due_local" compact />
        </div>
        <input type="hidden" name="assignee_id" value={session?.userId ?? "none"} />
        <button className="btn-ghost">Ajouter</button>
      </form>

      {/* Réponses reçues — la boîte Zoho remonte ici, l'IA propose, Bora décide. */}
      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
          Réponses reçues
          {replies.length > 0 && (
            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[11px] text-cyan-300">
              {replies.length}
            </span>
          )}
          {session?.me?.role === "admin" && (
            <span className="ml-auto text-[11px] font-normal normal-case tracking-normal">
              <Link href="/emails" className="text-slate-500 hover:text-slate-300">
                Non rattachés
              </Link>
            </span>
          )}
        </h2>

        {replies.length === 0 ? (
          <div className="card px-5 py-6 text-center text-sm text-slate-500">
            Aucune réponse en attente. Les réponses aux emails remontent ici
            automatiquement (relève toutes les 5 minutes).
          </div>
        ) : (
          <ul className="card divide-y divide-white/[0.05]">
            {replies.map((e) => (
              <ReplyCard key={e.id} email={e} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function TaskSection({
  title,
  tasks,
  tone,
}: {
  title: string;
  tasks: TaskWithProspect[];
  tone?: "late";
}) {
  if (tasks.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
        {title}
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            tone === "late"
              ? "bg-rose-500/15 text-rose-300"
              : "bg-white/[0.06] text-slate-400"
          }`}
        >
          {tasks.length}
        </span>
      </h2>

      <ul className="card divide-y divide-white/[0.05]">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </ul>
    </section>
  );
}
