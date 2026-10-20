/**
 * L'écran « Appels IA » — ce qui se dit avant le clic, sans réseau ni base :
 *
 *   node --experimental-strip-types lib/appelsIa/ecran.test.ts
 *
 * (script npm : `npm run test:appels-ecran`).
 *
 * La phrase « ce qui manque » est jouée sur les 32 combinaisons des cinq
 * éléments de la mise en route : elle doit TOUT nommer, jamais seulement le
 * premier. La marche à suivre après un échec est lue sur les phrases que
 * produit `causeDe` lui-même (lib/appelsIa/causes.ts) — si une phrase change
 * là-bas, le test le voit ici.
 */

import {
  ELEMENTS_MISE_EN_ROUTE,
  NOM_ELEMENT,
  elementsManquants,
  enumerer,
  etapeSuivi,
  marcheASuivre,
  phraseManquants,
  refusAppelTest,
  repliques,
  testReussi,
  type ElementMiseEnRoute,
} from "./ecran.ts";
import { causeDe } from "./causes.ts";
import { verifie, vrai, bilan } from "./verifie.ts";

// ---------------------------------------------------------------- énumération
verifie("énumérer : rien", enumerer([]), "");
verifie("énumérer : un", enumerer(["a"]), "a");
verifie("énumérer : deux", enumerer(["a", "b"]), "a et b");
verifie("énumérer : trois", enumerer(["a", "b", "c"]), "a, b et c");

// ---------------------------------------------------------------- les 32 combinaisons
for (let masque = 0; masque < 32; masque++) {
  // bit i à 1 = l'élément i est réglé / posé
  const regle = (i: number) => (masque & (1 << i)) !== 0;
  const faits = {
    numeroAppelant: regle(0) ? "+32480245368" : null,
    gsmTest: regle(1) ? "+32470000000" : null,
    secretsPoses: ["openai_api_key", "sip_identifiant", "sip_mot_de_passe"].filter((_, j) => regle(j + 2)),
  };
  const attendus = ELEMENTS_MISE_EN_ROUTE.filter((_, i) => !regle(i));
  const obtenus = elementsManquants(faits);
  verifie(`combinaison ${masque.toString(2).padStart(5, "0")} : manquants`, obtenus, attendus);

  const phrase = phraseManquants(obtenus);
  if (attendus.length === 0) {
    verifie(`combinaison ${masque} : complète, aucune phrase`, phrase, null);
    verifie(`combinaison ${masque} : complète, test possible`, refusAppelTest({ ...faits, appelEnCours: false }), null);
  } else {
    vrai(
      `combinaison ${masque} : la phrase nomme les ${attendus.length} élément(s)`,
      attendus.every((e: ElementMiseEnRoute) => phrase!.includes(NOM_ELEMENT[e])),
      phrase
    );
    vrai(
      `combinaison ${masque} : la phrase ne nomme pas ce qui est réglé`,
      ELEMENTS_MISE_EN_ROUTE.filter((e) => !attendus.includes(e)).every((e) => !phrase!.includes(NOM_ELEMENT[e])),
      phrase
    );
    verifie(`combinaison ${masque} : le bouton refuse avec la même phrase`, refusAppelTest({ ...faits, appelEnCours: false }), phrase);
  }
}

// Les secrets sans le test du mode « numéro » : le mot de passe ne se confond pas avec l'identifiant.
verifie(
  "phrase exacte : trois secrets manquants",
  phraseManquants(elementsManquants({ numeroAppelant: "+32480245368", gsmTest: "+32470572864", secretsPoses: [] })),
  "Il manque la clé OpenAI, l'identifiant SIP et le mot de passe SIP."
);
verifie(
  "phrase exacte : un seul manquant",
  phraseManquants(["gsm_test"]),
  "Il manque le GSM de test."
);
verifie(
  "un secret inconnu posé ne compte pour rien",
  elementsManquants({ numeroAppelant: "x", gsmTest: "y", secretsPoses: ["secret_interne"] }),
  ["openai_api_key", "sip_identifiant", "sip_mot_de_passe"]
);
verifie(
  "appel en cours, tout réglé",
  refusAppelTest({ numeroAppelant: "x", gsmTest: "y", secretsPoses: ["openai_api_key", "sip_identifiant", "sip_mot_de_passe"], appelEnCours: true }),
  "Un appel est déjà en cours : attendez qu'il se termine."
);
verifie(
  "appel en cours ET un manquant : les deux sont dits",
  refusAppelTest({ numeroAppelant: null, gsmTest: "y", secretsPoses: ["openai_api_key", "sip_identifiant", "sip_mot_de_passe"], appelEnCours: true }),
  "Il manque le numéro appelant. Un appel est déjà en cours : attendez qu'il se termine."
);

// ---------------------------------------------------------------- l'appel de test réussi
const base = { mode_test: true, statut: "termine", decroche_at: "2026-10-20T08:00:00Z", erreur_cote: null, erreur_message: null };
vrai("test réussi : décroché, terminé, sans erreur", testReussi(base));
vrai("pas réussi : jamais décroché", !testReussi({ ...base, decroche_at: null }));
vrai("pas réussi : échec", !testReussi({ ...base, statut: "echec" }));
vrai("pas réussi : panne de notre côté", !testReussi({ ...base, erreur_cote: "nous" }));
vrai("pas réussi : fin illisible", !testReussi({ ...base, erreur_cote: "neutre" }));
vrai("pas réussi : encore en ligne", !testReussi({ ...base, statut: "en_ligne" }));
vrai("pas réussi : un appel réel ne prouve pas le test", !testReussi({ ...base, mode_test: false }));

// ---------------------------------------------------------------- le suivi en direct
verifie("réservé → compose", etapeSuivi("reserve"), { etape: "compose", fini: false, echec: false });
verifie("composition → compose", etapeSuivi("composition"), { etape: "compose", fini: false, echec: false });
verifie("sonnerie → sonne", etapeSuivi("sonnerie"), { etape: "sonne", fini: false, echec: false });
verifie("en ligne", etapeSuivi("en_ligne"), { etape: "en_ligne", fini: false, echec: false });
verifie("terminé", etapeSuivi("termine"), { etape: "termine", fini: true, echec: false });
verifie("échec", etapeSuivi("echec"), { etape: "termine", fini: true, echec: true });

verifie("transcription absente", repliques(null), []);
verifie("transcription hors format", repliques({ tours: [] }), []);
verifie(
  "transcription : rôles inconnus et répliques vides écartés",
  repliques([
    { qui: "janet", texte: " Bonjour, je suis Janet, une IA. " },
    { qui: "systeme", texte: "x" },
    { qui: "prospect", texte: "   " },
    { qui: "prospect", texte: "Allô ?" },
    null,
    { qui: "janet" },
  ]),
  [
    { qui: "janet", texte: "Bonjour, je suis Janet, une IA." },
    { qui: "prospect", texte: "Allô ?" },
  ]
);

// ---------------------------------------------------------------- la marche à suivre
// Les messages viennent de causeDe, exactement comme le moteur les écrit.
const sip = causeDe({ etape: "creation", statut: 403, code: "outbound_sip_not_enabled", message: "" } as never);
verifie("SIP sortant non activé (code)", marcheASuivre("outbound_sip_not_enabled", sip.message)?.titre, "Le SIP sortant n'est pas activé chez OpenAI");
verifie("SIP sortant non activé (message seul)", marcheASuivre(null, sip.message)?.titre, "Le SIP sortant n'est pas activé chez OpenAI");

const cle = causeDe({ etape: "creation", statut: 401, code: null, message: "Incorrect API key" } as never);
verifie("clé refusée", marcheASuivre("creation", cle.message)?.titre, "OpenAI refuse la clé");
vrai("clé refusée : dit où la reposer", marcheASuivre("creation", cle.message)!.etapes.some((e) => e.includes("« Clé OpenAI »")));

const credit = causeDe({ etape: "creation", statut: 429, code: null, message: "" } as never);
verifie("crédit OpenAI", marcheASuivre("creation", credit.message)?.titre, "OpenAI : crédit ou débit épuisé");

const acces = causeDe({ etape: "creation", statut: 403, code: "forbidden", message: "" } as never);
verifie("403 autre que le SIP", marcheASuivre("forbidden", acces.message)?.titre, "OpenAI refuse l'accès");

const ligne = causeDe({ etape: "transport", code: null, message: "SIP 403 Forbidden: authentication failed" } as never);
verifie("identifiants SIP refusés", marcheASuivre("transport", ligne.message)?.titre, "La ligne Telnyx a refusé l'appel");
vrai(
  "identifiants SIP : dit où les reposer",
  marcheASuivre("transport", ligne.message)!.etapes.some((e) => e.includes("« Identifiant SIP »") && e.includes("« Mot de passe SIP »"))
);

const trunk = causeDe({ etape: "creation", statut: 502, code: null, message: "" } as never);
verifie("trunk injoignable", marcheASuivre("creation", trunk.message)?.titre, "OpenAI n'a pas pu joindre le trunk");

verifie("panne sans conseil connu", marcheASuivre("fin_illisible", "Fin d'appel illisible : l'annexe s'est arrêtée."), null);
verifie("rien du tout", marcheASuivre(null, null), null);

bilan("Écran Appels IA");
