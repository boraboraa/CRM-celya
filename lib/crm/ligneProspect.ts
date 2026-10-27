/**
 * La LIGNE `prospects` — construite à un seul endroit (19/10). Module NEUTRE
 * et pur : `createProspectCore` (formulaire complet, ajout rapide du
 * téléphone, connecteur MCP) l'insère telle quelle, et le test la compare.
 *
 * Toutes les colonnes, à chaque fois, `null` quand rien n'est saisi : un
 * formulaire qui n'en porte que trois produit EXACTEMENT les mêmes clés que
 * celui qui en porte treize (le piège PGRST102 des insertions groupées, et un
 * ajout rapide qui se distinguerait d'une fiche créée à la main).
 */
// Chemins RELATIFS avec extension : le test s'exécute tel quel sous node.
import { normalizeStatus } from "../constants.ts";
import { ADRESSE_MAX } from "./maps.ts";
import { normaliserSecteur } from "./secteurs.ts";

export type NewProspectInput = {
  company_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  sector?: string | null;
  /** Adresse libre OU lien Google Maps collé — stockée telle quelle. */
  address?: string | null;
  city?: string | null;
  status?: string | null;
  source?: string | null;
  value_estimate?: number | null;
  /** Probabilité de conclure en % (0–100). null = non renseignée. */
  probability?: number | null;
  /** « none » → vivier non assigné · absent/null → assigné à l'auteur. */
  owner_id?: string | null;
  notes?: string | null;
};

/** Les champs d'un formulaire de fiche — le complet en porte tous, l'ajout rapide quatre. */
export const CHAMPS_FORMULAIRE = [
  "company_name",
  "contact_name",
  "email",
  "phone",
  "website",
  "sector",
  "address",
  "city",
  "status",
  "source",
  "value_estimate",
  "owner_id",
  "notes",
] as const;

/**
 * Lit un formulaire de fiche (`FormData.get`, ou n'importe quel lecteur) :
 * texte nettoyé, vide → null, montant « 1 200,50 » → 1200.5. Un champ que le
 * formulaire ne porte pas vaut null — c'est ce qui rend l'ajout rapide
 * indiscernable du formulaire complet.
 */
export function entreeFormulaire(lire: (cle: string) => unknown): NewProspectInput {
  const str = (k: string): string | null => {
    const v = lire(k);
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t;
  };
  const num = (k: string): number | null => {
    const v = str(k);
    if (v === null) return null;
    const n = Number(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  return {
    company_name: str("company_name"),
    contact_name: str("contact_name"),
    email: str("email"),
    phone: str("phone"),
    website: str("website"),
    sector: str("sector"),
    address: str("address"),
    city: str("city"),
    status: str("status"),
    source: str("source"),
    value_estimate: num("value_estimate"),
    owner_id: str("owner_id"),
    notes: str("notes"),
  };
}

/** Ramène une probabilité à un entier 0–100, ou null. */
export function cleanProbability(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

const trimOrNull = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
};

/**
 * La ligne insérée. `phone` arrive tel que l'appelant le veut (le connecteur
 * MCP le normalise en « +32 » avant ; le formulaire garde la saisie).
 */
export function ligneProspect(input: NewProspectInput, userId: string) {
  const owner = input.owner_id;
  return {
    company_name: trimOrNull(input.company_name) ?? "Sans nom",
    contact_name: trimOrNull(input.contact_name, 120),
    email: trimOrNull(input.email)?.toLowerCase() ?? null,
    phone: trimOrNull(input.phone),
    website: trimOrNull(input.website),
    // La liste fixe (031) : « garage » → « Garage / carrosserie ». Le trigger
    // en base ferait de même ; la ligne renvoyée est déjà juste.
    sector: normaliserSecteur(trimOrNull(input.sector, 80)),
    address: trimOrNull(input.address, ADRESSE_MAX),
    city: trimOrNull(input.city, 80),
    status: normalizeStatus(trimOrNull(input.status)),
    source: trimOrNull(input.source),
    value_estimate:
      typeof input.value_estimate === "number" && Number.isFinite(input.value_estimate)
        ? input.value_estimate
        : null,
    probability: cleanProbability(input.probability),
    // Vivier fermé : « none » ne vaut plus « personne » mais « moi ». Le
    // trigger en base rattraperait un null de toute façon (migration 015),
    // mais mieux vaut que le propriétaire soit posé ici, sciemment.
    owner_id: owner === "none" ? userId : (trimOrNull(owner) ?? userId),
    notes: trimOrNull(input.notes, 4000),
    created_by: userId,
  };
}
