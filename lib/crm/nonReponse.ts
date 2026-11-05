/**
 * Une note « À rappeler » qui décrit en fait une NON-RÉPONSE (05/11/2026).
 *
 * « À rappeler » = quelqu'un a répondu et a dit de rappeler plus tard (Bora,
 * 05/11). Les étudiants le choisissaient aussi pour « je vais rappeler » —
 * « Pas répondu », « Pas rep », « Messager », « tombée sur boîte mail »,
 * « salon fermé », « était en consultation » : ces appels sont des « Pas
 * décroché ». Le module les reconnaît, À UN SEUL ENDROIT, pour deux usages :
 *
 *   1. le garde-fou doux de l'écran (`ResultatAppel`) : avec « À rappeler »,
 *      une note qui ressemble à une non-réponse fait PROPOSER « Pas de
 *      réponse ? → Pas décroché » en un tap — il ne change jamais rien seul ;
 *   2. la liste des « À rappeler » mal saisis, que Bora valide avant la 047.
 *
 * Quatre verdicts :
 *   non_reponse  personne au bout (messagerie, fermé, pas répondu…) ;
 *   a_trancher   une non-réponse ET une consigne de rappel donnée par
 *                quelqu'un (« à rappeler pas avant 19 h car en
 *                consultation »), ou quelqu'un a répondu mais pas la
 *                personne visée (« tombé sur l'assistante », « n'était pas le
 *                responsable ») — l'ancien « Barrage », que le 27/10 ne
 *                comptait pas comme une réponse. Jamais proposé à l'écran :
 *                Bora tranche ;
 *   interesse    la note dit « intéressé » (et pas « pas intéressé ») — sens
 *                inverse : peut-être un vrai « Intéressé » saisi en « À
 *                rappeler » ; Bora décide au cas par cas ;
 *   null         rien de tout cela.
 *
 * Déterministe, sans IA : une liste de mots, lue sans accents ni casse.
 * Imports relatifs : exécuté tel quel par `npm run test:non-reponse`.
 */

export type VerdictNote = "non_reponse" | "a_trancher" | "interesse" | null;

/** Minuscules, sans accents, apostrophes droites, espaces simples. */
export function normaliserNote(texte: string | null | undefined): string {
  return (texte ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Personne au bout du fil. */
const NON_REPONSE: RegExp[] = [
  /\bpas\s+(de\s+)?rep(onse|ondu|on)?\b/, // « pas rep », « pas de réponse », « pas répondu »
  /\b(n'?\s*)?a\s+pas\s+repondu\b/, // « n'a pas répondu »
  /\b(ne\s+)?repond\s+(pas|plus|jamais)\b/, // « répond pas », « ne répond plus »
  /\bpersonne\s+(n'?a\s+)?(ne\s+)?(repond|decroche)/,
  /\bmessag(er|erie)\b/, // « Messager » (sic), « messagerie »
  /\brepondeur\b/,
  /\bbo[iî]te\s+(vocale|mail|aux\s+lettres)\b/,
  /\bvoicemail\b/,
  // « salon fermé », « c'est fermé » — jamais « il ferme à 18h » (un horaire
  // donné par quelqu'un) : le mot doit qualifier l'établissement, ou être seul.
  /\b(salon|cabinet|garage|magasin|boutique|bureau|commerce|institut|c'est|est|etait|actuellement|deja|encore)\s+ferme(e|s|es)?\b/,
  /^ferme(e|s|es)?$/,
  /\ben\s+consultation\b/,
  /\bpas\s+dispo(nible)?s?\b/,
  /\b(ligne\s+)?occupe(e|s|es)?\b/,
  /\binjoignable\b/,
  /\bsonne\s+(dans\s+le\s+vide|occupe)\b/,
  /\bpas\s+decroche\b/,
];

/** Quelqu'un a répondu et a donné une consigne : un vrai « À rappeler » possible. */
const CONSIGNE: RegExp[] = [
  /\brap+el+er\s+(pas\s+avant|apres|vers|demain|ce\s+soir|cet\s+apres|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|dans|le\s+\d|a\s+\d|\d)/,
  /\bm'?\s*a\s+(dit|demande|redirige)/,
  /\b(il|elle|ils|elles)\s+(a|ont)\s+dit\b/,
  /\bdisponible\s+(demain|ce|le|a|lundi|mardi|mercredi|jeudi|vendredi)/,
];

/** Quelqu'un a répondu, mais pas la personne visée (l'ancien « Barrage »). */
const FILTRE: RegExp[] = [
  /\btombe(e)?\s+sur\s+(l'\s*|la\s+|le\s+|un\s+|une\s+)?(assistant|secretair|standard|colleg|employe|receptionn)/,
  /\bpas\s+(le|la)\s+(responsable|patron|patronne|gerant|gerante|decideur)\b/,
];

const INTERESSE = /\binteresse(e|s|es)?\b/;
const PAS_INTERESSE = /\b(pas|plus|aucunement|nullement)\s+(du\s+tout\s+)?interesse/;

export function lireNoteRappeler(texte: string | null | undefined): VerdictNote {
  const t = normaliserNote(texte);
  if (!t) return null;
  if (INTERESSE.test(t) && !PAS_INTERESSE.test(t)) return "interesse";
  const nonReponse = NON_REPONSE.some((r) => r.test(t));
  const consigne = CONSIGNE.some((r) => r.test(t));
  const filtre = FILTRE.some((r) => r.test(t));
  if (filtre) return "a_trancher";
  if (nonReponse) return consigne ? "a_trancher" : "non_reponse";
  return null;
}

/**
 * Le garde-fou de l'écran : proposer « Pas décroché » seulement quand le
 * résultat choisi est « À rappeler » ET que la note décrit sans ambiguïté
 * une non-réponse. Jamais d'action automatique : l'appelant affiche la
 * proposition, l'humain tape.
 */
export function proposerPasDecroche(resultat: string | null | undefined, texte: string | null | undefined): boolean {
  return resultat === "rappeler" && lireNoteRappeler(texte) === "non_reponse";
}
