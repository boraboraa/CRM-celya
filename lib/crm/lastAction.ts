/**
 * « Dernière action » — canal + résultat + date, par prospect.
 *
 * Ce que Bora doit lire sur chaque carte sans ouvrir la fiche : quelle a été
 * la dernière action, et par quel canal — « Mail envoyé, il y a 2 j »,
 * « Appelé, pas de réponse, il y a 3 j », « RDV, il y a 1 j ». Dérivée du
 * dernier événement réel du journal (activités hors brouillon + emails), en
 * SQL, par la vue `prospect_action_state` (migration 012) — jamais du texte
 * des notes, seulement leur nature, leur résultat et leur date.
 *
 * Module NEUTRE (ni "use client", ni code serveur) : importable par les pages
 * serveur comme par les composants client (liste, pipeline, dashboard).
 */

/** Ce que la vue sait dire du dernier événement d'une fiche. */
export type LastActionKind =
  | "email_sortant"
  | "email_entrant"
  | "appel_sans_reponse"
  | "echange"
  | "rendez_vous"
  | "note_interne";

/** Une ligne de la vue `prospect_action_state`. */
export type LastActionRow = {
  prospect_id: string;
  last_kind: LastActionKind | null;
  last_at: string | null;
  last_email_sent_at: string | null;
  last_reply_at: string | null;
};

/** Les colonnes à sélectionner — un seul endroit, pas de dérive. */
export const LAST_ACTION_SELECT =
  "prospect_id, last_kind, last_at, last_email_sent_at, last_reply_at";

/** Le pictogramme ne porte jamais seul : le libellé l'accompagne toujours. */
export const LAST_ACTION_ICON: Record<LastActionKind, string> = {
  email_sortant: "📧",
  email_entrant: "📬",
  appel_sans_reponse: "📞",
  echange: "📞",
  rendez_vous: "🤝",
  note_interne: "📝",
};

export const LAST_ACTION_LABEL: Record<LastActionKind, string> = {
  email_sortant: "Mail envoyé",
  email_entrant: "Réponse reçue",
  appel_sans_reponse: "Appelé, pas de réponse",
  echange: "Échange eu",
  rendez_vous: "RDV",
  note_interne: "Note de repérage",
};

/**
 * « En attente de réponse » : le dernier événement de la fiche est un mail
 * sortant — toute réponse (ou tout échange consigné depuis) serait plus
 * récente et changerait `last_kind`. C'est ce test, et lui seul, qui range
 * une fiche dans la zone calme du tableau « À faire ».
 */
export function isWaitingReply(
  row: Pick<LastActionRow, "last_kind"> | null | undefined
): boolean {
  return row?.last_kind === "email_sortant";
}

/** Indexe les lignes de la vue par prospect, pour les listes. */
export function mapLastActions(
  rows: LastActionRow[] | null | undefined
): Map<string, LastActionRow> {
  return new Map((rows ?? []).map((r) => [r.prospect_id, r]));
}
