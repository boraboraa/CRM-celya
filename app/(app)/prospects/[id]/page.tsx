import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { Avatar, Icone } from "@/components/ui";
import { AdresseInline } from "@/components/AdresseInline";
import { AdresseDepuisRdv } from "@/components/AdresseDepuisRdv";
import { BoutonsMaps } from "@/components/BoutonsMaps";
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
import {
  lireProchaineAction,
  plusRienDePrevu,
  rdvClos,
  PLUS_RIEN_COURT,
  rdvQuiCompte,
  rdvVivant,
} from "@/lib/crm/prochaineAction";
import { replySubject } from "@/lib/crm/email";
import type { ComposerPrefill } from "@/lib/crm/composer";
import {
  normalizeStatus,
  fmtDateTime,
  fmtMoney,
  relative,
  isCallOutcome,
  OUTCOME_LABEL,
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
  // LECTURE PARTAGÉE, ÉCRITURE PERSO (interrupteur d'équipe, migration 020).
  //
  // Depuis que deux commerciaux qui « travaillent en équipe » voient leurs
  // fiches respectives, cette page s'ouvre sur des fiches qu'on ne possède
  // pas. Les policies rebasées sur `owner_id` refusent l'écriture — mais un
  // refus après le clic n'est pas une interface : Bora aurait vingt boutons
  // qui échouent. Tout ce qui écrit est donc MASQUÉ, pas désactivé.
  //
  // Le test est le même que `canEditProspect` (lib/crm/access.ts) : moi, ou
  // l'admin. L'équipe n'y entre pas.
  const modifiable = Boolean(isAdmin) || prospect.owner_id === session?.userId;
  const lectureSeule = !modifiable;

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
        // Sans texte, c'est le RÉSULTAT qui titre l'entrée (« Barrage »,
        // « Intéressé ») : une ligne de journal ne doit jamais être muette.
        title:
          a.subject ??
          (isCallOutcome(a.outcome) ? OUTCOME_LABEL[a.outcome] : null),
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

  // « Prochaine action » — dérivée sans le moindre appel à un modèle, par la
  // même règle que la base (migrations 022 à 024, lib/crm/prochaineAction.ts) :
  // le rendez-vous VIVANT le plus proche — passé compris, il attend alors son
  // débrief — est TOUJOURS la prochaine action (024) ; une relance datée avant
  // lui reste une tâche, elle ne le remplace pas. Sur une fiche gagnée ou
  // perdue, seul un rendez-vous À VENIR compte : une fiche close ne réclame
  // jamais de débrief. Sans l'étape, la carte et la base se contrediraient.
  const lastEvent: LastEvent = timeline[0]
    ? { kind: timeline[0].kind, at: timeline[0].at }
    : null;
  const rdvCourant = rdvQuiCompte(meetings, status);
  const prochainRdv =
    meetings.find(
      (m) => rdvVivant(m.status) && new Date(m.starts_at).getTime() >= Date.now()
    ) ?? null;
  // Le lieu d'un rendez-vous, quand la fiche n'a pas encore d'adresse : le
  // prochain rendez-vous d'abord, sinon le plus récent qui en porte un.
  const lieuDepuisRdv =
    prospect.address
      ? null
      : (prochainRdv?.location?.trim() ||
          [...meetings].reverse().find((m) => m.location?.trim())?.location?.trim() ||
          null);

  const relances = openTasks as unknown as OpenTask[];
  const nextAction = deriveNextAction(
    relances,
    lastEvent,
    prospect.contact_name,
    rdvCourant
  );
  // La relance ouverte la plus proche (la liste est triée par échéance), même
  // quand un rendez-vous lui passe devant dans la carte : c'est elle que
  // « Relancer » re-date, jamais une nouvelle.
  const relanceOuverte = relances[0] ?? null;
  // Le garde-fou zéro tap : un rendez-vous clos sans suite ne laisse pas la
  // fiche muette — elle dit « Plus rien de prévu sur cette fiche ».
  const plusRien = plusRienDePrevu({
    nextActionAt: prospect.next_action_at,
    status,
    aEuUnRdvClos: meetings.some((m) => rdvClos(m.status)),
  });
  const lectureNext = lireProchaineAction(
    prospect.next_action_at,
    prospect.next_action_kind,
    Date.now(),
    status
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
        <Link href="/prospects" className="btn-link text-xs">
          <Icone nom="chevron" className="h-3 w-3 rotate-90" />
          Tous les prospects
        </Link>

        {/* Fiche d'un collègue : on le dit AVANT de la lire, pas au moment
            où un bouton manque. Ambre — c'est un avertissement, pas une
            erreur : la fiche est bien à sa place, elle n'est simplement pas
            la nôtre. */}
        {lectureSeule && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-500/[0.08] px-3.5 py-2.5 text-xs leading-relaxed text-amber-200 ring-1 ring-amber-400/25">
            <Icone nom="cadenas" className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Fiche de {owner?.full_name ?? owner?.email ?? "un autre commercial"} —
              lecture seule. Vous la voyez pour ne pas appeler deux fois la même
              société ; c&apos;est {owner?.full_name?.split(" ")[0] ?? "son responsable"} qui
              la fait avancer.
            </span>
          </p>
        )}

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
                  className="text-celya-blue hover:underline"
                >
                  {prospect.phone}
                </a>
              )}
              {prospect.email && (
                <a
                  href={`mailto:${prospect.email}`}
                  className="text-celya-blue hover:underline"
                >
                  {prospect.email}
                </a>
              )}
              {prospect.city && <span>{prospect.city}</span>}
            </p>

            {/* L'adresse — à côté du téléphone, les deux gestes du terrain :
                ouvrir la fiche Maps, ou lancer l'itinéraire. Sans adresse, le
                point d'entrée est ICI (« Ajouter une adresse ») : le champ
                du formulaire complet est replié tout en bas, personne ne l'y
                trouvait. Le lieu d'un rendez-vous, quand il y en a un à
                proposer, garde la priorité — jamais les deux à la fois. */}
            <div className="mt-2">
              {lectureSeule ? (
                // Ni « ＋ Ajouter une adresse » ni « Enregistrer cette
                // adresse ? » : les deux écrivent sur la fiche. Les boutons
                // Maps, eux, ne sont que des liens — et c'est précisément ce
                // dont un commercial a besoin sur la fiche d'un collègue.
                <BoutonsMaps valeur={prospect.address} ville={prospect.city} />
              ) : !prospect.address && lieuDepuisRdv ? (
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
                lectureSeule={lectureSeule}
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
              lectureSeule={lectureSeule}
            />
          </div>
        </div>
      </div>

      {/* ---------- 1. PROCHAINE ACTION, tout en tête ---------- */}
      <div className="mb-6">
        <NextActionCard
          action={nextAction}
          prospectId={prospect.id}
          companyName={prospect.company_name}
          relanceOuverte={relanceOuverte}
          plusRien={plusRien}
          rdvAVenir={prochainRdv?.starts_at ?? null}
          canEmail={Boolean(prospect.email)}
          lectureSeule={lectureSeule}
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
            lectureSeule={lectureSeule}
            rdvAVenir={prochainRdv?.starts_at ?? null}
          />

          {/* Modifier la fiche, et la supprimer — les deux écrivent. Rien
              n'est « désactivé » ici : le bloc entier n'existe pas sur la
              fiche d'un collègue. */}
          {modifiable && (
          <section>
            <details id="modifier-la-fiche" className="group card scroll-mt-6 p-6">
              <summary className="btn-link cursor-pointer list-none text-xs">
                <Icone
                  nom="chevron"
                  className="h-3 w-3 transition-transform group-open:rotate-180"
                />
                Modifier la fiche
              </summary>
              <div className="mt-5">
                <ProspectForm
                  prospect={prospect}
                  members={members}
                  action={updateProspectAction}
                  currentUserId={session?.userId}
                  peutReassigner={Boolean(isAdmin)}
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
          )}
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
                  className={`mt-0.5 flex items-center gap-1.5 text-sm font-medium ${
                    lectureNext.retard ? "text-amber-300" : "text-slate-100"
                  }`}
                >
                  {lectureNext.icone && (
                    <Icone nom={lectureNext.icone} className="h-3.5 w-3.5 text-blue-300" />
                  )}
                  {lectureNext.texte ??
                    (!lectureNext.rien && prospect.next_action_at
                      ? fmtDateTime(prospect.next_action_at)
                      : plusRien
                        ? PLUS_RIEN_COURT
                        : "—")}
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

            <RelancesSection
              prospectId={prospect.id}
              openTasks={openTasks}
              lectureSeule={lectureSeule}
              premiereDansLaCarte={Boolean(nextAction.task)}
              rdvAVenir={prochainRdv?.starts_at ?? null}
            />

            {doneTasks.length > 0 && (
              <details className="group mt-3">
                <summary className="btn-link cursor-pointer list-none text-xs">
                  <Icone
                    nom="chevron"
                    className="h-3 w-3 transition-transform group-open:rotate-180"
                  />
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
          {/* Les brouillons d'un collègue sont SON travail en cours : ni à
              lire par-dessus son épaule, ni à envoyer en son nom. */}
          {modifiable && (
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
