import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { Avatar } from "@/components/ui";
import { ConfidenceControl } from "@/components/ConfidenceControl";
import { ProspectForm } from "@/components/ProspectForm";
import { QuickNote } from "@/components/QuickNote";
import { StatusControl } from "@/components/StatusControl";
import { NextActionCard } from "@/components/NextActionCard";
import { Timeline, type TimelineEntry } from "@/components/Timeline";
import { DeleteEntryButton } from "@/components/DeleteEntryButton";
import { EmailComposer } from "@/components/EmailComposer";
import { DateField } from "@/components/DateField";
import { TaskRow, type TaskWithProspect } from "@/components/TaskRow";
import {
  updateProspectAction,
  deleteProspectAction,
  createTaskAction,
} from "@/app/actions";
import { readProspectFacts, evaluateStatus } from "@/lib/crm/status";
import { deriveNextAction, type OpenTask, type LastEvent } from "@/lib/crm/nextAction";
import {
  normalizeStatus,
  fmtDateTime,
  fmtMoney,
  relative,
} from "@/lib/constants";
import type { Activity, Prospect, Email, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

type ActivityRow = Activity & { crm_users: { full_name: string | null } | null };

/**
 * La fiche prospect, lue de haut en bas :
 *   1. qui c'est, où on en est (étape) ;
 *   2. PROCHAINE ACTION — quoi faire, pour quand, et les gestes rapides ;
 *   3. CHRONOLOGIE — les échanges, du plus récent au plus ancien ;
 *   4. seulement ensuite les formulaires (noter, écrire, planifier, modifier).
 *
 * La fiche se lit d'abord ; elle ne s'ouvre pas sur des formulaires.
 */
export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const session = await getSession();

  const [prospectRes, membersRes, activitiesRes, emailsRes, tasksRes] =
    await Promise.all([
      supabase.from("prospects").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("crm_users")
        .select("id, full_name, email")
        .eq("is_active", true)
        .order("full_name"),
      supabase
        .from("activities")
        .select("*, crm_users!activities_author_id_fkey(full_name)")
        .eq("prospect_id", id)
        .order("occurred_at", { ascending: false })
        .limit(100),
      supabase
        .from("emails")
        .select("*")
        .eq("prospect_id", id)
        .order("received_at", { ascending: false })
        .limit(50),
      supabase
        .from("tasks")
        .select("id, title, details, due_at, status, priority, prospect_id")
        .eq("prospect_id", id)
        .order("status")
        .order("due_at", { ascending: true }),
    ]);

  const prospect = prospectRes.data as Prospect | null;
  if (!prospect) notFound();

  const status = normalizeStatus(prospect.status);

  // L'étape confrontée aux faits. Sur une fiche verrouillée, le verdict ne
  // sert qu'à proposer — jamais à écrire (voir lib/crm/status.ts).
  const facts = await readProspectFacts(supabase, id);
  const verdict = evaluateStatus(status, Boolean(prospect.status_locked), facts);
  const suggestion = verdict.suggest
    ? { status: verdict.derived, reason: verdict.reason }
    : null;

  const members = (membersRes.data ?? []) as Pick<
    Profile,
    "id" | "full_name" | "email"
  >[];
  const owner = members.find((m) => m.id === prospect.owner_id);
  // Effacer une trace du journal est réservé à l'admin (revérifié côté serveur).
  const isAdmin = session?.me?.role === "admin" && session.me.is_active;

  // ---------------------------------------------------------------------
  // Chronologie — les vrais échanges seulement. Les brouillons sont écartés
  // ici et regroupés dans leur propre espace, plus bas.
  // ---------------------------------------------------------------------
  const activities = (activitiesRes.data ?? []) as unknown as ActivityRow[];
  const emails = (emailsRes.data ?? []) as Email[];

  const drafts = activities.filter((a) => a.is_draft);

  const timeline: TimelineEntry[] = [
    ...activities
      .filter((a) => !a.is_draft)
      .map((a) => ({
        key: `a-${a.id}`,
        id: a.id,
        source: "activity" as const,
        kind:
          a.type === "rendez_vous"
            ? ("rendez_vous" as const)
            : a.type === "email"
              ? ("email_sortant" as const)
              : a.outcome === "sans_reponse"
                ? ("appel_sans_reponse" as const)
                : a.is_exchange === false
                  ? ("note_interne" as const)
                  : ("note" as const),
        at: a.occurred_at,
        title: a.subject,
        body: a.body,
        by: a.crm_users?.full_name ?? null,
      })),
    ...emails.map((e) => ({
      key: `e-${e.id}`,
      id: e.id,
      source: "email" as const,
      kind:
        e.direction === "entrant"
          ? ("email_entrant" as const)
          : ("email_sortant" as const),
      at: e.received_at,
      title: e.subject,
      body: e.body_text,
      by: e.from_email,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const tasks = (tasksRes.data ?? []) as unknown as TaskWithProspect[];
  // Les tâches annulées ne sont pas affichées : TaskRow les rendrait comme
  // des relances actives en retard.
  const openTasks = tasks.filter((t) => t.status === "a_faire");
  const doneTasks = tasks.filter((t) => t.status === "fait");

  // « Prochaine action » — dérivée sans le moindre appel à un modèle.
  const lastEvent: LastEvent = timeline[0]
    ? { kind: timeline[0].kind, at: timeline[0].at }
    : null;
  const nextAction = deriveNextAction(
    openTasks as unknown as OpenTask[],
    lastEvent,
    prospect.contact_name
  );

  return (
    <>
      {/* ---------- En-tête : qui, et où on en est ---------- */}
      <div className="mb-6">
        <Link
          href="/prospects"
          className="text-xs text-slate-500 transition hover:text-slate-300"
        >
          ← Tous les prospects
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-50">
              {prospect.company_name}
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
              {prospect.contact_name && <span>{prospect.contact_name}</span>}
              {prospect.phone && (
                <a
                  href={`tel:${prospect.phone.replace(/\s/g, "")}`}
                  className="text-celya-cyan hover:underline"
                >
                  {prospect.phone}
                </a>
              )}
              {prospect.email && (
                <a
                  href={`mailto:${prospect.email}`}
                  className="text-celya-cyan hover:underline"
                >
                  {prospect.email}
                </a>
              )}
              {prospect.city && <span>{prospect.city}</span>}
            </p>

            {/* La confiance — le signal, sa raison, et la main de Bora. */}
            <div className="mt-3">
              <ConfidenceControl
                prospectId={prospect.id}
                level={prospect.confidence_level ?? null}
                reason={prospect.confidence_reason ?? null}
                locked={Boolean(prospect.confidence_locked)}
              />
            </div>
          </div>

          <div className="w-full max-w-md">
            <StatusControl
              prospectId={prospect.id}
              status={status}
              locked={Boolean(prospect.status_locked)}
              autoReason={prospect.status_auto_reason}
              suggestion={suggestion}
            />
          </div>
        </div>
      </div>

      {/* ---------- 1. PROCHAINE ACTION, tout en tête ---------- */}
      <div className="mb-6">
        <NextActionCard action={nextAction} prospectId={prospect.id} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------- Colonne principale ---------- */}
        <div className="space-y-8 lg:col-span-2">
          {/* ---------- 2. CHRONOLOGIE ---------- */}
          <section>
            <h2 className="mb-4 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              Chronologie
            </h2>
            <Timeline
              entries={timeline}
              renderAction={
                isAdmin
                  ? (entry) => (
                      <DeleteEntryButton
                        id={entry.id}
                        prospectId={prospect.id}
                        source={entry.source}
                        isRealEmail={entry.source === "email"}
                        label="cette entrée du journal"
                      />
                    )
                  : undefined
              }
            />
          </section>

          {/* ---------- 3. Puis seulement les formulaires ---------- */}
          <section id="noter-un-echange" className="scroll-mt-6">
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              Noter un échange
            </h2>
            {/* Le sélecteur d'étape part sur « ne pas changer » : aucun état
                local ne peut plus rétrograder la fiche. */}
            <QuickNote
              prospectId={prospect.id}
              companyName={prospect.company_name}
              contactName={prospect.contact_name}
            />
          </section>

          {prospect.email && (
            <section>
              <details className="card p-0">
                <summary className="cursor-pointer px-6 py-4 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
                  Écrire un email
                </summary>
                <div className="px-1 pb-1">
                  <EmailComposer
                    prospectId={prospect.id}
                    defaultTo={prospect.email}
                    contactName={prospect.contact_name}
                    companyName={prospect.company_name}
                  />
                </div>
              </details>
            </section>
          )}

          <section>
            <details className="card p-6">
              <summary className="cursor-pointer font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
                Modifier la fiche
              </summary>
              <div className="mt-5">
                <ProspectForm
                  prospect={prospect}
                  members={members}
                  action={updateProspectAction}
                  currentUserId={session?.userId}
                />
              </div>

              <form action={deleteProspectAction} className="mt-8 border-t border-white/[0.06] pt-5">
                <input type="hidden" name="id" value={prospect.id} />
                <button className="btn-danger">Supprimer ce prospect</button>
                <p className="mt-2 text-[11px] text-slate-500">
                  Supprime aussi son historique et ses relances. Action définitive.
                </p>
              </form>
            </details>
          </section>
        </div>

        {/* ---------- Colonne latérale ---------- */}
        <div className="space-y-6">
          {/* Chiffres de l'affaire */}
          <section className="card space-y-3 p-5">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-400">
                Valeur estimée
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-100">
                {fmtMoney(prospect.value_estimate, prospect.currency)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">
                  Dernier contact
                </p>
                <p className="mt-0.5 text-sm font-medium text-slate-100">
                  {prospect.last_contact_at
                    ? relative(prospect.last_contact_at)
                    : "Jamais"}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">
                  Prochaine action
                </p>
                <p
                  className={`mt-0.5 text-sm font-medium ${
                    prospect.next_action_at &&
                    new Date(prospect.next_action_at).getTime() < Date.now()
                      ? "text-rose-400"
                      : "text-slate-100"
                  }`}
                >
                  {prospect.next_action_at ? fmtDateTime(prospect.next_action_at) : "—"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-white/[0.06] pt-3">
              <Avatar name={owner?.full_name ?? null} size="md" />
              <div>
                <p className="text-[11px] uppercase tracking-wider text-slate-400">
                  Responsable
                </p>
                <p className="mt-0.5 text-sm font-medium text-slate-100">
                  {owner?.full_name ?? owner?.email ?? "Non assigné"}
                </p>
              </div>
            </div>
          </section>

          {/* Relances */}
          <section>
            <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              Relances
            </h2>

            {openTasks.length === 0 ? (
              <p className="card px-5 py-6 text-center text-sm text-slate-500">
                Aucune relance planifiée.
              </p>
            ) : (
              <ul className="card divide-y divide-white/[0.05]">
                {openTasks.map((t) => (
                  <TaskRow key={t.id} task={t} compact />
                ))}
              </ul>
            )}

            <details className="mt-3">
              <summary className="cursor-pointer px-1 text-xs text-slate-500 transition hover:text-slate-300">
                Planifier une relance
              </summary>
              <form action={createTaskAction} className="card mt-2 space-y-3 p-5">
                <input type="hidden" name="prospect_id" value={prospect.id} />
                <div>
                  <label className="label" htmlFor="title">
                    Quoi faire
                  </label>
                  <input
                    id="title"
                    name="title"
                    required
                    className="input"
                    placeholder="Relancer pour le devis"
                  />
                </div>
                <div>
                  <span className="label">Quand</span>
                  <DateField name="due_local" required compact />
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
                <button className="btn-primary w-full">Planifier</button>
              </form>
            </details>

            {doneTasks.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer px-1 text-xs text-slate-500 transition hover:text-slate-300">
                  {doneTasks.length} relance{doneTasks.length > 1 ? "s" : ""} passée
                  {doneTasks.length > 1 ? "s" : ""}
                </summary>
                <ul className="card mt-2 divide-y divide-white/[0.05]">
                  {doneTasks.map((t) => (
                    <TaskRow key={t.id} task={t} compact />
                  ))}
                </ul>
              </details>
            )}
          </section>

          {/* Brouillons — hors chronologie, clairement séparés. Un texte
              jamais envoyé n'est pas un échange : il ne compte pour aucun
              fait, ne touche pas au dernier contact, et se supprime d'un clic. */}
          {drafts.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
                Brouillons
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-normal normal-case tracking-normal text-slate-400">
                  {drafts.length}
                </span>
              </h2>
              <p className="mb-2 text-[11px] text-slate-600">
                Textes non envoyés — hors chronologie.
              </p>
              <ul className="card divide-y divide-white/[0.05]">
                {drafts.map((d) => (
                  <li key={d.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-xs font-medium text-slate-300">
                        {d.subject ?? "Brouillon"}
                      </p>
                      {isAdmin && (
                        <DeleteEntryButton
                          id={d.id}
                          prospectId={prospect.id}
                          source="activity"
                          label="ce brouillon"
                        />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">
                      {fmtDateTime(d.occurred_at)}
                    </p>
                    {d.body && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[11px] text-slate-500 transition hover:text-slate-300">
                          Voir le texte
                        </summary>
                        <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-500">
                          {d.body.slice(0, 2000)}
                        </p>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {prospect.notes && (
            <section>
              <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
                Notes générales
              </h2>
              <p className="card whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-slate-300">
                {prospect.notes}
              </p>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
