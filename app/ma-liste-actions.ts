"use server";

/**
 * « Ma liste » — les server actions (27/10/2026). L'écran tient l'état du chat
 * en mémoire (aucune table) ; le serveur LIT (code d'abord, modèle ensuite),
 * VÉRIFIE (doublons du lot et de l'équipe) et IMPORTE (le chemin de l'import
 * CSV, `importProspectsCore`, qui revérifie tout).
 *
 * Tout ce qui revient du navigateur est REPASSÉ par `rangerFiche` : une server
 * action se rejoue avec n'importe quel corps, l'écran n'est pas une garantie.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { lireCollage, corrigerAvecAssistant, type LectureCollage } from "@/lib/crm/maListeIA";
import {
  etatsDesFiches,
  ligneImport,
  rangerFiche,
  recapitulatif,
  type Defauts,
  type EtatFiche,
  type FicheCollee,
} from "@/lib/crm/maListe";
import { doublonsEquipe } from "@/lib/crm/doublonsEquipe";
import { importProspectsCore, nomsDesProprietaires, type ImportResult } from "@/lib/crm/prospects";

/** Ce que l'écran garde en mémoire : au plus 200 fiches (deux collages et demi). */
const PLAFOND_SESSION = 200;

async function contexte() {
  const supabase = await createClient();
  const session = await getSession();
  if (!session?.userId || !session.me?.is_active) redirect("/login");
  return { supabase, userId: session.userId, isAdmin: session.me.role === "admin" };
}

/** Repasse ce que le navigateur renvoie par les règles du code. */
function nettoyer(fiches: unknown): FicheCollee[] {
  if (!Array.isArray(fiches)) return [];
  const res: FicheCollee[] = [];
  for (const f of fiches.slice(0, PLAFOND_SESSION)) {
    if (!f || typeof f !== "object") continue;
    const brute = f as Record<string, unknown>;
    const r = rangerFiche({ ...brute, phone: brute.phone ?? brute.phone_lu }, { secteur: null, ville: null });
    if (r) res.push(r);
  }
  return res;
}

export type EtatListe = {
  fiches: FicheCollee[];
  etats: EtatFiche[];
  recap: string;
  /** La vérification d'équipe n'a pas pu se faire (031 absente, panne). */
  equipeIndisponible: boolean;
  /**
   * La région que la base déduira à l'import, par fiche (034, `lieux_de` —
   * la même règle que le trigger) : la commune à Bruxelles, la province
   * ailleurs. null : rien de lisible (à compléter après).
   */
  regions: (string | null)[];
};

/** La région de chaque fiche, telle que le trigger la posera. Panne : rien, sans erreur. */
async function regionsDe(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fiches: FicheCollee[]
): Promise<(string | null)[]> {
  const vides = fiches.map(() => null);
  if (fiches.length === 0) return vides;
  const { data, error } = await supabase.rpc("lieux_de", {
    p_villes: fiches.map((f) => f.city ?? null),
    p_adresses: fiches.map((f) => f.address ?? null),
    p_noms: fiches.map((f) => f.company_name ?? null),
  });
  if (error || !Array.isArray(data)) return vides;
  const out: (string | null)[] = [...vides];
  for (const r of data as { i: number; region: string | null }[]) {
    if (r.i >= 1 && r.i <= out.length) out[r.i - 1] = r.region ?? null;
  }
  return out;
}

async function verifier(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fiches: FicheCollee[]
): Promise<EtatListe> {
  const [{ doublons, indisponible }, regions] = await Promise.all([
    doublonsEquipe(
      supabase,
      fiches.map((f) => ({ telephone: f.phone ?? f.phone_lu, societe: f.company_name }))
    ),
    regionsDe(supabase, fiches),
  ]);
  const noms = await nomsDesProprietaires(supabase, doublons.map((d) => d.proprietaire));
  const etats = etatsDesFiches(fiches, doublons, (id) => noms.get(id) ?? null);
  return { fiches, etats, recap: recapitulatif(etats), equipeIndisponible: indisponible, regions };
}

/**
 * Lire un collage et l'AJOUTER à la liste en cours (on peut coller une
 * deuxième liste ensuite). Les doublons se calculent sur l'ensemble.
 */
export async function lireMaListeAction(input: {
  texte: string;
  defauts: Defauts;
  existantes: unknown;
}): Promise<
  EtatListe & {
    lecture: Omit<LectureCollage, "fiches"> & {
      nouvelles: number;
      /** Par fiche ajoutée : ce que le code n'a pas pu confirmer dans le texte. */
      aVerifier: string[][];
    };
  }
> {
  const { supabase } = await contexte();
  const existantes = nettoyer(input.existantes);
  const defauts: Defauts = {
    secteur: typeof input.defauts?.secteur === "string" ? input.defauts.secteur : null,
    ville: typeof input.defauts?.ville === "string" ? input.defauts.ville.slice(0, 80) : null,
  };
  const lu = await lireCollage(String(input.texte ?? "").slice(0, 50_000), defauts);
  const place = Math.max(0, PLAFOND_SESSION - existantes.length);
  const nouvelles = lu.fiches.slice(0, place);
  const fiches = [...existantes, ...nouvelles.map(({ aVerifier: _a, ...f }) => f)];
  const etat = await verifier(supabase, fiches);
  const { fiches: _f, ...reste } = lu;
  return {
    ...etat,
    lecture: {
      ...reste,
      tronque: reste.tronque || nouvelles.length < lu.fiches.length,
      nouvelles: nouvelles.length,
      aVerifier: nouvelles.map((f) => f.aVerifier),
    },
  };
}

/** Revérifier après une modification à la main (le tableau est éditable). */
export async function verifierMaListeAction(fiches: unknown): Promise<EtatListe> {
  const { supabase } = await contexte();
  return verifier(supabase, nettoyer(fiches));
}

/** Une correction que le code n'a pas su lire : le modèle propose, le code valide. */
export async function corrigerMaListeAction(input: {
  message: string;
  fiches: unknown;
}): Promise<EtatListe & { reponse: string; indisponible: boolean }> {
  const { supabase } = await contexte();
  const r = await corrigerAvecAssistant(String(input.message ?? ""), nettoyer(input.fiches));
  const etat = await verifier(supabase, r.fiches);
  return { ...etat, reponse: r.reponse, indisponible: r.indisponible };
}

/**
 * Importer. Seules les fiches « à créer » partent ; `importProspectsCore`
 * revérifie le lot, l'équipe et l'e-mail (une autre personne a pu enregistrer
 * la même société pendant qu'on relisait). Étape « À appeler », toujours :
 * coller une liste n'est pas un échange. Responsable : soi — l'admin choisit.
 */
export async function importerMaListeAction(input: {
  fiches: unknown;
  ownerId?: string | null;
}): Promise<ImportResult> {
  const { supabase, userId, isAdmin } = await contexte();
  const fiches = nettoyer(input.fiches);
  if (fiches.length === 0) return { inserted: 0, skipped: 0, reasons: [], error: "Aucune fiche à importer." };
  const owner = isAdmin && typeof input.ownerId === "string" && input.ownerId ? input.ownerId : userId;

  const result = await importProspectsCore(
    supabase,
    userId,
    fiches.map(ligneImport),
    owner
  );
  if (result.inserted > 0) {
    revalidatePath("/prospects");
    revalidatePath("/dashboard");
  }
  return result;
}
