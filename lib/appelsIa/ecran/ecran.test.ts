/**
 * L'écran « Appels IA » — ce qui se dit avant le clic, sans réseau ni base :
 *
 *   node --experimental-strip-types lib/appelsIa/ecran/ecran.test.ts
 *
 * (script npm : `npm run test:appels-ecran`).
 *
 * La phrase « ce qui manque » est jouée sur les 32 combinaisons des cinq
 * éléments de la mise en route : elle doit TOUT nommer, jamais seulement le
 * premier — et, sur les mêmes 32 (× test réussi ou non), la connexion,
 * l'onglet d'ouverture, l'état des onglets et le refus de lancer
 * (`miseEnRoute.ts`). La marche à suivre après un échec est lue sur les phrases que
 * produit `causeDe` lui-même (lib/appelsIa/causes.ts) — si une phrase change
 * là-bas, le test le voit ici.
 */

import {
  CONFIRMATION_REEL,
  ELEMENTS_MISE_EN_ROUTE,
  compterSelection,
  dureeLisible,
  estimationJours,
  phraseBandeau,
  phraseConfirmationLancement,
  phraseEstimation,
  phraseSelection,
  type FaitsBandeau,
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
  LIGNE_CONNEXION,
  REFUS_REEL_SANS_TEST,
  connexionComplete,
  etatsOnglets,
  lireOnglet,
  numerosProposes,
  ongletParDefaut,
  refusLancement,
  secretsManquants,
} from "./index.ts";
import { causeDe } from "../causes.ts";
import type { ReglagesMoteur } from "../regles.ts";
import { verifie, vrai, bilan } from "../verifie.ts";

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
    vrai(
      `combinaison ${masque} : le bouton de test refuse en nommant le même manque`,
      (refusAppelTest({ ...faits, appelEnCours: false }) ?? "").startsWith(phrase!),
      refusAppelTest({ ...faits, appelEnCours: false })
    );
  }

  // La connexion : les trois secrets, et eux seuls.
  const secretsAbsents = attendus.filter((e) => e !== "numero_appelant" && e !== "gsm_test");
  verifie(`combinaison ${masque} : secrets manquants`, secretsManquants(faits), secretsAbsents);
  verifie(`combinaison ${masque} : connexion complète ⇔ trois secrets posés`, connexionComplete(faits), secretsAbsents.length === 0);
  vrai(
    `combinaison ${masque} : le test renvoie vers Connexion ⇔ un secret manque`,
    (refusAppelTest({ ...faits, appelEnCours: false }) ?? "").includes("Réglages avancés → Connexion") === secretsAbsents.length > 0
  );

  // L'onglet d'ouverture : « Campagnes » dès que le numéro appelant est réglé
  // — secrets posés ou non.
  verifie(`combinaison ${masque} : onglet d'ouverture`, ongletParDefaut(faits), regle(0) ? "campagnes" : "numero-test");

  for (const reussi of [false, true]) {
    const refus = refusLancement({ ...faits, testReussi: reussi });
    const bloque = !regle(0) || secretsAbsents.length > 0 || !reussi;
    verifie(`combinaison ${masque}, test ${reussi ? "réussi" : "à faire"} : Lancer bloqué`, refus !== null, bloque);
    if (refus) {
      vrai(`combinaison ${masque}, test ${reussi} : le refus dit le numéro`, refus.includes("numéro appelant") === !regle(0), refus);
      vrai(
        `combinaison ${masque}, test ${reussi} : le refus nomme chaque secret absent`,
        secretsAbsents.every((e) => refus.includes(NOM_ELEMENT[e])) && (secretsAbsents.length > 0) === refus.includes("connexion technique"),
        refus
      );
      vrai(`combinaison ${masque}, test ${reussi} : le refus dit le test`, refus.includes("appel de test réussi") === !reussi, refus);
    }
    // L'onglet « Numéro & test » : les deux numéros et un test réussi — la connexion n'y compte pas.
    const e = etatsOnglets({ ...faits, testReussi: reussi, campagnesActives: 0, appelEnCours: false, appelesAujourdhui: 0 });
    verifie(
      `combinaison ${masque}, test ${reussi} : onglet Numéro & test`,
      e["numero-test"].ton,
      regle(0) && regle(1) && reussi ? "fait" : "a_faire"
    );
  }
}

// ---------------------------------------------------------------- les onglets
verifie("onglets : libellé du premier", etatsOnglets({ numeroAppelant: null, gsmTest: null, testReussi: false, campagnesActives: 0, appelEnCours: false, appelesAujourdhui: 0 })["numero-test"], { ton: "a_faire", texte: "numéro à régler" });
verifie("onglets : GSM à régler", etatsOnglets({ numeroAppelant: "x", gsmTest: null, testReussi: false, campagnesActives: 0, appelEnCours: false, appelesAujourdhui: 0 })["numero-test"].texte, "GSM à régler");
verifie("onglets : test à faire", etatsOnglets({ numeroAppelant: "x", gsmTest: "y", testReussi: false, campagnesActives: 0, appelEnCours: false, appelesAujourdhui: 0 })["numero-test"].texte, "test à faire");
verifie("onglets : campagnes actives", etatsOnglets({ numeroAppelant: "x", gsmTest: "y", testReussi: true, campagnesActives: 2, appelEnCours: false, appelesAujourdhui: 0 }).campagnes, { ton: "info", texte: "2 actives" });
verifie("onglets : aucune campagne active", etatsOnglets({ numeroAppelant: "x", gsmTest: "y", testReussi: true, campagnesActives: 0, appelEnCours: false, appelesAujourdhui: 0 }).campagnes.ton, "a_faire");
verifie("onglets : suivi en direct", etatsOnglets({ numeroAppelant: "x", gsmTest: "y", testReussi: true, campagnesActives: 0, appelEnCours: true, appelesAujourdhui: 3 }).suivi.texte, "en direct");
verifie("onglets : suivi du jour", etatsOnglets({ numeroAppelant: "x", gsmTest: "y", testReussi: true, campagnesActives: 0, appelEnCours: false, appelesAujourdhui: 3 }).suivi.texte, "3 aujourd'hui");
verifie("lireOnglet : connu", lireOnglet("suivi", "campagnes"), "suivi");
verifie("lireOnglet : l'ancien nom retombe sur le défaut", lireOnglet("mise-en-route", "campagnes"), "campagnes");
verifie("lireOnglet : absent", lireOnglet(undefined, "numero-test"), "numero-test");
vrai("la ligne de connexion dit « une seule fois »", LIGNE_CONNEXION.includes("une seule fois"));
vrai("le refus du réel renvoie vers « Numéro & test »", REFUS_REEL_SANS_TEST.includes("Numéro & test"));
verifie(
  "refus de lancer, exact : rien n'est prêt",
  refusLancement({ numeroAppelant: null, gsmTest: null, secretsPoses: [], testReussi: false }),
  "Le numéro appelant n'est pas réglé (onglet « Numéro & test »). La connexion technique n'est pas finalisée : il manque la clé OpenAI, l'identifiant SIP et le mot de passe SIP (Réglages avancés → Connexion, une seule fois). Faites d'abord un appel de test réussi vers votre GSM (onglet « Numéro & test »)."
);

// ---------------------------------------------------------------- les numéros proposés
verifie(
  "numéros proposés : réglé d'abord, sans doublon, lisibles",
  numerosProposes({ actuel: "+32480245368", profil: "0480 24 53 68", gsm: "+32470572864" }),
  [
    { e164: "+32480245368", lisible: "0480 24 53 68", source: "réglé" },
    { e164: "+32470572864", lisible: "0470 57 28 64", source: "votre GSM de test" },
  ]
);
verifie(
  "numéros proposés : le numéro du compte quand rien n'est réglé",
  numerosProposes({ actuel: null, profil: "081 22 33 44", gsm: null }).map((n) => [n.e164, n.source]),
  [["+3281223344", "votre compte"]]
);
verifie("numéros proposés : un numéro surtaxé n'est jamais proposé", numerosProposes({ actuel: null, profil: "0903 12 34 56", gsm: null }), []);
verifie("numéros proposés : rien de connu", numerosProposes({ actuel: null, profil: null, gsm: null }), []);

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
verifie(
  "test sans connexion : le manque, puis où la poser",
  refusAppelTest({ numeroAppelant: "x", gsmTest: "y", secretsPoses: ["openai_api_key"], appelEnCours: false }),
  "Il manque l'identifiant SIP et le mot de passe SIP. La connexion se pose une seule fois, dans Réglages avancés → Connexion."
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

// ---------------------------------------------------------------- durée
verifie("durée : secondes", dureeLisible(45), "45 s");
verifie("durée : minutes rondes", dureeLisible(120), "2 min");
verifie("durée : minutes et secondes", dureeLisible(134), "2 min 14 s");
verifie("durée : absente", dureeLisible(null), null);

// ---------------------------------------------------------------- la sélection de l'assistant
const fiches = [
  { id: "a", societe: "Garage A", refus: null },
  { id: "b", societe: "Garage B", refus: "Pas de numéro belge appelable sur la fiche." },
  { id: "c", societe: "Garage C", refus: "Pas de numéro belge appelable sur la fiche." },
  { id: "d", societe: "Garage D", refus: "Ce numéro est sur la liste d'opposition." },
  { id: "e", societe: "Garage E", refus: null },
  { id: "f", societe: "Garage F", refus: undefined as unknown as null },
];
const tout = compterSelection(fiches, new Set(["a", "b", "c", "d", "e"]));
verifie("sélection : les appelables", tout.appelables, ["a", "e"]);
verifie("sélection : les écartées, avec leur raison", tout.ecartees.map((e) => e.id), ["b", "c", "d"]);
verifie("sélection : raisons, la plus fréquente d'abord", tout.parRaison, [
  { raison: "Pas de numéro belge appelable sur la fiche.", nombre: 2 },
  { raison: "Ce numéro est sur la liste d'opposition.", nombre: 1 },
]);
verifie("sélection : phrase", phraseSelection(tout), "2 fiches peuvent être appelées, 3 écartées.");
verifie("sélection : une fiche non cochée ne compte pas", compterSelection(fiches, new Set(["a"])).ecartees, []);
verifie("sélection : phrase, une seule", phraseSelection(compterSelection(fiches, new Set(["a"]))), "1 fiche peut être appelée.");
verifie("sélection : phrase, aucune", phraseSelection(compterSelection(fiches, new Set(["b"]))), "Aucune fiche ne peut être appelée, 1 écartée.");
verifie(
  "sélection : raison inconnue → écartée, jamais appelée par défaut",
  compterSelection(fiches, new Set(["f"])),
  { appelables: [], ecartees: [{ id: "f", societe: "Garage F", raison: "Vérification impossible." }], parRaison: [{ raison: "Vérification impossible.", nombre: 1 }] }
);

// ---------------------------------------------------------------- l'estimation
const regl = { plafond_jour: 40, plafond_heure: 8, fenetre_debut: "09:30:00", fenetre_fin: "17:30:00" };
verifie("estimation : 8 h × 8/h = 64 > 40 → 40 par jour", estimationJours(23, regl), { parJour: 40, jours: 1 });
verifie("estimation : 81 fiches → 3 jours", estimationJours(81, regl).jours, 3);
verifie("estimation : plafond horaire limitant (2 h × 8)", estimationJours(20, { ...regl, fenetre_fin: "11:30" }), { parJour: 16, jours: 2 });
verifie("estimation : rien", estimationJours(0, regl), { parJour: 40, jours: 0 });
verifie(
  "estimation : phrase",
  phraseEstimation(23, estimationJours(23, regl)),
  "Environ 1 jour ouvré pour un premier appel à chaque fiche, à 40 appels par jour au plus — jusqu'à 3 essais par fiche."
);

// ---------------------------------------------------------------- la confirmation de lancement
const mardiSoir = new Date("2026-10-20T18:00:00Z"); // 20h à Bruxelles
const mardiMatin = new Date("2026-10-20T08:00:00Z"); // 10h
const conf = { fenetre_debut: "09:30", fenetre_fin: "17:30", plafond_heure: 8, mode_test: false };
verifie(
  "confirmation : hors fenêtre",
  phraseConfirmationLancement(conf, mardiSoir),
  "Janet va commencer à appeler les fiches dès 9h30 en semaine, 8 appels par heure au plus. Lancer ?"
);
verifie(
  "confirmation : dans la fenêtre",
  phraseConfirmationLancement(conf, mardiMatin),
  "Janet va commencer à appeler les fiches dès maintenant (jusqu'à 17h30), 8 appels par heure au plus. Lancer ?"
);
vrai("confirmation : en mode test, c'est le GSM", phraseConfirmationLancement({ ...conf, mode_test: true }, mardiSoir).includes("VOTRE GSM"));
vrai("confirmation réelle : annonce IA et opposition", /IA/.test(CONFIRMATION_REEL) && /opposition/.test(CONFIRMATION_REEL));

// ---------------------------------------------------------------- le bandeau d'état
const reglesOk: ReglagesMoteur = {
  actif: true,
  mode_test: false,
  gsm_test: "+32470572864",
  numero_appelant: "+32480245368",
  fenetre_debut: "09:30:00",
  fenetre_fin: "17:30:00",
  plafond_heure: 8,
  plafond_jour: 40,
  pause_cause: null,
};
const fb = (p: Partial<FaitsBandeau> & { r?: Partial<ReglagesMoteur> } = {}): FaitsBandeau => ({
  reglages: { ...reglesOk, ...(p.r ?? {}) },
  maintenant: p.maintenant ?? mardiMatin,
  compteur: p.compteur ?? { aujourdhui: 0, derniereHeure: 0 },
  enCours: p.enCours ?? null,
  fileComposable: p.fileComposable ?? 12,
  fileAutreMode: p.fileAutreMode ?? 0,
  fileEnPause: p.fileEnPause ?? 0,
});
verifie(
  "bandeau : appel en cours, 2e essai",
  phraseBandeau(fb({ enCours: { societe: "Garage X", prospect_id: "p", essai: 2, mode_test: false } })),
  { ton: "marche", texte: "Janet appelle en ce moment : Garage X (2e essai)." }
);
verifie(
  "bandeau : appel en cours, 1er essai (pas d'ordinal)",
  phraseBandeau(fb({ enCours: { societe: "Garage X", prospect_id: "p", essai: 1, mode_test: false } })).texte,
  "Janet appelle en ce moment : Garage X."
);
verifie(
  "bandeau : appel de test",
  phraseBandeau(fb({ r: { actif: false }, enCours: { societe: "Appel de test", prospect_id: null, essai: 1, mode_test: true } })).texte,
  "Janet appelle en ce moment : Appel de test."
);
verifie("bandeau : actif, dans la fenêtre", phraseBandeau(fb()), { ton: "marche", texte: "En marche : 12 fiches à appeler, une à la fois." });
verifie("bandeau : coupé", phraseBandeau(fb({ r: { actif: false } })), { ton: "arret", texte: "À l'arrêt : interrupteur coupé." });
verifie(
  "bandeau : pause du moteur",
  phraseBandeau(fb({ r: { pause_cause: "OpenAI refuse la clé API (401)." } })),
  { ton: "pause", texte: "En pause : OpenAI refuse la clé API (401)." }
);
verifie(
  "bandeau : hors fenêtre, mardi soir → mercredi matin",
  phraseBandeau(fb({ maintenant: mardiSoir })),
  { ton: "pause", texte: "En pause : hors fenêtre, reprise mercredi 21 octobre à 9h30." }
);
verifie(
  "bandeau : vendredi soir → lundi",
  phraseBandeau(fb({ maintenant: new Date("2026-10-23T17:00:00Z") })).texte,
  "En pause : hors fenêtre, reprise lundi 26 octobre à 9h30."
);
verifie(
  "bandeau : jour férié (Armistice, mercredi 11/11)",
  phraseBandeau(fb({ maintenant: new Date("2026-11-11T10:00:00Z") })),
  { ton: "pause", texte: "En pause : jour férié (Armistice), reprise jeudi 12 novembre à 9h30." }
);
verifie(
  "bandeau : plafond du jour atteint",
  phraseBandeau(fb({ compteur: { aujourdhui: 40, derniereHeure: 3 } })),
  { ton: "pause", texte: "En pause : plafond du jour atteint (40 appels), reprise mercredi 21 octobre à 9h30." }
);
verifie(
  "bandeau : plafond de l'heure atteint",
  phraseBandeau(fb({ compteur: { aujourdhui: 12, derniereHeure: 8 } })).texte,
  "En pause : plafond de l'heure atteint (8 appels), reprise dans moins d'une heure."
);
verifie(
  "bandeau : numéro appelant manquant passe avant la fenêtre",
  phraseBandeau(fb({ maintenant: mardiSoir, r: { numero_appelant: null } })).texte,
  "À l'arrêt : Le numéro appelant n'est pas réglé : le moteur refuse de composer."
);
verifie(
  "bandeau : file vide",
  phraseBandeau(fb({ fileComposable: 0 })),
  { ton: "arret", texte: "Rien à appeler : lancez une campagne." }
);
verifie(
  "bandeau : file dans l'autre mode",
  phraseBandeau(fb({ fileComposable: 0, fileAutreMode: 5 })).texte,
  "Rien à appeler : 5 fiches attendent dans la file en mode test, que le mode actuel ne prend pas."
);
verifie(
  "bandeau : campagne en pause",
  phraseBandeau(fb({ fileComposable: 0, fileEnPause: 1 })).texte,
  "Rien à appeler : 1 fiche attend dans une campagne en pause."
);

bilan("Écran Appels IA");
