/**
 * Les régions d'une fiche — la liste fermée, et le filtre de /prospects
 * (28 octobre 2026, migration 034).
 *
 * La RÈGLE (quelle commune, quelle région) vit en SQL, une seule fois
 * (`public.lieu_de` + le trigger `prospects_lieu`) : tous les écrivains passent
 * par la base. Ici, seulement la LISTE — la même que `public.regions_valides()`
 * (la recette 034 le vérifie) — et la lecture du filtre `?region=`.
 *
 * Décision de Bora (28/10) : « Bruxelles détaillé » — à Bruxelles, la région
 * EST la commune (les 19) ; ailleurs, la province.
 *
 * Module NEUTRE et pur : la page serveur, la ligne de filtres et le formulaire
 * s'en servent ; le test l'exécute tel quel sous node.
 */

export const COMMUNES_BRUXELLES = [
  "Anderlecht",
  "Auderghem",
  "Berchem-Sainte-Agathe",
  "Bruxelles-Ville",
  "Etterbeek",
  "Evere",
  "Forest",
  "Ganshoren",
  "Ixelles",
  "Jette",
  "Koekelberg",
  "Molenbeek-Saint-Jean",
  "Saint-Gilles",
  "Saint-Josse-ten-Noode",
  "Schaerbeek",
  "Uccle",
  "Watermael-Boitsfort",
  "Woluwe-Saint-Lambert",
  "Woluwe-Saint-Pierre",
] as const;

export const BRUXELLES_A_PRECISER = "Bruxelles (commune à préciser)";

export const PROVINCES_WALLONIE = ["Brabant wallon", "Hainaut", "Liège", "Luxembourg", "Namur"] as const;
export const PROVINCES_FLANDRE = [
  "Anvers",
  "Brabant flamand",
  "Flandre occidentale",
  "Flandre orientale",
  "Limbourg",
] as const;
export const HORS_BELGIQUE = "Hors Belgique";

export const REGIONS = [
  ...COMMUNES_BRUXELLES,
  BRUXELLES_A_PRECISER,
  ...PROVINCES_WALLONIE,
  ...PROVINCES_FLANDRE,
  HORS_BELGIQUE,
] as const;
export type Region = (typeof REGIONS)[number];

export function estRegion(v: unknown): v is Region {
  return typeof v === "string" && (REGIONS as readonly string[]).includes(v);
}

/** Les groupes du menu (`<optgroup>`) et du filtre « tout le groupe ». */
export const GROUPES_REGION = [
  { cle: "bruxelles", label: "Bruxelles", regions: [...COMMUNES_BRUXELLES, BRUXELLES_A_PRECISER] },
  { cle: "wallonie", label: "Wallonie", regions: [...PROVINCES_WALLONIE] },
  { cle: "flandre", label: "Flandre", regions: [...PROVINCES_FLANDRE] },
  { cle: "hors", label: "Hors Belgique", regions: [HORS_BELGIQUE] },
] as const satisfies readonly { cle: string; label: string; regions: readonly Region[] }[];

/** Le libellé court d'une région dans un menu : « Bruxelles (commune à préciser) » → « Commune à préciser ». */
export function libelleRegionCourt(r: Region): string {
  return r === BRUXELLES_A_PRECISER ? "Commune à préciser" : r;
}

// ---------------------------------------------------------------------------
// Le filtre de /prospects : `?region=`
// ---------------------------------------------------------------------------
// Une région (« Anderlecht », « Namur »), un groupe (« g:bruxelles » = toutes
// les communes de Bruxelles), ou « aucune » (région inconnue — pour les
// compléter). Toute autre valeur est ignorée, jamais recopiée dans une URL.

export const REGION_AUCUNE = "aucune";

const LIBELLE_GROUPE: Record<(typeof GROUPES_REGION)[number]["cle"], string> = {
  bruxelles: "Tout Bruxelles",
  wallonie: "Toute la Wallonie",
  flandre: "Toute la Flandre",
  hors: "Hors Belgique",
};

export type FiltreRegion =
  | { type: "regions"; regions: Region[]; label: string }
  | { type: "aucune"; label: string };

export function lireFiltreRegion(valeur: string | null | undefined): FiltreRegion | null {
  if (!valeur) return null;
  if (valeur === REGION_AUCUNE) return { type: "aucune", label: "Région inconnue" };
  if (valeur.startsWith("g:")) {
    const g = GROUPES_REGION.find((x) => x.cle === valeur.slice(2));
    return g ? { type: "regions", regions: [...g.regions], label: LIBELLE_GROUPE[g.cle] } : null;
  }
  return estRegion(valeur) ? { type: "regions", regions: [valeur], label: valeur } : null;
}

/** La valeur à garder dans l'URL, ou null si elle ne vaut rien. */
export function valeurFiltreRegion(valeur: string | null | undefined): string | null {
  return lireFiltreRegion(valeur) ? valeur! : null;
}

// ---------------------------------------------------------------------------
// Ce que la liste affiche du lieu
// ---------------------------------------------------------------------------
/**
 * « Éghezée (Namur) », « Laeken (Bruxelles-Ville) », « Ixelles » : la commune,
 * et la région entre parenthèses quand elle apprend quelque chose. Sans
 * commune, la région seule (« Bruxelles » pour une commune à préciser).
 */
export function lieuAffiche(city: string | null | undefined, region: string | null | undefined): string | null {
  const c = city?.trim() || null;
  const r = region?.trim() || null;
  if (!c) return r === BRUXELLES_A_PRECISER ? "Bruxelles" : r;
  if (!r || r === c || r === BRUXELLES_A_PRECISER || r === HORS_BELGIQUE) return c;
  return `${c} (${r})`;
}

/**
 * Le menu « Région » de /prospects — des chaînes seulement (il traverse vers
 * un composant client) : [libellé du groupe, [valeur, libellé][]][]. Chaque
 * groupe commence par « Tout … » quand il compte plusieurs régions.
 */
export function optionsFiltreRegion(): [string, [string, string][]][] {
  const groupes: [string, [string, string][]][] = GROUPES_REGION.map((g) => {
    const tout = lireFiltreRegion(`g:${g.cle}`)!;
    const lignes: [string, string][] = g.regions.map((r) => [r, libelleRegionCourt(r)]);
    return [g.label, g.regions.length > 1 ? [[`g:${g.cle}`, tout.label], ...lignes] : lignes];
  });
  groupes.push(["À compléter", [[REGION_AUCUNE, "Région inconnue"]]]);
  return groupes;
}

// ---------------------------------------------------------------------------
// La région devinée par l'indicatif du fixe (29/10, décision de Bora)
// ---------------------------------------------------------------------------
/**
 * Recopie de `public.region_de_telephone` (migration 038) — la base l'applique
 * seule, via le trigger `prospects_lieu`, QUAND la commune et l'adresse n'ont
 * rien donné. Ici pour les tests (jeu de cas commun `indicatifs.cas.json`,
 * joué aussi par la recette 038).
 *
 * Un fixe belge s'écrit sur 9 chiffres (0 compris) : « 02 », « 03 », « 04 »,
 * « 09 » à deux chiffres, les autres à trois. Un GSM (10 chiffres, 046x–049x),
 * un numéro spécial (0800, 090x…) ou étranger ne disent rien. Les zones à
 * cheval sur deux provinces (056 Courtrai/Mouscron, 067 Nivelles/Soignies)
 * non plus. Le 02 couvre aussi la périphérie flamande : il donne « Bruxelles
 * (commune à préciser) », jamais une commune.
 */
const ZONES: Record<string, Region> = {
  "02": BRUXELLES_A_PRECISER,
  "03": "Anvers",
  "04": "Liège",
  "09": "Flandre orientale",
  "010": "Brabant wallon",
  "011": "Limbourg",
  "012": "Limbourg",
  "013": "Brabant flamand",
  "014": "Anvers",
  "015": "Anvers",
  "016": "Brabant flamand",
  "019": "Liège",
  "050": "Flandre occidentale",
  "051": "Flandre occidentale",
  "052": "Flandre orientale",
  "053": "Flandre orientale",
  "054": "Flandre orientale",
  "055": "Flandre orientale",
  "057": "Flandre occidentale",
  "058": "Flandre occidentale",
  "059": "Flandre occidentale",
  "060": "Hainaut",
  "061": "Luxembourg",
  "063": "Luxembourg",
  "064": "Hainaut",
  "065": "Hainaut",
  "068": "Hainaut",
  "069": "Hainaut",
  "071": "Hainaut",
  "080": "Liège",
  "081": "Namur",
  "082": "Namur",
  "083": "Namur",
  "084": "Luxembourg",
  "085": "Liège",
  "086": "Luxembourg",
  "087": "Liège",
  "089": "Limbourg",
};

export function regionDeTelephone(tel: string | null | undefined): Region | null {
  let n = (tel ?? "").replace(/\D/g, "");
  if (n.startsWith("0032")) n = "0" + n.slice(4);
  else if (n.startsWith("32") && (tel ?? "").trim().startsWith("+")) n = "0" + n.slice(2);
  if (n.length !== 9 || !n.startsWith("0")) return null;
  // Numéros spéciaux : gratuits (0800), payants (090x), zonaux nationaux (070, 077, 078).
  if (/^0(800|90|70|77|78)/.test(n)) return null;
  return ZONES[n.slice(0, 2)] ?? ZONES[n.slice(0, 3)] ?? null;
}

// ---------------------------------------------------------------------------
// La pastille région de la liste, du pipeline et de la fiche (29/10)
// ---------------------------------------------------------------------------
/**
 * « Bruxelles · Auderghem », « Bruxelles » (commune à préciser), « Brabant
 * flamand », « Hors Belgique » — ou « Région ? » quand on ne sait pas.
 */
export function pastilleRegion(region: string | null | undefined): { label: string; connue: boolean } {
  const r = region?.trim() || null;
  if (!r || !estRegion(r)) return { label: "Région ?", connue: false };
  if (r === BRUXELLES_A_PRECISER) return { label: "Bruxelles", connue: true };
  if ((COMMUNES_BRUXELLES as readonly string[]).includes(r)) return { label: `Bruxelles · ${r}`, connue: true };
  return { label: r, connue: true };
}

/**
 * La commune à côté de la pastille : seulement quand elle apprend quelque
 * chose (« Overijse » sous « Brabant flamand », « Laeken » sous
 * « Bruxelles · Bruxelles-Ville ») — jamais « Auderghem » deux fois.
 */
export function communeAffichee(city: string | null | undefined, region: string | null | undefined): string | null {
  const c = city?.trim() || null;
  if (!c) return null;
  return c === region?.trim() ? null : c;
}
