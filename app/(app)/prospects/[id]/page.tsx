import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { Avatar } from "@/components/ui";
import { AdresseInline } from "@/components/AdresseInline";
import { AdresseDepuisRdv } from "@/components/AdresseDepuisRdv";
import { ConfidenceControl } from "@/components/ConfidenceControl";
import { ProspectForm } from "@/components/ProspectForm";
import { ProspectJournal } from "@/components/ProspectJournal";
import { StatusControl } from "@/components/StatusControl";
import { NextActionCard } from "@/components/NextActionCard";
import { type TimelineEntry } from "@/components/Timeline";
import { DraftsSection } from "@/components/DraftsSection";
import { type TaskWithProspect } from "@/components/TaskRow";
import { TaskList } from "@/components/TaskList";
import { RelancesSection } from "@/components/RelancesSection";
import { updateProspectAction, deleteProspectAction } from "@/app/actions";
import { factsFromRows, evaluateStatus } from "@/lib/crm/status";
import { deriveNextAction, type OpenTask, type LastEvent } from "@/lib/crm/nextAction";
import { replySubject } from "@/lib/crm/email";
import type { ComposerPrefill } from "@/lib/crm/composer";
import {
  normalizeStatus,
  fmtDateTime,
  fmtMoney,
  relative,
} from "@/lib/constants";
import type { Activity, Prospect, Email, Profile } from "@/lib/types";


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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `?repondre=<id d'email>` : le composeur s'ouvre en réponse à ce message. */
  searchParams: Promise<{ repondre?: string }>;
}) {
  const { id } = await params;
  const { repondre } = await searchParams;
  const supabase = await createClient();
  const session = await getSession();

  // Les emails portent un corps HTML et un `raw` jsonb qui ne servent pas ici :
  // on ne demande que ce qui s'affiche. Les activités montent à 200 parce que
  // les faits d'étape se lisent sur la même moisson (voir plus bas).
  const [prospectRes, membersRes, activitiesRes, emailsRes, tasksRes, meetingsRes] =
    await Promise.all([
      supabase.from("prospects").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("crm_users")
        .select("id, full_name, email")
        .eq("is_active", true)
        .order("full_name"),
      supabase
        .from("activities")
        .select(
          "id, type, subject, body, outcome, occurred_at, is_draft, is_exchange, crm_users!activities_author_id_fkey(full_name)"
        )
        .eq("prospect_id", id)
        .order("occurred_at", { ascending: false })
        .limit(200),
      supabase
        .from("emails")
        .select("id, direction, from_email, subject, body_text, received_at")
        .eq("prospect_id", id)
        .order("received_at", { ascending: false })
        .limit(50),
      supabase
        .from("tasks")
        .select("id, title, details, due_at, status, priority, prospect_id")
        .eq("prospect_id", id)
        .order("status")
        .order("due_at", { ascending: true }),
      // Les rendez-vous de la fiche (agenda) — lus via meetings_visibles,
      // comme toute lecture d'agenda. Ils portent le fait « rendez-vous »
      // et la prochaine action.
      supabase
        .from("meetings_visibles")
        .select("id, title, starts_at, ends_at, location, status")
        .eq("prospect_id", id)
        .order("starts_at", { ascending: true })
        .limit(50),
    ]);

  const prospect = prospectRes.data as Prospect | null;
  if (!prospect) notFound();

  const status = normalizeStatus(prospect.status);

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
  const allActivities = (activitiesRes.data ?? []) as unknown as ActivityRow[];
  const emails = (emailsRes.data ?? []) as Email[];
  const tasks = (tasksRes.data ?? []) as unknown as TaskWithProspect[];
  const meetings = (meetingsRes.data ?? []) as unknown as {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    location: string | null;
    status: string;
  }[];
  // Les tâches annulées ne sont pas affichées : TaskRow les rendrait comme
  // des relances actives en retard.
  const openTasks = tasks.filter((t) => t.status === "a_faire");
  const doneTasks = tasks.filter((t) => t.status === "fait");

  // L'étape confrontée aux faits — déduits des lignes DÉJÀ chargées ci-dessus.
  // C'est la même règle qu'avant (lib/crm/status.ts), simplement lue sans
  // redemander activités, emails, rendez-vous et fiche à la base : quatre
  // allers-retours économisés à chaque ouverture de fiche.
  // Sur une fiche verrouillée, le verdict ne sert qu'à proposer, jamais à
  // écrire.
  const facts = factsFromRows({
    activities: allActivities,
    emails,
    meetings,
    proposalSentAt: prospect.proposal_sent_at ?? null,
  });
  const verdict = evaluateStatus(status, Boolean(prospect.status_locked), facts);
  const suggestion = verdict.suggest
    ? { status: verdict.derived, reason: verdict.reason }
    : null;

  // L'affichage reste sur les 100 événements les plus récents, comme avant ;
  // seuls les faits lisent plus loin.
  const activities = allActivities.slice(0, 100);
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

  // « Prochaine action » — dérivée sans le moindre appel à un modèle. Le
  // prochain rendez-vous d'agenda (à venir, non annulé) passe devant la
  // relance s'il arrive avant elle.
  const lastEvent: LastEvent = timeline[0]
    ? { kind: timeline[0].kind, at: timeline[0].at }
    : null;
  const prochainRdv =
    meetings.find(
      (m) =>
        m.status !== "annule" && new Date(m.starts_at).getTime() >= Date.now()
    ) ?? null;
  // Le lieu d'un rendez-vous, quand la fiche n'a pas encore d'adresse : le
  // prochain rendez-vous d'abord, sinon le plus récent qui en porte un.
  const lieuDepuisRdv =
    prospect.address
      ? null
      : (prochainRdv?.location?.trim() ||
          [...meetings].reverse().find((m) => m.location?.trim())?.location?.trim() ||
          null);

  const nextAction = deriveNextAction(
    openTasks as unknown as OpenTask[],
    lastEvent,
    prospect.contact_name,
    prochainRdv
  );

  // « Répondre » depuis une réponse reçue (tableau À faire) : le composeur
  // s'ouvre pré-rempli, destinataire et objet repris du message reçu. Le
  // message est cherché parmi ceux déjà chargés — pas une requête de plus.
  const replyTo = repondre
    ? emails.find((e) => e.id === repondre && e.direction === "entrant")
    : undefined;
  const composerPrefill: ComposerPrefill | undefined = replyTo
    ? { to: replyTo.from_email, subject: replySubject(replyTo.subject) }
    : undefined;

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

            {/* L'adresse — à côté du téléphone, les deux gestes du terrain :
                ouvrir la fiche Maps, ou lancer l'itinéraire. Sans adresse, le
                point d'entrée est ICI (« ＋ Ajouter une adresse ») : le champ
                du formulaire complet est replié tout en bas, personne ne l'y
                trouvait. Le lieu d'un rendez-vous, quand il y en a un à
                proposer, garde la priorité — jamais les deux à la fois. */}
            <div className="mt-2">
              {!prospect.address && lieuDepuisRdv ? (
                <div className="max-w-md">
                  <AdresseDepuisRdv
                    prospectId={prospect.id}
                    lieu={lieuDepuisRdv}
                    ville={prospect.city}
                  />
                </div>
              ) : (
                <AdresseInline
                  prospectId={prospect.id}
                  address={prospect.address}
                  ville={prospect.city}
                />
              )}
            </div>

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
        <NextActionCard
          action={nextAction}
          prospectId={prospect.id}
          canEmail={Boolean(prospect.email)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------- Colonne principale ---------- */}
        <div className="space-y-8 lg:col-span-2">
          {/* ---------- 2. AGIR (consigner / envoyer), puis 3. CHRONOLOGIE ----
              Les deux vivent ensemble : l'échange consigné ou le mail envoyé
              s'inscrit dans le fil à l'instant du clic, sans attendre le
              serveur. Le bloc « Agir » passe devant le fil — écrire à un
              prospect ne doit plus demander de scroller des mois d'historique. */}
          <ProspectJournal
            entries={timeline}
            prospectId={prospect.id}
            companyName={prospect.company_name}
            contactName={prospect.contact_name}
            prospectEmail={prospect.email}
            isAdmin={Boolean(isAdmin)}
            initialTab={composerPrefill ? "email" : "consigner"}
            initialPrefill={composerPrefill}
          />

          <section>
            <details id="modifier-la-fiche" className="card scroll-mt-6 p-6">
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

            <RelancesSection prospectId={prospect.id} openTasks={openTasks} />

            {doneTasks.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer px-1 text-xs text-slate-500 transition hover:text-slate-300">
                  {doneTasks.length} relance{doneTasks.length > 1 ? "s" : ""} passée
                  {doneTasks.length > 1 ? "s" : ""}
                </summary>
                <TaskList
                  tasks={doneTasks}
                  compact
                  className="card mt-2 divide-y divide-white/[0.05]"
                />
              </details>
            )}
          </section>

          {/* Brouillons — hors chronologie, clairement séparés. Un texte
              jamais envoyé n'est pas un échange : il ne compte pour aucun
              fait, ne touche pas au dernier contact, se supprime d'un clic —
              et depuis le 12 août, s'ENVOIE d'un clic. */}
          <DraftsSection
            drafts={drafts.map((d) => ({
              id: d.id,
              subject: d.subject,
              body: d.body,
              occurred_at: d.occurred_at,
            }))}
            prospectId={prospect.id}
            prospectEmail={prospect.email}
            isAdmin={Boolean(isAdmin)}
          />

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
