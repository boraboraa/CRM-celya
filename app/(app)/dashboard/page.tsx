import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { todayBounds } from "@/lib/time";
import { PageHeader, Stat, StatusChip, EmptyState, Avatar } from "@/components/ui";
import { TaskRow, type TaskWithClient } from "@/components/TaskRow";
import { ACTIVITY_LABEL, fmtMoney, relative } from "@/lib/constants";
import type { ActivityType, ClientStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const OPEN_STATUSES: ClientStatus[] = [
  "nouveau",
  "contacte",
  "qualifie",
  "proposition",
  "negociation",
];

export default async function DashboardPage() {
  const supabase = await createClient();
  const session = await getSession();
  const { end } = todayBounds();

  const [dueRes, clientsRes, activityRes, staleRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, details, due_at, status, priority, client_id, clients(id, company_name, contact_name)")
      .eq("status", "a_faire")
      .lte("due_at", end)
      .order("due_at", { ascending: true })
      .limit(50),

    supabase.from("clients").select("id, status, value_estimate"),

    supabase
      .from("activities")
      .select("id, type, subject, body, occurred_at, client_id, clients(id, company_name)")
      .order("occurred_at", { ascending: false })
      .limit(8),

    supabase
      .from("clients")
      .select("id, company_name, contact_name, status, last_contact_at, owner_id")
      .in("status", OPEN_STATUSES)
      .or(
        `last_contact_at.is.null,last_contact_at.lt.${new Date(Date.now() - 14 * 86400000).toISOString()}`
      )
      .order("last_contact_at", { ascending: true, nullsFirst: true })
      .limit(6),
  ]);

  const tasks = (dueRes.data ?? []) as unknown as TaskWithClient[];
  const clients = clientsRes.data ?? [];
  const activities = (activityRes.data ?? []) as unknown as {
    id: string;
    type: ActivityType;
    subject: string | null;
    body: string | null;
    occurred_at: string;
    clients: { id: string; company_name: string } | null;
  }[];
  const stale = staleRes.data ?? [];

  const openClients = clients.filter((c) =>
    OPEN_STATUSES.includes(c.status as ClientStatus)
  );
  const pipelineValue = openClients.reduce(
    (sum, c) => sum + Number(c.value_estimate ?? 0),
    0
  );
  const won = clients.filter((c) => c.status === "gagne").length;
  const overdue = tasks.filter(
    (t) => new Date(t.due_at).getTime() < Date.now()
  ).length;

  const firstName = session?.me?.full_name?.split(" ")[0];

  return (
    <>
      <PageHeader
        title={firstName ? `Bonjour ${firstName}` : "Aujourd'hui"}
        subtitle="Ce qui doit être relancé, et où en est le pipeline."
        action={
          <Link href="/clients/nouveau" className="btn-primary">
            + Nouveau client
          </Link>
        }
      />

      <div className="mb-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="À relancer"
          value={tasks.length}
          tone={tasks.length ? "warn" : "default"}
          hint={overdue ? `dont ${overdue} en retard` : "aujourd'hui ou avant"}
        />
        <Stat label="Clients en cours" value={openClients.length} />
        <Stat label="Pipeline estimé" value={fmtMoney(pipelineValue)} />
        <Stat label="Gagnés" value={won} tone={won ? "good" : "default"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
            Relances du jour
          </h2>

          {tasks.length === 0 ? (
            <EmptyState
              title="Rien à relancer aujourd'hui"
              hint="Après un appel, ajoutez une note sur la fiche client et planifiez la prochaine relance en un clic."
              href="/clients"
              cta="Voir les clients"
            />
          ) : (
            <ul className="card divide-y divide-white/[0.05]">
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}

          {stale.length > 0 && (
            <>
              <h2 className="mb-3 mt-8 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
                Sans contact depuis 2 semaines
              </h2>
              <ul className="card divide-y divide-white/[0.05]">
                {stale.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={c.contact_name ?? c.company_name} />
                    <Link
                      href={`/clients/${c.id}`}
                      className="min-w-0 flex-1 text-sm text-slate-200 hover:text-celya-cyan"
                    >
                      <span className="block truncate">{c.company_name}</span>
                      <span className="block text-xs text-slate-500">
                        {c.last_contact_at
                          ? `Dernier contact ${relative(c.last_contact_at)}`
                          : "Jamais contacté"}
                      </span>
                    </Link>
                    <StatusChip status={c.status as ClientStatus} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
            Dernière activité
          </h2>

          {activities.length === 0 ? (
            <div className="card px-5 py-8 text-center text-sm text-slate-500">
              Aucune activité enregistrée pour l&apos;instant.
            </div>
          ) : (
            <ul className="card divide-y divide-white/[0.05]">
              {activities.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <p className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="chip bg-white/[0.05] text-slate-300 ring-white/10">
                      {ACTIVITY_LABEL[a.type]}
                    </span>
                    {relative(a.occurred_at)}
                  </p>
                  {a.clients && (
                    <Link
                      href={`/clients/${a.clients.id}`}
                      className="mt-1.5 block text-sm text-slate-200 hover:text-celya-cyan"
                    >
                      {a.clients.company_name}
                    </Link>
                  )}
                  {(a.subject || a.body) && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">
                      {a.subject ?? a.body}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
