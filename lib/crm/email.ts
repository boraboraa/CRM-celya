/**
 * Ce qu'un email sortant doit respecter, écrit une seule fois — module neutre,
 * partagé par le composeur (client), les server actions et le connecteur MCP.
 *
 * Les gabarits du composeur laissent volontairement un trou « [À compléter] »
 * là où Bora doit écrire. Envoyer ce trou tel quel, c'est envoyer un message
 * honteux à un prospect : le garde-fou est donc posé aux trois endroits d'où
 * un mail peut partir, pas seulement dans le formulaire.
 */

/** Le trou laissé par les gabarits. */
export const PLACEHOLDER = "[À compléter]";

export const PLACEHOLDER_ERROR =
  "Le message contient encore « [À compléter] » — complétez-le avant l'envoi.";

export function hasPlaceholder(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.toLowerCase().includes(PLACEHOLDER.toLowerCase());
}

/** Mêmes bornes que l'edge function crm-mail (qui tronque à l'arrivée). */
export const MAX_SUBJECT = 300;
export const MAX_BODY = 20000;

/** Validation d'adresse : la même que celle de l'edge function. */
export function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/** Objet d'une réponse, sans empiler les « Re: ». */
export function replySubject(subject: string | null | undefined): string {
  const clean = (subject ?? "").trim();
  if (!clean) return "Re:";
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}
