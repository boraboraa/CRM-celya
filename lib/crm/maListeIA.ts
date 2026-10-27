/**
 * « Ma liste » — le passage par le modèle (27/10/2026). Serveur seulement :
 * il appelle `chatJSON` (lib/ai/provider.ts), qui jette s'il est importé côté
 * client et ne lève jamais (null sur toute panne).
 *
 *   1. le code lit ce qu'il sait lire (`lireDeterministe`) ;
 *   2. s'il reste des lignes qu'il ne sait pas lire, TOUT le collage part au
 *      modèle, en morceaux (les remarques se lisent avec la fiche qu'elles
 *      suivent) — sauf si l'assistant est indisponible : on garde la lecture
 *      du code, et l'écran dit ce qui n'a pas été lu ;
 *   3. ce que rend le modèle est VALIDÉ contre le collage (`validerSortieModele`).
 *
 * Imports relatifs avec extension : le test (test:ma-liste) l'exécute sous
 * node contre un faux fournisseur HTTP local.
 */

import { aiAvailable, chatJSON } from "../ai/provider.ts";
import {
  SYSTEM_CORRECTION,
  validerCorrectionsModele,
  type FicheCollee,
  PLAFOND_CARACTERES,
  PLAFOND_FICHES,
  SYSTEM_MA_LISTE,
  lireDeterministe,
  morceaux,
  validerSortieModele,
  type Defauts,
  type FicheAVerifier,
} from "./maListe.ts";

export type LectureCollage = {
  fiches: FicheAVerifier[];
  /** « lecture » : le code seul ; « assistant » : le modèle est passé. */
  source: "lecture" | "assistant";
  /** Lignes que personne n'a lues (assistant indisponible, ou en panne). */
  nonLues: string[];
  /** L'assistant manquait ou a échoué : l'écran le dit, et propose le CSV. */
  assistantIndisponible: boolean;
  /** Le collage dépassait le plafond : la fin n'a pas été lue. */
  tronque: boolean;
  error?: string;
};

/** Au plus trois morceaux en même temps : sous la minute d'une fonction Vercel. */
const EN_PARALLELE = 3;

export async function lireCollage(texte: string, defauts: Defauts): Promise<LectureCollage> {
  const brut = (texte ?? "").trim();
  if (!brut) {
    return { fiches: [], source: "lecture", nonLues: [], assistantIndisponible: false, tronque: false, error: "Rien à lire : collez votre liste." };
  }
  const tronque = brut.length > PLAFOND_CARACTERES;
  const collage = tronque ? brut.slice(0, PLAFOND_CARACTERES) : brut;

  const lu = lireDeterministe(collage, defauts);
  if (lu.nonLues.length === 0) {
    return {
      fiches: lu.fiches.slice(0, PLAFOND_FICHES).map((f) => ({ ...f, aVerifier: [] })),
      source: "lecture",
      nonLues: [],
      assistantIndisponible: false,
      tronque: tronque || lu.fiches.length > PLAFOND_FICHES,
    };
  }

  const repli = (): LectureCollage => ({
    fiches: lu.fiches.slice(0, PLAFOND_FICHES).map((f) => ({ ...f, aVerifier: [] })),
    source: "lecture",
    nonLues: lu.nonLues,
    assistantIndisponible: true,
    tronque,
  });
  if (!aiAvailable(false)) return repli();

  const parts = morceaux(collage);
  const sorties: (Record<string, unknown> | null)[] = new Array(parts.length).fill(null);
  for (let i = 0; i < parts.length; i += EN_PARALLELE) {
    await Promise.all(
      parts.slice(i, i + EN_PARALLELE).map(async (part, j) => {
        sorties[i + j] = await chatJSON({
          system: SYSTEM_MA_LISTE,
          user: `Texte :\n${part}`,
          maxTokens: 4000,
        });
      })
    );
  }
  // Un seul morceau en panne et c'est tout le collage qui serait incomplet
  // sans qu'on le sache : on retombe sur la lecture du code, et on le dit.
  if (sorties.some((s) => s === null)) return repli();

  const fiches = sorties.flatMap((s, i) => validerSortieModele(s, parts[i], defauts));
  return {
    fiches: fiches.slice(0, PLAFOND_FICHES),
    source: "assistant",
    nonLues: [],
    assistantIndisponible: false,
    tronque: tronque || fiches.length > PLAFOND_FICHES,
  };
}

/**
 * Une correction que le code n'a pas su lire (`lireCorrection` d'abord, côté
 * écran) : le modèle propose des opérations, le code les valide. Assistant
 * absent ou en panne : rien ne change, et on le dit.
 */
export async function corrigerAvecAssistant(
  message: string,
  fiches: FicheCollee[]
): Promise<{ fiches: FicheCollee[]; reponse: string; indisponible: boolean }> {
  const indispo = {
    fiches,
    reponse:
      "Je n'ai pas compris, et l'assistant est indisponible. Essayez « enlève la 3 », « le secteur c'est kiné », ou corrigez directement dans le tableau.",
    indisponible: true,
  };
  if (!aiAvailable(false)) return indispo;
  const liste = fiches
    .map((f, i) => `${i + 1}. ${f.company_name} | ${f.phone ?? "—"} | ${f.city ?? "—"} | ${f.sector ?? "—"}`)
    .join("\n");
  const sortie = await chatJSON({
    system: SYSTEM_CORRECTION,
    user: `Liste :\n${liste}\n\nDemande : ${message.slice(0, 500)}`,
    maxTokens: 1200,
  });
  if (!sortie) return indispo;
  const v = validerCorrectionsModele(sortie, fiches);
  return {
    fiches: v.fiches,
    reponse: v.reponse ?? (v.appliquees ? "C'est fait." : "Je n'ai rien changé : pouvez-vous préciser ?"),
    indisponible: false,
  };
}
