/**
 * Les pannes du moteur, dites en français — pur, testé.
 *
 * Une panne de NOTRE côté n'est jamais comptée comme un essai sur le
 * prospect : la ligne repart en file, et l'écran dit la cause exacte. Celles
 * qui ne se répareront pas seules (clé refusée, SIP sortant non activé,
 * configuration refusée) mettent le moteur en PAUSE tout de suite ; les autres
 * à la deuxième d'affilée.
 */

import type { ErreurAppel } from "../../supabase/functions/_shared/appels/rapport.ts";
import { coteTransport } from "../../supabase/functions/_shared/appels/transport.ts";

export type Cause = {
  message: string;
  /** Met le moteur en pause dès la première occurrence. */
  pauseImmediate: boolean;
};

export function causeDe(e: ErreurAppel | null | undefined): Cause {
  if (!e) return { message: "Panne inconnue.", pauseImmediate: false };
  const code = (e.code ?? "").toLowerCase();
  const msg = (e.message ?? "").slice(0, 200);
  if (e.etape === "preparation") {
    return { message: msg || "Préparation de l'appel impossible.", pauseImmediate: /secret|clé|numéro appelant/i.test(msg) };
  }
  if (e.etape === "creation") {
    if (code === "outbound_sip_not_enabled") {
      return {
        message: "OpenAI refuse : l'appel SIP sortant n'est pas activé pour l'organisation (outbound_sip_not_enabled).",
        pauseImmediate: true,
      };
    }
    if (e.statut === 401) return { message: "OpenAI refuse la clé API (401). Reposez la clé dans l'écran Appels IA.", pauseImmediate: true };
    if (e.statut === 403) return { message: `OpenAI refuse l'accès (403${code ? ` ${code}` : ""}).`, pauseImmediate: true };
    if (e.statut === 400 || e.statut === 422) {
      return { message: `OpenAI refuse la configuration de l'appel (${e.statut}) : ${msg || "sans détail"}.`, pauseImmediate: true };
    }
    if (e.statut === 429) return { message: "OpenAI : limite de débit ou de crédit atteinte (429).", pauseImmediate: true };
    if (e.statut === 502) return { message: "OpenAI n'a pas pu joindre le trunk SIP (502) : vérifiez la connexion Telnyx.", pauseImmediate: false };
    if (e.statut === 504) return { message: "OpenAI : délai d'initialisation de l'appel dépassé (504).", pauseImmediate: false };
    if (!e.statut) return { message: `OpenAI injoignable : ${msg || "délai dépassé"}.`, pauseImmediate: false };
    return { message: `OpenAI a refusé l'appel (${e.statut}) : ${msg || "sans détail"}.`, pauseImmediate: false };
  }
  if (e.etape === "attache") {
    return { message: `La connexion annexe n'a pas pu s'ouvrir : ${msg || "sans détail"}. L'appel a été raccroché.`, pauseImmediate: false };
  }
  if (e.etape === "transport") {
    const detail = [e.code, msg].filter(Boolean).join(" — ");
    if (coteTransport(e) === "nous") {
      // Identifiants, numéro appelant, crédit : rien ne se réparera seul.
      return {
        message: `La ligne a refusé l'appel avant la sonnerie${detail ? ` (${detail})` : ""} : identifiants SIP, profil sortant, numéro appelant ou crédit Telnyx à vérifier.`,
        pauseImmediate: true,
      };
    }
    return {
      message: `L'appel n'a jamais sonné${detail ? ` (${detail})` : ""}, sans cause reconnue. Si d'autres appels passent, le numéro du prospect est en cause.`,
      pauseImmediate: false,
    };
  }
  return { message: `Fin d'appel illisible : ${msg || "l'annexe s'est arrêtée"}.`, pauseImmediate: false };
}
