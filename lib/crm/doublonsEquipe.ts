/**
 * « Déjà suivie dans l'équipe » — l'appel à la base (031). La règle vit en
 * SQL (`doublons_equipe_pour`) ; ce module ne fait que l'appeler par la bonne
 * porte et traduire la réponse.
 *
 *  - Depuis l'écran (client de l'utilisateur) : `doublons_equipe`, qui lit
 *    `auth.uid()`.
 *  - Depuis le connecteur MCP (service_role, RLS contournée) :
 *    `doublons_equipe_pour(viewer, …)`, avec l'identité du porteur du jeton —
 *    jamais une valeur venue d'un paramètre d'outil.
 *
 * TOLÉRANT : sans la 031 (`PGRST202`, fonction absente) ou sur toute erreur,
 * la réponse est « aucun doublon d'équipe » et `indisponible` le dit — un
 * import ne doit pas se bloquer parce qu'une vérification de confort manque.
 * Les doublons visibles (RLS, `findDuplicates`) et ceux du lot restent
 * vérifiés de leur côté.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUCUN_DOUBLON, type DoublonEquipe, type EntreeDoublon } from "./doublons";

/** Au plus 200 entrées par appel — la fonction SQL refuse au-delà. */
const PAQUET = 200;

type Ligne = {
  idx: number;
  par_telephone: boolean;
  par_societe: boolean;
  a_moi: boolean;
  fiche_id: string | null;
  proprietaire: string | null;
};

export async function doublonsEquipe(
  client: SupabaseClient,
  entrees: EntreeDoublon[],
  /** Rempli par le connecteur MCP seulement (service_role). */
  viewerId?: string | null
): Promise<{ doublons: DoublonEquipe[]; indisponible: boolean }> {
  const doublons: DoublonEquipe[] = entrees.map(() => ({ ...AUCUN_DOUBLON }));
  let indisponible = false;
  for (let debut = 0; debut < entrees.length; debut += PAQUET) {
    const paquet = entrees.slice(debut, debut + PAQUET);
    const telephones = paquet.map((e) => e.telephone?.trim() || null);
    const societes = paquet.map((e) => e.societe?.trim() || null);
    const { data, error } = viewerId
      ? await client.rpc("doublons_equipe_pour", {
          p_viewer: viewerId,
          p_telephones: telephones,
          p_societes: societes,
        })
      : await client.rpc("doublons_equipe", { p_telephones: telephones, p_societes: societes });
    if (error || !Array.isArray(data)) {
      if (error && error.code !== "PGRST202") console.warn("[doublons_equipe]", error.code, error.message);
      indisponible = true;
      continue;
    }
    for (const l of data as Ligne[]) {
      const i = debut + l.idx - 1;
      if (i < debut || i >= debut + paquet.length) continue;
      doublons[i] = {
        parTelephone: Boolean(l.par_telephone),
        parSociete: Boolean(l.par_societe),
        aMoi: Boolean(l.a_moi),
        ficheId: l.a_moi ? (l.fiche_id ?? null) : null,
        proprietaire: l.proprietaire ?? null,
      };
    }
  }
  return { doublons, indisponible };
}
