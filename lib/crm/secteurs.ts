/**
 * Les secteurs — UNE liste fixe, une seule normalisation (27 octobre 2026).
 *
 * `prospects.sector` était un texte libre : « garage », « Garage », « Garage
 * automobile », « Garage / Carrosserie », « Carrosserie »… cinq orthographes
 * pour un seul métier, donc aucun filtre ni compteur par secteur possible.
 *
 * La règle est écrite DEUX fois, et c'est voulu : ici (formulaires, ajout
 * rapide, import, « Ma liste », connecteur MCP) et en SQL
 * (`public.normaliser_secteur`, migration 031), parce qu'un trigger normalise
 * aussi ce qu'écrivent le service_role, Janet et le SQL direct. Les deux
 * copies jouent le MÊME jeu de cas, `secteurs.cas.json` (test:secteurs et la
 * recette 031) : si l'une diverge, un des deux tests rougit.
 *
 * Module pur, sans alias `@/` : le test l'exécute tel quel sous node.
 */

export const SECTEURS = [
  "Garage / carrosserie",
  "Syndic de copropriété",
  "Agence immobilière",
  "Vétérinaire",
  "Cabinet dentaire",
  "Centre médical / maison médicale",
  "Kiné / paramédical",
  "Opticien / audioprothésiste",
  "Chauffagiste / plombier",
  "Institut de beauté",
  "Auto-école",
  "Infirmier à domicile",
  "Courtier en assurances",
  "Restaurant / HoReCa",
  "Autre",
] as const;

export type SecteurFixe = (typeof SECTEURS)[number];

/**
 * Mots-clés, dans l'ORDRE (la première règle gagne). Chaque motif est une
 * sous-chaîne cherchée dans le texte minuscule, sans accents. L'ordre porte
 * les cas piégeux :
 *  - « Auto-école » AVANT le garage (« auto » n'est pas un garage) ;
 *  - « paramédical » AVANT « médical » ;
 *  - « dentaire » AVANT « cabinet / médical » ;
 *  - « syndic » AVANT « immobilier » (« syndic et agence immobilière »).
 * Recopié à l'identique dans `normaliser_secteur` (031).
 */
export const REGLES_SECTEUR: ReadonlyArray<readonly [SecteurFixe, readonly string[]]> = [
  ["Auto-école", ["auto-ecole", "auto ecole", "autoecole", "ecole de conduite", "rijschool"]],
  ["Garage / carrosserie", ["garage", "carross", "mecani", "pneu", "depann", "concession", "automobile", "car wash", "carwash"]],
  ["Syndic de copropriété", ["syndic", "copropri"]],
  ["Agence immobilière", ["immobili", "immo "]],
  ["Vétérinaire", ["veterin", "veto"]],
  ["Cabinet dentaire", ["dentist", "dentaire", "orthodont"]],
  ["Kiné / paramédical", ["kine", "physio", "osteo", "logoped", "podolog", "paramedic", "ergotherap"]],
  ["Infirmier à domicile", ["infirmi", "soins a domicile"]],
  ["Centre médical / maison médicale", ["maison medicale", "centre medical", "polyclinique", "medecin", "generaliste", "medical"]],
  ["Opticien / audioprothésiste", ["optic", "audioprot", "audition", "auditif", "lunett"]],
  ["Chauffagiste / plombier", ["chauffag", "plomb", "sanitaire", "chaudiere", "hvac"]],
  ["Institut de beauté", ["beaute", "esthetic", "onglerie", "manucure", "epilation"]],
  ["Courtier en assurances", ["assuranc", "courtier"]],
  ["Restaurant / HoReCa", ["restaura", "horeca", "brasserie", "bistro", "pizzeria", "traiteur", "friterie", "snack", "taverne", "cafe "]],
];

/**
 * Minuscules, sans accents, espaces resserrés, un espace de garde à la fin
 * (« immo », « cafe » ne valent qu'en mot entier : « immo » oui, « immobile »
 * par la règle « immobili »). Les seuls accents retirés sont ceux de la
 * table — la copie SQL fait le même `translate`, pas plus.
 */
const AVEC = "àâäáãåçéèêëíìîïñóòôöõúùûüýÿ";
const SANS = "aaaaaaceeeeiiiinooooouuuuyy";

export function texteSecteur(brut: string): string {
  let t = brut.toLowerCase();
  let r = "";
  for (const c of t) {
    const i = AVEC.indexOf(c);
    r += i >= 0 ? SANS[i] : c;
  }
  t = r.replace(/\s+/g, " ").trim();
  return `${t} `;
}

/**
 * « garage » → « Garage / carrosserie ». Vide ou null → null (on ne devine
 * pas un secteur qui n'a pas été donné) ; texte inconnu → « Autre ».
 */
export function normaliserSecteur(brut: string | null | undefined): SecteurFixe | null {
  if (brut == null) return null;
  const t = texteSecteur(brut);
  if (!t.trim()) return null;
  for (const s of SECTEURS) if (texteSecteur(s) === t) return s;
  for (const [secteur, motifs] of REGLES_SECTEUR) {
    if (motifs.some((m) => t.includes(m))) return secteur;
  }
  return "Autre";
}

export function estSecteurFixe(v: unknown): v is SecteurFixe {
  return typeof v === "string" && (SECTEURS as readonly string[]).includes(v);
}
