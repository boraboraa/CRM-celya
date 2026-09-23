/**
 * « Prochaine action » — dérivée de façon DÉTERMINISTE.
 *
 * Quand Bora ouvre une fiche, il doit comprendre en deux secondes où on en est
 * et quoi faire. La phrase affichée en tête (« En attente de réponse de
 * Sébastien — relance prévue le 11 août ») se calcule à partir de la relance
 * ouverte et du dernier événement du journal. Aucune clé IA n'est nécessaire :
 * c'est du code, pas un modèle.
 */

// Chemins RELATIFS : le test (npm run test:prochaine-action) exécute ce
// module tel quel sous node, qui ne connaît pas l'alias « @/ ».
import { fmtDate } from "../constants.ts";
import { libelleRdv } from "./prochaineAction.ts";

/** Ce qui alimente la chronologie — et donc le contexte de l'action. */
export type TimelineKind =
  | "note"
  | "note_interne"
  | "appel_sans_reponse"
  | "email_sortant"
  | "email_entrant"
  | "rendez_vous";

export type LastEvent = { kind: TimelineKind; at: string } | null;

export type OpenTask = {
  id: string;
  title: string;
  due_at: string;
  priority: number;
  prospect_id: string | null;
};

/** Le prochain rendez-vous de l'agenda (meetings), s'il y en a un. */
export type NextMeeting = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
};

export type NextAction = {
  /** La relance ouverte la plus proche — ce qu'il y a concrètement à faire. */
  task: OpenTask | null;
  /** Le rendez-vous d'agenda affiché à la place d'une relance, le cas échéant. */
  meeting: NextMeeting | null;
  /** Où on en est : « En attente de réponse de Sébastien ». */
  context: string;
  /** Quand : « relance prévue le 11 août » / « RDV le 28/09 à 12h ». */
  when: string | null;
  overdue: boolean;
  /** La prochaine action est un rendez-vous, pas une simple relance. */
  isMeeting: boolean;
  /** Le rendez-vous est passé et attend son débrief — jamais « en retard ». */
  aDebriefer: boolean;
};

/** Le prénom, pour une phrase qui sonne juste. */
function firstName(contact?: string | null): string | null {
  const t = contact?.trim();
  if (!t) return null;
  return t.split(/\s+/)[0];
}

/**
 * Où en est-on ? Lu du dernier événement réel du journal — jamais du texte
 * des notes, seulement de leur nature et de leur date.
 */
function describeContext(last: LastEvent, contact: string | null): string {
  const who = firstName(contact);

  if (!last) {
    return "Aucun échange enregistré pour l'instant.";
  }

  switch (last.kind) {
    case "email_sortant":
      return who
        ? `En attente de réponse de ${who} — email envoyé le ${fmtDate(last.at)}.`
        : `En attente de réponse — email envoyé le ${fmtDate(last.at)}.`;
    case "email_entrant":
      return who
        ? `${who} a répondu le ${fmtDate(last.at)}.`
        : `Réponse reçue le ${fmtDate(last.at)}.`;
    case "rendez_vous":
      return `Rendez-vous enregistré le ${fmtDate(last.at)}.`;
    case "note":
      return who
        ? `Dernier échange avec ${who} le ${fmtDate(last.at)}.`
        : `Dernier échange noté le ${fmtDate(last.at)}.`;
    case "note_interne":
      return `Note de repérage du ${fmtDate(last.at)} — aucun échange encore eu.`;
    case "appel_sans_reponse":
      return `Appelé le ${fmtDate(last.at)} — pas de réponse.`;
  }
}

/**
 * Assemble le bloc « Prochaine action » — la même règle que
 * `prochaine_action_de` (migrations 022 à 024), lue sur les lignes déjà
 * chargées.
 *
 * `openTasks` : les relances ouvertes, triées par échéance croissante. `meeting` : le
 * rendez-vous qui compte (`rdvQuiCompte`, étape de la fiche comprise). S'il y
 * en a un, c'est LUI la prochaine action, TOUJOURS (024) — à venir, il se dit ;
 * passé, il attend son débrief, jamais « en retard de relance ». Une relance
 * datée avant lui reste une tâche (« À appeler » le jour venu) mais ne le
 * remplace jamais ici.
 */
export function deriveNextAction(
  openTasks: OpenTask[],
  lastEvent: LastEvent,
  contactName: string | null,
  meeting: NextMeeting | null = null,
  now: number = Date.now()
): NextAction {
  const task = openTasks[0] ?? null;
  const context = describeContext(lastEvent, contactName);

  if (meeting) {
    // « Passé » = a commencé, comme en SQL et dans la liste
    // (`lireProchaineAction`) : la carte et la liste disent la même chose
    // pendant le rendez-vous.
    const passe = new Date(meeting.starts_at).getTime() < now;
    return {
      task: null,
      meeting,
      context,
      when: passe
        ? `à débriefer — ${libelleRdv(meeting.starts_at)}`
        : libelleRdv(meeting.starts_at),
      overdue: false,
      isMeeting: true,
      aDebriefer: passe,
    };
  }

  if (!task) {
    return {
      task: null,
      meeting: null,
      context,
      when: null,
      overdue: false,
      isMeeting: false,
      aDebriefer: false,
    };
  }

  const overdue = new Date(task.due_at).getTime() < now;

  return {
    task,
    meeting: null,
    context,
    when: `relance prévue le ${fmtDate(task.due_at)}`,
    overdue,
    isMeeting: false,
    aDebriefer: false,
  };
}
