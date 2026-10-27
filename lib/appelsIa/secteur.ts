/**
 * Le secteur d'une fiche, pour choisir le script de Janet — pur, testé.
 *
 * `prospects.sector` est un texte libre (« Garage / carrosserie »,
 * « Dentiste », « Restaurant / HoReCa »…). Quatre scripts : garage,
 * restaurant, cabinet, autre. Inconnu ou vide : « autre ».
 */

import { normaliserSecteur, type SecteurFixe } from "../crm/secteurs.ts";

export type Secteur = "garage" | "restaurant" | "cabinet" | "autre";

export const SECTEURS: Secteur[] = ["garage", "restaurant", "cabinet", "autre"];

export const SECTEUR_LABEL: Record<Secteur, string> = {
  garage: "Garage",
  restaurant: "Restaurant",
  cabinet: "Cabinet",
  autre: "Autre",
};

const GARAGE =
  /\b(garages?|garagiste|carrosseries?|carrossier|mecani\w*|automobiles?|autos?|pneus?|pneumatiques?|depann\w*|concession\w*|car ?wash|motos?|carrosserie)\b/;
const RESTAURANT =
  /\b(restaurants?|resto|horeca|brasseries?|bistrots?|bistro|cafes?|pizzerias?|traiteurs?|friteries?|snacks?|bars?|tavernes?|gastronom\w*|cuisines?|trattoria|sushi)\b/;
const CABINET =
  /\b(cabinets?|dentistes?|dentaires?|orthodont\w*|veterinaires?|veto|medecins?|medical|medicale|kines?|kinesitherapeutes?|osteopathes?|osteo|psychologues?|logopedes?|infirmiers?|infirmieres?|cliniques?|podologues?|dermatolog\w*|ophtalmolog\w*|pediatres?|generalistes?|sage-femme|polyclinique|paramedical)\b/;

/**
 * Depuis la liste fixe (031), le script se choisit par CORRESPONDANCE
 * EXPLICITE : l'expression régulière prenait « Auto-école » pour un garage
 * (« auto »). Elle ne sert plus que de repli, pour un texte que la liste
 * classe « Autre » (ou une fiche écrite avant la 031).
 */
export const SCRIPT_DU_SECTEUR: Record<SecteurFixe, Secteur> = {
  "Garage / carrosserie": "garage",
  "Syndic de copropriété": "autre",
  "Agence immobilière": "autre",
  "Vétérinaire": "cabinet",
  "Cabinet dentaire": "cabinet",
  "Centre médical / maison médicale": "cabinet",
  "Kiné / paramédical": "cabinet",
  "Opticien / audioprothésiste": "autre",
  "Chauffagiste / plombier": "autre",
  "Institut de beauté": "autre",
  "Auto-école": "autre",
  "Infirmier à domicile": "cabinet",
  "Courtier en assurances": "autre",
  "Restaurant / HoReCa": "restaurant",
  Autre: "autre",
};

export function secteurDe(brut: string | null | undefined): Secteur {
  const fixe = normaliserSecteur(brut);
  if (fixe && fixe !== "Autre") return SCRIPT_DU_SECTEUR[fixe];
  const t = (brut ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (!t.trim()) return "autre";
  if (GARAGE.test(t)) return "garage";
  if (CABINET.test(t)) return "cabinet";
  if (RESTAURANT.test(t)) return "restaurant";
  return "autre";
}
