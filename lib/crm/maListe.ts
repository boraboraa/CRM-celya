/**
 * « MA LISTE » — coller sa liste, Janet range (27/10/2026). Module PUR : la
 * lecture déterministe, le prompt, la validation de ce que le modèle rend, et
 * les corrections par message. L'appel au modèle vit dans ./maListeIA.ts ;
 * l'écriture, dans les server actions (app/ma-liste-actions.ts).
 *
 * Les étudiants font leur recherche ailleurs (souvent avec leur propre IA), et
 * collent TOUT d'un coup : le plus souvent « nom + numéro », parfois un tableau
 * markdown, parfois un copier-coller Google Maps bruité, avec leurs remarques
 * au milieu. Trois règles, reprises de l'extraction d'une fiche (CLAUDE.md,
 * « L'extraction — le cahier des charges ») et à ne pas régresser :
 *
 *  1. NE JAMAIS DEVINER — un champ absent vaut null. Un numéro que le modèle
 *     rendrait sans qu'il figure dans le collage est écarté (`chiffresPresents`).
 *  2. LE MODÈLE EXTRAIT, LE CODE RANGE — « +32 » (`normalizeBelgianPhone`),
 *     secteur de la liste fixe, e-mail et site validés, ici.
 *  3. LE DÉTERMINISTE D'ABORD — une liste « nom + numéro » ou un tableau
 *     markdown se lisent SANS modèle (instantané, et même assistant coupé). Le
 *     modèle ne sert qu'au texte que le code ne sait pas lire.
 *
 * Ce qui décrit la société va dans les champs ; ce que l'étudiant en DIT
 * (« la secrétaire décroche jamais », « rappeler après 14h ») va dans `notes`
 * — « Ce qu'on sait », en tête de fiche. Jamais d'échange créé : la fiche
 * entre en « À appeler ».
 *
 * Imports relatifs avec extension : le test (test:ma-liste) l'exécute sous node.
 */

import { normalizeBelgianPhone } from "./telephone.ts";
import { normaliserSecteur, SECTEURS, type SecteurFixe } from "./secteurs.ts";
import {
  cleSociete,
  doublonsDansLeLot,
  estDoublonEquipe,
  phraseDoublon,
  type DoublonEquipe,
} from "./doublons.ts";

/**
 * Au plus 80 fiches et 12 000 caractères par collage. Pourquoi ces chiffres :
 * le texte que le code ne sait pas lire part au modèle en trois morceaux de
 * 4 000 caractères AU PLUS, en parallèle ; MiniMax rend ~20 fiches en 15–25 s
 * par morceau, ce qui tient sous la minute d'une fonction Vercel. 80 fiches,
 * c'est aussi une journée d'appels largement — au-delà, l'import CSV existe.
 * On peut coller une deuxième liste ensuite : elle s'ajoute.
 */
export const PLAFOND_FICHES = 80;
export const PLAFOND_CARACTERES = 12_000;
export const TAILLE_MORCEAU = 4_000;

export type FicheCollee = {
  company_name: string;
  /** Le numéro rangé au format « +32 … » — null s'il est absent ou implausible. */
  phone: string | null;
  /** Tel qu'il a été lu, quand il n'a pas pu être rangé (pour le signaler). */
  phone_lu: string | null;
  contact_name: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  sector: SecteurFixe | null;
  /** « Ce qu'on sait » — les remarques de l'étudiant, jamais réécrites. */
  notes: string | null;
};

export type Defauts = { secteur: string | null; ville: string | null };

// ---------------------------------------------------------------------------
// Petits outils
// ---------------------------------------------------------------------------

const nettoie = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Un numéro dans une ligne : « 02 640 12 34 », « 0470/12.34.56 »,
 * « +32 (0)2 640 12 34 », « 0032 2 640 12 34 ». Des groupes de chiffres
 * séparés par UN espace (ou collés par « . / - ( ) ») : « 02 640 12 34 - 14h »
 * s'arrête avant « - 14h », qui serait sinon avalé comme deux chiffres de plus.
 */
const RE_TEL = /(?:\+\s?|00\s?)?\(?\d[\d()./-]*(?:[ \t]\(?\d[\d()./-]*)*/g;

export function trouverTelephones(ligne: string): { brut: string; debut: number; fin: number }[] {
  const res: { brut: string; debut: number; fin: number }[] = [];
  for (const m of ligne.matchAll(RE_TEL)) {
    const chiffres = m[0].replace(/\D/g, "");
    // Six chiffres au moins : un numéro TRONQUÉ (« 02 640 12 ») reste un
    // numéro — il sera signalé implausible, pas pris pour un bout de nom.
    if (chiffres.length < 6 || chiffres.length > 15) continue;
    res.push({ brut: m[0].trim(), debut: m.index ?? 0, fin: (m.index ?? 0) + m[0].length });
  }
  return res;
}

/** Les chiffres d'un numéro rendu par le modèle figurent-ils dans le collage ? */
export function chiffresPresents(numero: string, collage: string): boolean {
  const n = numero.replace(/\D/g, "");
  if (n.length < 8) return false;
  const tout = collage.replace(/\D/g, "");
  // On compare les 8 derniers chiffres : « +32 2 640 12 34 » rendu pour
  // « 02/640.12.34 » collé garde « 26401234 ».
  return tout.includes(n.slice(-8));
}

/** Le nom figure-t-il (à la casse, aux accents et à la ponctuation près) dans le collage ? */
export function nomPresent(nom: string, collage: string): boolean {
  const k = cleSociete(nom);
  const tout = cleSociete(collage) ?? "";
  return Boolean(k && tout.includes(k));
}

function emailValide(v: unknown): string | null {
  const t = nettoie(v, 200)?.toLowerCase() ?? null;
  return t && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(t) ? t : null;
}

function siteValide(v: unknown): string | null {
  const t = nettoie(v, 200);
  if (!t) return null;
  const sans = t.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(sans) ? sans : null;
}

/**
 * La ville lisible dans une adresse : le morceau « code postal + commune »
 * (4 chiffres en Belgique, 5 en France — Rémi est à Lyon). « Rue de Fer 12,
 * 5000 Namur, Belgique » → « Namur ». Rien de lisible : null, jamais deviné.
 */
export function villeDeLAdresse(adresse: string | null | undefined): string | null {
  if (!adresse) return null;
  for (const morceau of adresse.split(",").map((m) => m.trim()).reverse()) {
    const m = /(?:^|\s)(?:[A-Z]{1,2}-)?\d{4,5}\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' -]{1,60})$/.exec(morceau);
    if (m) {
      const ville = m[1].replace(/\s+/g, " ").trim();
      return ville ? ville.slice(0, 80) : null;
    }
  }
  return null;
}

/**
 * Une fiche rangée : le code applique ses règles à ce qui a été LU (par lui ou
 * par le modèle). Les défauts du collage (secteur, ville) ne remplacent jamais
 * ce que le texte dit de la ligne.
 */
export function rangerFiche(
  lue: {
    company_name?: unknown;
    phone?: unknown;
    contact_name?: unknown;
    email?: unknown;
    website?: unknown;
    address?: unknown;
    city?: unknown;
    sector?: unknown;
    notes?: unknown;
  },
  defauts: Defauts
): FicheCollee | null {
  const nom = nettoie(lue.company_name, 200);
  if (!nom) return null;
  const telLu = nettoie(lue.phone, 40);
  const tel = normalizeBelgianPhone(telLu);
  return {
    company_name: nom,
    phone: tel,
    phone_lu: tel ? null : telLu,
    contact_name: nettoie(lue.contact_name, 120),
    email: emailValide(lue.email),
    website: siteValide(lue.website),
    address: nettoie(lue.address, 300),
    // La ville : celle que la ligne dit, à défaut celle qu'on LIT dans
    // l'adresse (« Rue de Fer 12, 5000 Namur »), à défaut le défaut du collage.
    city:
      nettoie(lue.city, 80) ??
      villeDeLAdresse(nettoie(lue.address, 300)) ??
      nettoie(defauts.ville, 80),
    sector: normaliserSecteur(nettoie(lue.sector, 80) ?? nettoie(defauts.secteur, 80)),
    notes: nettoie(lue.notes, 1000),
  };
}

// ---------------------------------------------------------------------------
// 1. La lecture déterministe
// ---------------------------------------------------------------------------

/** Les colonnes d'un tableau markdown, reconnues à leur en-tête. */
const ENTETES: [keyof FicheCollee | "phone", RegExp][] = [
  ["company_name", /^(nom|soci[eé]t[eé]|entreprise|commerce|cabinet|raison sociale|name|company|business|[eé]tablissement)/i],
  ["phone", /^(t[eé]l|phone|num[eé]ro|gsm|mobile|fixe)/i],
  ["address", /^(adresse|address|rue|localisation|lieu|emplacement)/i],
  ["city", /^(ville|commune|localit[eé]|city)/i],
  ["website", /^(site|web|url|website)/i],
  ["contact_name", /^(contact|g[eé]rant|responsable|interlocuteur|d[eé]cideur|personne)/i],
  ["email", /^(e-?mail|courriel|mail)/i],
  ["sector", /^(secteur|activit[eé]|cat[eé]gorie|m[eé]tier|type)/i],
  ["notes", /^(notes?|remarques?|commentaires?|infos?|observations?|pourquoi|accroche)/i],
];

function cellules(ligne: string): string[] {
  return ligne
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const estSeparateurTableau = (l: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(l.trim());

/**
 * Une remarque de l'étudiant, sur sa propre ligne, sous une fiche : elle
 * commence par un tiret, une flèche, une parenthèse, « NB », « Rem », « Note »,
 * « Info », « Attention », ou par une MINUSCULE (« la secrétaire décroche
 * jamais ») — un nom de société, lui, commence par une majuscule.
 */
const RE_REMARQUE_PREFIXE = /^(?:[-–—•*→>(]|(?:nb|n\.b\.|rem|note|remarque|info|attention|pdr)\b)/i;
const RE_REMARQUE_MINUSCULE = /^[a-zàâäçéèêëîïôöùûü]/;
const estRemarque = (l: string) => RE_REMARQUE_PREFIXE.test(l) || RE_REMARQUE_MINUSCULE.test(l);

/** Ce que le séparateur laisse autour du nom : « Cabinet Smile — », « : », « ; ». */
const bords = (s: string) => s.replace(/^[\s\-–—:;,|\t•*→>]+|[\s\-–—:;,|\t•*→>]+$/g, "");

export type LectureDeterministe = {
  fiches: FicheCollee[];
  /** Les lignes que le code n'a pas su lire — elles partent au modèle. */
  nonLues: string[];
};

/**
 * Lit ce qui se lit sans modèle :
 *  - un TABLEAU markdown (`| Nom | Téléphone | … |`), colonnes reconnues à
 *    leur en-tête ;
 *  - des lignes « nom + numéro » (séparateurs « - », « : », tabulation, « ; »,
 *    ou rien), avec éventuellement une remarque après le numéro ;
 *  - une remarque sur sa propre ligne (tiret, minuscule, « NB : »…) juste sous
 *    une fiche : elle va dans ses notes.
 * Tout le reste est rendu dans `nonLues`.
 */
export function lireDeterministe(texte: string, defauts: Defauts): LectureDeterministe {
  const lignes = texte.replace(/\r/g, "").split("\n");
  const fiches: FicheCollee[] = [];
  const nonLues: string[] = [];
  let colonnes: (keyof FicheCollee | "phone" | null)[] | null = null;
  let derniere: FicheCollee | null = null;

  for (const brute of lignes) {
    // Les puces et numéros de liste (« 1. », « 3) », « - ») ne font pas partie du nom.
    const ligne = brute
      .replace(/\u00a0/g, " ")
      .replace(/^\s*(?:\d{1,3}[.)]|[-–•*])\s+/, "")
      .trimEnd();
    if (!ligne.trim()) {
      derniere = null;
      continue;
    }
    // Un titre (« Voici ma liste : », « # Dentistes Ixelles ») ne se lit pas.
    if (/^#+\s/.test(ligne.trim()) || (/:\s*$/.test(ligne) && trouverTelephones(ligne).length === 0)) {
      derniere = null;
      continue;
    }

    // --- Un tableau markdown.
    if (ligne.trim().startsWith("|")) {
      if (estSeparateurTableau(ligne)) continue;
      const cs = cellules(ligne);
      const lu = cs.map((c) => ENTETES.find(([, re]) => re.test(c))?.[0] ?? null);
      if (!colonnes || (lu.filter(Boolean).length >= 2 && lu.includes("company_name"))) {
        if (lu.includes("company_name")) {
          colonnes = lu;
          continue;
        }
      }
      if (colonnes) {
        const champs: Record<string, string> = {};
        cs.forEach((c, i) => {
          const k = colonnes![i];
          if (k && c && c !== "-" && c !== "—") champs[k] = champs[k] ? `${champs[k]} ${c}` : c;
        });
        const f = rangerFiche(champs, defauts);
        if (f) {
          fiches.push(f);
          derniere = f;
        } else nonLues.push(ligne);
        continue;
      }
      nonLues.push(ligne);
      continue;
    }
    colonnes = null;

    // --- Une ligne « nom + numéro ».
    const tels = trouverTelephones(ligne);
    if (tels.length === 1) {
      const avant = bords(ligne.slice(0, tels[0].debut));
      const apres = bords(ligne.slice(tels[0].fin));
      // Un nom court, sans virgule ni chiffre de rue : sinon c'est une adresse
      // collée au nom, que seul le modèle sait démêler.
      if (avant && avant.length <= 80 && !avant.includes(",") && !/\d{2,}/.test(avant)) {
        const f = rangerFiche({ company_name: avant, phone: tels[0].brut, notes: apres || null }, defauts);
        if (f) {
          fiches.push(f);
          derniere = f;
          continue;
        }
      }
    }

    // --- Une remarque sous la fiche précédente.
    if (derniere && tels.length === 0 && estRemarque(ligne.trim()) && ligne.trim().length <= 300) {
      const r = bords(ligne.trim());
      derniere.notes = derniere.notes ? `${derniere.notes}\n${r}` : r;
      continue;
    }

    nonLues.push(ligne);
    derniere = null;
  }
  return { fiches, nonLues };
}

// ---------------------------------------------------------------------------
// 2. Le modèle — le prompt, les morceaux, la validation
// ---------------------------------------------------------------------------

export const SYSTEM_MA_LISTE = `Tu es Janet, l'assistante du CRM Celya. Un commercial colle la liste des entreprises qu'il va appeler. Tu en extrais TOUTES les sociétés, une par objet.

Règles absolues :
1. N'invente JAMAIS rien. Un champ absent du texte vaut null. Recopie les valeurs telles qu'elles apparaissent (le numéro dans son format d'origine).
2. Une société = une entrée. Ignore les titres, les horaires (« Ouvert · Ferme à 18:00 »), les notes Google (« 4,6 ★ (87 avis) »), les liens « Itinéraire », « Site Web », « Appeler ».
3. Ce qui DÉCRIT la société va dans les champs : company_name, phone, address (rue, numéro, code postal, ville — telle qu'écrite), city (la ville seule), website, email, contact_name (une personne nommée), sector (le métier : « Cabinet dentaire », « Garage »…).
4. Ce que le COMMERCIAL en dit — une remarque, un conseil, une info d'appel (« la secrétaire décroche jamais », « rappeler après 14h », « ils ont déjà un logiciel ») — va dans "notes", recopié tel quel. Jamais dans les autres champs.
5. Le type d'établissement Google (« Dentiste », « Garage automobile ») va dans "sector", pas dans "notes".

Réponds UNIQUEMENT avec un objet JSON :
{ "fiches": [ { "company_name": ..., "phone": ..., "address": ..., "city": ..., "website": ..., "email": ..., "contact_name": ..., "sector": ..., "notes": ... } ] }

Exemple :
Texte :
Cabinet Dentaire Smile
4,8 ★ (52) · Dentiste
Avenue Louise 54, 1050 Ixelles
Ouvert · Ferme à 18:00
02 640 12 34
la secrétaire décroche jamais, essayer avant 9h
Réponse :
{"fiches":[{"company_name":"Cabinet Dentaire Smile","phone":"02 640 12 34","address":"Avenue Louise 54, 1050 Ixelles","city":"Ixelles","website":null,"email":null,"contact_name":null,"sector":"Dentiste","notes":"la secrétaire décroche jamais, essayer avant 9h"}]}`;

/**
 * Coupe le texte en morceaux d'au plus `taille` caractères, AUX LIGNES VIDES
 * de préférence (un bloc Google Maps reste entier), sinon aux fins de ligne.
 * Une fiche coupée en deux se retrouverait en double : le dédoublonnage du
 * lot la rattrape (même téléphone ou même nom).
 */
export function morceaux(texte: string, taille = TAILLE_MORCEAU): string[] {
  const blocs = texte.replace(/\r/g, "").split(/\n\s*\n/);
  const res: string[] = [];
  let courant = "";
  const pousser = () => {
    if (courant.trim()) res.push(courant.trim());
    courant = "";
  };
  for (const bloc of blocs) {
    if (bloc.length > taille) {
      pousser();
      let part = "";
      for (const l of bloc.split("\n")) {
        if (part && part.length + l.length + 1 > taille) {
          res.push(part.trim());
          part = "";
        }
        part += (part ? "\n" : "") + l;
      }
      if (part.trim()) res.push(part.trim());
      continue;
    }
    if (courant && courant.length + bloc.length + 2 > taille) pousser();
    courant += (courant ? "\n\n" : "") + bloc;
  }
  pousser();
  return res;
}

export type FicheAVerifier = FicheCollee & {
  /** Ce que le code n'a pas pu confirmer dans le collage — affiché sur la ligne. */
  aVerifier: string[];
};

/**
 * Ce que le modèle a rendu, validé contre le collage : un numéro absent du
 * texte est retiré (jamais inventé), un nom introuvable est signalé.
 */
export function validerSortieModele(
  sortie: Record<string, unknown> | null,
  collage: string,
  defauts: Defauts
): FicheAVerifier[] {
  const brutes = Array.isArray(sortie?.fiches) ? (sortie!.fiches as unknown[]) : [];
  const res: FicheAVerifier[] = [];
  for (const b of brutes.slice(0, PLAFOND_FICHES)) {
    if (!b || typeof b !== "object") continue;
    const lue = { ...(b as Record<string, unknown>) };
    const aVerifier: string[] = [];
    const tel = nettoie(lue.phone, 40);
    if (tel && !chiffresPresents(tel, collage)) {
      lue.phone = null;
      aVerifier.push("numéro introuvable dans le texte — retiré");
    }
    const f = rangerFiche(lue, defauts);
    if (!f) continue;
    if (!nomPresent(f.company_name, collage)) aVerifier.push("nom à vérifier");
    res.push({ ...f, aVerifier });
  }
  return res;
}

// ---------------------------------------------------------------------------
// 3. Les corrections par message — le code d'abord
// ---------------------------------------------------------------------------

export type Correction =
  | { op: "retirer"; lignes: number[] }
  | { op: "modifier"; lignes: number[] | "toutes"; champ: "sector" | "city"; valeur: string | null };

/** « 3 », « 3 et 5 », « 2, 4, 6 », « 2 à 5 » → [3], [3, 5]… (numérotées à partir de 1). */
function lireNumeros(t: string): number[] {
  const res = new Set<number>();
  for (const m of t.matchAll(/(\d+)\s*(?:à|-|a)\s*(\d+)|(\d+)/g)) {
    if (m[1] && m[2]) {
      const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y);
      for (let i = a; i <= Math.min(b, a + PLAFOND_FICHES); i++) res.add(i);
    } else if (m[3]) res.add(Number(m[3]));
  }
  return [...res].filter((n) => n >= 1).sort((a, b) => a - b);
}

const sansAccents = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Une correction simple, lue SANS modèle : « enlève la 3 », « retire 2 et 5 »,
 * « le secteur c'est kiné », « la ville c'est Namur pour la 2 ». null : le
 * message n'est pas de cette forme (le modèle tentera, s'il est là).
 */
export function lireCorrection(message: string, nbFiches: number): Correction | null {
  const t = sansAccents(message.trim());
  if (!t) return null;

  const retrait = t.match(/^(?:enleve|enlever|retire|retirer|supprime|supprimer|vire|virer|efface|effacer|pas)\b(.*)$/);
  if (retrait) {
    const n = lireNumeros(retrait[1]).filter((x) => x <= nbFiches);
    return n.length ? { op: "retirer", lignes: n } : null;
  }

  // Le champ et sa valeur, lus sur le message D'ORIGINE (casse et accents
  // de la valeur gardés : « Namur », « Kiné »).
  const champ = message
    .trim()
    .match(/\b(secteur|ville)\b\s*(?:c[’']est|c est|=|:|est|en)?\s*(.+)$/i);
  if (champ) {
    let valeur = champ[2];
    let lignes: number[] | "toutes" = "toutes";
    const pour = valeur.match(/^(.*?)\s+(?:pour|sur)\s+(?:la|les|ligne|lignes)?\s*([\d\s,età-]+)$/i);
    if (pour) {
      valeur = pour[1];
      const n = lireNumeros(pour[2]).filter((x) => x <= nbFiches);
      if (n.length) lignes = n;
    }
    const v = bords(valeur.replace(/^(?:l[ea]s?|du|de la)\s+/i, ""));
    if (!v) return null;
    return champ[1].toLowerCase() === "secteur"
      ? { op: "modifier", lignes, champ: "sector", valeur: normaliserSecteur(v) }
      : { op: "modifier", lignes, champ: "city", valeur: v.slice(0, 80) };
  }
  return null;
}

/** Applique une correction ; les numéros sont ceux de l'écran (1, 2, 3…). */
export function appliquerCorrection<T extends FicheCollee>(fiches: T[], c: Correction): T[] {
  if (c.op === "retirer") {
    const out = new Set(c.lignes.map((n) => n - 1));
    return fiches.filter((_, i) => !out.has(i));
  }
  const vise = (i: number) => c.lignes === "toutes" || c.lignes.includes(i + 1);
  return fiches.map((f, i) => (vise(i) ? { ...f, [c.champ]: c.valeur } : f));
}

/** La phrase de Janet après une correction — la même partout. */
export function phraseCorrection(c: Correction, avant: number, apres: number): string {
  if (c.op === "retirer") {
    const n = avant - apres;
    return `C'est fait : ${n} fiche${n > 1 ? "s" : ""} retirée${n > 1 ? "s" : ""}. Il en reste ${apres}.`;
  }
  const quoi = c.champ === "sector" ? "le secteur" : "la ville";
  const ou = c.lignes === "toutes" ? "toutes les fiches" : `la ligne ${c.lignes.join(", ")}`;
  return `C'est fait : ${quoi} vaut « ${c.valeur ?? "—"} » pour ${ou}.`;
}

/** Les champs qu'une correction du modèle a le droit de toucher — rien d'autre. */
const CHAMPS_CORRIGIBLES = [
  "company_name",
  "phone",
  "contact_name",
  "email",
  "website",
  "address",
  "city",
  "sector",
  "notes",
] as const;

export const SYSTEM_CORRECTION = `Tu es Janet, l'assistante du CRM Celya. Le commercial corrige la liste de fiches qu'il s'apprête à importer. Tu reçois la liste numérotée (à partir de 1) et sa demande. Tu rends UNIQUEMENT les opérations demandées, sans rien inventer :
{ "operations": [ { "op": "retirer", "lignes": [3] } | { "op": "modifier", "ligne": 2, "champ": "city" | "sector" | "company_name" | "phone" | "contact_name" | "email" | "website" | "address" | "notes", "valeur": "..." } ], "reponse": "une phrase courte en français qui dit ce qui a été fait" }
Si la demande n'est pas claire, rends { "operations": [], "reponse": "la question à poser" }.`;

/**
 * Les opérations proposées par le modèle, VALIDÉES : numéros de ligne dans la
 * liste, champs de la liste blanche, valeurs rangées comme le reste (secteur
 * de la liste fixe, téléphone « +32 »). Une opération invalide est ignorée.
 */
export function validerCorrectionsModele(
  sortie: Record<string, unknown> | null,
  fiches: FicheCollee[]
): { fiches: FicheCollee[]; reponse: string | null; appliquees: number } {
  const ops = Array.isArray(sortie?.operations) ? (sortie!.operations as unknown[]) : [];
  let res = [...fiches];
  const retirer = new Set<number>();
  let appliquees = 0;
  for (const o of ops.slice(0, 50)) {
    if (!o || typeof o !== "object") continue;
    const op = o as Record<string, unknown>;
    if (op.op === "retirer" && Array.isArray(op.lignes)) {
      for (const n of op.lignes) {
        if (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= fiches.length) {
          retirer.add((n as number) - 1);
          appliquees++;
        }
      }
    } else if (op.op === "modifier") {
      const n = op.ligne;
      const champ = op.champ as (typeof CHAMPS_CORRIGIBLES)[number];
      if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > fiches.length) continue;
      if (!(CHAMPS_CORRIGIBLES as readonly string[]).includes(champ as string)) continue;
      const courante = res[(n as number) - 1];
      const rangee = rangerFiche({ ...courante, [champ]: op.valeur ?? null }, { secteur: null, ville: null });
      if (!rangee) continue;
      res[(n as number) - 1] = rangee;
      appliquees++;
    }
  }
  if (retirer.size) res = res.filter((_, i) => !retirer.has(i));
  const reponse = typeof sortie?.reponse === "string" ? sortie.reponse.trim().slice(0, 300) || null : null;
  return { fiches: res, reponse, appliquees };
}

/**
 * Le message est-il une LISTE à lire (et non une correction) ? Plusieurs
 * lignes, un numéro, un tableau, ou un long texte : c'est une liste.
 * « enlève la 3 » ou « le secteur c'est kiné » n'en sont pas.
 */
export function estUnCollage(message: string, nbFiches: number): boolean {
  const t = message.trim();
  if (!t) return false;
  if (nbFiches === 0) return true;
  if (lireCorrection(t, nbFiches)) return false;
  return t.includes("\n") || t.startsWith("|") || trouverTelephones(t).length > 0 || t.length > 160;
}

/** Les secteurs proposés en tête du collage (la liste fixe, sans « Autre »). */
export const SECTEURS_PROPOSES = SECTEURS.filter((s) => s !== "Autre");

// ---------------------------------------------------------------------------
// 4. Le récapitulatif — ce qui sera créé, ce qui ne le sera pas, et pourquoi
// ---------------------------------------------------------------------------

export type EtatFiche = {
  /**
   * a_creer : sera créée ; doublon_lot : répète une ligne plus haute ;
   * doublon_equipe : déjà suivie par un autre membre ; a_moi : déjà dans mes
   * fiches. Seule a_creer est importée.
   */
  statut: "a_creer" | "doublon_lot" | "doublon_equipe" | "a_moi";
  /** Pourquoi elle ne sera pas créée — ou ce qu'il faut vérifier. */
  phrase: string | null;
  /** Créée, mais sans numéro (absent ou implausible) : à compléter. */
  sansNumero: boolean;
};

/**
 * L'état de chaque ligne, dans l'ordre : le lot d'abord (la PREMIÈRE
 * occurrence reste), puis l'équipe (`doublons_equipe`, 031 — le nom du
 * responsable n'arrive que pour l'admin).
 */
export function etatsDesFiches(
  fiches: FicheCollee[],
  equipe: (DoublonEquipe | null | undefined)[],
  nomProprietaire: (id: string) => string | null = () => null
): EtatFiche[] {
  const lot = doublonsDansLeLot(fiches.map((f) => ({ telephone: f.phone ?? f.phone_lu, societe: f.company_name })));
  return fiches.map((f, i) => {
    const sansNumero = !f.phone;
    const d = lot.get(i);
    if (d) {
      return {
        statut: "doublon_lot",
        phrase: `répète la ligne ${d.premier + 1} (${d.raison === "telephone" ? "même téléphone" : "même nom"})`,
        sansNumero,
      };
    }
    const e = equipe[i];
    if (e && estDoublonEquipe(e)) {
      return {
        statut: e.aMoi ? "a_moi" : "doublon_equipe",
        phrase: phraseDoublon(e, e.proprietaire ? nomProprietaire(e.proprietaire) : null),
        sansNumero,
      };
    }
    return {
      statut: "a_creer",
      phrase: sansNumero
        ? f.phone_lu
          ? `numéro « ${f.phone_lu} » implausible — à compléter sur la fiche`
          : "sans numéro — à compléter sur la fiche"
        : null,
      sansNumero,
    };
  });
}

/** « 14 fiches à créer · 2 déjà suivies dans l'équipe · 1 sans numéro ». */
export function recapitulatif(etats: EtatFiche[]): string {
  const n = (s: EtatFiche["statut"]) => etats.filter((e) => e.statut === s).length;
  const pl = (k: number, un: string, plusieurs: string) => `${k} ${k > 1 ? plusieurs : un}`;
  const creer = n("a_creer");
  const parts = [pl(creer, "fiche à créer", "fiches à créer")];
  if (n("doublon_equipe")) parts.push(pl(n("doublon_equipe"), "déjà suivie dans l'équipe", "déjà suivies dans l'équipe"));
  if (n("a_moi")) parts.push(pl(n("a_moi"), "déjà dans vos fiches", "déjà dans vos fiches"));
  if (n("doublon_lot")) parts.push(pl(n("doublon_lot"), "en double dans la liste", "en double dans la liste"));
  const sans = etats.filter((e) => e.statut === "a_creer" && e.sansNumero).length;
  if (sans) parts.push(pl(sans, "sans numéro", "sans numéro"));
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// L'import — la ligne que reçoit importProspectsCore
// ---------------------------------------------------------------------------

/**
 * Ce qui part à l'import pour une fiche relue : toutes les colonnes lues, dont
 * l'ADRESSE et la VILLE (le 27/10, une colonne « Adresse » semblait ne pas
 * arriver — elle était lue, mais l'écran de relecture ne la montrait pas).
 * Étape « À appeler », toujours : coller une liste n'est pas un échange.
 * Pure : testée par `test:ma-liste`, de la lecture du collage à cette ligne.
 */
export function ligneImport(f: FicheCollee) {
  return {
    company_name: f.company_name,
    contact_name: f.contact_name ?? undefined,
    email: f.email ?? undefined,
    phone: f.phone ?? f.phone_lu ?? undefined,
    website: f.website ?? undefined,
    sector: f.sector ?? undefined,
    address: f.address ?? undefined,
    city: f.city ?? undefined,
    status: "a_appeler" as const,
    source: "Ma liste",
    notes: f.notes ?? undefined,
  };
}
