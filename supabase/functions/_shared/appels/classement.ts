/**
 * Le classement d'un appel de Janet — qui était au bout du fil.
 *
 * PARTAGÉ, en un seul exemplaire, par :
 *   · l'annexe (edge function Deno `appels-ia-annexe`), qui raccroche EN DIRECT
 *     dès qu'une messagerie ou un serveur vocal est reconnu dans l'accueil ;
 *   · le moteur Next (lib/appelsIa/fin.ts), qui classe l'appel terminé ;
 *   · les tests node (lib/appelsIa/classement.test.ts).
 * TypeScript portable : aucun import, aucune API Deno ou Node, aucun alias.
 *
 * Repris de l'ancien sortant du produit (`_shared/disposition.ts` de
 * `elevenlabs-webhook`, lu le 07/10/2026), avec les corrections validées :
 *   · `repondu_humain` exige DEUX répliques humaines, dont une APRÈS une phrase
 *     de Janet (un échange) — un « Allô ? » puis raccroché n'est pas un humain ;
 *   · les motifs de machine ne se cherchent QUE dans l'accueil (les deux
 *     premières répliques du prospect) : un humain qui dit plus loin « rappelez-
 *     moi plus tard » ne devient pas un répondeur ;
 *   · motifs FORTS (décident seuls, et font raccrocher en direct) et FAIBLES
 *     (ne décident que faute de tout échange) : « ne quittez pas », « merci de
 *     patienter », « vous êtes bien chez… » sont aussi des phrases humaines ;
 *   · « after the tone », « druk op » + chiffre, « toets 1 », « kies 1 » ;
 *   · le texte est NORMALISÉ (minuscules, sans accents) avant toute
 *     comparaison : le `\b` de JavaScript ne reconnaissait pas « à », si bien
 *     que « bienvenue à … » et « vous êtes bien à … » ne matchaient jamais.
 */

export type Classement =
  | "repondu_humain"
  | "repondeur"
  | "standard_ivr"
  | "sans_reponse"
  | "occupe_echec";

export type Confiance = "haute" | "moyenne" | "basse";

export type VerdictClassement = {
  classement: Classement;
  confiance: Confiance;
  raison: string;
};

/** Minuscules, sans accents, apostrophes droites, blancs simples. */
export function normaliser(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Les motifs — sur du texte NORMALISÉ (sans accents).
// ---------------------------------------------------------------------------

/** Menu de serveur vocal : décide seul. */
const MENU = new RegExp(
  [
    "\\btapez (le )?(\\d|un|deux|trois|quatre|cinq|six|sept|huit|neuf|zero|etoile|diese)\\b",
    "\\bappuyez sur\\b",
    "\\bcomposez le\\b",
    "\\btouche (etoile|diese|\\d)\\b",
    "\\bpour (toute|tout|nous joindre|le service|joindre|prendre|contacter|parler)\\b[^.]{0,60}\\b(tapez|dites|appuyez|composez)\\b",
    "\\bpress (one|two|three|four|five|zero|star|\\d)\\b",
    "\\bdruk (op )?(een|twee|drie|vier|vijf|nul|\\d|het hekje|de ster)\\b",
    "\\btoets (een|twee|drie|vier|\\d)\\b",
    "\\bkies (een|twee|drie|vier|\\d)\\b",
  ].join("|")
);

/** Messagerie : décide seule. */
const MESSAGERIE_FORTE = new RegExp(
  [
    "\\blaiss(ez|er)[ -]((nous|moi) )?(un |votre |vos )?(petit )?messages?\\b",
    "\\bapres le (bip|signal)\\b",
    "\\bau (bip|signal) sonore\\b",
    "\\bboite (vocale|de messagerie)\\b",
    "\\bmessagerie\\b",
    "\\brepondeur\\b",
    "\\bboite de reception est pleine\\b",
    "\\bnos bureaux sont (actuellement )?fermes\\b",
    "\\bnous sommes (actuellement )?(fermes|absents?|en conges?)\\b",
    "\\ben dehors (de nos|des) heures (d'ouverture|de bureau)\\b",
    "\\bmailbox\\b",
    "\\bvoicemail\\b",
    "\\bleave (a|your) message\\b",
    "\\bafter the (tone|beep)\\b",
    "\\brecord your message\\b",
    "\\bspreek (\\S+ )?(een |uw )?bericht in\\b",
    "\\b(laat|inspreken) (\\S+ )?(een |uw )?bericht\\b",
    "\\bna de (piep|pieptoon|toon)\\b",
  ].join("|")
);

/** Serveur vocal (sans menu) : décide seul. */
const SERVEUR_FORT = new RegExp(
  [
    "\\bserveur vocal\\b",
    "\\bstandard (automatique|telephonique)\\b",
    "\\brepondeur (automatique|interactif)\\b",
    "\\b(cet|votre) appel (est|peut etre|va etre|sera) (enregistre|transfere|mis en attente)\\b",
    "\\btous nos (conseillers|operateurs|collaborateurs|agents) sont\\b",
    "\\bun de nos (agents|conseillers|operateurs)\\b",
    "\\b(this|your) call (is|may be|will be) (recorded|monitored)\\b",
    "\\ball (our )?(agents|representatives|operators) are\\b",
    "\\bal onze (medewerkers|operatoren) zijn\\b",
    "\\bdit gesprek (kan|wordt) (worden )?opgenomen\\b",
  ].join("|")
);

/** Indices FAIBLES : aussi des phrases humaines. Ne décident que sans échange. */
const MESSAGERIE_FAIBLE = new RegExp(
  [
    "\\bvous etes bien (sur|au|chez|a)\\b",
    "\\bje ne suis pas (disponible|joignable|la)\\b",
    "\\bnous ne sommes pas (disponibles?|joignables?|au bureau)\\b",
    "\\brappele[rz]?[ -]?(nous|moi)? ?(plus tard|ulterieurement|demain)\\b",
    "\\b(reprendrons|de retour|reprise)\\b[^.]{0,40}\\ble \\d",
    "\\ben conges?\\b",
    "\\bbonnes? vacances\\b",
    "\\bheures d'ouverture\\b",
    "\\bnot available\\b",
    "\\bu (heeft|hebt) \\S+ bereikt\\b",
    "\\bik ben (momenteel )?(niet bereikbaar|er niet|afwezig)\\b",
    "\\b(momenteel )?niet (bereikbaar|beschikbaar)\\b",
  ].join("|")
);

const SERVEUR_FAIBLE = new RegExp(
  [
    "\\bmerci (de|pour) (patienter|votre patience)\\b",
    "\\brestez en ligne\\b",
    "\\bne quittez pas\\b",
    "\\bbienvenue (a|chez|au|aux|dans)\\b",
    "\\bdans (quelques instants|les plus brefs delais)\\b",
    "\\b(prenons|prendre|prendrons|traiterons|traiter) (votre )?appel\\b",
    "\\bwelcome to\\b",
    "\\bwelkom bij\\b",
    "\\b(een )?ogenblik(je)? geduld\\b",
    "\\bblijf aan de lijn\\b",
  ].join("|")
);

/** Janet dit elle-même qu'elle parle à une machine. */
const JANET_MACHINE =
  /\bc'est (un|une) (repondeur|messagerie)\b|\bje reconnais (un|une) (repondeur|messagerie)\b|\bun (standard|serveur) automat/;

/** Une réplique qui contient au moins un mot. */
export function aDesMots(texte: string): boolean {
  return /[a-z0-9]{2,}/.test(normaliser(texte));
}

/**
 * Le verdict des motifs FORTS sur l'accueil (les deux premières répliques du
 * prospect). C'est la seule chose qui fait raccrocher l'annexe en direct.
 */
export function machineDansAccueil(accueil: string): "repondeur" | "standard_ivr" | null {
  const t = normaliser(accueil);
  if (!t) return null;
  if (MENU.test(t)) return "standard_ivr";
  if (MESSAGERIE_FORTE.test(t)) return "repondeur";
  if (SERVEUR_FORT.test(t)) return "standard_ivr";
  return null;
}

/** Les indices FAIBLES de l'accueil. */
export function indiceFaibleDansAccueil(accueil: string): "repondeur" | "standard_ivr" | null {
  const t = normaliser(accueil);
  if (!t) return null;
  if (MESSAGERIE_FAIBLE.test(t)) return "repondeur";
  if (SERVEUR_FAIBLE.test(t)) return "standard_ivr";
  return null;
}

export type Tour = { qui: "prospect" | "janet"; texte: string };

export type FaitsAppel = {
  /** `transport.failed` APRÈS la sonnerie (avant, c'est une panne de notre côté). */
  echecTransport: boolean;
  decroche: boolean;
  /** Du décroché à la fin, en secondes. */
  dureeEnLigneS: number | null;
  tours: Tour[];
  /** Ce que l'annexe a reconnu en direct (et qui l'a fait raccrocher). */
  machineEnDirect: "repondeur" | "standard_ivr" | null;
  /** Le motif de `fin_appel`, si Janet l'a appelé. */
  finAppelJanet: string | null;
  /** Ce que Janet a FAIT : un rendez-vous posé, une opposition enregistrée. */
  rdvPose: boolean;
  opposition: boolean;
};

/** L'accueil : les deux premières répliques du prospect. */
export function accueilDe(tours: Tour[]): string {
  return tours
    .filter((t) => t.qui === "prospect" && aDesMots(t.texte))
    .slice(0, 2)
    .map((t) => t.texte)
    .join(" ");
}

/**
 * Les répliques humaines, et s'il y a eu ÉCHANGE : une réplique du prospect
 * arrivée APRÈS une phrase de Janet. Une messagerie récite sans répondre.
 */
export function echanges(tours: Tour[]): { repliques: number; echange: boolean } {
  let repliques = 0;
  let janetAParle = false;
  let echange = false;
  for (const t of tours) {
    if (!aDesMots(t.texte)) continue;
    if (t.qui === "janet") {
      janetAParle = true;
    } else {
      repliques++;
      if (janetAParle) echange = true;
    }
  }
  return { repliques, echange };
}

/**
 * Le classement, dans l'ordre — la première règle qui s'applique gagne :
 *   1. échec du transport après sonnerie → occupé / échec ;
 *   2. pas de décroché → pas de réponse ;
 *   3. Janet a AGI (rendez-vous, opposition) → humain ;
 *   4. machine reconnue en direct, ou motif FORT dans l'accueil → machine ;
 *   5. deux répliques humaines et un échange → humain ;
 *   6. `fin_appel` de Janet (répondeur, standard) → machine ;
 *   7. indice FAIBLE dans l'accueil → machine ;
 *   8. Janet a dit « c'est un répondeur » → répondeur ;
 *   9. aucun mot du prospect : moins de 8 s → pas de réponse, sinon répondeur ;
 *  10. une réplique, sans échange → répondeur (confiance basse).
 */
export function classerAppel(f: FaitsAppel): VerdictClassement {
  if (f.echecTransport) {
    return { classement: "occupe_echec", confiance: "haute", raison: "échec du transport après la sonnerie" };
  }
  if (!f.decroche) {
    return { classement: "sans_reponse", confiance: "haute", raison: "pas décroché" };
  }
  if (f.rdvPose || f.opposition) {
    return {
      classement: "repondu_humain",
      confiance: "haute",
      raison: f.rdvPose ? "rendez-vous posé pendant l'appel" : "opposition demandée pendant l'appel",
    };
  }
  const accueil = accueilDe(f.tours);
  const fort = f.machineEnDirect ?? machineDansAccueil(accueil);
  if (fort) {
    return {
      classement: fort,
      confiance: "haute",
      raison: fort === "repondeur" ? "messagerie reconnue dans l'accueil" : "serveur vocal reconnu dans l'accueil",
    };
  }
  const { repliques, echange } = echanges(f.tours);
  if (repliques >= 2 && echange) {
    return { classement: "repondu_humain", confiance: "haute", raison: `${repliques} répliques, avec échange` };
  }
  const motif = normaliser(f.finAppelJanet ?? "");
  if (motif === "repondeur" || motif === "standard") {
    return {
      classement: motif === "repondeur" ? "repondeur" : "standard_ivr",
      confiance: "moyenne",
      raison: `Janet a conclu : ${motif}`,
    };
  }
  const faible = indiceFaibleDansAccueil(accueil);
  if (faible) {
    return {
      classement: faible,
      confiance: "moyenne",
      raison: faible === "repondeur" ? "indice de messagerie, sans échange" : "indice de serveur vocal, sans échange",
    };
  }
  const motsJanet = normaliser(f.tours.filter((t) => t.qui === "janet").map((t) => t.texte).join(" "));
  if (JANET_MACHINE.test(motsJanet)) {
    return { classement: "repondeur", confiance: "moyenne", raison: "Janet a reconnu une machine" };
  }
  if (repliques === 0) {
    const d = f.dureeEnLigneS ?? 0;
    return d < 8
      ? { classement: "sans_reponse", confiance: "moyenne", raison: "décroché, moins de 8 s sans un mot" }
      : { classement: "repondeur", confiance: "basse", raison: "décroché, silence de 8 s ou plus" };
  }
  return {
    classement: "repondeur",
    confiance: "basse",
    raison: repliques === 1 ? "une seule réplique, sans échange" : "des répliques, sans échange",
  };
}

/** Les classements « machine » qui comptent pour la règle des deux machines. */
export function estMachine(c: Classement | string | null | undefined): boolean {
  return c === "repondeur" || c === "standard_ivr";
}
