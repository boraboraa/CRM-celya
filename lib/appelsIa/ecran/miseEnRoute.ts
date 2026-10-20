/**
 * La mise en route de Janet, et ce qu'elle ouvre — pur, testé
 * (`npm run test:appels-ecran`), écrit UNE fois : la page (onglet par défaut),
 * les onglets (✓ / « à faire »), la ligne « Connexion technique à finaliser »,
 * l'appel de test, le bouton « Lancer » ET les actions serveur qui refusent
 * avec les mêmes phrases.
 *
 * Deux temps, parce que Bora est le seul utilisateur (décision du 20/10) :
 *
 *   · la CONNEXION (clé OpenAI, identifiant et mot de passe SIP) se pose UNE
 *     fois, dans « Réglages avancés → Connexion » ; tant qu'elle manque, une
 *     seule ligne discrète le dit, puis plus rien n'en parle ;
 *   · le QUOTIDIEN (onglet « Numéro & test ») : le numéro appelant, le GSM de
 *     test, l'appel de test.
 *
 * L'écran s'ouvre sur « Campagnes » dès que le numéro appelant est réglé ;
 * « Lancer » y reste bloqué tant que la connexion ou un test réussi manquent,
 * et dit pourquoi (`refusLancement`).
 *
 * Imports RELATIFS en `.ts` : le test l'exécute tel quel sous node.
 */

import { numeroAppelable, numeroLisible } from "../numeros.ts";

// ---------------------------------------------------------------------------
// Les éléments : deux numéros, trois secrets
// ---------------------------------------------------------------------------

/** Les trois secrets de Janet — la liste blanche de `appels_ia_poser_secret` (migration 025). */
export const SECRETS_JANET = ["openai_api_key", "sip_identifiant", "sip_mot_de_passe"] as const;
export type NomSecret = (typeof SECRETS_JANET)[number];

export const ELEMENTS_MISE_EN_ROUTE = ["numero_appelant", "gsm_test", ...SECRETS_JANET] as const;
export type ElementMiseEnRoute = (typeof ELEMENTS_MISE_EN_ROUTE)[number];

/** Le nom de chaque élément, avec son article : il entre tel quel dans une phrase. */
export const NOM_ELEMENT: Record<ElementMiseEnRoute, string> = {
  numero_appelant: "le numéro appelant",
  gsm_test: "le GSM de test",
  openai_api_key: "la clé OpenAI",
  sip_identifiant: "l'identifiant SIP",
  sip_mot_de_passe: "le mot de passe SIP",
};

/** Le libellé d'une ligne (numéro ou secret). */
export const LIBELLE_ELEMENT: Record<ElementMiseEnRoute, string> = {
  numero_appelant: "Numéro appelant",
  gsm_test: "GSM de test",
  openai_api_key: "Clé OpenAI",
  sip_identifiant: "Identifiant SIP",
  sip_mot_de_passe: "Mot de passe SIP",
};

export type FaitsMiseEnRoute = {
  numeroAppelant: string | null;
  gsmTest: string | null;
  /** Les secrets posés (`appels_ia_secrets_poses`) — jamais leur valeur. */
  secretsPoses: readonly string[];
};

/** Ce qui manque, dans l'ordre : les deux numéros, puis les trois secrets. */
export function elementsManquants(f: FaitsMiseEnRoute): ElementMiseEnRoute[] {
  const poses = new Set(f.secretsPoses);
  return ELEMENTS_MISE_EN_ROUTE.filter((e) => {
    if (e === "numero_appelant") return !f.numeroAppelant;
    if (e === "gsm_test") return !f.gsmTest;
    return !poses.has(e);
  });
}

/** Les secrets qui manquent encore — la connexion technique. */
export function secretsManquants(f: Pick<FaitsMiseEnRoute, "secretsPoses">): NomSecret[] {
  const poses = new Set(f.secretsPoses);
  return SECRETS_JANET.filter((s) => !poses.has(s));
}

/** La connexion technique est-elle posée ? (une fois pour toutes) */
export function connexionComplete(f: Pick<FaitsMiseEnRoute, "secretsPoses">): boolean {
  return secretsManquants(f).length === 0;
}

/** La seule ligne qui parle de la connexion, tant qu'elle manque. */
export const LIGNE_CONNEXION = "Connexion technique à finaliser (une seule fois)";

/** « a », « a et b », « a, b et c ». */
export function enumerer(mots: readonly string[]): string {
  if (mots.length <= 1) return mots[0] ?? "";
  return `${mots.slice(0, -1).join(", ")} et ${mots[mots.length - 1]}`;
}

/** « Il manque la clé OpenAI et le mot de passe SIP. » — TOUT ce qui manque, jamais seulement le premier. */
export function phraseManquants(m: readonly ElementMiseEnRoute[]): string | null {
  if (m.length === 0) return null;
  return `Il manque ${enumerer(m.map((e) => NOM_ELEMENT[e]))}.`;
}

/**
 * Pourquoi « Appeler mon GSM (test) » ne peut pas partir — ou null. Le test
 * compose pour de vrai : il lui faut les deux numéros ET la connexion. Tout ce
 * qui manque est nommé, puis un appel déjà en cours (un seul à la fois).
 */
export function refusAppelTest(f: FaitsMiseEnRoute & { appelEnCours: boolean }): string | null {
  const manquants = elementsManquants(f);
  const connexion = manquants.some((e) => (SECRETS_JANET as readonly string[]).includes(e));
  const phrases = [
    phraseManquants(manquants),
    connexion ? "La connexion se pose une seule fois, dans Réglages avancés → Connexion." : null,
    f.appelEnCours ? "Un appel est déjà en cours : attendez qu'il se termine." : null,
  ];
  const dit = phrases.filter((p): p is string => Boolean(p));
  return dit.length ? dit.join(" ") : null;
}

/** Un appel de test qui prouve que la chaîne marche : décroché, terminé, sans erreur. */
export function testReussi(a: {
  mode_test: boolean;
  statut: string;
  decroche_at: string | null;
  erreur_cote: string | null;
  erreur_message?: string | null;
}): boolean {
  return a.mode_test && a.statut === "termine" && Boolean(a.decroche_at) && !a.erreur_cote && !a.erreur_message;
}

/** Le refus de sortir du mode test, dit par l'écran ET par l'action serveur. */
export const REFUS_REEL_SANS_TEST =
  "Passer en appels réels n'est possible qu'après un appel de test décroché et terminé sans erreur (onglet « Numéro & test »).";

/**
 * Pourquoi « Lancer la campagne » est bloqué — ou null. TOUT est dit : le
 * numéro appelant, la connexion, l'appel de test réussi. L'écran grise le
 * bouton avec cette phrase ; `lancerCampagneAction` refuse avec la même.
 */
export function refusLancement(f: FaitsMiseEnRoute & { testReussi: boolean }): string | null {
  const phrases: string[] = [];
  if (!f.numeroAppelant) phrases.push("Le numéro appelant n'est pas réglé (onglet « Numéro & test »).");
  const secrets = secretsManquants(f);
  if (secrets.length) {
    phrases.push(
      `La connexion technique n'est pas finalisée : il manque ${enumerer(secrets.map((s) => NOM_ELEMENT[s]))} (Réglages avancés → Connexion, une seule fois).`
    );
  }
  if (!f.testReussi) phrases.push("Faites d'abord un appel de test réussi vers votre GSM (onglet « Numéro & test »).");
  return phrases.length ? phrases.join(" ") : null;
}

// ---------------------------------------------------------------------------
// Les onglets
// ---------------------------------------------------------------------------

export const ONGLETS = ["numero-test", "campagnes", "suivi"] as const;
export type Onglet = (typeof ONGLETS)[number];

export const LIBELLE_ONGLET: Record<Onglet, string> = {
  "numero-test": "Numéro & test",
  campagnes: "Campagnes",
  suivi: "Suivi",
};

export function lireOnglet(brut: string | string[] | undefined, parDefaut: Onglet): Onglet {
  const v = Array.isArray(brut) ? brut[0] : brut;
  return (ONGLETS as readonly string[]).includes(v ?? "") ? (v as Onglet) : parDefaut;
}

/** L'écran s'ouvre sur « Campagnes » dès que le numéro appelant est réglé. */
export function ongletParDefaut(f: Pick<FaitsMiseEnRoute, "numeroAppelant">): Onglet {
  return f.numeroAppelant ? "campagnes" : "numero-test";
}

/** `fait` : ✓ ; `a_faire` : ambre ; `info` : neutre (un mot, un compte). */
export type EtatOnglet = { ton: "fait" | "a_faire" | "info"; texte: string };

/**
 * L'état de chaque onglet. « Numéro & test » est fait quand les deux numéros
 * sont réglés et qu'un test a réussi — la connexion n'y figure plus (elle vit
 * dans les réglages avancés, et le test réussi la prouve de toute façon).
 */
export function etatsOnglets(
  f: Pick<FaitsMiseEnRoute, "numeroAppelant" | "gsmTest"> & {
    testReussi: boolean;
    campagnesActives: number;
    appelEnCours: boolean;
    appelesAujourdhui: number;
  }
): Record<Onglet, EtatOnglet> {
  const numeroTest: EtatOnglet = !f.numeroAppelant
    ? { ton: "a_faire", texte: "numéro à régler" }
    : !f.gsmTest
      ? { ton: "a_faire", texte: "GSM à régler" }
      : !f.testReussi
        ? { ton: "a_faire", texte: "test à faire" }
        : { ton: "fait", texte: "fait" };
  return {
    "numero-test": numeroTest,
    campagnes:
      f.campagnesActives > 0
        ? { ton: "info", texte: `${f.campagnesActives} active${f.campagnesActives > 1 ? "s" : ""}` }
        : { ton: "a_faire", texte: "à faire" },
    suivi: f.appelEnCours ? { ton: "info", texte: "en direct" } : { ton: "info", texte: `${f.appelesAujourdhui} aujourd'hui` },
  };
}

// ---------------------------------------------------------------------------
// Le numéro appelant : choisi parmi ses numéros, ou saisi
// ---------------------------------------------------------------------------

export type NumeroPropose = { e164: string; lisible: string; source: string };

/**
 * Les numéros que le CRM connaît à Bora, proposés d'un tap : celui qui est
 * réglé, celui de son compte (`crm_users.phone`), son GSM de test. Seuls les
 * numéros belges appelables (le juge de `numeros.ts`), sans doublon, le
 * numéro réglé d'abord. Le CRM ne lit PAS la liste des numéros du compte
 * Telnyx (aucune API branchée) : un autre numéro se saisit à la main.
 */
export function numerosProposes(c: { actuel: string | null; profil: string | null; gsm: string | null }): NumeroPropose[] {
  const vus = new Set<string>();
  const sortie: NumeroPropose[] = [];
  for (const [brut, source] of [
    [c.actuel, "réglé"],
    [c.profil, "votre compte"],
    [c.gsm, "votre GSM de test"],
  ] as const) {
    const e164 = numeroAppelable(brut);
    if (!e164 || vus.has(e164)) continue;
    vus.add(e164);
    sortie.push({ e164, lisible: numeroLisible(e164), source });
  }
  return sortie;
}
