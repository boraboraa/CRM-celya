/**
 * Les RACCOURCIS dans les notes — un parseur DÉTERMINISTE, qui tourne à la
 * frappe, sans réseau, sans modèle. Le principe s'inverse : l'IA ne sert plus
 * qu'au rattrapage sur du texte libre ; ce qui suit une grammaire se lit ici,
 * immédiatement, et s'affiche en pastilles sous la note.
 *
 * Module PUR : aucun accès réseau ni Supabase, l'instant courant passé en
 * paramètre (`maintenant`, interprété dans le fuseau du processus — le
 * navigateur de l'équipe est à l'heure de Bruxelles). Testé par
 * lib/crm/raccourcis.test.ts.
 *
 * La grammaire est TOLÉRANTE, parce que Bora DICTE À LA VOIX : tout est
 * normalisé (NFD, diacritiques retirés, minuscules) AVANT comparaison —
 * « 11H », « eghéeze », « chaussee », « onze heures » passent. Les positions
 * renvoyées (`segments`, lieu, contact) pointent le texte D'ORIGINE : le
 * parseur ne réécrit RIEN.
 *
 * RÈGLES DURES — celles qui ont perdu le rendez-vous du 31/08 :
 *   · une heure SANS jour → { manque: "jour" } — JAMAIS « aujourd'hui » ni
 *     « demain » par défaut ;
 *   · un jour SANS heure avec un déclencheur rdv → { manque: "heure" } — un
 *     rendez-vous a toujours une heure ; une relance, non ;
 *   · aucune date dans le passé, sauf année écrite explicitement (sinon on
 *     roule à l'occurrence suivante) ;
 *   · « perdu » / « gagné » ne produisent JAMAIS qu'une suggestion.
 */

// Extension explicite : ce module est exécuté TEL QUEL par node (le test
// `npm run test:raccourcis`), qui ne résout pas les specificateurs sans
// extension. tsconfig l'autorise (allowImportingTsExtensions).
import { estHoteMaps } from "./maps.ts";

export type Raccourci = {
  rdv?: {
    /**
     * « YYYY-MM-DDTHH:mm » quand jour ET heure sont lus ; « HH:mm » quand
     * seule l'heure est lue (manque: "jour") ; « YYYY-MM-DD » quand seul le
     * jour est lu (manque: "heure") ; « » si le déclencheur est seul.
     */
    debut: string;
    /** Même convention que `debut` — uniquement si une fin ou une durée est lue. */
    fin?: string;
    /** Repris du texte d'origine (accents et majuscules). */
    lieu?: string;
    manque?: "jour" | "heure";
  };
  /** « YYYY-MM-DD » — l'échéance reste à 09:00, c'est voulu. */
  relance?: { date: string };
  sansReponse?: boolean;
  propositionEnvoyee?: boolean;
  contact?: string;
  /** SUGGESTION seule, jamais appliquée : « Perdu » reste une décision humaine. */
  suggestionPerdu?: { motif?: string };
  /** Positions à surligner, dans la chaîne D'ORIGINE. */
  segments: { debut: number; fin: number; role: string }[];
};

// ---------------------------------------------------------------------------
// Normalisation — avec la carte des positions vers le texte d'origine.
// ---------------------------------------------------------------------------

type Normalise = { texte: string; map: number[] };

function normalise(texte: string): Normalise {
  let out = "";
  const map: number[] = [];
  for (let i = 0; i < texte.length; i++) {
    const nfd = texte[i].normalize("NFD");
    for (const c of nfd) {
      // Les diacritiques (accents combinants U+0300–U+036F) disparaissent, le
      // reste passe en minuscules — la carte retient d'où vient chaque
      // caractère du texte normalisé dans le texte d'origine.
      const cp = c.codePointAt(0) ?? 0;
      if (cp >= 0x0300 && cp <= 0x036f) continue;
      out += c.toLowerCase();
      map.push(i);
      break; // un seul caractère de base par caractère d'origine
    }
  }
  return { texte: out, map };
}

// ---------------------------------------------------------------------------
// Dates — calculées depuis `maintenant`, jamais dans le passé.
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function plusJours(base: Date, jours: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + jours);
  return d;
}

const JOURS_SEMAINE = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];

const MOIS: Record<string, number> = {
  janvier: 1, janv: 1,
  fevrier: 2, fev: 2,
  mars: 3,
  avril: 4, avr: 4,
  mai: 5,
  juin: 6,
  juillet: 7, juil: 7,
  aout: 8,
  septembre: 9, sept: 9,
  octobre: 10, oct: 10,
  novembre: 11, nov: 11,
  decembre: 12, dec: 12,
};

const HEURES_EN_LETTRES: Record<string, number> = {
  une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6,
  sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
};

/** Jour/mois (année facultative) → « YYYY-MM-DD », roulé à l'occurrence
 *  suivante si la date est passée et l'année absente. null si invalide. */
function dateNumerique(
  jour: number,
  mois: number,
  annee: number | null,
  maintenant: Date
): string | null {
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;
  const auj = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());

  if (annee !== null) {
    const an = annee < 100 ? 2000 + annee : annee;
    const d = new Date(an, mois - 1, jour);
    if (d.getMonth() !== mois - 1) return null; // 31/02…
    return ymd(d); // année explicite : le passé est permis
  }

  let d = new Date(auj.getFullYear(), mois - 1, jour);
  if (d.getMonth() !== mois - 1) return null;
  if (d.getTime() < auj.getTime()) {
    d = new Date(auj.getFullYear() + 1, mois - 1, jour);
    if (d.getMonth() !== mois - 1) return null;
  }
  return ymd(d);
}

// ---------------------------------------------------------------------------
// Le parseur
// ---------------------------------------------------------------------------

type Span = { a: number; b: number }; // [a, b) dans le texte NORMALISÉ

type Trouve<T> = { valeur: T; span: Span };

function chevauche(span: Span, autres: Span[]): boolean {
  return autres.some((o) => span.a < o.b && span.b > o.a);
}

const PONCTUATION = /[.,;:!?\n]/;

export function lireRaccourcis(texte: string, maintenant: Date): Raccourci {
  const resultat: Raccourci = { segments: [] };
  if (!texte.trim()) return resultat;

  const { texte: norm, map } = normalise(texte);
  const pris: Span[] = []; // les zones déjà reconnues (rien ne s'y relit)

  /** Traduit une plage normalisée vers le texte d'origine. */
  const orig = (span: Span): { debut: number; fin: number } => ({
    debut: map[span.a] ?? 0,
    fin: (map[Math.max(span.a, span.b - 1)] ?? 0) + 1,
  });

  /** L'inverse d'`orig` : une plage du texte D'ORIGINE, vue en normalisé. */
  const spanDepuisOrigine = (debut: number, fin: number): Span | null => {
    let a = -1;
    let b = -1;
    for (let i = 0; i < map.length; i++) {
      if (map[i] >= debut && map[i] < fin) {
        if (a === -1) a = i;
        b = i + 1;
      }
    }
    return a === -1 ? null : { a, b };
  };

  const marque = (span: Span, role: string) => {
    pris.push(span);
    const o = orig(span);
    resultat.segments.push({ debut: o.debut, fin: o.fin, role });
  };

  const premier = (re: RegExp): Span | null => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm))) {
      const span = { a: m.index, b: m.index + m[0].length };
      if (!chevauche(span, pris)) return span;
    }
    return null;
  };

  // ---- 0. Un lien Google Maps collé dans la note EST le lieu -------------
  // Repéré AVANT tout le reste, et sur le texte D'ORIGINE : une URL est pleine
  // de chiffres et de séparateurs que les lecteurs de date et d'heure
  // prendraient pour une échéance, et la découpe en mots la mettrait en
  // pièces. Sa plage est réservée d'emblée ; le lien ne devient un « lieu »
  // que si la note parle d'un rendez-vous (section 5).
  let lienMaps: { texteOriginal: string; span: Span } | null = null;
  {
    const re = /https?:\/\/\S+/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texte))) {
      // La ponctuation finale (« … goo.gl/abc, on se voit ») n'appartient pas
      // au lien.
      const brut = m[0].replace(/[.,;:!?)\]]+$/, "");
      let u: URL;
      try {
        u = new URL(brut);
      } catch {
        continue;
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      // Le juge est dans maps.ts, et nulle part ailleurs : refaire le test ici
      // laissait passer un sosie d'hôte collé dans une note.
      if (!estHoteMaps(u)) continue;
      const span = spanDepuisOrigine(m.index, m.index + brut.length);
      if (!span || chevauche(span, pris)) continue;
      lienMaps = { texteOriginal: brut, span };
      pris.push(span); // réservé : rien ne se relit à l'intérieur d'une URL
      break;
    }
  }

  // ---- 1. Les déclencheurs sans paramètre --------------------------------
  const sansRep = premier(
    /\b(pdr|pas de reponse|pas repondu|messagerie|repondeur)\b/g
  );
  if (sansRep) {
    resultat.sansReponse = true;
    marque(sansRep, "sans_reponse");
  }

  const proposition = premier(
    /\b(devis envoye|proposition envoyee|offre envoyee)\b/g
  );
  if (proposition) {
    resultat.propositionEnvoyee = true;
    marque(proposition, "proposition");
  }

  const perdu = premier(/\b(perdu|pas interesse|refus)\b/g);
  if (perdu) {
    // La clause qui contient le déclencheur, dans le texte d'origine — le
    // motif probable de la perte. SUGGESTION uniquement.
    const o = orig(perdu);
    let debut = o.debut;
    while (debut > 0 && !PONCTUATION.test(texte[debut - 1])) debut--;
    let fin = o.fin;
    while (fin < texte.length && !PONCTUATION.test(texte[fin])) fin++;
    const motif = texte.slice(debut, fin).trim().slice(0, 120);
    resultat.suggestionPerdu = { motif: motif || undefined };
    marque(perdu, "perdu");
  }

  const rdvTrigger = premier(/\b(rdv|rendez[- ]vous|rv)\b/g);
  if (rdvTrigger) marque(rdvTrigger, "rdv");

  const relanceTrigger = premier(
    /\b(a rappeler|rappeler|rappel|relancer|relance)\b/g
  );
  if (relanceTrigger) marque(relanceTrigger, "relance");

  // ---- 2. Le contact ------------------------------------------------------
  // « le gérant c'est Marc » · « contact Marc » · « avec Prénom Nom » (les
  // majuscules du texte d'origine départagent « avec Marc » d'« avec le devis »).
  const litNomApres = (finNorm: number, majuscules: boolean): Trouve<string> | null => {
    const reste = norm.slice(finNorm);
    const m = /^\s*([a-z][a-z'-]+)(\s+([a-z][a-z'-]+))?/.exec(reste);
    if (!m) return null;
    const a = finNorm + m[0].indexOf(m[1]);
    let b = a + m[1].length;
    const o1 = orig({ a, b });
    let nom = texte.slice(o1.debut, o1.fin);
    if (majuscules && nom[0] !== nom[0].toUpperCase()) return null;
    if (m[3]) {
      const a3 = finNorm + m[0].lastIndexOf(m[3]);
      const span3 = { a: a3, b: a3 + m[3].length };
      const o3 = orig(span3);
      const nom3 = texte.slice(o3.debut, o3.fin);
      // Le second mot n'est retenu qu'en « Prénom Nom » (deux majuscules).
      if (!majuscules || nom3[0] === nom3[0].toUpperCase()) {
        if (!majuscules) {
          // « contact marc dupont » : on s'arrête au premier mot si le second
          // ressemble à un mot-outil.
          if (!/^(le|la|les|de|du|des|et|a|au|pour|qui|est)$/.test(m[3])) {
            b = span3.b;
            nom = `${nom} ${nom3}`;
          }
        } else {
          b = span3.b;
          nom = `${nom} ${nom3}`;
        }
      }
    }
    return { valeur: nom.trim(), span: { a, b } };
  };

  let contact: Trouve<string> | null = null;
  const gerant =
    /\b(le\s+)?(gerant|gerante|patron|patronne|proprietaire|responsable|directeur|directrice)\s+(c\s*'?\s*est|est)\b/g;
  gerant.lastIndex = 0;
  const mGerant = gerant.exec(norm);
  if (mGerant) contact = litNomApres(mGerant.index + mGerant[0].length, false);
  if (!contact) {
    const mContact = /\bcontact\s*:?/g.exec(norm);
    if (mContact) contact = litNomApres(mContact.index + mContact[0].length, false);
  }
  if (!contact) {
    const avec = /\bavec\b/g;
    let m: RegExpExecArray | null;
    while ((m = avec.exec(norm))) {
      const c = litNomApres(m.index + m[0].length, true);
      if (c && !chevauche(c.span, pris)) {
        contact = c;
        break;
      }
    }
  }
  if (contact && !chevauche(contact.span, pris)) {
    resultat.contact = contact.valeur;
    marque(contact.span, "contact");
  }

  // ---- 3. Le jour ---------------------------------------------------------
  let jour: Trouve<string> | null = null;

  // 3a. « 3/9 » · « 03/09 » · « 3-9 » · « 3/9/26 »
  {
    const re = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm))) {
      const span = { a: m.index, b: m.index + m[0].length };
      if (chevauche(span, pris)) continue;
      const date = dateNumerique(
        Number(m[1]),
        Number(m[2]),
        m[3] ? Number(m[3]) : null,
        maintenant
      );
      if (date) {
        jour = { valeur: date, span };
        break;
      }
    }
  }

  // 3b. « 1er septembre » · « 15 sept » · « 20 août »
  if (!jour) {
    const noms = Object.keys(MOIS).sort((x, y) => y.length - x.length).join("|");
    const re = new RegExp(`\\b(\\d{1,2})(er)?\\s+(${noms})\\b(\\s+(\\d{4}))?`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm))) {
      const span = { a: m.index, b: m.index + m[0].length };
      if (chevauche(span, pris)) continue;
      const date = dateNumerique(
        Number(m[1]),
        MOIS[m[3]],
        m[5] ? Number(m[5]) : null,
        maintenant
      );
      if (date) {
        jour = { valeur: date, span };
        break;
      }
    }
  }

  // 3c. aujourd'hui · demain · après-demain
  if (!jour) {
    const re = /\b(aujourd\s*'?\s*hui|apres[- ]demain|demain)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm))) {
      const span = { a: m.index, b: m.index + m[0].length };
      if (chevauche(span, pris)) continue;
      const decalage = m[1].startsWith("aujourd") ? 0 : m[1].startsWith("apres") ? 2 : 1;
      jour = { valeur: ymd(plusJours(maintenant, decalage)), span };
      break;
    }
  }

  // 3d. lundi … dimanche — la PROCHAINE occurrence, aujourd'hui exclu.
  if (!jour) {
    const re = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm))) {
      const span = { a: m.index, b: m.index + m[0].length };
      if (chevauche(span, pris)) continue;
      const cible = JOURS_SEMAINE.indexOf(m[1]);
      const decalage = ((cible - maintenant.getDay() + 7 - 1) % 7) + 1;
      jour = { valeur: ymd(plusJours(maintenant, decalage)), span };
      break;
    }
  }

  if (jour) marque(jour.span, "jour");

  // ---- 4. L'heure, la fin, la durée --------------------------------------
  type Heure = { minutes: number; span: Span };
  const heures: Heure[] = [];
  {
    const re = /\b(\d{1,2})\s*[h:]\s*([0-5]\d)?(?!\d)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm))) {
      const span = { a: m.index, b: m.index + m[0].length };
      if (chevauche(span, pris)) continue;
      const h = Number(m[1]);
      if (h > 23) continue;
      heures.push({ minutes: h * 60 + (m[2] ? Number(m[2]) : 0), span });
    }
    // « midi » et les heures en lettres (« onze heures », dictée vocale).
    const midi = premier(/\bmidi\b/g);
    if (midi) heures.push({ minutes: 12 * 60, span: midi });
    const lettres = new RegExp(
      `\\b(${Object.keys(HEURES_EN_LETTRES).join("|")})\\s+heures?(\\s+(trente|et\\s+demie?))?\\b`,
      "g"
    );
    let ml: RegExpExecArray | null;
    while ((ml = lettres.exec(norm))) {
      const span = { a: ml.index, b: ml.index + ml[0].length };
      if (chevauche(span, pris)) continue;
      heures.push({
        minutes: HEURES_EN_LETTRES[ml[1]] * 60 + (ml[2] ? 30 : 0),
      span,
      });
    }
    heures.sort((x, y) => x.span.a - y.span.a);
  }

  let debutMin: number | null = null;
  let finMin: number | null = null;
  let dureeMin: number | null = null;

  if (heures.length > 0) {
    const h1 = heures[0];
    debutMin = h1.minutes;
    marque(h1.span, "heure");

    // Ce qui suit l'heure de début : « -12h » / « a 12h » = une FIN ;
    // « 1h30 » / « 90min » = une DURÉE. Sinon, rien — 60 minutes par défaut.
    const suite = heures.find((h) => h.span.a > h1.span.b);
    if (suite) {
      const entre = norm.slice(h1.span.b, suite.span.a);
      if (/^\s*(-|a|au)\s*$/.test(entre)) {
        // « 11h-12h » / « 11h à 12h » : une heure de FIN.
        finMin = suite.minutes;
        marque(suite.span, "heure");
      } else if (/^\s*$/.test(entre) && suite.minutes <= 12 * 60) {
        // Collée après l'heure, sans liaison : une DURÉE (« 11h 1h30 »).
        dureeMin = suite.minutes;
        marque(suite.span, "duree");
      }
    }
    if (finMin === null && dureeMin === null) {
      const mDuree = premier(/\b(\d{1,3})\s*min(utes)?\b/g);
      if (mDuree && mDuree.a > h1.span.b) {
        const brute = /(\d{1,3})/.exec(norm.slice(mDuree.a, mDuree.b));
        if (brute) {
          dureeMin = Number(brute[1]);
          marque(mDuree, "duree");
        }
      }
    }
  }

  // ---- 5. Le lieu (seulement pour un rendez-vous) -------------------------
  let lieu: { texteOriginal: string; span: Span } | null = null;
  if (rdvTrigger) {
    type Token = { a: number; b: number };
    const tokens: Token[] = [];
    {
      const re = /[^\s.,;:!?\n]+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(norm))) tokens.push({ a: m.index, b: m.index + m[0].length });
    }
    const libre = (t: Token) => !chevauche(t, pris);
    const texteDe = (t: Token) => norm.slice(t.a, t.b);

    /** Étend une plage de tokens vers l'arrière puis l'avant, sans jamais
     *  traverser une zone reconnue ni une ponctuation de clause. */
    const clauseAutour = (idx: number): Span => {
      let debut = idx;
      while (debut > 0 && libre(tokens[debut - 1])) {
        const entre = norm.slice(tokens[debut - 1].b, tokens[debut].a);
        if (PONCTUATION.test(entre)) break;
        debut--;
      }
      let fin = idx;
      while (fin < tokens.length - 1 && libre(tokens[fin + 1])) {
        const entre = norm.slice(tokens[fin].b, tokens[fin + 1].a);
        if (PONCTUATION.test(entre)) break;
        fin++;
      }
      return { a: tokens[debut].a, b: tokens[fin].b };
    };

    const lieuDepuis = (
      span: Span
    ): { texteOriginal: string; span: Span } | null => {
      const o = orig(span);
      const t = texte.slice(o.debut, o.fin).trim();
      return t.length >= 2 ? { texteOriginal: t, span } : null;
    };

    // 5a. Un lien Maps collé prime sur tout : c'est le lieu, sans ambiguïté
    // et sans interprétation. Sa plage est déjà réservée (section 0) ; seul
    // le segment reste à poser.
    if (lienMaps) {
      lieu = lienMaps;
      resultat.segments.push({ ...orig(lienMaps.span), role: "lieu" });
    }

    // 5b. Une adresse : un mot de voie (rue, chaussée…) — la clause qui
    // l'entoure est le lieu (« eghéeze chaussée de namur 393 »).
    const VOIES = /^(rue|chaussee|avenue|place|boulevard|chemin|route|quai)$/;
    const idxVoie = lieu
      ? -1
      : tokens.findIndex((t) => libre(t) && VOIES.test(texteDe(t)));
    if (idxVoie >= 0) {
      lieu = lieuDepuis(clauseAutour(idxVoie));
    }

    // 5c. « chez … » — le lieu commence au mot « chez ».
    if (!lieu) {
      const idxChez = tokens.findIndex((t) => libre(t) && texteDe(t) === "chez");
      if (idxChez >= 0 && idxChez < tokens.length - 1 && libre(tokens[idxChez + 1])) {
        const clause = clauseAutour(idxChez + 1);
        lieu = lieuDepuis({ a: tokens[idxChez].a, b: clause.b });
      }
    }

    // 5d. « a … » / « @ … » — après l'heure seulement, pour ne pas confondre
    // avec les « à » du texte courant. Le « a » lui-même n'entre pas au lieu.
    if (!lieu && heures.length > 0) {
      const apres = heures[0].span.b;
      const idxA = tokens.findIndex(
        (t) => t.a >= apres && libre(t) && (texteDe(t) === "a" || texteDe(t) === "@")
      );
      if (idxA >= 0 && idxA < tokens.length - 1 && libre(tokens[idxA + 1])) {
        const suivant = texteDe(tokens[idxA + 1]);
        if (!/^\d+$/.test(suivant)) {
          const clause = clauseAutour(idxA + 1);
          lieu = lieuDepuis({
            a: Math.max(clause.a, tokens[idxA + 1].a),
            b: clause.b,
          });
        }
      }
    }

    if (lieu && lieu !== lienMaps) marque(lieu.span, "lieu");
  }

  // ---- 6. Assemblage ------------------------------------------------------
  const heureTexte =
    debutMin !== null ? `${pad(Math.floor(debutMin / 60))}:${pad(debutMin % 60)}` : null;
  const finDepuisDuree =
    debutMin !== null && dureeMin !== null ? debutMin + dureeMin : finMin;
  const finTexte =
    finDepuisDuree !== null && finDepuisDuree < 24 * 60
      ? `${pad(Math.floor(finDepuisDuree / 60))}:${pad(finDepuisDuree % 60)}`
      : null;

  if (rdvTrigger) {
    const rdv: NonNullable<Raccourci["rdv"]> = { debut: "" };
    if (jour && heureTexte) {
      rdv.debut = `${jour.valeur}T${heureTexte}`;
      if (finTexte) rdv.fin = `${jour.valeur}T${finTexte}`;
    } else if (heureTexte) {
      // Une heure SANS jour : on REFUSE de deviner le jour.
      rdv.debut = heureTexte;
      if (finTexte) rdv.fin = finTexte;
      rdv.manque = "jour";
    } else if (jour) {
      // Un jour SANS heure : un rendez-vous a toujours une heure.
      rdv.debut = jour.valeur;
      rdv.manque = "heure";
    } else {
      rdv.manque = "jour";
    }
    if (lieu) rdv.lieu = lieu.texteOriginal;
    resultat.rdv = rdv;
  } else if (relanceTrigger && jour) {
    // Une relance a un jour, pas d'heure : l'échéance reste à 09:00.
    resultat.relance = { date: jour.valeur };
  }

  return resultat;
}
