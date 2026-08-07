import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { todayBounds } from "@/lib/time";
import { PageHeader, EmptyState } from "@/components/ui";
import { TaskRow, type TaskWithProspect } from "@/components/TaskRow";
import { ReplyCard, type ReplyCardEmail } from "@/components/ReplyCard";
import { DateField } from "@/components/DateField";
import { createTaskAction } from "@/app/actions";
import { fmtDate, relative } from "@/lib/constants";
import {
  LAST_ACTION_SELECT,
  mapLastActions,
  type LastActionRow,
} from "@/lib/crm/lastAction";

export const dynamic = "force-dynamic";

/** Une fiche en attente de réponse — la zone CALME du tableau. */
type WaitingProspect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  next_action_at: string | null;
  /** Date du dernier mail envoyé. */
  sent_at: string | null;
};

/**
 * À faire — trois états, jamais mélangés :
 *
 *   1. « À appeler / à rappeler » — ce qui échoit aujourd'hui et ce qui est
 *      en retard (appel jamais passé, appel sans réponse, relance échue).
 *      C'est la date qui décide : une relance au 14 octobre ne remonte que
 *      le 14 octobre.
 *   2. « En attente de réponse » — un mail est parti, pas encore de réponse.
 *      Zone CALME : jamais « en retard ». La fiche ne remonte en zone 1 qu'à
 *      l'échéance de sa relance « si pas de réponse » (+5 jours à l'envoi).
 *   3. « Réponses reçues » — le prospect a répondu : agir maintenant.
 */
export default async function TodoPage() {
  const supabase = await createClient();
  const session = await getSession();
  const { start, end } = todayBounds();

  const TASK_SELECT =
    "id, title, details, due_at, status, priority, prospect_id, prospects(id, company_name, contact_name, phone)";

  const [overdueRes, todayRes, repliesRes, waitingRes] = await Promise.all([
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

    // En attente de réponse — le dernier événement de la fiche est un mail
    // sortant (toute réponse ou tout échange consigné depuis serait plus
    // récent). Vue prospect_action_state, RLS appliquée.
    supabase
      .from("prospect_action_state")
      .select(LAST_ACTION_SELECT)
      .eq("last_kind", "email_sortant")
      .limit(200),
  ]);

  const overdueAll = (overdueRes.data ?? []) as unknown as TaskWithProspect[];
  const todayAll = (todayRes.data ?? []) as unknown as TaskWithProspect[];
  const replies = (repliesRes.data ?? []) as unknown as ReplyCardEmail[];
  const waitingRows = (waitingRes.data ?? []) as unknown as LastActionRow[];
  const waitingMap = mapLastActions(waitingRows);

  // Une fiche qui a répondu vit en zone 3 — ses relances n'encombrent pas la
  // zone 1 (seuls les « RDV … » restent : un rendez-vous s'honore).
  const replyIds = new Set(
    replies.map((e) => e.prospects?.id).filter(Boolean) as string[]
  );
  const inZone1 = (t: TaskWithProspect) =>
    !t.prospect_id || t.title.startsWith("RDV") || !replyIds.has(t.prospect_id);
  const overdue = overdueAll.filter(inZone1);
  const today = todayAll.filter(inZone1);

  // La zone calme ne liste que les fiches dont RIEN n'est encore dû : dès que
  // la relance « si pas de réponse » échoit, la fiche remonte en zone 1 et
  // quitte celle-ci — jamais dans les deux.
  const dueIds = new Set(
    [...overdueAll, ...todayAll]
      .map((t) => t.prospect_id)
      .filter(Boolean) as string[]
  );
  const calmIds = waitingRows
    .map((r) => r.prospect_id)
    .filter((id) => !dueIds.has(id) && !replyIds.has(id));

  let waiting: WaitingProspect[] = [];
  if (calmIds.length > 0) {
    const { data } = await supabase
      .from("prospects")
      .select("id, company_name, contact_name, status, next_action_at")
      .in("id", calmIds)
      .not("status", "in", "(gagne,perdu)")
      .limit(200);
    waiting = ((data ?? []) as unknown as (WaitingProspect & {
      status: string;
    })[])
      .map((p) => ({
        ...p,
        sent_at:
          waitingMap.get(p.id)?.last_email_sent_at ??
          waitingMap.get(p.id)?.last_at ??
          null,
      }))
      // La prochaine à remonter d'abord ; sans relance posée, en fin de liste.
      .sort((a, b) => {
        if (!a.next_action_at) return 1;
        if (!b.next_action_at) return -1;
        return (
          new Date(a.next_action_at).getTime() -
          new Date(b.next_action_at).getTime()
        );
      });
  }

  const firstName = session?.me?.full_name?.split(" ")[0];
  const nothingAtAll =
    overdue.length + today.length + waiting.length + replies.length === 0;

  return (
    <>
      <PageHeader
        title={firstName ? `Bonjour ${firstName}` : "À faire"}
        subtitle="Trois états, jamais mélangés : à appeler, en attente de réponse, réponses reçues."
        action={
          <Link href="/prospects/nouveau" className="btn-primary">
            + Nouveau prospect
          </Link>
        }
      />

      {nothingAtAll ? (
        <EmptyState
          title="Rien à faire aujourd'hui"
          hint="Posez une relance ou un rendez-vous sur une fiche prospect : il remontera ici à sa date."
          href="/prospects"
          cta="Voir les prospects"
        />
      ) : (
        <div className="space-y-8">
          {/* ---------- 1. À appeler / à rappeler ---------- */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              À appeler / à rappeler
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-slate-400">
                {overdue.length + today.length}
              </span>
            </h2>

            {overdue.length + today.length === 0 ? (
              <div className="card px-5 py-6 text-center text-sm text-slate-500">
                Rien à appeler aujourd&apos;hui.
              </div>
            ) : (
              <div className="space-y-6">
                <TaskSection title="En retard" tone="late" tasks={overdue} />
                <TaskSection title="Aujourd'hui" tasks={today} />
              </div>
            )}
          </section>

          {/* ---------- 2. En attente de réponse — zone CALME ---------- */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              En attente de réponse
              {waiting.length > 0 && (
                <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] text-violet-300">
                  {waiting.length}
                </span>
              )}
            </h2>

            {waiting.length === 0 ? (
              <div className="card px-5 py-5 text-center text-sm text-slate-500">
                Aucun mail en attente de réponse.
              </div>
            ) : (
              <>
                <p className="mb-2 text-[11px] text-slate-500">
                  Le mail est parti — rien à faire pour l&apos;instant. Sans
                  réponse, chaque fiche remonte dans « À appeler / à rappeler »
                  à la date indiquée.
                </p>
                <ul className="card animate-rise divide-y divide-white/[0.05]">
                  {waiting.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
                    >
                      <span aria-hidden className="text-[13px]">
                        📧
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/prospects/${p.id}`}
                          className="text-sm font-medium text-slate-100 underline-offset-2 hover:text-celya-cyan hover:underline"
                        >
                          {p.company_name}
                        </Link>
                        <p className="text-xs text-slate-400">
                          Mail envoyé{p.sent_at ? ` ${relative(p.sent_at)}` : ""}
                          {p.contact_name ? ` à ${p.contact_name}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-violet-300/90">
                        {p.next_action_at
                          ? `Remonte le ${fmtDate(p.next_action_at)}`
                          : "Aucune relance posée"}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
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

      {/* ---------- 3. Réponses reçues — agir maintenant ---------- */}
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
          <ul className="card animate-rise divide-y divide-white/[0.05]">
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
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
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
      </h3>

      <ul className="card animate-rise divide-y divide-white/[0.05]">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </ul>
    </div>
  );
}
