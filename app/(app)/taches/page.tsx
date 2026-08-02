import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/ui";
import { TaskRow, type TaskWithClient } from "@/components/TaskRow";
import { createTaskAction } from "@/app/actions";
import { todayBounds } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ filtre?: string }>;
}) {
  const { filtre } = await searchParams;
  const supabase = await createClient();
  const session = await getSession();
  const { end } = todayBounds();

  const view = filtre ?? "ouvertes";

  let query = supabase
    .from("tasks")
    .select(
      "id, title, details, due_at, status, priority, client_id, clients(id, company_name, contact_name)"
    );

  if (view === "terminees") {
    query = query.eq("status", "fait").order("completed_at", { ascending: false });
  } else if (view === "retard") {
    query = query
      .eq("status", "a_faire")
      .lt("due_at", new Date().toISOString())
      .order("due_at", { ascending: true });
  } else if (view === "jour") {
    query = query
      .eq("status", "a_faire")
      .lte("due_at", end)
      .order("due_at", { ascending: true });
  } else {
    query = query.eq("status", "a_faire").order("due_at", { ascending: true });
  }

  const { data } = await query.limit(200);
  const tasks = (data ?? []) as unknown as TaskWithClient[];

  const filters = [
    { key: "ouvertes", label: "Toutes les relances" },
    { key: "jour", label: "Aujourd'hui" },
    { key: "retard", label: "En retard" },
    { key: "terminees", label: "Terminées" },
  ];

  return (
    <>
      <PageHeader
        title="Relances"
        subtitle="Tout ce qui doit être rappelé, relancé ou suivi."
      />

      <div className="mb-5 flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Link
            key={f.key}
            href={`/taches?filtre=${f.key}`}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 transition ${
              view === f.key
                ? "bg-white/[0.09] text-slate-100 ring-white/15"
                : "bg-white/[0.03] text-slate-400 ring-white/10 hover:text-slate-200"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <form action={createTaskAction} className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[240px] flex-1">
          <label className="label" htmlFor="title">
            Nouvelle relance (sans client)
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
          <label className="label" htmlFor="due_days">
            Échéance
          </label>
          <select id="due_days" name="due_days" defaultValue="1" className="input">
            <option value="1">Demain</option>
            <option value="3">Dans 3 jours</option>
            <option value="7">Dans 1 semaine</option>
            <option value="14">Dans 2 semaines</option>
          </select>
        </div>
        <input type="hidden" name="assignee_id" value={session?.userId ?? "none"} />
        <button className="btn-ghost">Ajouter</button>
      </form>

      {tasks.length === 0 ? (
        <EmptyState
          title={
            view === "terminees"
              ? "Aucune relance terminée"
              : view === "retard"
                ? "Rien en retard — bravo"
                : "Aucune relance planifiée"
          }
          hint="Les relances se créent aussi automatiquement quand vous notez un appel sur une fiche client."
          href="/clients"
          cta="Voir les clients"
        />
      ) : (
        <ul className="card divide-y divide-white/[0.05]">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ul>
      )}
    </>
  );
}
