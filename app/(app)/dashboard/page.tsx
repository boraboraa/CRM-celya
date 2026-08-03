import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { todayBounds, slotOfISO } from "@/lib/time";
import { PageHeader, StatusChip, EmptyState } from "@/components/ui";
import { CallActions } from "@/components/CallActions";
import { ReplyCard, type ReplyCardEmail } from "@/components/ReplyCard";
import {
  CALL_OUTCOMES,
  CALL_SLOT_LABEL,
  OTHER_SLOT,
  relative,
} from "@/lib/constants";
import type { CallOutcome, CallSlot, ProspectStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Statuts qui peuvent porter un rappel dû (tout sauf gagné/perdu). */
const RAPPEL_STATUSES: ProspectStatus[] = [
  "a_appeler",
  "sans_reponse",
  "contact_etabli",
  "rappel_programme",
  "rdv",
  "proposition",
];

type QueueProspect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  city: string | null;
  status: ProspectStatus;
  call_attempts: number;
  last_outcome: CallOutcome | null;
  last_contact_at: string | null;
  next_action_at: string | null;
};

const QUEUE_SELECT =
  "id, company_name, contact_name, phone, city, status, call_attempts, last_outcome, last_contact_at, next_action_at";

export default async function DashboardPage() {
  const supabase = await createClient();
  const session = await getSession();
  const { start, end } = todayBounds();

  const [overdueRes, todayRes, neverRes, repliesRes] = await Promise.all([
    // 1. En retard — rappels dont la date est passée, les plus anciens d'abord.
    supabase
      .from("prospects")
      .select(QUEUE_SELECT)
      .in("status", RAPPEL_STATUSES)
      .lt("next_action_at", start)
      .order("next_action_at", { ascending: true })
      .limit(60),

    // 2. Aujourd'hui — rappels du jour (un rappel programmé y remonte seul).
    supabase
      .from("prospects")
      .select(QUEUE_SELECT)
      .in("status", RAPPEL_STATUSES)
      .gte("next_action_at", start)
      .lte("next_action_at", end)
      .order("next_action_at", { ascending: true })
      .limit(60),

    // 3. Jamais appelés.
    supabase
      .from("prospects")
      .select(QUEUE_SELECT)
      .eq("status", "a_appeler")
      .order("created_at", { ascending: true })
      .limit(60),

    // 4. Réponses reçues — emails entrants rattachés, en attente de tri.
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

  const overdue = (overdueRes.data ?? []) as QueueProspect[];
  const today = (todayRes.data ?? []) as QueueProspect[];
  const scheduled = new Set([...overdue, ...today].map((p) => p.id));
  const never = ((neverRes.data ?? []) as QueueProspect[]).filter(
    (p) => !scheduled.has(p.id)
  );

  // Variation d'horaire : si les 3 derniers appels d'un prospect ont eu lieu
  // dans le même créneau, on en propose un autre.
  const calledIds = [...overdue, ...today].map((p) => p.id);
  const slotHints = new Map<string, string>();
  if (calledIds.length > 0) {
    const { data: calls } = await supabase
      .from("activities")
      .select("prospect_id, occurred_at")
      .in("prospect_id", calledIds)
      .eq("type", "appel")
      .order("occurred_at", { ascending: false })
      .limit(400);

    const byProspect = new Map<string, CallSlot[]>();
    for (const c of calls ?? []) {
      const list = byProspect.get(c.prospect_id) ?? [];
      if (list.length < 3) {
        list.push(slotOfISO(c.occurred_at));
        byProspect.set(c.prospect_id, list);
      }
    }
    for (const [id, slots] of byProspect) {
      if (slots.length === 3 && slots.every((s) => s === slots[0])) {
        slotHints.set(
          id,
          `3 derniers appels ${CALL_SLOT_LABEL[slots[0]]} — essayez ${CALL_SLOT_LABEL[OTHER_SLOT[slots[0]]]}.`
        );
      }
    }
  }

  const replies = (repliesRes.data ?? []) as unknown as ReplyCardEmail[];
  const firstName = session?.me?.full_name?.split(" ")[0];
  const empty = overdue.length + today.length + never.length === 0;

  return (
    <>
      <PageHeader
        title={firstName ? `Bonjour ${firstName}` : "File d'appels"}
        subtitle="Qui j'appelle maintenant — en retard d'abord, puis le jour, puis les jamais appelés."
        action={
          <Link href="/prospects/nouveau" className="btn-primary">
            + Nouveau prospect
          </Link>
        }
      />

      {empty ? (
        <EmptyState
          title="Rien à appeler pour l'instant"
          hint="Ajoutez des prospects ou importez une liste : ils apparaîtront ici, dans l'ordre où il faut les appeler."
          href="/prospects/nouveau"
          cta="Créer un prospect"
        />
      ) : (
        <div className="space-y-8">
          <QueueSection
            title="En retard"
            tone="late"
            prospects={overdue}
            slotHints={slotHints}
          />
          <QueueSection
            title="Aujourd'hui"
            prospects={today}
            slotHints={slotHints}
          />
          <QueueSection
            title="Jamais appelés"
            prospects={never}
            slotHints={slotHints}
          />
        </div>
      )}

      {/* 4. Réponses reçues — la boîte Zoho remonte ici, l'IA propose, Bora décide. */}
      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
          Réponses reçues
          {replies.length > 0 && (
            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[11px] text-cyan-300">
              {replies.length}
            </span>
          )}
          {session?.me?.role === "admin" && (
            <span className="ml-auto flex gap-3 text-[11px] font-normal normal-case tracking-normal">
              <Link href="/emails" className="text-slate-500 hover:text-slate-300">
                Non rattachés
              </Link>
              <Link href="/reglages-email" className="text-slate-500 hover:text-slate-300">
                Réglages boîte
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

function QueueSection({
  title,
  prospects,
  slotHints,
  tone,
}: {
  title: string;
  prospects: QueueProspect[];
  slotHints: Map<string, string>;
  tone?: "late";
}) {
  if (prospects.length === 0) return null;

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
          {prospects.length}
        </span>
      </h2>

      <ul className="card divide-y divide-white/[0.05]">
        {prospects.map((p) => (
          <li key={p.id} className="px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {p.phone ? (
                <a
                  href={`tel:${p.phone.replace(/\s/g, "")}`}
                  className="btn-primary shrink-0 px-3.5 py-2 text-xs"
                >
                  📞 {p.phone}
                </a>
              ) : (
                <span className="chip bg-rose-500/10 text-rose-300 ring-rose-400/20">
                  Pas de numéro
                </span>
              )}

              <Link
                href={`/prospects/${p.id}`}
                className="min-w-0 font-medium text-slate-100 hover:text-celya-cyan"
              >
                {p.company_name}
              </Link>

              {p.contact_name && (
                <span className="text-xs text-slate-400">{p.contact_name}</span>
              )}
              {p.city && <span className="text-xs text-slate-500">{p.city}</span>}

              <span className="ml-auto flex items-center gap-2">
                <StatusChip status={p.status} />
              </span>
            </div>

            <p className="mt-1.5 text-xs text-slate-500">
              {p.last_outcome
                ? `Dernier appel : ${CALL_OUTCOMES[p.last_outcome]?.label ?? p.last_outcome} · ${relative(p.last_contact_at)} · ${p.call_attempts} tentative${p.call_attempts > 1 ? "s" : ""}`
                : "Jamais appelé"}
              {p.next_action_at && ` · rappel prévu ${relative(p.next_action_at)}`}
            </p>

            <div className="mt-2.5">
              <CallActions
                prospect={{
                  id: p.id,
                  company_name: p.company_name,
                  status: p.status,
                  call_attempts: p.call_attempts,
                }}
                slotHint={slotHints.get(p.id)}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
