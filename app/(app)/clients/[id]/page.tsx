import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { StatusChip, Avatar } from "@/components/ui";
import { ClientForm } from "@/components/ClientForm";
import { QuickNote } from "@/components/QuickNote";
import { TaskRow, type TaskWithClient } from "@/components/TaskRow";
import {
  updateClientAction,
  setClientStatusAction,
  deleteClientAction,
  createTaskAction,
} from "@/app/actions";
import {
  ACTIVITY_LABEL,
  STATUS_ORDER,
  STATUS_LABEL,
  fmtDateTime,
  fmtMoney,
  relative,
} from "@/lib/constants";
import type { Activity, Client, Email, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

type TimelineItem =
  | { kind: "activity"; at: string; data: Activity & { crm_users: { full_name: string | null } | null } }
  | { kind: "email"; at: string; data: Email };

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const session = await getSession();

  const [clientRes, membersRes, activitiesRes, emailsRes, tasksRes] =
    await Promise.all([
      supabase.from("clients").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("crm_users")
        .select("id, full_name, email")
        .eq("is_active", true)
        .order("full_name"),
      supabase
        .from("activities")
        .select("*, crm_users!activities_author_id_fkey(full_name)")
        .eq("client_id", id)
        .order("occurred_at", { ascending: false })
        .limit(100),
      supabase
        .from("emails")
        .select("*")
        .eq("client_id", id)
        .order("received_at", { ascending: false })
        .limit(50),
      supabase
        .from("tasks")
        .select("id, title, details, due_at, status, priority, client_id")
        .eq("client_id", id)
        .order("status")
        .order("due_at", { ascending: true }),
    ]);

  const client = clientRes.data as Client | null;
  if (!client) notFound();

  const members = (membersRes.data ?? []) as Pick<
    Profile,
    "id" | "full_name" | "email"
  >[];
  const owner = members.find((m) => m.id === client.owner_id);

  const timeline: TimelineItem[] = [
    ...((activitiesRes.data ?? []) as never[]).map((a: never) => ({
      kind: "activity" as const,
      at: (a as Activity).occurred_at,
      data: a as Activity & { crm_users: { full_name: string | null } | null },
    })),
    ...((emailsRes.data ?? []) as Email[]).map((e) => ({
      kind: "email" as const,
      at: e.received_at,
      data: e,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const tasks = (tasksRes.data ?? []) as unknown as TaskWithClient[];
  const openTasks = tasks.filter((t) => t.status === "a_faire");
  const doneTasks = tasks.filter((t) => t.status !== "a_faire");

  return (
    <>
      {/* ---------- En-tête ---------- */}
      <div className="mb-6">
        <Link
          href="/clients"
          className="text-xs text-slate-500 transition hover:text-slate-300"
        >
          ← Tous les clients
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-50">
              {client.company_name}
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
              {client.contact_name && <span>{client.contact_name}</span>}
              {client.phone && (
                <a
                  href={`tel:${client.phone.replace(/\s/g, "")}`}
                  className="text-celya-cyan hover:underline"
                >
                  {client.phone}
                </a>
              )}
              {client.email && (
                <a
                  href={`mailto:${client.email}`}
                  className="text-celya-cyan hover:underline"
                >
                  {client.email}
                </a>
              )}
              {client.city && <span>{client.city}</span>}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <StatusChip status={client.status} />
            <form action={setClientStatusAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={client.id} />
              <select
                name="status"
                defaultValue={client.status}
                className="input py-2 text-xs"
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <button className="btn-ghost px-3 py-2 text-xs">Changer</button>
            </form>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Valeur estimée
            </p>
            <p className="mt-0.5 text-sm font-medium text-slate-100">
              {fmtMoney(client.value_estimate, client.currency)}
            </p>
          </div>
          <div className="card px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Dernier contact
            </p>
            <p className="mt-0.5 text-sm font-medium text-slate-100">
              {client.last_contact_at ? relative(client.last_contact_at) : "Jamais"}
            </p>
          </div>
          <div className="card px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Prochaine relance
            </p>
            <p
              className={`mt-0.5 text-sm font-medium ${
                client.next_action_at &&
                new Date(client.next_action_at).getTime() < Date.now()
                  ? "text-rose-400"
                  : "text-slate-100"
              }`}
            >
              {client.next_action_at ? fmtDateTime(client.next_action_at) : "—"}
            </p>
          </div>
          <div className="card flex items-center gap-3 px-4 py-3">
            <Avatar name={owner?.full_name ?? null} size="md" />
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-500">
                Responsable
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-100">
                {owner?.full_name ?? owner?.email ?? "Non assigné"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------- Colonne principale ---------- */}
        <div className="space-y-6 lg:col-span-2">
          <section>
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              Noter un échange
            </h2>
            <QuickNote clientId={client.id} />
          </section>

          <section>
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              Historique
            </h2>

            {timeline.length === 0 ? (
              <div className="card px-5 py-10 text-center text-sm text-slate-500">
                Rien d&apos;enregistré pour l&apos;instant. Après votre premier appel,
                notez ce qui s&apos;est dit ci-dessus.
              </div>
            ) : (
              <ol className="card divide-y divide-white/[0.05]">
                {timeline.map((item) =>
                  item.kind === "activity" ? (
                    <li key={`a-${item.data.id}`} className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="chip bg-white/[0.05] text-slate-300 ring-white/10">
                          {ACTIVITY_LABEL[item.data.type]}
                        </span>
                        {item.data.outcome && (
                          <span className="chip bg-celya-blue/15 text-blue-300 ring-blue-400/25">
                            {item.data.outcome}
                          </span>
                        )}
                        <span className="text-xs text-slate-500">
                          {fmtDateTime(item.data.occurred_at)}
                          {item.data.duration_min
                            ? ` · ${item.data.duration_min} min`
                            : ""}
                        </span>
                        <span className="ml-auto text-xs text-slate-500">
                          {item.data.crm_users?.full_name ?? ""}
                        </span>
                      </div>
                      {item.data.body && (
                        <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                          {item.data.body}
                        </p>
                      )}
                    </li>
                  ) : (
                    <li key={`e-${item.data.id}`} className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="chip bg-violet-500/15 text-violet-300 ring-violet-400/25">
                          Email {item.data.direction === "entrant" ? "reçu" : "envoyé"}
                        </span>
                        <span className="text-xs text-slate-500">
                          {fmtDateTime(item.data.received_at)}
                        </span>
                        <span className="ml-auto truncate text-xs text-slate-500">
                          {item.data.from_email}
                        </span>
                      </div>
                      {item.data.subject && (
                        <p className="mt-2 text-sm font-medium text-slate-200">
                          {item.data.subject}
                        </p>
                      )}
                      {item.data.body_text && (
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-400">
                          {item.data.body_text.slice(0, 1200)}
                        </p>
                      )}
                    </li>
                  )
                )}
              </ol>
            )}
          </section>

          <section>
            <details className="card p-6">
              <summary className="cursor-pointer font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
                Modifier la fiche
              </summary>
              <div className="mt-5">
                <ClientForm
                  client={client}
                  members={members}
                  action={updateClientAction}
                  currentUserId={session?.userId}
                />
              </div>

              <form action={deleteClientAction} className="mt-8 border-t border-white/[0.06] pt-5">
                <input type="hidden" name="id" value={client.id} />
                <button className="btn-danger">Supprimer ce client</button>
                <p className="mt-2 text-[11px] text-slate-500">
                  Supprime aussi son historique et ses relances. Action définitive.
                </p>
              </form>
            </details>
          </section>
        </div>

        {/* ---------- Colonne relances ---------- */}
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              Relances
            </h2>

            <form action={createTaskAction} className="card mb-4 space-y-3 p-5">
              <input type="hidden" name="client_id" value={client.id} />
              <div>
                <label className="label" htmlFor="title">
                  Quoi faire
                </label>
                <input
                  id="title"
                  name="title"
                  required
                  className="input"
                  placeholder="Rappeler pour le devis"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="due_days">
                    Quand
                  </label>
                  <select id="due_days" name="due_days" defaultValue="3" className="input">
                    <option value="1">Demain</option>
                    <option value="2">Dans 2 jours</option>
                    <option value="3">Dans 3 jours</option>
                    <option value="7">Dans 1 semaine</option>
                    <option value="14">Dans 2 semaines</option>
                    <option value="30">Dans 1 mois</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="priority">
                    Priorité
                  </label>
                  <select id="priority" name="priority" defaultValue="2" className="input">
                    <option value="1">Haute</option>
                    <option value="2">Normale</option>
                    <option value="3">Basse</option>
                  </select>
                </div>
              </div>
              <button className="btn-primary w-full">Planifier</button>
            </form>

            {openTasks.length === 0 ? (
              <p className="card px-5 py-6 text-center text-sm text-slate-500">
                Aucune relance planifiée.
              </p>
            ) : (
              <ul className="card divide-y divide-white/[0.05]">
                {openTasks.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </ul>
            )}

            {doneTasks.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer px-1 text-xs text-slate-500 hover:text-slate-300">
                  {doneTasks.length} relance{doneTasks.length > 1 ? "s" : ""} terminée
                  {doneTasks.length > 1 ? "s" : ""}
                </summary>
                <ul className="card mt-2 divide-y divide-white/[0.05]">
                  {doneTasks.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </ul>
              </details>
            )}
          </section>

          {client.notes && (
            <section>
              <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
                Notes générales
              </h2>
              <p className="card whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-slate-300">
                {client.notes}
              </p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
