/**
 * Les CLÉS de doublon et les doublons d'un même lot — module pur (27/10/2026).
 *
 * Deux étudiants qui importent le même cabinet depuis Google Maps : la liste
 * n'a presque jamais d'e-mail, et l'import ne dédoublonnait QUE sur l'e-mail.
 * D'où deux clés, le téléphone et le nom de société, comparées :
 *  - dans le lot lui-même (`doublonsDansLeLot`, ici) ;
 *  - dans TOUTE la base, sans rien révéler (`doublons_equipe`, SQL, 031) —
 *    la cloison entre étudiants tient : on apprend « déjà suivie dans
 *    l'équipe », jamais par qui ni quoi.
 *
 * Les deux clés sont écrites DEUX fois, ici et en SQL (`cle_telephone`,
 * `cle_societe`), et jouent le MÊME jeu de cas (`doublons.cas.json` :
 * test:doublons et la recette 031). Toute évolution se fait des deux côtés.
 *
 * Imports relatifs seulement : le test l'exécute tel quel sous node.
 */

/**
 * Le numéro national significatif : « 081 22 33 44 », « +32 81 22 33 44 »,
 * « 0032 81 22 33 44 » et « +32 (0)81 22.33.44 » donnent tous « 81223344 ».
 *
 * L'ancienne clé (les 9 derniers chiffres) ratait les FIXES : « 081 22 33 44 »
 * gardait son 0 (« 081223344 ») et « +32 81 22 33 44 » son 2 (« 281223344 »).
 * Les 8 derniers chiffres n'auraient pas suffi non plus : « +32 71 22 33 44 »
 * (Charleroi) et « +32 471 22 33 44 » (un mobile) se seraient confondus.
 * Moins de 8 chiffres significatifs : pas de clé (on ne rapproche pas « 112 »).
 */
export function cleTelephone(v?: string | null): string | null {
  if (!v) return null;
  let d = v.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("32") && (d.length === 10 || d.length === 11)) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  return d.length >= 8 ? d : null;
}

/**
 * Le nom de société sans accents, sans forme juridique ni ponctuation :
 * « Garage Dupont SPRL » et « garage dupont » donnent « garagedupont ».
 * Quatre caractères au moins (sinon « SA » ou « Bar » rapprocheraient tout).
 * Les accents retirés sont ceux de la table — la copie SQL fait le même
 * `translate`, pas plus.
 */
const AVEC = "àâäáãåçéèêëíìîïñóòôöõúùûüýÿ";
const SANS = "aaaaaaceeeeiiiinooooouuuuyy";
const FORMES = /(^|[^a-z0-9])(srl|sprl|sa|bv|bvba|nv|asbl|vzw|sc|scs|snc|gmbh)(?=$|[^a-z0-9])/g;

export function cleSociete(v?: string | null): string | null {
  if (!v) return null;
  let t = "";
  for (const c of v.toLowerCase()) {
    const i = AVEC.indexOf(c);
    t += i >= 0 ? SANS[i] : c;
  }
  // Deux passes : « sa sprl » (deux formes collées) partageraient leur espace.
  t = t.replace(FORMES, "$1").replace(FORMES, "$1");
  const k = t.replace(/[^a-z0-9]/g, "");
  return k.length > 3 ? k : null;
}

export type EntreeDoublon = { telephone?: string | null; societe?: string | null };

/** Pourquoi deux entrées se ressemblent. */
export type RaisonDoublon = "telephone" | "societe";

/**
 * Les doublons À L'INTÉRIEUR d'un lot (un collage, un fichier) : pour chaque
 * entrée qui répète une entrée PLUS HAUTE, l'index de cette première et la
 * raison. La première occurrence reste, les suivantes sont signalées — c'est
 * l'ordre de la liste qui décide, jamais une préférence.
 */
export function doublonsDansLeLot(
  entrees: EntreeDoublon[]
): Map<number, { premier: number; raison: RaisonDoublon }> {
  const parTel = new Map<string, number>();
  const parNom = new Map<string, number>();
  const res = new Map<number, { premier: number; raison: RaisonDoublon }>();
  entrees.forEach((e, i) => {
    const t = cleTelephone(e.telephone);
    const n = cleSociete(e.societe);
    const tPremier = t ? parTel.get(t) : undefined;
    const nPremier = n ? parNom.get(n) : undefined;
    if (tPremier !== undefined) res.set(i, { premier: tPremier, raison: "telephone" });
    else if (nPremier !== undefined) res.set(i, { premier: nPremier, raison: "societe" });
    if (t && tPremier === undefined) parTel.set(t, i);
    if (n && nPremier === undefined) parNom.set(n, i);
  });
  return res;
}

/** Ce que la base répond pour UNE entrée (031, `doublons_equipe`). */
export type DoublonEquipe = {
  /** Une fiche de la base porte le même téléphone. */
  parTelephone: boolean;
  /** Une fiche de la base porte le même nom de société. */
  parSociete: boolean;
  /** …et c'est l'une des MIENNES (je peux l'ouvrir : `ficheId`). */
  aMoi: boolean;
  /** L'une de mes fiches, quand `aMoi` — sinon null, toujours. */
  ficheId: string | null;
  /** Le responsable — rempli pour l'ADMIN seulement, jamais pour un commercial. */
  proprietaire: string | null;
};

export const AUCUN_DOUBLON: DoublonEquipe = {
  parTelephone: false,
  parSociete: false,
  aMoi: false,
  ficheId: null,
  proprietaire: null,
};

export function estDoublonEquipe(d: DoublonEquipe | null | undefined): boolean {
  return Boolean(d && (d.parTelephone || d.parSociete));
}

/**
 * La phrase d'un doublon, la MÊME partout (import, « Ma liste », ajout
 * rapide, MCP). Pour un commercial, jamais de nom : la fiche d'un autre
 * étudiant reste invisible, seule son existence est dite — c'est le prix de
 * la règle « au premier qui l'enregistre ».
 */
export function phraseDoublon(d: DoublonEquipe, nomProprietaire?: string | null): string {
  const pourquoi = d.parTelephone ? "même téléphone" : "même nom";
  if (d.aMoi) return `déjà dans vos fiches (${pourquoi})`;
  if (d.proprietaire) {
    return `déjà suivie dans l'équipe — par ${nomProprietaire ?? "un autre membre"} (${pourquoi})`;
  }
  return `déjà suivie dans l'équipe (${pourquoi})`;
}
