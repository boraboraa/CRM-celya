/**
 * Le classement d'un appel — FR, NL, EN, durées, l'accueil seul, deux
 * répliques humaines, le « à » de JavaScript :
 *
 *   node --experimental-strip-types lib/appelsIa/classement.test.ts
 *
 * Le module testé est PARTAGÉ avec l'annexe (Deno) : c'est le même fichier.
 */

import {
  classerAppel,
  machineDansAccueil,
  indiceFaibleDansAccueil,
  normaliser,
  type FaitsAppel,
  type Tour,
} from "../../supabase/functions/_shared/appels/classement.ts";
import { coteTransport } from "../../supabase/functions/_shared/appels/transport.ts";
import { verifie, bilan } from "./verifie.ts";

const P = (texte: string): Tour => ({ qui: "prospect", texte });
const J = (texte: string): Tour => ({ qui: "janet", texte });

function f(p: Partial<FaitsAppel>): FaitsAppel {
  return {
    echecTransport: false,
    decroche: true,
    dureeEnLigneS: 30,
    tours: [],
    machineEnDirect: null,
    finAppelJanet: null,
    rdvPose: false,
    opposition: false,
    ...p,
  };
}
const c = (p: Partial<FaitsAppel>) => classerAppel(f(p)).classement;

// ---------------------------------------------------------------- l'accueil, motifs FORTS
const forts: [string, string | null][] = [
  ["Bonjour, vous êtes sur la messagerie de Garage Dupont, laissez un message après le bip.", "repondeur"],
  ["Laissez-nous votre message", "repondeur"],
  ["Après le signal sonore", "repondeur"],
  ["Vous êtes bien sur la boîte vocale de Marc", "repondeur"],
  ["Nos bureaux sont actuellement fermés", "repondeur"],
  ["Hello, please leave a message after the tone", "repondeur"],
  ["After the beep", "repondeur"],
  ["Spreek een bericht in na de piep", "repondeur"],
  ["U bent verbonden met de voicemail", "repondeur"],
  ["Pour le service après-vente, tapez 1", "standard_ivr"],
  ["Appuyez sur la touche étoile", "standard_ivr"],
  ["Druk op 1 voor de werkplaats", "standard_ivr"],
  ["Toets 2 voor de boekhouding", "standard_ivr"],
  ["Kies 3", "standard_ivr"],
  ["Press 1 for sales", "standard_ivr"],
  ["Cet appel est enregistré à des fins de qualité", "standard_ivr"],
  ["Tous nos conseillers sont occupés", "standard_ivr"],
  ["Serveur vocal du cabinet", "standard_ivr"],
  // Ce qui n'est PAS un motif fort.
  ["Garage Dupont, bonjour", null],
  ["Allô ?", null],
  ["Oui, c'est pour quoi ?", null],
  ["Ne quittez pas, je vous le passe", null],
  ["Merci de patienter, je regarde", null],
  ["Druk, druk, je suis débordé", null],
];
for (const [t, attendu] of forts) verifie(`accueil fort : « ${t} »`, machineDansAccueil(t), attendu);

// ---------------------------------------------------------------- le « à » de JavaScript
verifie("normaliser enlève les accents", normaliser("Bienvenue À l'Atelier"), "bienvenue a l'atelier");
verifie("« Bienvenue à … » est reconnu (le \\b après « à » ne matchait jamais)", indiceFaibleDansAccueil("Bienvenue à la clinique vétérinaire"), "standard_ivr");
verifie("« Vous êtes bien à … » est reconnu", indiceFaibleDansAccueil("Vous êtes bien à la carrosserie Martin"), "repondeur");
verifie("« Bienvenue chez … » : indice faible", indiceFaibleDansAccueil("Bienvenue chez Garage Dupont"), "standard_ivr");
verifie("« Merci de patienter » : indice faible seulement", indiceFaibleDansAccueil("Merci de patienter"), "standard_ivr");

// ---------------------------------------------------------------- le classement complet
verifie("pas décroché → sans réponse", c({ decroche: false, dureeEnLigneS: null }), "sans_reponse");
verifie("échec du transport après sonnerie → occupé / échec", c({ echecTransport: true, decroche: false }), "occupe_echec");
verifie("décroché, aucun mot, 5 s → sans réponse (moins de 8 s)", c({ dureeEnLigneS: 5 }), "sans_reponse");
verifie("décroché, aucun mot, 8 s → répondeur (8 s ou plus)", c({ dureeEnLigneS: 8 }), "repondeur");
verifie("décroché, aucun mot, 12 s → répondeur", c({ dureeEnLigneS: 12 }), "repondeur");
verifie(
  "humain : deux répliques avec échange",
  c({ tours: [P("Allô ?"), J("Bonjour, je suis Janet, une intelligence artificielle…"), P("Oui, c'est pour quoi ?")] }),
  "repondu_humain"
);
verifie("un seul « Allô ? » puis raccroché → répondeur (pas un humain)", c({ tours: [P("Allô ?"), J("Bonjour, je suis Janet…")] }), "repondeur");
verifie(
  "deux répliques SANS échange (une annonce coupée en deux) → pas humain",
  c({ tours: [P("Garage Dupont,"), P("nous sommes là du lundi au vendredi")] }),
  "repondeur"
);
verifie(
  "messagerie FR reconnue dans l'accueil",
  c({ tours: [P("Bonjour vous êtes sur la messagerie de Pierre"), P("laissez un message après le bip")] }),
  "repondeur"
);
verifie("messagerie NL", c({ tours: [P("Spreek een bericht in na de pieptoon")] }), "repondeur");
verifie("messagerie EN", c({ tours: [P("Please leave a message after the tone")] }), "repondeur");
verifie("menu FR", c({ tours: [P("Pour joindre l'atelier, tapez 1")] }), "standard_ivr");
verifie("menu NL", c({ tours: [P("Druk op 2 voor de receptie")] }), "standard_ivr");
verifie("menu EN", c({ tours: [P("Press 3 for accounts")] }), "standard_ivr");
verifie(
  "un humain qui dit PLUS LOIN « rappelez-moi plus tard » reste un humain (motifs dans l'accueil seulement)",
  c({
    tours: [
      P("Oui allô ?"),
      J("Bonjour, je suis Janet, une intelligence artificielle…"),
      P("Ah d'accord, écoutez je suis en plein travail"),
      J("Je comprends, quand puis-je vous rappeler ?"),
      P("Rappelez-moi plus tard, jeudi peut-être"),
    ],
  }),
  "repondu_humain"
);
verifie(
  "« vous êtes bien chez Dupont » dit par un HUMAIN qui répond ensuite → humain",
  c({ tours: [P("Oui vous êtes bien chez Dupont"), J("Bonjour, je suis Janet…"), P("Oui ?")] }),
  "repondu_humain"
);
verifie(
  "« vous êtes bien chez Dupont » sans échange → répondeur (indice faible)",
  c({ tours: [P("Vous êtes bien chez Dupont, nous sommes absents")] }),
  "repondeur"
);
verifie(
  "« ne quittez pas » puis un humain → humain (une secrétaire qui transfère)",
  c({ tours: [P("Garage Martin, bonjour"), J("Bonjour, je suis Janet…"), P("Ne quittez pas, je vous le passe"), P("Oui, Martin ?")] }),
  "repondu_humain"
);
verifie("machine reconnue en direct par l'annexe", c({ machineEnDirect: "repondeur", tours: [P("Bonjour")] }), "repondeur");
verifie("rendez-vous posé → humain, quoi que dise l'accueil", c({ rdvPose: true, tours: [P("Vous êtes bien chez Dupont")] }), "repondu_humain");
verifie("opposition → humain", c({ opposition: true, tours: [P("Ne m'appelez plus")] }), "repondu_humain");
verifie("fin_appel de Janet : répondeur, sans échange", c({ finAppelJanet: "repondeur", tours: [P("Bonjour")] }), "repondeur");
verifie("fin_appel de Janet : standard, sans échange", c({ finAppelJanet: "standard", tours: [P("Un instant")] }), "standard_ivr");
verifie(
  "fin_appel « répondeur » mais un vrai échange → l'échange gagne",
  c({ finAppelJanet: "repondeur", tours: [P("Allô ?"), J("Bonjour, je suis Janet…"), P("Oui ?")] }),
  "repondu_humain"
);

// À qui la faute, quand le transport échoue avant toute sonnerie.
const t = (code: string | null, message: string) => coteTransport({ code, message });
verifie("transport : 403 forbidden → nous", t(null, "SIP 403 Forbidden"), "nous");
verifie("transport : identifiants refusés → nous", t("auth_failed", "Authentication failed"), "nous");
verifie("transport : 407 proxy auth → nous", t(null, "407 Proxy Authentication Required"), "nous");
verifie("transport : numéro appelant refusé → nous", t("invalid_caller_id", "caller id rejected"), "nous");
verifie("transport : SIP sortant non activé → nous", t("outbound_sip_not_enabled", ""), "nous");
verifie("transport : crédit épuisé → nous", t(null, "Insufficient balance"), "nous");
verifie("transport : occupé → eux", t("busy", "User busy"), "eux");
verifie("transport : 486 → eux", t(null, "486 Busy Here"), "eux");
verifie("transport : numéro inexistant → eux", t("not_found", "Number not found"), "eux");
verifie("transport : non attribué → eux", t(null, "unallocated number"), "eux");
verifie("transport : refusé par l'appelé → eux", t("call_rejected", "Declined"), "eux");
verifie("transport : « forbidden » passe devant « rejected »", t("rejected", "403 Forbidden"), "nous");
verifie("transport : message inconnu → inconnu", t(null, "échec du transport"), "inconnu");
verifie("transport : rien → inconnu", coteTransport(null), "inconnu");
verifie("transport : « Service Unavailable » (480/503 chez eux) → eux", t(null, "Temporarily Unavailable"), "eux");

bilan("Classement");
