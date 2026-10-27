/**
 * Les filtres de /prospects — l'URL, et ce qu'on en montre (19/10).
 *
 * Module NEUTRE et pur (ni React, ni Supabase) : la page serveur s'en sert pour
 * construire ses liens, la feuille « Filtres » du téléphone et les puces des
 * filtres actifs en reçoivent le résultat — des chaînes. Le filtre lui-même
 * reste la requête de la page (`filtreRecherche`, `.eq("status")`…) : ici, on
 * ne fait que lire et réécrire l'URL.
 */

export type ParamsProspects = {
  q?: string;
  statut?: string;
  tri?: string;
  vue?: string;
  filtre?: string;
  perimetre?: string;
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
} as const;
export type Tri = keyof typeof TRIS;

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
  if (v.vue === "colonnes") sp.set("vue", "colonnes");
  if (estFiltre(v.filtre ?? undefined)) sp.set("filtre", v.filtre!);
  if (v.perimetre) sp.set("perimetre", v.perimetre);
  const qs = sp.toString();
  return `/prospects${qs ? `?${qs}` : ""}`;
}

export type FiltreActif = {
  cle: "q" | "statut" | "tri" | "filtre";
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
  if (estFiltre(params.filtre)) {
    out.push({
      cle: "filtre",
      label: FILTRES_RAPIDES[params.filtre],
      retirer: hrefProspects(params, { filtre: null }),
    });
  }
  if (params.vue !== "colonnes" && (params.tri === "relance" || params.tri === "nom" || params.tri === "recent")) {
    out.push({
      cle: "tri",
      label: `Tri : ${TRIS[params.tri]}`,
      retirer: hrefProspects(params, { tri: null }),
    });
  }
  return out;
}
