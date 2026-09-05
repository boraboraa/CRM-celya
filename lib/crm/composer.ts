/**
 * Ouvrir le composeur email depuis n'importe où sur la fiche.
 *
 * Le composeur vit dans `ProspectJournal` (bloc « Agir »), mais les gestes qui
 * décident d'écrire sont ailleurs : la carte PROCHAINE ACTION, l'espace
 * Brouillons de la colonne latérale, demain autre chose. Plutôt que de faire
 * remonter un état à travers la page (server component au milieu), ces
 * composants clients se parlent par un événement de fenêtre : celui qui veut
 * écrire appelle `openComposer()`, le journal l'entend, bascule sur l'onglet
 * Email, pré-remplit et fait défiler jusque-là.
 *
 * Un seul geste passe par ici : écrire. L'onglet « Note » ne s'ouvre plus à
 * distance — le résultat d'appel, l'étape et la date de relance ont chacun
 * leur surface propre sur la fiche, et plus rien n'a besoin d'y renvoyer.
 *
 * Module NEUTRE (pas de « use client ») : il ne touche à `window` que dans le
 * corps des fonctions, et ne doit jamais être importé par un composant serveur
 * — voir le piège « frontière client/serveur » dans CLAUDE.md.
 */

export type ComposerPrefill = {
  to?: string | null;
  subject?: string | null;
  body?: string | null;
};

/**
 * Les deux onglets du bloc « Agir » de la fiche : « Note » et « Email ».
 * Les valeurs restent celles d'origine — les liens venus d'autres écrans et
 * la prop `initialTab` de la page en dépendent ; seuls les libellés ont changé.
 */
export type JournalTab = "consigner" | "email";

export type JournalOpen = ComposerPrefill & { onglet: JournalTab };

/** Événement de fenêtre écouté par ProspectJournal. */
export const COMPOSER_EVENT = "celya:agir";

/** Ancre du composeur — les liens venus d'un autre écran pointent dessus. */
export const COMPOSER_ANCHOR = "ecrire-un-email";

/** Lien vers la fiche, composeur ouvert (depuis la liste, À faire, etc.). */
export function composerHref(prospectId: string, replyToEmailId?: string): string {
  const qs = replyToEmailId ? `?repondre=${encodeURIComponent(replyToEmailId)}` : "";
  return `/prospects/${prospectId}${qs}#${COMPOSER_ANCHOR}`;
}

function dispatch(detail: JournalOpen): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<JournalOpen>(COMPOSER_EVENT, { detail }));
}

/**
 * Déplie le composeur email et le pré-remplit. Sans argument : composeur vide.
 * Sans effet côté serveur (rendu initial), par construction.
 */
export function openComposer(prefill: ComposerPrefill = {}): void {
  dispatch({ ...prefill, onglet: "email" });
}
