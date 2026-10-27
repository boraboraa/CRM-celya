/**
 * Les objectifs et les compteurs — LECTURES (27/10/2026). La règle vit en SQL
 * (031 : `compteurs_de`, `classement_equipe`) ; ce module ne fait que les
 * appeler et traduire.
 *
 * TOLÉRANT, comme les autres lectures du lot : sans la 031 (fonction absente,
 * `PGRST202`, ou table absente, `PGRST205`), tout répond « indisponible » et
 * les écrans se rendent comme avant — la carte d'objectifs ne s'affiche pas,
 * le classement le dit.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEBUT_SALES_TROPHY,
  ZERO,
  ajouterJours,
  jourBruxelles,
  lundiDe,
  type Compteurs,
  type Objectifs,
} from "./compteurs";

type LigneCompteurs = Compteurs & { user_id: string };

const versCompteurs = (l: Partial<LigneCompteurs> | null | undefined): Compteurs => ({
  appels: l?.appels ?? 0,
  reponses: l?.reponses ?? 0,
  interesses: l?.interesses ?? 0,
  rdv: l?.rdv ?? 0,
  essais: l?.essais ?? 0,
  numeros: l?.numeros ?? 0,
});

export type MesObjectifs = {
  disponible: boolean;
  lundi: string;
  semaine: Compteurs;
  /** Les essais depuis le début du Sales Trophy. */
  essaisPeriode: number;
  objectifs: Objectifs | null;
};

/** Les compteurs de la semaine en cours, ceux de la période, et les objectifs posés. */
export async function lireMesObjectifs(
  supabase: SupabaseClient,
  userId: string,
  maintenant: Date = new Date()
): Promise<MesObjectifs> {
  const { semaine: s, trophy } = periodesClassement(maintenant);
  const lundi = s.debut;
  const [sem, per, obj, objPer] = await Promise.all([
    supabase.rpc("compteurs_de", { p_user: userId, p_debut: s.debut, p_fin: s.fin }),
    supabase.rpc("compteurs_de", { p_user: userId, p_debut: trophy.debut, p_fin: trophy.fin }),
    supabase.from("objectifs").select("appels, reponses, rdv").eq("user_id", userId).eq("semaine", lundi).maybeSingle(),
    supabase
      .from("objectifs_periode")
      .select("essais")
      .eq("user_id", userId)
      .eq("debut", DEBUT_SALES_TROPHY)
      .maybeSingle(),
  ]);
  if (sem.error || per.error) {
    return { disponible: false, lundi, semaine: { ...ZERO }, essaisPeriode: 0, objectifs: null };
  }
  const o = obj.data as { appels: number; reponses: number; rdv: number } | null;
  const op = objPer.data as { essais: number } | null;
  return {
    disponible: true,
    lundi,
    semaine: versCompteurs((sem.data as LigneCompteurs[] | null)?.[0]),
    essaisPeriode: versCompteurs((per.data as LigneCompteurs[] | null)?.[0]).essais,
    objectifs:
      o || op
        ? { appels: o?.appels ?? null, reponses: o?.reponses ?? null, rdv: o?.rdv ?? null, essaisPeriode: op?.essais ?? null }
        : null,
  };
}

export type LigneClassement = Compteurs & { user_id: string; nom: string };

/** Le classement d'une période [début, fin) — des chiffres par participant. */
export async function lireClassement(
  supabase: SupabaseClient,
  debut: string,
  fin: string
): Promise<{ disponible: boolean; lignes: LigneClassement[] }> {
  const { data, error } = await supabase.rpc("classement_equipe", { p_debut: debut, p_fin: fin });
  if (error) {
    if (error.code !== "PGRST202") console.warn("[classement_equipe]", error.code, error.message);
    return { disponible: false, lignes: [] };
  }
  return {
    disponible: true,
    lignes: ((data ?? []) as LigneClassement[]).map((l) => ({ ...versCompteurs(l), user_id: l.user_id, nom: l.nom })),
  };
}

/** Les deux périodes du classement : la semaine en cours, et depuis le 2/11. */
export function periodesClassement(maintenant: Date = new Date()) {
  const aujourdhui = jourBruxelles(maintenant);
  const lundi = lundiDe(aujourdhui);
  return {
    semaine: { debut: lundi, fin: ajouterJours(lundi, 7) },
    trophy: {
      debut: DEBUT_SALES_TROPHY,
      // Avant le 2/11, la période est vide — on borne au lendemain du début.
      fin: ajouterJours(aujourdhui < DEBUT_SALES_TROPHY ? DEBUT_SALES_TROPHY : aujourdhui, 1),
    },
  };
}
