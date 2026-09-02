/**
 * Les CAUSES d'échec de l'assistant, et leur traduction en clair.
 *
 * Module NEUTRE (ni "use client", ni serveur) : il ne touche à aucune clé et
 * ne fait aucun appel — il ne fait que nommer. Il est donc importable par la
 * server action de diagnostic comme par le composant qui l'affiche.
 *
 * Une cause est une chaîne stable, écrite telle quelle dans les logs serveur
 * par `echecIA` (lib/ai/provider.ts) : c'est la même valeur que Bora lit à
 * l'écran et que l'on cherche dans les journaux Vercel.
 */

/**
 * Causes fixes. Les causes paramétrées (`http_<code>`, `base_resp_<code>`) se
 * construisent à l'appel — leur préfixe seul est stable.
 */
export const CAUSE_CONFIG_ABSENTE = "config_absente";
export const CAUSE_REPONSE_VIDE = "reponse_vide";
export const CAUSE_TIMEOUT = "timeout";
export const CAUSE_JSON_INVALIDE = "json_invalide";
export const CAUSE_RESEAU = "reseau";
export const CAUSE_REFUS_MODELE = "refus_modele";

/** Les codes MiniMax rencontrés — l'erreur arrive dans un HTTP 200. */
const BASE_RESP: Record<string, string> = {
  "1002": "Limite de débit atteinte, réessayez.",
  "1004": "Clé d'API refusée par MiniMax.",
  "1008": "Solde MiniMax épuisé — rechargez le compte.",
  "1013": "Paramètre refusé par MiniMax (modèle inconnu ?).",
  "2013": "Requête invalide pour MiniMax.",
};

/** Les codes HTTP qui ont une explication utile plutôt qu'un numéro. */
const HTTP: Record<string, string> = {
  "401": "Clé d'API refusée (401).",
  "403": "Accès refusé par le fournisseur (403).",
  "404":
    "Introuvable (404) — MINIMAX_BASE_URL doit valoir https://api.minimax.io/v1 : le code ajoute lui-même /chat/completions.",
  "429": "Limite de débit atteinte (429), réessayez.",
  "500": "Panne du fournisseur (500).",
  "502": "Panne du fournisseur (502).",
  "503": "Fournisseur indisponible (503).",
};

/**
 * La cause, en français, pour l'écran de diagnostic. `detail` sert seulement
 * aux causes qui n'ont pas d'explication toute faite (variables manquantes,
 * message brut du fournisseur) — jamais une clé, jamais un en-tête.
 */
export function messagePourCause(cause: string, detail?: string | null): string {
  if (cause === "ok") return "L'assistant répond normalement.";

  if (cause === CAUSE_CONFIG_ABSENTE) {
    return detail
      ? `Variables manquantes sur l'hébergeur : ${detail}.`
      : "Le fournisseur IA n'est pas configuré sur l'hébergeur.";
  }
  if (cause === CAUSE_TIMEOUT) {
    return "Le fournisseur n'a pas répondu en 30 s.";
  }
  if (cause === CAUSE_RESEAU) {
    return `Impossible de joindre le fournisseur${detail ? ` — ${detail}` : ""}.`;
  }
  if (cause === CAUSE_REPONSE_VIDE) {
    return "Le fournisseur a répondu, mais sans contenu exploitable.";
  }
  if (cause === CAUSE_JSON_INVALIDE) {
    return "Le fournisseur a répondu hors format (pas de JSON exploitable).";
  }
  if (cause === CAUSE_REFUS_MODELE) {
    return "Le modèle a décliné la demande.";
  }

  const baseResp = cause.startsWith("base_resp_") ? cause.slice(10) : null;
  if (baseResp) {
    return (
      BASE_RESP[baseResp] ??
      `MiniMax a refusé la requête (code ${baseResp}${detail ? ` : ${detail}` : ""}).`
    );
  }

  const http = cause.startsWith("http_") ? cause.slice(5) : null;
  if (http) {
    return HTTP[http] ?? `Le fournisseur a répondu ${http}${detail ? ` : ${detail}` : ""}.`;
  }

  return `Échec de l'assistant (${cause})${detail ? ` : ${detail}` : ""}.`;
}
