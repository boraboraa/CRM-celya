/**
 * Cœur « prospects » — indépendant des cookies et de Next. C'est l'unique
 * chemin d'insertion d'un prospect : le formulaire (app/actions.ts) comme le
 * connecteur MCP passent par ici. Un prospect créé par le connecteur est donc
 * indiscernable d'un prospect créé à la main.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeStatus } from "@/lib/constants";
import { findDuplicates, normalizeBelgianPhone, type DuplicateHit } from "./dedup";
import { normaliserSecteur } from "./secteurs";
import { doublonsDansLeLot, estDoublonEquipe, phraseDoublon } from "./doublons";
import { doublonsEquipe } from "./doublonsEquipe";
import type { Viewer } from "./access";

// La ligne et la lecture du formulaire vivent dans un module pur, testé
// (ligneProspect.ts) ; ré-exportées ici pour les appelants existants.
export { cleanProbability, type NewProspectInput } from "./ligneProspect";
import { ligneProspect, cleanProbability, type NewProspectInput } from "./ligneProspect";

export type CreateProspectResult = {
  error?: string;
  /** Renseigné si la création a abouti. */
  id?: string;
  /**
   * Renseigné (sans insertion) quand la dédup a détecté des fiches proches et
   * que `force` n'est pas demandé : on prévient, on ne crée pas en double.
   */
  duplicates?: DuplicateHit[];
  /**
   * Renseigné (sans insertion) quand la fiche est DÉJÀ SUIVIE par un autre
   * membre de l'équipe (031) : la phrase à afficher, qui ne nomme personne
   * pour un commercial. Un commercial ne passe jamais outre — la fiche est
   * à qui l'a enregistrée la première ; l'admin, avec `force`.
   */
  doublonEquipe?: string;
};

const trimOrNull = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
};

/**
 * Insère un prospect.
 *  - `checkDuplicates` : compare aux fiches existantes (téléphone / email /
 *    société) et, si `force` est faux, renvoie les doublons sans créer.
 *  - `normalizePhone` : applique la normalisation « +32 » déterministe (le
 *    connecteur MCP l'active ; le formulaire conserve la saisie telle quelle).
 */
export async function createProspectCore(
  supabase: SupabaseClient,
  userId: string,
  input: NewProspectInput,
  opts: {
    checkDuplicates?: boolean;
    normalizePhone?: boolean;
    force?: boolean;
    /** Renseigné par le connecteur MCP seul : il agit en service_role, donc
     *  la dédup doit être bornée à son portefeuille à la main. Voir access.ts. */
    scope?: Viewer | null;
    /**
     * Vérifier l'équipe entière (031, `doublons_equipe`) : téléphone et nom.
     * `viewerId` quand l'appelant est en service_role (MCP) ; `isAdmin` dit
     * si `force` peut passer outre.
     */
    equipe?: { viewerId?: string; isAdmin: boolean };
  } = {}
): Promise<CreateProspectResult> {
  const rawPhone = trimOrNull(input.phone);
  const phone = opts.normalizePhone ? normalizeBelgianPhone(rawPhone) : rawPhone;
  const company = trimOrNull(input.company_name) ?? "Sans nom";
  const email = trimOrNull(input.email)?.toLowerCase() ?? null;

  if (opts.checkDuplicates && !opts.force) {
    const duplicates = await findDuplicates(
      supabase,
      { company_name: company, phone, email },
      opts.scope
    );
    if (duplicates.length > 0) return { duplicates };
  }

  if (opts.equipe) {
    const { doublons } = await doublonsEquipe(
      supabase,
      [{ telephone: phone, societe: company }],
      opts.equipe.viewerId
    );
    const d = doublons[0];
    // Ma propre fiche : les doublons visibles (ci-dessus, ou la recherche de
    // l'écran) en parlent déjà. Celle d'un autre : on refuse — sauf l'admin
    // qui force.
    if (estDoublonEquipe(d) && !d.aMoi && !(opts.equipe.isAdmin && opts.force)) {
      const noms = await nomsDesProprietaires(supabase, [d.proprietaire]);
      return { doublonEquipe: phraseDoublon(d, d.proprietaire ? noms.get(d.proprietaire) : null) };
    }
  }

  const { data, error } = await supabase
    .from("prospects")
    .insert(ligneProspect({ ...input, phone }, userId))
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: data.id as string };
}

// ---------------------------------------------------------------------------
// Import en lot — dédup ligne par ligne, insertion par paquets.
//
// Trois filets, dans cet ordre (27/10) :
//  1. dans le fichier lui-même — e-mail, téléphone, nom de société ;
//  2. dans TOUTE l'équipe — téléphone et nom (`doublons_equipe`, 031), sans
//     rien apprendre de la fiche d'un autre : « déjà suivie dans l'équipe » ;
//  3. l'e-mail déjà présent dans ce que le lecteur voit.
// Jusque-là, seul le 3 existait : une liste Google Maps n'a presque jamais
// d'e-mail, deux étudiants importaient le même cabinet sans alerte.
// ---------------------------------------------------------------------------

export type ImportRow = Partial<
  Record<
    | "company_name"
    | "contact_name"
    | "email"
    | "phone"
    | "website"
    | "sector"
    | "address"
    | "city"
    | "status"
    | "source"
    | "value_estimate"
    | "notes",
    string
  >
>;

export type ImportResult = {
  inserted: number;
  skipped: number;
  reasons: string[];
  /** Nombre de fiches qui *seraient* créées — renseigné en simulation. */
  pending?: number;
  /**
   * Avec `rendreIds` seulement : l'identifiant créé pour CHAQUE ligne reçue,
   * au même index — null pour une ligne ignorée (société manquante, doublon),
   * en simulation, ou si la fiche rendue ne correspond pas à la ligne envoyée.
   * Le connecteur MCP s'en sert pour écrire le brief d'appel de chaque fiche.
   */
  ids?: (string | null)[];
  error?: string;
};

import type { ProspectStatus } from "@/lib/types";

const STATUS_ALIASES: Record<string, ProspectStatus> = {
  a_appeler: "a_appeler",
  "à appeler": "a_appeler",
  "a appeler": "a_appeler",
  nouveau: "a_appeler",
  new: "a_appeler",
  contacte: "contacte",
  contacté: "contacte",
  contacted: "contacte",
  contact_etabli: "contacte",
  "contact établi": "contacte",
  "contact etabli": "contacte",
  sans_reponse: "contacte",
  "sans réponse": "contacte",
  "sans reponse": "contacte",
  rappel_programme: "contacte",
  "rappel programmé": "contacte",
  "rappel programme": "contacte",
  rendez_vous: "rendez_vous",
  "rendez-vous": "rendez_vous",
  "rendez vous": "rendez_vous",
  rdv: "rendez_vous",
  "rdv fixé": "rendez_vous",
  "rdv fixe": "rendez_vous",
  qualifie: "rendez_vous",
  qualifié: "rendez_vous",
  qualified: "rendez_vous",
  meeting: "rendez_vous",
  a_rappeler: "a_rappeler",
  "à rappeler": "a_rappeler",
  "a rappeler": "a_rappeler",
  suivi_email: "suivi_email",
  "suivi par email": "suivi_email",
  "suivi email": "suivi_email",
  proposition: "proposition",
  devis: "proposition",
  proposal: "proposition",
  negociation: "proposition",
  négociation: "proposition",
  negotiation: "proposition",
  essai_gratuit: "essai_gratuit",
  "essai gratuit": "essai_gratuit",
  essai: "essai_gratuit",
  trial: "essai_gratuit",
  gagne: "gagne",
  gagné: "gagne",
  won: "gagne",
  client: "gagne",
  perdu: "perdu",
  lost: "perdu",
};

function toStatus(raw?: string): ProspectStatus {
  if (!raw) return "a_appeler";
  return STATUS_ALIASES[raw.trim().toLowerCase()] ?? "a_appeler";
}

function toNumber(raw?: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\s/g, "");
  if (!cleaned) return null;
  // « 4.800,50 » (format FR) vs « 4,800.50 » (format EN)
  const normalised =
    cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

const clean = (v?: string): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Import en lot. `dryRun` calcule le résumé (créés / doublons ignorés /
 * erreurs) sans rien écrire — le connecteur MCP l'utilise pour proposer avant
 * d'agir. Ne s'arrête jamais au premier problème de ligne : les lignes fautives
 * sont comptées et expliquées, les bonnes sont insérées.
 */
export async function importProspectsCore(
  supabase: SupabaseClient,
  userId: string,
  rows: ImportRow[],
  ownerId: string | null,
  opts: {
    dryRun?: boolean;
    /**
     * Rendre l'id créé pour chaque ligne (`ImportResult.ids`). Demande à
     * PostgREST de renvoyer les lignes insérées, donc de pouvoir les RELIRE :
     * réservé au connecteur MCP (service_role). Sous une session, une fiche
     * importée au nom d'un autre ne serait pas relisible et l'insertion
     * entière échouerait — d'où une option, et non un comportement par défaut.
     */
    rendreIds?: boolean;
    /**
     * Le porteur du jeton, quand l'appelant agit en service_role (connecteur
     * MCP) : la vérification d'équipe passe alors par
     * `doublons_equipe_pour(viewer)`. Absent : le client est celui de
     * l'utilisateur, `doublons_equipe` lit `auth.uid()`.
     */
    viewerId?: string;
  } = {}
): Promise<ImportResult> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { inserted: 0, skipped: 0, reasons: [], error: "Aucune ligne à importer." };
  }
  if (rows.length > 2000) {
    return {
      inserted: 0,
      skipped: 0,
      reasons: [],
      error: "Maximum 2000 lignes par import. Découpez votre fichier.",
    };
  }

  // 3. L'e-mail déjà présent dans ce que le lecteur voit (RLS, ou tout pour
  // le service_role — l'adresse vient de l'appelant, rien n'est appris).
  const { data: existing } = await supabase
    .from("prospects")
    .select("email")
    .not("email", "is", null);

  const seen = new Set(
    (existing ?? [])
      .map((c) => (c.email as string | null)?.toLowerCase())
      .filter(Boolean) as string[]
  );

  // 1 et 2 : le fichier, puis l'équipe — calculés d'un coup, avant la boucle.
  const entrees = rows.map((r) => ({ telephone: clean(r.phone), societe: clean(r.company_name) }));
  const dansLeLot = doublonsDansLeLot(entrees);
  const { doublons: equipe } = await doublonsEquipe(supabase, entrees, opts.viewerId);
  const noms = await nomsDesProprietaires(supabase, equipe.map((d) => d.proprietaire));

  const reasons: string[] = [];
  let skipped = 0;
  const payload: Record<string, unknown>[] = [];
  /** Pour chaque ligne du payload, son index dans `rows`. */
  const origines: number[] = [];

  rows.forEach((row, index) => {
    const ligne = index + 2; // +1 en-tête, +1 pour compter à partir de 1
    const company = clean(row.company_name);
    const ignorer = (pourquoi: string) => {
      skipped++;
      if (reasons.length < 12) reasons.push(`Ligne ${ligne} : ${pourquoi}`);
    };

    if (!company) return ignorer("société manquante");

    const double = dansLeLot.get(index);
    if (double) {
      return ignorer(
        `${company} — répète la ligne ${double.premier + 2} (${double.raison === "telephone" ? "même téléphone" : "même nom"})`
      );
    }
    if (estDoublonEquipe(equipe[index])) {
      const d = equipe[index];
      return ignorer(`${company} — ${phraseDoublon(d, d.proprietaire ? noms.get(d.proprietaire) : null)}`);
    }

    const email = clean(row.email)?.toLowerCase() ?? null;
    if (email && seen.has(email)) return ignorer(`${email} existe déjà`);
    if (email) seen.add(email);

    payload.push({
      company_name: company,
      contact_name: clean(row.contact_name),
      email,
      phone: clean(row.phone),
      website: clean(row.website),
      sector: normaliserSecteur(clean(row.sector)),
      address: clean(row.address),
      city: clean(row.city),
      status: toStatus(row.status),
      source: clean(row.source) ?? "Import CSV",
      value_estimate: toNumber(row.value_estimate),
      notes: clean(row.notes),
      // Idem : un import appartient à quelqu'un. « none »/null retombent sur
      // l'auteur de l'import plutôt que dans un vivier qui n'existe plus.
      owner_id: ownerId === "none" || ownerId === null ? userId : ownerId,
      created_by: userId,
    });
    origines.push(index);
  });

  const ids: (string | null)[] | undefined = opts.rendreIds ? rows.map(() => null) : undefined;

  // Simulation : on renvoie ce qui serait fait, sans écrire.
  if (opts.dryRun) {
    return { inserted: 0, skipped, reasons, pending: payload.length, ...(ids ? { ids } : {}) };
  }

  let inserted = 0;
  for (let i = 0; i < payload.length; i += 200) {
    const chunk = payload.slice(i, i + 200);
    let error: { message: string } | null = null;
    if (ids) {
      const r = await supabase.from("prospects").insert(chunk).select("id, company_name, email");
      error = r.error;
      const rendues = (r.data ?? []) as { id: string; company_name: string; email: string | null }[];
      // PostgREST rend les lignes dans l'ordre d'insertion ; on le vérifie
      // quand même, ligne par ligne : un id mal apparié écrirait le brief
      // d'une fiche sur une autre. Au moindre doute, null.
      rendues.forEach((f, j) => {
        const envoye = chunk[j];
        if (envoye && f.company_name === envoye.company_name && (f.email ?? null) === (envoye.email ?? null)) {
          ids[origines[i + j]] = f.id;
        }
      });
      if (!error) inserted += rendues.length;
    } else {
      const r = await supabase.from("prospects").insert(chunk, { count: "exact" });
      error = r.error;
      if (!error) inserted += r.count ?? chunk.length;
    }

    if (error) {
      return {
        inserted,
        skipped,
        reasons,
        ...(ids ? { ids } : {}),
        error: `Import interrompu après ${inserted} fiche(s) : ${error.message}`,
      };
    }
  }

  return { inserted, skipped, reasons, ...(ids ? { ids } : {}) };
}

/**
 * Les noms des responsables que la base a désignés — elle ne les désigne qu'à
 * l'ADMIN (031) : pour un commercial, la liste est vide et rien n'est lu.
 */
export async function nomsDesProprietaires(
  supabase: SupabaseClient,
  ids: (string | null)[]
): Promise<Map<string, string>> {
  const uniques = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const noms = new Map<string, string>();
  if (uniques.length === 0) return noms;
  const { data } = await supabase.from("crm_users").select("id, full_name, email").in("id", uniques);
  for (const u of (data ?? []) as { id: string; full_name: string | null; email: string }[]) {
    noms.set(u.id, u.full_name?.trim() || u.email);
  }
  return noms;
}
