/**
 * À qui la faute, quand l'appel échoue AVANT toute sonnerie ?
 *
 * `transport.failed` ne porte aucun code SIP (doc OpenAI du 07/10) : seulement
 * un `error.code` et un `error.message` libres. Or la réponse change tout :
 *   · NOTRE côté (trunk refusé, identifiants, numéro appelant, crédit) : rien
 *     n'a atteint le prospect, l'essai ne compte pas, et deux pannes d'affilée
 *     mettent le moteur en pause ;
 *   · LEUR côté (numéro inexistant, occupé, refusé, injoignable) : c'est un
 *     essai, et un numéro mort ne doit pas mettre en pause toute la campagne ;
 *   · INCONNU : on ne devine pas. La première fois sur une fiche, c'est compté
 *     de notre côté (rien n'est brûlé) ; la seconde fois sur la même fiche, le
 *     numéro est déclaré injoignable et le cycle s'arrête — sans pause du
 *     moteur, puisque les autres fiches passent.
 *
 * Les motifs sont cherchés dans le code ET le message, en minuscules. Les
 * motifs « nous » passent DEVANT : « 403 forbidden » n'est jamais un occupé.
 */

export type CoteTransport = "nous" | "eux" | "inconnu";

const NOUS =
  /\b(auth\w*|unauthori[sz]ed|forbidden|credential\w*|password|digest|401|403|407|trunk|caller[ _-]?(id|number)|from[ _-]?number|payment|402|insufficient|balance|quota|rate[ _-]?limit|429|not[ _-]?enabled|outbound[ _-]?sip|tls|certificate|codec|488)\b/;

const EUX =
  /\b(busy|occup\w*|486|600|decline\w*|603|reject\w*|unavailable|480|not[ _-]?found|404|604|unallocated|invalid[ _-]?(number|destination)|no[ _-]?route|unreachable|no[ _-]?answer|408|cancel\w*|487|temporarily)\b/;

export function coteTransport(e: { code?: string | null; message?: string | null } | null | undefined): CoteTransport {
  if (!e) return "inconnu";
  // Les « _ » et « - » deviennent des espaces : `\b` tient « _ » pour une lettre,
  // et « outbound_sip_not_enabled » ne matcherait aucun mot.
  const texte = `${e.code ?? ""} ${e.message ?? ""}`.toLowerCase().replace(/[_-]+/g, " ");
  if (NOUS.test(texte)) return "nous";
  if (EUX.test(texte)) return "eux";
  return "inconnu";
}
