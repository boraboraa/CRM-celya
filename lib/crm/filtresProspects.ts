/**
 * Les filtres de /prospects — l'URL, et ce qu'on en montre (19/10).
 *
 * Module NEUTRE et pur (ni React, ni Supabase) : la page serveur s'en sert pour
 * construire ses liens, la feuille « Filtres » du téléphone et les puces des
 * filtres actifs en reçoivent le résultat — des chaînes. Le filtre lui-même
 * reste la requête de la page (`filtreRecherche`, `.eq("status")`…) : ici, on
 * ne fait que lire et réécrire l'URL.
 */
// Chemin RELATIF avec extension : le test s'exécute tel quel sous node.
import { lireFiltreRegion, valeurFiltreRegion } from "./regions.ts";

export type ParamsProspects = {
  q?: string;
  statut?: string;
  tri?: string;
  vue?: string;
  filtre?: string;
  perimetre?: string;
  /** La région (034) : une région, `g:<groupe>`, ou `aucune` — lib/crm/regions.ts. */
  region?: string;
};

/** Les raccourcis de filtre (boutons « Emails envoyés », « À débriefer »). */
export const FILTRES_RAPIDES = {
  emails: "Emails envoyés",
  a_debriefer: "À débriefer",
} as const;
export type FiltreRapide = keyof typeof FILTRES_RAPIDES;

/**
 * « Priorité » est le défaut depuis le 27/10 (lib/crm/ordreProspects.ts) :
 * étoilées, puis ce qui est dû, puis le reste. « Activité récente » — l'ancien
 * défaut — reste un choix.
 */
export const TRIS = {
  priorite: "Priorité",
  relance: "Prochaine action",
  recent: "Activité récente",
  nom: "Nom",
  // 28/10 : par commune (la ville), pour démarcher un quartier d'un coup.
  commune: "Commune",
} as const;
export type Tri = keyof typeof TRIS;

/**
 * Les deux AFFICHAGES des mêmes fiches (27/10) : la liste, et le pipeline
 * (les colonnes par étape). Le sélecteur est visible par TOUS, et le dernier
 * choix est RETENU — écrit par le navigateur (cookie `celya_vue`), relu par la
 * page et validé comme une URL : un cookie trafiqué ne vaut pas plus qu'un
 * `?vue=` trafiqué. Dans l'URL, l'ancien nom `colonnes` reste celui du
 * pipeline (les liens existants continuent de marcher).
 */
export const VUES = { liste: "Liste", colonnes: "Pipeline" } as const;
export type Vue = keyof typeof VUES;
export const VUE_COOKIE = "celya_vue";

const estVue = (v?: string | null): v is Vue => v === "liste" || v === "colonnes";

/** L'affichage : celui de l'URL, à défaut le dernier choisi, à défaut la liste. */
export function lireVue(parametre: string | null | undefined, memorise: string | null | undefined): Vue {
  if (estVue(parametre)) return parametre;
  if (estVue(memorise)) return memorise;
  return "liste";
}

/**
 * Le menu « Étape » de la ligne de filtres porte aussi les deux raccourcis
 * (« À débriefer », « Emails envoyés ») : une seule liste déroulante, plus de
 * rangée de puces. Sa valeur : une étape, `f:<raccourci>`, ou `tous`.
 */
export function valeurEtape(params: ParamsProspects): string {
  if (estFiltre(params.filtre)) return `f:${params.filtre}`;
  return params.statut && params.statut !== "tous" ? params.statut : "tous";
}

/** Le menu « Étape » → les paramètres à poser (un seul des deux à la fois). */
export function depuisValeurEtape(valeur: string): { statut: string | null; filtre: string | null } {
  if (valeur.startsWith("f:")) {
    const f = valeur.slice(2);
    return { statut: null, filtre: estFiltre(f) ? f : null };
  }
  return { statut: valeur === "tous" ? null : valeur, filtre: null };
}

const estFiltre = (f?: string): f is FiltreRapide =>
  !!f && Object.prototype.hasOwnProperty.call(FILTRES_RAPIDES, f);

/**
 * L'URL de la page en conservant recherche, étape, tri, vue, filtre et
 * périmètre — `over` remplace (une valeur) ou retire (`null`) un paramètre.
 * L'ordre des paramètres est fixe : deux chemins vers le même écran donnent
 * la même URL.
 */
export function hrefProspects(
  params: ParamsProspects,
  over: Partial<Record<keyof ParamsProspects, string | null>> = {}
): string {
  const v = { ...params, ...over };
  const sp = new URLSearchParams();
  if (v.q?.trim()) sp.set("q", v.q.trim());
  if (v.statut && v.statut !== "tous") sp.set("statut", v.statut);
  if (v.tri && v.tri !== "priorite" && Object.prototype.hasOwnProperty.call(TRIS, v.tri)) sp.set("tri", v.tri);
  // Explicite dans les deux sens : « Liste » doit l'emporter sur un
  // « Pipeline » retenu.
  if (estVue(v.vue)) sp.set("vue", v.vue);
  if (estFiltre(v.filtre ?? undefined)) sp.set("filtre", v.filtre!);
  if (v.perimetre) sp.set("perimetre", v.perimetre);
  const region = valeurFiltreRegion(v.region);
  if (region) sp.set("region", region);
  const qs = sp.toString();
  return `/prospects${qs ? `?${qs}` : ""}`;
}

export type FiltreActif = {
  cle: "q" | "statut" | "region" | "tri" | "filtre";
  label: string;
  /** L'URL sans ce filtre — la croix de la puce. */
  retirer: string;
};

/**
 * Les filtres posés, chacun avec son lien de retrait — dans l'ordre où on les
 * lit. Le périmètre n'en fait pas partie : il a sa propre puce, et « le
 * retirer » n'aurait pas de sens (le défaut dépend du rôle, et du dernier
 * choix mémorisé). Le tri ne compte qu'en liste (les colonnes ne trient pas).
 */
export function filtresActifs(
  params: ParamsProspects,
  etapes: Record<string, string>
): FiltreActif[] {
  const out: FiltreActif[] = [];
  const q = params.q?.trim();
  if (q) out.push({ cle: "q", label: `« ${q} »`, retirer: hrefProspects(params, { q: null }) });
  if (params.statut && params.statut !== "tous" && etapes[params.statut]) {
    out.push({
      cle: "statut",
      label: etapes[params.statut],
      retirer: hrefProspects(params, { statut: null }),
    });
  }
  const region = lireFiltreRegion(params.region);
  if (region) {
    out.push({ cle: "region", label: region.label, retirer: hrefProspects(params, { region: null }) });
  }
  if (estFiltre(params.filtre)) {
    out.push({
      cle: "filtre",
      label: FILTRES_RAPIDES[params.filtre],
      retirer: hrefProspects(params, { filtre: null }),
    });
  }
  if (params.vue !== "colonnes" && (params.tri === "relance" || params.tri === "nom" || params.tri === "recent" || params.tri === "commune")) {
    out.push({
      cle: "tri",
      label: `Tri : ${TRIS[params.tri]}`,
      retirer: hrefProspects(params, { tri: null }),
    });
  }
  return out;
}
