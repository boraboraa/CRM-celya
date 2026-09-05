import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { todayBounds } from "@/lib/time";
import { PageHeader, EmptyState, Icone } from "@/components/ui";
import { type TaskWithProspect } from "@/components/TaskRow";
import { TaskList } from "@/components/TaskList";
import { ReplyCard, type ReplyCardEmail } from "@/components/ReplyCard";
import { NouvelleRelanceLibre } from "@/components/NouvelleRelanceLibre";
import { PerimetreSwitcher } from "@/components/PerimetreSwitcher";
import { DebriefList, type DebriefMeeting } from "@/components/DebriefList";
import { BoutonsMaps } from "@/components/BoutonsMaps";
import { fmtDate, relative } from "@/lib/constants";
import {
  LAST_ACTION_SELECT,
  isWaitingReply,
  mapLastActions,
  type LastActionRow,
} from "@/lib/crm/lastAction";
import {
  lirePerimetre,
  filtrerTaches,
  filtrerProspects,
  filtrerJointProspects,
  restreindreAuxProspects,
  type PerimetreViewer,
} from "@/lib/crm/perimetre";


/** Une fiche en attente de réponse — la zone CALME du tableau. */
type WaitingProspect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  next_action_at: string | null;
  /** Date du dernier mail envoyé. */
  sent_at: string | null;
};

/** Une ligne de l'agenda lue via meetings_visibles. */
type MeetingRow = {
  id: string;
  owner_id: string;
  prospect_id: string | null;
  kind: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  status: string;
};

/** Heure de Bruxelles, « 11:00 ». */
const heure = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-BE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });

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
 *
 * Le tout dans le PÉRIMÈTRE choisi (lib/crm/perimetre.ts) : « moi » par
 * défaut, pour tout le monde — l'admin peut élargir à un membre ou à toute
 * l'équipe. C'est un filtre de confort ; la cloison de sécurité reste la RLS.
 */
export default async function TodoPage({
  searchParams,
}: {
  searchParams: Promise<{ perimetre?: string }>;
}) {
  const supabase = await createClient();
  const [session, params] = await Promise.all([getSession(), searchParams]);
  const { start, end } = todayBounds();

  const viewer: PerimetreViewer = {
    userId: session?.userId ?? "",
    isAdmin: session?.me?.role === "admin",
  };
  const perimetre = lirePerimetre(params, viewer);

  const TASK_SELECT =
    "id, title, details, due_at, status, priority, prospect_id, prospects(id, company_name, contact_name, phone, email)";

  // Les requêtes partent ENSEMBLE. La liste des fiches en attente était
  // auparavant lancée après coup, une fois les identifiants connus : un
  // aller-retour de plus, en série, sur l'écran le plus consulté. On charge
  // maintenant les fiches ouvertes en parallèle et on croise en mémoire.
  //
  // Le périmètre s'applique aux CINQ : en oublier une remettrait du bruit
  // dans sa zone. La vue prospect_action_state, qui ne porte pas owner_id,
  // est restreinte en mémoire juste en dessous.
  const [
    overdueRes,
    todayRes,
    repliesRes,
    waitingRes,
    openProspectsRes,
    membresRes,
    meetingsTodayRes,
    debriefRes,
  ] = await Promise.all([
    // En retard — les plus anciennes d'abord.
    filtrerTaches(
      supabase
        .from("tasks")
        .select(TASK_SELECT)
        .eq("status", "a_faire")
        .lt("due_at", start),
      perimetre,
      viewer
    )
      .order("due_at", { ascending: true })
      .limit(100),

    // Aujourd'hui.
    filtrerTaches(
      supabase
        .from("tasks")
        .select(TASK_SELECT)
        .eq("status", "a_faire")
        .gte("due_at", start)
        .lte("due_at", end),
      perimetre,
      viewer
    )
      .order("due_at", { ascending: true })
      .limit(100),

    // Réponses reçues — emails entrants rattachés, en attente de tri.
    // L'embed est !inner pour que le filtre de périmètre soit filtrant.
    filtrerJointProspects(
      supabase
        .from("emails")
        .select(
          "id, from_email, subject, body_text, received_at, intent, intent_confidence, intent_summary, proposed_due_at, prospects!inner(id, company_name)"
        )
        .eq("direction", "entrant")
        .eq("triage", "a_traiter")
        .not("prospect_id", "is", null),
      perimetre,
      viewer
    )
      .order("received_at", { ascending: false })
      .limit(20),

    // La dernière action de chaque fiche (vue prospect_action_state, RLS
    // appliquée). Elle sert DEUX zones, d'où l'absence de filtre SQL :
    //   · « En attente de réponse » — dernier événement = mail sortant ;
    //   · « À appeler / à rappeler » — le résultat du dernier appel, affiché
    //     sur la ligne (« Pas de réponse (3e fois) ») avant d'en passer un
    //     autre. Filtrer ici aurait coûté une SIXIÈME requête sur l'écran le
    //     plus consulté ; le tri se fait en mémoire, juste en dessous.
    supabase.from("prospect_action_state").select(LAST_ACTION_SELECT).limit(500),

    // Les fiches encore ouvertes — celles qui peuvent peupler la zone calme.
    filtrerProspects(
      supabase
        .from("prospects")
        .select("id, company_name, contact_name, next_action_at")
        .not("status", "in", "(gagne,perdu)"),
      perimetre,
      viewer
    ).limit(500),

    // Les membres actifs — pour le sélecteur de périmètre (admin seulement).
    viewer.isAdmin
      ? supabase
          .from("crm_users")
          .select("id, full_name, email")
          .eq("is_active", true)
          .order("full_name")
      : Promise.resolve({ data: [] }),

    // L'agenda du jour — en tête d'écran, avant les relances. Le filtre de
    // périmètre porte sur owner_id, la même colonne que pour les fiches.
    filtrerProspects(
      supabase
        .from("meetings_visibles")
        .select(
          "id, owner_id, prospect_id, kind, title, starts_at, ends_at, location, status"
        )
        .gte("starts_at", start)
        .lte("starts_at", end)
        .neq("status", "annule"),
      perimetre,
      viewer
    )
      .order("starts_at", { ascending: true })
      .limit(30),

    // Rendez-vous passés jamais débriefés — la boucle qui manquait : rien ne
    // demandait jamais ce qu'un rendez-vous avait donné.
    filtrerProspects(
      supabase
        .from("meetings_visibles")
        .select(
          "id, owner_id, prospect_id, kind, title, starts_at, ends_at, location, status"
        )
        .lt("ends_at", new Date().toISOString())
        .in("status", ["prevu", "confirme"])
        .is("debriefed_at", null),
      perimetre,
      viewer
    )
      .order("ends_at", { ascending: false })
      .limit(20),
  ]);

  const overdueAll = (overdueRes.data ?? []) as unknown as TaskWithProspect[];
  const todayAll = (todayRes.data ?? []) as unknown as TaskWithProspect[];
  const replies = (repliesRes.data ?? []) as unknown as ReplyCardEmail[];
  const membres = (membresRes.data ?? []) as {
    id: string;
    full_name: string | null;
    email: string;
  }[];
  const openProspectRows = (openProspectsRes.data ?? []) as unknown as Omit<
    WaitingProspect,
    "sent_at"
  >[];
  // La vue ne sait pas porter le filtre de périmètre (pas d'owner_id, pas de
  // jointure PostgREST possible) : on la restreint aux fiches du périmètre.
  const actionRows = restreindreAuxProspects(
    (waitingRes.data ?? []) as unknown as LastActionRow[],
    new Set(openProspectRows.map((p) => p.id)),
    perimetre
  );
  // Zone calme : seules les fiches dont le dernier événement est un mail
  // sortant. Le tri qui était fait en SQL se fait ici, sur les mêmes lignes.
  const waitingRows = actionRows.filter(isWaitingReply);
  const waitingMap = mapLastActions(waitingRows);
  const actionsMap = mapLastActions(actionRows);

  /** Attache à chaque relance ce qu'a donné le dernier appel de la fiche. */
  const avecDerniereAction = (t: TaskWithProspect): TaskWithProspect => {
    const a = t.prospect_id ? actionsMap.get(t.prospect_id) : undefined;
    return a
      ? {
          ...t,
          derniere_action: {
            kind: a.last_kind,
            at: a.last_at,
            outcome: a.last_outcome,
            text: a.last_text,
            streak: a.last_no_answer_streak,
          },
        }
      : t;
  };

  // ---- L'agenda : les rendez-vous du jour et ceux à débriefer. Les infos
  // de fiche (contact, téléphone, lieu de la carte) viennent d'une requête
  // groupée — c'est ce qui rend l'agenda utile depuis un téléphone.
  const meetingsToday = (meetingsTodayRes.data ?? []) as unknown as MeetingRow[];
  const aDebriefer = (debriefRes.data ?? []) as unknown as MeetingRow[];
  const meetingProspectIds = [
    ...new Set(
      [...meetingsToday, ...aDebriefer]
        .map((m) => m.prospect_id)
        .filter(Boolean) as string[]
    ),
  ];
  const meetingProspects = new Map<
    string,
    {
      id: string;
      company_name: string;
      contact_name: string | null;
      phone: string | null;
      city: string | null;
    }
  >();
  if (meetingProspectIds.length > 0) {
    // `city` complète l'adresse du rendez-vous quand elle n'a pas de code
    // postal — jamais `country`, qui n'est pas fiable (voir lib/crm/maps.ts).
    const { data } = await supabase
      .from("prospects")
      .select("id, company_name, contact_name, phone, city")
      .in("id", meetingProspectIds);
    for (const p of (data ?? []) as {
      id: string;
      company_name: string;
      contact_name: string | null;
      phone: string | null;
      city: string | null;
    }[]) {
      meetingProspects.set(p.id, p);
    }
  }
  const debriefMeetings: DebriefMeeting[] = aDebriefer.map((m) => ({
    id: m.id,
    title: m.title,
    starts_at: m.starts_at,
    ends_at: m.ends_at,
    prospect: m.prospect_id
      ? {
          id: m.prospect_id,
          company_name:
            meetingProspects.get(m.prospect_id)?.company_name ?? "Fiche prospect",
        }
      : null,
  }));

  // Une fiche qui a répondu vit en zone 3 — ses relances n'encombrent pas la
  // zone 1 le temps du tri. (Les rendez-vous ne passent plus par des tâches
  // « RDV … » : ils vivent dans l'agenda, zone « Aujourd'hui ».)
  const replyIds = new Set(
    replies.map((e) => e.prospects?.id).filter(Boolean) as string[]
  );
  const inZone1 = (t: TaskWithProspect) =>
    !t.prospect_id || !replyIds.has(t.prospect_id);
  const overdue = overdueAll.filter(inZone1).map(avecDerniereAction);
  const today = todayAll.filter(inZone1).map(avecDerniereAction);

  // La zone calme ne liste que les fiches dont RIEN n'est encore dû : dès que
  // la relance « si pas de réponse » échoit, la fiche remonte en zone 1 et
  // quitte celle-ci — jamais dans les deux.
  const dueIds = new Set(
    [...overdueAll, ...todayAll]
      .map((t) => t.prospect_id)
      .filter(Boolean) as string[]
  );
  const calmIds = new Set(
    waitingRows
      .map((r) => r.prospect_id)
      .filter((id) => !dueIds.has(id) && !replyIds.has(id))
  );

  const waiting: WaitingProspect[] = openProspectRows
    .filter((p) => calmIds.has(p.id))
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

  const firstName = session?.me?.full_name?.split(" ")[0];
  const nothingAtAll =
    overdue.length +
      today.length +
      waiting.length +
      replies.length +
      meetingsToday.length +
      debriefMeetings.length ===
    0;

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

      {/* Le périmètre — admin seulement (le composant ne rend rien sinon). */}
      {viewer.isAdmin && (
        <div className="mb-5">
          <PerimetreSwitcher
            role={session?.me?.role ?? "commercial"}
            viewerId={viewer.userId}
            perimetre={perimetre}
            membres={membres}
            basePath="/dashboard"
            searchParams={params}
          />
        </div>
      )}

      {/* ---------- 0. Aujourd'hui — l'agenda du jour, avant les relances ---------- */}
      {meetingsToday.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
            Aujourd&apos;hui
            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] text-blue-300">
              {meetingsToday.length}
            </span>
            <span className="ml-auto text-[11px] font-normal normal-case tracking-normal">
              <Link
                href="/agenda"
                className="text-slate-500 hover:text-slate-300"
              >
                Voir l&apos;agenda
              </Link>
            </span>
          </h2>
          <ul className="card animate-rise divide-y divide-white/[0.05]">
            {meetingsToday.map((m) => {
              const p = m.prospect_id
                ? meetingProspects.get(m.prospect_id)
                : undefined;
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
                >
                  <span className="w-24 shrink-0 text-sm font-semibold tabular-nums text-blue-300">
                    {heure(m.starts_at)}–{heure(m.ends_at)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {p ? (
                        <Link
                          href={`/prospects/${p.id}`}
                          prefetch={false}
                          className="underline-offset-2 hover:text-celya-blue hover:underline"
                        >
                          {m.title}
                        </Link>
                      ) : (
                        m.title
                      )}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                      {p?.contact_name && <span>{p.contact_name}</span>}
                      {p?.phone && (
                        <a
                          href={`tel:${p.phone.replace(/\s/g, "")}`}
                          className="text-celya-blue hover:underline"
                        >
                          {p.phone}
                        </a>
                      )}
                      {/* L'adresse en clientèle : un bouton, pas un texte à
                          recopier dans Maps. */}
                      {m.location && (
                        <BoutonsMaps
                          valeur={m.location}
                          ville={p?.city}
                          compact
                        />
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-slate-300">
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
                      <Icone
                        nom="enveloppe"
                        className="h-3.5 w-3.5 text-slate-400"
                      />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/prospects/${p.id}`}
                          prefetch={false}
                          className="text-sm font-medium text-slate-100 underline-offset-2 hover:text-celya-blue hover:underline"
                        >
                          {p.company_name}
                        </Link>
                        <p className="text-xs text-slate-400">
                          Mail envoyé{p.sent_at ? ` ${relative(p.sent_at)}` : ""}
                          {p.contact_name ? ` à ${p.contact_name}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-slate-400">
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
      <NouvelleRelanceLibre assigneeId={session?.userId ?? "none"} />

      {/* ---------- 3. Réponses reçues — agir maintenant ---------- */}
      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
          Réponses reçues
          {replies.length > 0 && (
            <span className="rounded-full bg-celya-blue/15 px-2 py-0.5 text-[11px] text-blue-300">
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

      {/* ---------- 4. Rendez-vous à débriefer — la boucle qui manquait.
          Un rendez-vous passé non débriefé RESTE ici : c'est le seul rappel
          du produit, ne pas en ajouter d'autre. ---------- */}
      {debriefMeetings.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
            Rendez-vous à débriefer
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">
              {debriefMeetings.length}
            </span>
          </h2>
          <DebriefList meetings={debriefMeetings} />
        </section>
      )}
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
              ? "bg-amber-500/15 text-amber-300"
              : "bg-white/[0.06] text-slate-400"
          }`}
        >
          {tasks.length}
        </span>
      </h3>

      <TaskList
        tasks={tasks}
        className="card animate-rise divide-y divide-white/[0.05]"
      />
    </div>
  );
}
