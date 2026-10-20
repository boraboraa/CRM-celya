/**
 * L'écran « Appels IA », ce qui se décide avant d'être affiché — pur, testé
 * (`npm run test:appels-ecran`), sans réseau ni base.
 *
 * Ce module ne décide RIEN pour le moteur : il dit à l'admin, avant le clic,
 * ce que le moteur et l'action serveur refuseraient de toute façon. Il est lu
 * par la page serveur, par les composants de l'écran ET par les actions
 * serveur (`appelTestAction` refuse avec la même phrase) — écrit une fois.
 *
 * Imports RELATIFS en `.ts` : le test l'exécute tel quel sous node.
 */

import {
  dansFenetre,
  enMinutes,
  ferieDe,
  heureFr,
  instantBruxelles,
  jourHeureFr,
  lendemainOuvre,
  partiesBruxelles,
  prochaineOuverture,
} from "./calendrier.ts";
import { fenetreDe, refusMoteur, type CompteurAppels, type ReglagesMoteur } from "./regles.ts";

// ---------------------------------------------------------------------------
// La mise en route : cinq éléments, puis un appel de test réussi
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

/** Le libellé de la ligne de la liste de contrôle. */
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

/** Ce qui manque, dans l'ordre de la liste de contrôle. */
export function elementsManquants(f: FaitsMiseEnRoute): ElementMiseEnRoute[] {
  const poses = new Set(f.secretsPoses);
  return ELEMENTS_MISE_EN_ROUTE.filter((e) => {
    if (e === "numero_appelant") return !f.numeroAppelant;
    if (e === "gsm_test") return !f.gsmTest;
    return !poses.has(e);
  });
}

/** « a », « a et b », « a, b et c ». */
export function enumerer(mots: readonly string[]): string {
  if (mots.length <= 1) return mots[0] ?? "";
  return `${mots.slice(0, -1).join(", ")} et ${mots[mots.length - 1]}`;
}

/** « Il manque la clé OpenAI et le mot de passe SIP. » — TOUT ce qui manque, jamais seulement le premier. */
export function phraseManquants(m: readonly ElementMiseEnRoute[]): string | null {
  if (m.length === 0) return null;
  const premier = NOM_ELEMENT[m[0]];
  // « Il manque l'identifiant… », jamais « Il manque le l'… ».
  return `Il manque ${enumerer([premier, ...m.slice(1).map((e) => NOM_ELEMENT[e])])}.`;
}

/**
 * Pourquoi le bouton « Appeler mon GSM (test) » ne peut pas partir — ou null.
 * Tout ce qui manque d'abord, puis un appel déjà en cours (le moteur n'en
 * tient qu'un à la fois).
 */
export function refusAppelTest(f: FaitsMiseEnRoute & { appelEnCours: boolean }): string | null {
  const phrases = [phraseManquants(elementsManquants(f)), f.appelEnCours ? "Un appel est déjà en cours : attendez qu'il se termine." : null];
  const dit = phrases.filter((p): p is string => Boolean(p));
  return dit.length ? dit.join(" ") : null;
}

/** Un appel de test qui prouve que la chaîne marche : décroché, terminé, sans erreur. */
export function testReussi(a: { mode_test: boolean; statut: string; decroche_at: string | null; erreur_cote: string | null; erreur_message?: string | null }): boolean {
  return a.mode_test && a.statut === "termine" && Boolean(a.decroche_at) && !a.erreur_cote && !a.erreur_message;
}

/** Le refus de sortir du mode test, dit par l'écran ET par l'action serveur. */
export const REFUS_REEL_SANS_TEST =
  "Passer en appels réels n'est possible qu'après un appel de test décroché et terminé sans erreur (onglet « Mise en route »).";

// ---------------------------------------------------------------------------
// Le suivi en direct d'un appel
// ---------------------------------------------------------------------------

/** « 45 s », « 2 min », « 2 min 14 s ». */
export function dureeLisible(s: number | null | undefined): string | null {
  if (s === null || s === undefined || !Number.isFinite(s) || s < 0) return null;
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}

export const ETAPES_SUIVI = ["compose", "sonne", "en_ligne", "termine"] as const;
export type EtapeSuivi = (typeof ETAPES_SUIVI)[number];

export const LIBELLE_ETAPE: Record<EtapeSuivi, string> = {
  compose: "Compose",
  sonne: "Sonne",
  en_ligne: "En ligne",
  termine: "Terminé",
};

/** Où en est l'appel, d'après son statut en base (`appels_ia.statut`). */
export function etapeSuivi(statut: string): { etape: EtapeSuivi; fini: boolean; echec: boolean } {
  switch (statut) {
    case "reserve":
    case "composition":
      return { etape: "compose", fini: false, echec: false };
    case "sonnerie":
      return { etape: "sonne", fini: false, echec: false };
    case "en_ligne":
      return { etape: "en_ligne", fini: false, echec: false };
    case "echec":
      return { etape: "termine", fini: true, echec: true };
    default:
      return { etape: "termine", fini: true, echec: false };
  }
}

/** Les répliques d'une transcription (`appels_ia.transcription`), lisibles — jamais une forme inattendue. */
export type Replique = { qui: "janet" | "prospect"; texte: string };

export function repliques(brut: unknown): Replique[] {
  if (!Array.isArray(brut)) return [];
  return brut
    .filter(
      (t): t is { qui: string; texte: string } =>
        Boolean(t) && typeof t === "object" && typeof (t as { texte?: unknown }).texte === "string"
    )
    .filter((t) => t.qui === "janet" || t.qui === "prospect")
    .map((t) => ({ qui: t.qui as Replique["qui"], texte: t.texte.trim() }))
    .filter((t) => t.texte.length > 0);
}

// ---------------------------------------------------------------------------
// Après un échec : la marche à suivre
// ---------------------------------------------------------------------------

export type MarcheASuivre = { titre: string; etapes: string[] };

/**
 * Ce qu'il faut faire après un échec d'appel, d'après ce que le moteur a écrit
 * (`appels_ia.erreur_code`, `erreur_message` — ce dernier vient de
 * `causeDe`, lib/appelsIa/causes.ts : ses phrases sont les clés de lecture,
 * et le test les tire de `causeDe` lui-même pour ne jamais diverger).
 * Null : rien de connu à conseiller, le message seul suffit.
 */
export function marcheASuivre(code: string | null | undefined, message: string | null | undefined): MarcheASuivre | null {
  const c = (code ?? "").toLowerCase();
  const m = message ?? "";
  const leverPuisTester = "Levez la pause du moteur s'il s'est mis en pause, puis relancez l'appel de test.";

  if (c === "outbound_sip_not_enabled" || /outbound_sip_not_enabled|SIP sortant n'est pas activé/i.test(m)) {
    return {
      titre: "Le SIP sortant n'est pas activé chez OpenAI",
      etapes: [
        "Connectez-vous à platform.openai.com avec un compte propriétaire de l'organisation.",
        "Demandez l'activation des appels SIP sortants (outbound SIP) pour l'ORGANISATION — elle se fait par organisation, pas par projet : réglages de l'organisation, ou le support OpenAI.",
        "Rien à changer dans le CRM : la clé et le trunk restent les mêmes.",
        leverPuisTester,
      ],
    };
  }
  if (c === "invalid_api_key" || /\(401\)|clé API/i.test(m)) {
    return {
      titre: "OpenAI refuse la clé",
      etapes: [
        "Créez une nouvelle clé sur platform.openai.com → API keys, dans le projet qui a accès à GPT-Live.",
        "Collez-la dans la ligne « Clé OpenAI » ci-dessus (Remplacer). Elle ne s'affichera plus jamais.",
        leverPuisTester,
      ],
    };
  }
  if (/\(429\)/.test(m)) {
    return {
      titre: "OpenAI : crédit ou débit épuisé",
      etapes: [
        "Vérifiez le solde et les limites du compte sur platform.openai.com → Billing et Limits.",
        leverPuisTester,
      ],
    };
  }
  if (/\(403/.test(m)) {
    return {
      titre: "OpenAI refuse l'accès",
      etapes: [
        "Vérifiez que la clé appartient à un projet qui a accès à GPT-Live (platform.openai.com → Projects).",
        leverPuisTester,
      ],
    };
  }
  if (/refusé l'appel avant la sonnerie/i.test(m)) {
    return {
      titre: "La ligne Telnyx a refusé l'appel",
      etapes: [
        "Dans le portail Telnyx → Voice → SIP Connections, ouvrez la connexion du trunk et relisez l'identifiant et le mot de passe (Credentials).",
        "Reposez-les dans « Identifiant SIP » et « Mot de passe SIP » ci-dessus.",
        "Vérifiez que le numéro appelant est rattaché à cette connexion, avec un profil sortant (Outbound Voice Profile), et que le compte Telnyx a du crédit.",
        leverPuisTester,
      ],
    };
  }
  if (/\(502\)|trunk SIP/i.test(m)) {
    return {
      titre: "OpenAI n'a pas pu joindre le trunk",
      etapes: [
        "Vérifiez l'URL du trunk dans les réglages avancés (attendu : sips:sip.telnyx.com:5061).",
        "Vérifiez dans Telnyx que la connexion SIP accepte TLS.",
        "Relancez l'appel de test.",
      ],
    };
  }
  if (/secret/i.test(m)) {
    return {
      titre: "Un secret manque",
      etapes: ["Posez la clé OpenAI, l'identifiant et le mot de passe SIP dans la liste ci-dessus.", "Relancez l'appel de test."],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// L'assistant de campagne : la sélection, l'estimation, la confirmation
// ---------------------------------------------------------------------------

/** Une fiche proposée par l'assistant, avec la raison de la règle 025 (`appels_ia_simuler_inscription`), ou null. */
export type FicheCandidate = { id: string; societe: string; refus: string | null };

export type CompteSelection = {
  appelables: string[];
  ecartees: { id: string; societe: string; raison: string }[];
  /** Les raisons d'exclusion, la plus fréquente d'abord : « 3 × Pas de numéro… ». */
  parRaison: { raison: string; nombre: number }[];
};

/**
 * Ce que deviendrait la sélection cochée : combien Janet pourra appeler, et
 * pourquoi chacune des autres est écartée. Ne JUGE rien : les raisons viennent
 * de la base (une fiche dont la raison est inconnue est écartée, jamais
 * appelée par défaut).
 */
export function compterSelection(fiches: readonly (FicheCandidate & { refus: string | null | undefined })[], cochees: ReadonlySet<string>): CompteSelection {
  const appelables: string[] = [];
  const ecartees: CompteSelection["ecartees"] = [];
  for (const f of fiches) {
    if (!cochees.has(f.id)) continue;
    if (f.refus === null) appelables.push(f.id);
    else ecartees.push({ id: f.id, societe: f.societe, raison: f.refus ?? "Vérification impossible." });
  }
  const compte = new Map<string, number>();
  for (const e of ecartees) compte.set(e.raison, (compte.get(e.raison) ?? 0) + 1);
  const parRaison = [...compte.entries()]
    .map(([raison, nombre]) => ({ raison, nombre }))
    .sort((a, b) => b.nombre - a.nombre || a.raison.localeCompare(b.raison));
  return { appelables, ecartees, parRaison };
}

/** « 23 fiches peuvent être appelées, 4 écartées. » */
export function phraseSelection(c: Pick<CompteSelection, "appelables" | "ecartees">): string {
  const n = c.appelables.length;
  const e = c.ecartees.length;
  const tete =
    n === 0
      ? "Aucune fiche ne peut être appelée"
      : `${n} fiche${n > 1 ? "s" : ""} ${n > 1 ? "peuvent" : "peut"} être appelée${n > 1 ? "s" : ""}`;
  return e === 0 ? `${tete}.` : `${tete}, ${e} écartée${e > 1 ? "s" : ""}.`;
}

/**
 * Combien de jours ouvrés pour un premier essai sur chaque fiche : la capacité
 * d'un jour est le plus petit du plafond du jour et du plafond horaire × les
 * heures de fenêtre. Une fiche peut demander jusqu'à 3 essais : l'écran le
 * dit à côté, sans le multiplier (la plupart des cycles s'arrêtent avant).
 */
export function estimationJours(
  n: number,
  r: { plafond_jour: number; plafond_heure: number; fenetre_debut: string; fenetre_fin: string }
): { parJour: number; jours: number } {
  const minutes = Math.max(0, enMinutes(r.fenetre_fin.slice(0, 5)) - enMinutes(r.fenetre_debut.slice(0, 5)));
  const parJour = Math.max(1, Math.min(r.plafond_jour, Math.floor((r.plafond_heure * minutes) / 60)));
  return { parJour, jours: n <= 0 ? 0 : Math.ceil(n / parJour) };
}

/** « environ 1 jour ouvré à 40 appels par jour », « environ 3 jours ouvrés … ». */
export function phraseEstimation(n: number, e: { parJour: number; jours: number }): string {
  if (n <= 0) return "Rien à appeler.";
  return `Environ ${e.jours} jour${e.jours > 1 ? "s" : ""} ouvré${e.jours > 1 ? "s" : ""} pour un premier appel à chaque fiche, à ${e.parJour} appels par jour au plus — jusqu'à 3 essais par fiche.`;
}

/**
 * La confirmation avant d'allumer : ce que Janet va faire, quand, à quel
 * rythme. « dès 9h30 en semaine » hors fenêtre ; « dès maintenant » dedans.
 */
export function phraseConfirmationLancement(
  r: { fenetre_debut: string; fenetre_fin: string; plafond_heure: number; mode_test: boolean },
  maintenant: Date
): string {
  const f = { debut: r.fenetre_debut.slice(0, 5), fin: r.fenetre_fin.slice(0, 5) };
  const quand = dansFenetre(maintenant, f)
    ? `dès maintenant (jusqu'à ${heureFr(enMinutes(f.fin))})`
    : `dès ${heureFr(enMinutes(f.debut))} en semaine`;
  const qui = r.mode_test ? "Janet va appeler VOTRE GSM avec le brief de chaque fiche" : "Janet va commencer à appeler les fiches";
  return `${qui} ${quand}, ${r.plafond_heure} appel${r.plafond_heure > 1 ? "s" : ""} par heure au plus. Lancer ?`;
}

/** La seconde confirmation, pour passer en appels réels. */
export const CONFIRMATION_REEL =
  "Appels RÉELS : Janet appellera les vrais numéros des fiches et écrira chaque résultat sur la fiche. Elle s'annonce comme une IA dès sa première phrase, et respecte la liste d'opposition : un « ne m'appelez plus » y inscrit le numéro sur-le-champ. Confirmer ?";

// ---------------------------------------------------------------------------
// Le bandeau d'état de l'onglet Campagnes : UNE phrase
// ---------------------------------------------------------------------------

export type TonBandeau = "marche" | "pause" | "arret";
export type Bandeau = { ton: TonBandeau; texte: string };

export type FaitsBandeau = {
  reglages: ReglagesMoteur;
  maintenant: Date;
  compteur: CompteurAppels;
  enCours: { societe: string | null; prospect_id: string | null; essai: number; mode_test: boolean } | null;
  /** Lignes en attente dans une campagne ACTIVE, du mode en cours : ce que le moteur prendra. */
  fileComposable: number;
  /** Lignes en attente inscrites dans l'AUTRE mode : le moteur ne les prendra pas. */
  fileAutreMode: number;
  /** Lignes en attente dans une campagne en pause. */
  fileEnPause: number;
};

const ORDINAL = ["", "1er", "2e", "3e"];

/**
 * Où en est Janet, en une phrase — tirée de la même lecture que l'état du
 * moteur (`refusMoteur`, lib/appelsIa/regles.ts, appelé tel quel) :
 *
 *   « Janet appelle en ce moment : Garage X (2e essai) »
 *   « En pause : hors fenêtre, reprise demain à 9h30 »
 *   « En pause : jour férié (Toussaint), reprise lundi 2 novembre à 9h30 »
 *   « En pause : plafond du jour atteint (40 appels), reprise … »
 *   « À l'arrêt : interrupteur coupé »
 */
export function phraseBandeau(f: FaitsBandeau): Bandeau {
  const r = f.reglages;
  if (f.enCours) {
    const qui = f.enCours.societe ?? (f.enCours.prospect_id ? "une fiche" : "votre GSM (appel de test)");
    const essai = f.enCours.prospect_id && f.enCours.essai > 1 ? ` (${ORDINAL[f.enCours.essai] ?? `${f.enCours.essai}e`} essai)` : "";
    return { ton: "marche", texte: `Janet appelle en ce moment : ${qui}${essai}.` };
  }
  if (!r.actif) return { ton: "arret", texte: "À l'arrêt : interrupteur coupé." };
  if (r.pause_cause) return { ton: "pause", texte: `En pause : ${r.pause_cause}` };

  const fenetre = fenetreDe(r);
  const reprise = jourHeureFr(prochaineOuverture(f.maintenant, fenetre));
  const refus = refusMoteur(r, f.maintenant, f.compteur);
  if (refus) {
    // Le refus du moteur dit CE QUI EMPÊCHE D'ABORD (numéro manquant avant la
    // fenêtre, fenêtre avant les plafonds) : on lit son ordre, pas le nôtre.
    if (refus.startsWith("Hors de la fenêtre")) {
      const ferie = ferieDe(partiesBruxelles(f.maintenant).ymd);
      return {
        ton: "pause",
        texte: ferie ? `En pause : jour férié (${ferie}), reprise ${reprise}.` : `En pause : hors fenêtre, reprise ${reprise}.`,
      };
    }
    if (refus.startsWith("Plafond du jour")) {
      const demain = prochaineOuverture(instantBruxelles(lendemainOuvre(f.maintenant), 0), fenetre);
      return { ton: "pause", texte: `En pause : plafond du jour atteint (${r.plafond_jour} appels), reprise ${jourHeureFr(demain)}.` };
    }
    if (refus.startsWith("Plafond de l'heure")) {
      return { ton: "pause", texte: `En pause : plafond de l'heure atteint (${r.plafond_heure} appels), reprise dans moins d'une heure.` };
    }
    return { ton: "arret", texte: `À l'arrêt : ${refus}` };
  }

  if (f.fileComposable > 0) {
    return { ton: "marche", texte: `En marche : ${f.fileComposable} fiche${f.fileComposable > 1 ? "s" : ""} à appeler, une à la fois.` };
  }
  if (f.fileAutreMode > 0) {
    return {
      ton: "arret",
      texte: `Rien à appeler : ${f.fileAutreMode} fiche${f.fileAutreMode > 1 ? "s" : ""} attend${f.fileAutreMode > 1 ? "ent" : ""} dans la file en mode ${r.mode_test ? "réel" : "test"}, que le mode actuel ne prend pas.`,
    };
  }
  if (f.fileEnPause > 0) {
    return { ton: "arret", texte: `Rien à appeler : ${f.fileEnPause} fiche${f.fileEnPause > 1 ? "s" : ""} attend${f.fileEnPause > 1 ? "ent" : ""} dans une campagne en pause.` };
  }
  return { ton: "arret", texte: "Rien à appeler : lancez une campagne." };
}
