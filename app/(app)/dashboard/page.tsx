import { avecRepliColonne } from "@/lib/crm/tolerance";
import { lireMesObjectifs } from "@/lib/crm/lectureObjectifs";
import { CarteObjectifs } from "@/components/CarteObjectifs";
import { etoileesDabord } from "@/lib/crm/ordreProspects";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSession, getPerimetreViewer, perimetreMemorise } from "@/lib/auth";
import { todayBounds } from "@/lib/time";
import { PageHeader } from "@/components/ui";
import { type TaskWithProspect } from "@/components/TaskRow";
import { type ReplyCardEmail } from "@/components/ReplyCard";
import { PerimetreSwitcher } from "@/components/PerimetreSwitcher";
import { type DebriefMeeting } from "@/components/DebriefList";
import { ZonesAFaire, type WaitingProspect } from "@/components/ZonesAFaire";
import { AvecColonneAppels } from "@/components/appelsIa/AvecColonneAppels";
import { lireEtatAppels, rdvPosesParJanet } from "@/lib/appelsIa/lectures";
import {
  LAST_ACTION_SELECT,
  isWaitingReply,
  mapLastActions,
  type LastActionRow,
} from "@/lib/crm/lastAction";
import { relanceEnLecture } from "@/lib/crm/access";
import { ligneAgendaJour } from "@/lib/crm/agendaJour";
import { rdvADebriefer } from "@/lib/crm/debrief";
import { ordreAFaire } from "@/lib/crm/ficheSuivante";
import { MemoireAFaire } from "@/components/FicheSuivante";
import {
  lirePerimetre,
  filtrerTaches,
  filtrerProspects,
  filtrerJointProspects,
  restreindreAuxProspects,
  peutElargir,
  membresProposables,
  type PerimetreViewer,
} from "@/lib/crm/perimetre";


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
  debriefed_at?: string | null;
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

  // `getPerimetreViewer` porte aussi l'interrupteur « travaille en équipe » et
  // la liste des porteurs (migration 020) — `cache()`é, donc une seule requête
  // par rendu, et zéro pour un admin.
  const viewer: PerimetreViewer = await getPerimetreViewer();
  const perimetre = lirePerimetre(params, viewer, await perimetreMemorise());

  // `starred_at` (031) n'est nommée que si la base la connaît : chaque lecture
  // qui la porte passe par `avecRepliColonne` (lib/crm/tolerance.ts).
  const TASK_SELECT = (e: boolean): string =>
    `id, title, details, due_at, status, priority, prospect_id, assignee_id, prospects(id, company_name, contact_name, phone, email, next_action_at, next_action_kind${e ? ", starred_at" : ""})`;

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
    etatAppels,
    mesObjectifs,
  ] = await Promise.all([
    // En retard — les plus anciennes d'abord.
    avecRepliColonne((e) =>
      filtrerTaches(
        supabase
          .from("tasks")
          .select(TASK_SELECT(e))
          .eq("status", "a_faire")
          .lt("due_at", start),
        perimetre,
        viewer
      )
        .order("due_at", { ascending: true })
        .limit(100)
    ),

    // Aujourd'hui.
    avecRepliColonne((e) =>
      filtrerTaches(
        supabase
          .from("tasks")
          .select(TASK_SELECT(e))
          .eq("status", "a_faire")
          .gte("due_at", start)
          .lte("due_at", end),
        perimetre,
        viewer
      )
        .order("due_at", { ascending: true })
        .limit(100)
    ),

    // Réponses reçues — emails entrants rattachés, en attente de tri.
    // L'embed est !inner pour que le filtre de périmètre soit filtrant.
    avecRepliColonne((e) =>
      filtrerJointProspects(
        supabase
          .from("emails")
          .select(
            `id, from_email, subject, body_text, received_at, intent, intent_confidence, intent_summary, proposed_due_at, prospects!inner(id, company_name, owner_id${e ? ", starred_at" : ""})` as string
          )
          .eq("direction", "entrant")
          .eq("triage", "a_traiter")
          .not("prospect_id", "is", null),
        perimetre,
        viewer
      )
        .order("received_at", { ascending: false })
        .limit(20)
    ),

    // La dernière action de chaque fiche (vue prospect_action_state, RLS
    // appliquée). Elle sert DEUX zones, d'où l'absence de filtre SQL :
    //   · « En attente de réponse » — dernier événement = mail sortant ;
    //   · « À appeler / à rappeler » — le résultat du dernier appel, affiché
    //     sur la ligne (« Pas décroché (3e fois) ») avant d'en passer un
    //     autre. Filtrer ici aurait coûté une SIXIÈME requête sur l'écran le
    //     plus consulté ; le tri se fait en mémoire, juste en dessous.
    supabase.from("prospect_action_state").select(LAST_ACTION_SELECT).limit(500),

    // Les fiches encore ouvertes — celles qui peuvent peupler la zone calme.
    avecRepliColonne((e) =>
      filtrerProspects(
        supabase
          .from("prospects")
          .select(`id, company_name, contact_name, next_action_at, next_action_kind${e ? ", starred_at" : ""}` as string)
          .not("status", "in", "(gagne,perdu)"),
        perimetre,
        viewer
      ).limit(500)
    ),

    // Les membres actifs — pour le sélecteur de périmètre (admin, ou porteur
    // de l'interrupteur d'équipe ; la liste est bornée au partage juste après).
    peutElargir(viewer)
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
    // demandait jamais ce qu'un rendez-vous avait donné. De PROSPECT
    // seulement : un RDV personnel ne réclame jamais de débrief (le « Rdv
    // Ephec » du 18/10). « Passé » = a commencé, comme en base (027).
    filtrerProspects(
      supabase
        .from("meetings_visibles")
        .select(
          "id, owner_id, prospect_id, kind, title, starts_at, ends_at, location, status, debriefed_at"
        )
        .eq("kind", "prospect")
        .lte("starts_at", new Date().toISOString())
        // « reporte » AUSSI : un rendez-vous reporté puis passé attend son
        // débrief comme les autres. Sans lui, tout RDV déplacé une fois
        // échappait à cette zone pour toujours (Garage Boetendael, 02/09 →
        // invisible trois semaines). Même liste que `rdv_vivant` (022).
        .in("status", ["prevu", "confirme", "reporte"])
        .is("debriefed_at", null),
      perimetre,
      viewer
    )
      .order("starts_at", { ascending: false })
      .limit(50),

    // La colonne « Appels » (Janet) — ADMIN SEUL, et lue avec le reste : elle
    // ne retarde pas la page. Tolérante : migration 025 absente → indisponible,
    // et la mise en page reste celle d'avant. Rien n'est demandé pour un
    // commercial (la RLS ne lui rendrait rien de toute façon).
    viewer.isAdmin ? lireEtatAppels(supabase) : Promise.resolve(null),

    // Les objectifs de la semaine (031) — un commercial seul : l'admin n'est
    // pas au classement. Tolérant : sans la 031, la carte ne s'affiche pas.
    !viewer.isAdmin ? lireMesObjectifs(supabase, viewer.userId) : Promise.resolve(null),
  ]);

  const overdueAll = (overdueRes.data ?? []) as unknown as TaskWithProspect[];
  const todayAll = (todayRes.data ?? []) as unknown as TaskWithProspect[];
  // Les DEUX zones d'action du tableau restent personnelles, même en périmètre
  // d'équipe : trier une réponse et débriefer un rendez-vous ÉCRIVENT (l'un
  // rattache un email et pose une relance, l'autre clôt un RDV et verse un
  // compte rendu au journal). `emails_update` et `meetings_update` les
  // refuseraient sur le travail d'un collègue — et surtout, ce sont ses boucles
  // à lui : les lui prendre, c'est les faire disparaître de son écran.
  const aMoi = (ownerId: string | null | undefined) =>
    viewer.isAdmin || ownerId === viewer.userId;

  // Les étoilées en tête de CHAQUE zone (031) — jamais une zone de plus :
  // l'ordre propre à la zone vaut ensuite (lib/crm/ordreProspects.ts).
  const replies = etoileesDabord(
    ((repliesRes.data ?? []) as unknown as (ReplyCardEmail & {
      prospects?: { starred_at?: string | null } | null;
    })[]).filter((e) => aMoi(e.prospects?.owner_id)),
    (e) => Boolean(e.prospects?.starred_at)
  );
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
  const aDebriefer = ((debriefRes.data ?? []) as unknown as MeetingRow[]).filter(
    (m) => aMoi(m.owner_id)
  );
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
      status: string;
      starred_at?: string | null;
    }
  >();
  // Les fiches des rendez-vous, et — pour l'admin — ceux que Janet a posés
  // (« posé par Janet »). Les deux lectures dépendent des rendez-vous du jour,
  // elles partent donc ensemble, juste après.
  const [fichesRdvRes, posesParJanet] = await Promise.all([
    // `city` complète l'adresse du rendez-vous quand elle n'a pas de code
    // postal — jamais `country`, qui n'est pas fiable (voir lib/crm/maps.ts).
    meetingProspectIds.length > 0
      ? avecRepliColonne((e) =>
          supabase
            .from("prospects")
            .select(`id, company_name, contact_name, phone, city, status${e ? ", starred_at" : ""}` as string)
            .in("id", meetingProspectIds)
        )
      : Promise.resolve({ data: [], error: null }),
    viewer.isAdmin && meetingsToday.length > 0
      ? rdvPosesParJanet(
          supabase,
          meetingsToday.map((m) => m.id)
        )
      : Promise.resolve(new Set<string>()),
  ]);
  for (const p of (fichesRdvRes.data ?? []) as unknown as {
    id: string;
    company_name: string;
    contact_name: string | null;
    phone: string | null;
    city: string | null;
    status: string;
    starred_at: string | null;
  }[]) {
    meetingProspects.set(p.id, p);
  }
  // Ce qui attend une issue — la règle vit dans lib/crm/debrief.ts : jamais
  // un RDV perso, jamais une fiche gagnée ou perdue (023 : sa fiche ne le dit
  // plus, cette zone non plus), UN SEUL rendez-vous par fiche (le plus récent ;
  // la base clôt les plus anciens « remplacés » dès qu'il est débriefé, 027).
  const debriefMeetings: DebriefMeeting[] = etoileesDabord(
    rdvADebriefer(aDebriefer, (id) => meetingProspects.get(id)?.status),
    (m) => Boolean(m.prospect_id && meetingProspects.get(m.prospect_id)?.starred_at)
  ).map((m) => ({
      id: m.id,
      title: m.title,
      starts_at: m.starts_at,
      ends_at: m.ends_at,
      prospect: m.prospect_id
        ? {
            id: m.prospect_id,
            company_name:
              meetingProspects.get(m.prospect_id)?.company_name ?? "Fiche prospect",
            contact_name: meetingProspects.get(m.prospect_id)?.contact_name ?? null,
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
  // Une relance d'un collègue se LIT. En périmètre « moi » tout est à moi, donc
  // ce prédicat ne coûte rien ; en « équipe » il empêche d'offrir « Fait »,
  // « Reporter » et « Résultat » sur le travail d'un autre — que `tasks_update`
  // et `activities_insert` refuseraient, et qui déplacerait SON « À faire ».
  const relanceLue = (t: TaskWithProspect) =>
    relanceEnLecture(viewer, t.assignee_id);

  // Une fiche dont le RDV passé attend son issue : sa ligne offre le débrief
  // à la place de « Résultat », comme la carte de la fiche (même liste que la
  // zone débrief — jamais un RDV perso, jamais une fiche close).
  const rdvParFiche = new Map(
    debriefMeetings
      .filter((m) => m.prospect)
      .map((m) => [m.prospect!.id, { id: m.id, starts_at: m.starts_at }])
  );
  const avecDebrief = (t: TaskWithProspect): TaskWithProspect => {
    const rdv = t.prospect_id ? rdvParFiche.get(t.prospect_id) : undefined;
    return rdv ? { ...t, rdv_a_debriefer: rdv } : t;
  };

  const etoilee = (t: TaskWithProspect) => Boolean(t.prospects?.starred_at);
  const overdue = etoileesDabord(
    overdueAll.filter(inZone1).map(avecDerniereAction).map(avecDebrief),
    etoilee
  );
  const today = etoileesDabord(
    todayAll.filter(inZone1).map(avecDerniereAction).map(avecDebrief),
    etoilee
  );

  // Le résultat du prédicat, pas le prédicat : `TaskList` est un composant
  // CLIENT, et une fonction ne traverse pas la frontière serveur → client
  // (React la refuse à la sérialisation, toute la page tombe). Une liste
  // d'identifiants, elle, est de la donnée.
  const relancesLues = [...overdue, ...today]
    .filter(relanceLue)
    .map((t) => t.id);

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

  const waitingTries: WaitingProspect[] = openProspectRows
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
  const waiting = etoileesDabord(waitingTries, (p) =>
    Boolean((p as WaitingProspect & { starred_at?: string | null }).starred_at)
  );

  // L'ordre des lignes de l'écran, pour « Fiche suivante » sur la fiche
  // ouverte d'ici — exactement ce qui s'affiche, dans l'ordre des zones.
  const ordre = ordreAFaire([
    debriefMeetings.map((m) => m.prospect?.id),
    overdue.map((t) => t.prospects?.id),
    today.map((t) => t.prospects?.id),
    waiting.map((p) => p.id),
    replies.map((e) => e.prospects?.id),
  ]);

  const firstName = session?.me?.full_name?.split(" ")[0];

  return (
    <>
      <PageHeader
        title={firstName ? `Bonjour ${firstName}` : "À faire"}
        subtitle="Trois états, jamais mélangés : à appeler, en attente de réponse, réponses reçues."
        compactMobile
        action={
          <Link href="/prospects/nouveau" className="btn-primary">
            + Nouveau prospect
          </Link>
        }
      />

      <MemoireAFaire ids={ordre} />

      {mesObjectifs?.disponible && <CarteObjectifs donnees={mesObjectifs} />}

      {/* La colonne « Appels » de Janet — admin seul. Sans elle (commercial,
          migration 025 absente), le contenu est rendu tel quel. */}
      <AvecColonneAppels etat={etatAppels}>
        {/* Le périmètre — admin, ou porteur de l'interrupteur d'équipe. Le
            composant ne rend rien pour les autres, ni pour un porteur seul. */}
        {peutElargir(viewer) && (
          <div className="mb-5">
            <PerimetreSwitcher
              role={session?.me?.role ?? "commercial"}
              viewerId={viewer.userId}
              perimetre={perimetre}
              membres={membresProposables(membres, viewer)}
              peutElargir={peutElargir(viewer)}
              basePath="/dashboard"
              searchParams={params}
            />
          </div>
        )}

        <ZonesAFaire
          lignesJour={meetingsToday.map((m) =>
            ligneAgendaJour(m, meetingProspects, posesParJanet)
          )}
          debriefMeetings={debriefMeetings}
          overdue={overdue}
          today={today}
          relancesLues={relancesLues}
          waiting={waiting}
          replies={replies}
          admin={session?.me?.role === "admin"}
        />
      </AvecColonneAppels>
    </>
  );
}
