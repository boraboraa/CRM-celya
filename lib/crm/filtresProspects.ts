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
import { AVEC_PERDUES, LIBELLE_AVEC_PERDUES } from "./perdues.ts";
import { STATUS_ORDER } from "../constants.ts";
import { SECTEURS, type SecteurFixe } from "./secteurs.ts";

export type ParamsProspects = {
  q?: string;
  statut?: string;
  tri?: string;
  vue?: string;
  filtre?: string;
  perimetre?: string;
  /** La région (034) : une région, `g:<groupe>`, ou `aucune` — lib/crm/regions.ts. */
  region?: string;
  /** Le métier (3/11) : une valeur de SECTEURS (lib/crm/secteurs.ts), rien d'autre. */
  secteur?: string;
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
 * L'étape de l'URL, si elle existe encore — sinon rien. Un lien ou un onglet
 * resté sur une étape RETIRÉE (`?statut=contacte`, `?statut=proposition`,
 * 29/10) ne doit ni filtrer, ni s'afficher en puce, ni se recopier : il vaut
 * « toutes les étapes ». `avec_perdues` reste une valeur du menu.
 */
export function statutConnu(statut?: string | null): string | undefined {
  if (!statut || statut === "tous") return undefined;
  if (statut === AVEC_PERDUES) return statut;
  return (STATUS_ORDER as string[]).includes(statut) ? statut : undefined;
}

/**
 * Le métier de l'URL, s'il est l'un des quinze de la liste fixe
 * (`SECTEURS`, migration 031) — sinon rien. Un `?secteur=` inventé ne filtre
 * pas, ne s'affiche pas en puce et ne se recopie pas, comme une étape retirée.
 */
export function secteurConnu(secteur?: string | null): SecteurFixe | undefined {
  if (!secteur) return undefined;
  return (SECTEURS as readonly string[]).includes(secteur) ? (secteur as SecteurFixe) : undefined;
}

/** Les paramètres de la page, l'étape et le métier inconnus retirés. */
export function nettoyerParams<P extends ParamsProspects>(params: P): P {
  const statut = statutConnu(params.statut);
  const secteur = secteurConnu(params.secteur);
  if (statut === params.statut && secteur === params.secteur) return params;
  const { statut: _s, secteur: _m, ...reste } = params;
  return { ...reste, ...(statut ? { statut } : {}), ...(secteur ? { secteur } : {}) } as P;
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
  const secteur = secteurConnu(v.secteur);
  if (secteur) sp.set("secteur", secteur);
  const qs = sp.toString();
  // Une liste VIDE voulue (dernière puce retirée, « Toutes ») le DIT : sans
  // ce marqueur, `/prospects` nu reprendrait les filtres mémorisés (lot 6).
  return `/prospects?${qs || `${MARQUEUR_SANS_FILTRE}=aucun`}`;
}

export type FiltreActif = {
  cle: "q" | "statut" | "region" | "secteur" | "tri" | "filtre";
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
  // « Toutes, perdues comprises » (29/10) : les perdues sont masquées par
  // défaut — les montrer est un filtre comme un autre, retirable.
  if (params.statut === AVEC_PERDUES) {
    out.push({ cle: "statut", label: LIBELLE_AVEC_PERDUES, retirer: hrefProspects(params, { statut: null }) });
  }
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
  const secteur = secteurConnu(params.secteur);
  if (secteur) {
    out.push({ cle: "secteur", label: secteur, retirer: hrefProspects(params, { secteur: null }) });
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

/* ───────────────── Les filtres gardés au retour (3 novembre 2026) ─────────────────
 *
 * Ouvrir une fiche puis revenir (lien « Tous les prospects », bouton retour,
 * geste retour de l'iPad, onglet Prospects) rendait une liste NUE : les
 * filtres disparaissaient. Ils sont désormais retenus dans le cookie
 * `celya_filtres` — écrit par le NAVIGATEUR quand les filtres changent
 * (`components/MemoireFiltres.tsx`), relu par le serveur et revalidé COMME UNE
 * URL : un cookie trafiqué ne vaut pas plus qu'une URL trafiquée. Il s'efface
 * à minuit (heure de Bruxelles) : le lendemain repart d'une liste propre.
 *
 * Valeur : `AAAA-MM-JJ|<chaîne de requête>` — la date de Bruxelles du jour
 * d'écriture. Un cookie d'un autre jour est IGNORÉ même si le navigateur le
 * garde (horloge décalée, cookie fabriqué à la main).
 *
 * Seuls les FILTRES sont retenus — la vue (Liste | Pipeline) et le périmètre
 * ont déjà leurs propres cookies (`celya_vue`, `celya_perim`).
 */
export const FILTRES_COOKIE = "celya_filtres";

/** Le marqueur d'une liste vide VOULUE : `?filtres=aucun` l'emporte sur le cookie. */
export const MARQUEUR_SANS_FILTRE = "filtres";

/** Les clés retenues — et dans cet ordre. */
const CLES_FILTRES = ["q", "statut", "region", "secteur", "filtre", "tri"] as const;

/** La date de Bruxelles d'un instant, « AAAA-MM-JJ ». */
export function jourBruxelles(maintenant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(maintenant);
}

/**
 * Minuit suivant, heure de Bruxelles — l'expiration du cookie. Calculé sur le
 * décalage du JOUR (+1 en hiver, +2 en été), jamais sur une constante.
 */
export function minuitBruxelles(maintenant: Date): Date {
  const [a, m, j] = jourBruxelles(maintenant).split("-").map(Number);
  // Le lendemain, en date civile (UTC sert d'arithmétique, pas de fuseau).
  const lendemain = new Date(Date.UTC(a, m - 1, j + 1));
  const cible = lendemain.toISOString().slice(0, 10);
  for (const decalage of [1, 2, 0, 3]) {
    const t = new Date(lendemain.getTime() - decalage * 3_600_000);
    const heure = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Brussels",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(t);
    if (jourBruxelles(t) === cible && Number(heure) === 0) return t;
  }
  return lendemain;
}

/** Les filtres d'un jeu de paramètres, validés, en chaîne de requête (sans `?`). */
export function chaineFiltres(params: ParamsProspects): string {
  const propres = nettoyerParams(params);
  const sp = new URLSearchParams();
  const q = propres.q?.trim();
  if (q) sp.set("q", q.slice(0, 200));
  if (propres.statut && propres.statut !== "tous") sp.set("statut", propres.statut);
  const region = valeurFiltreRegion(propres.region);
  if (region) sp.set("region", region);
  if (propres.secteur) sp.set("secteur", propres.secteur);
  if (estFiltre(propres.filtre)) sp.set("filtre", propres.filtre);
  if (propres.tri && propres.tri !== "priorite" && Object.prototype.hasOwnProperty.call(TRIS, propres.tri)) {
    sp.set("tri", propres.tri);
  }
  return sp.toString();
}

/** Les paramètres d'une chaîne de requête — seulement les clés de filtre. */
function filtresDe(chaine: string): ParamsProspects {
  const sp = new URLSearchParams(chaine);
  const out: ParamsProspects = {};
  for (const cle of CLES_FILTRES) {
    const v = sp.get(cle);
    if (v !== null && v !== "") out[cle] = v;
  }
  return out;
}

/** La valeur à écrire dans le cookie (vide : rien à retenir — on l'efface). */
export function valeurCookieFiltres(params: ParamsProspects, maintenant: Date): string {
  const chaine = chaineFiltres(params);
  return chaine ? `${jourBruxelles(maintenant)}|${chaine}` : "";
}

/**
 * Le cookie relu : les filtres qu'il retient, VALIDÉS — ou `null` (absent,
 * d'un autre jour, illisible, ou vide). Ce qui en sort a repassé par la même
 * validation qu'une URL.
 */
export function lireCookieFiltres(
  valeur: string | null | undefined,
  maintenant: Date
): ParamsProspects | null {
  if (!valeur) return null;
  // Le navigateur garde la valeur encodée ; le serveur (Next) la reçoit déjà
  // décodée. On ne décode qu'une fois : décoder deux fois changerait un « % »
  // de la recherche.
  let brut = valeur;
  if (!valeur.includes("|")) {
    try {
      brut = decodeURIComponent(valeur);
    } catch {
      return null;
    }
  }
  const i = brut.indexOf("|");
  if (i < 0) return null;
  if (brut.slice(0, i) !== jourBruxelles(maintenant)) return null;
  const chaine = chaineFiltres(filtresDe(brut.slice(i + 1)));
  return chaine ? filtresDe(chaine) : null;
}

/** La ligne `Set-Cookie`/`document.cookie` du jour (vide : l'effacer). */
export function ligneCookieFiltres(params: ParamsProspects, maintenant: Date, securise = false): string {
  const valeur = valeurCookieFiltres(params, maintenant);
  const sur = securise ? "; secure" : "";
  if (!valeur) return `${FILTRES_COOKIE}=; path=/; max-age=0; samesite=lax${sur}`;
  return `${FILTRES_COOKIE}=${encodeURIComponent(valeur)}; path=/; expires=${minuitBruxelles(maintenant).toUTCString()}; samesite=lax${sur}`;
}

/** La ligne qui EFFACE le cookie (« Tout effacer »). */
export function ligneEffacerFiltres(securise = false): string {
  return `${FILTRES_COOKIE}=; path=/; max-age=0; samesite=lax${securise ? "; secure" : ""}`;
}

/** La valeur d'un cookie dans `document.cookie`. */
export function lireDansCookies(cookies: string, nom: string): string | null {
  for (const morceau of cookies.split(";")) {
    const [k, ...v] = morceau.trim().split("=");
    if (k === nom) return v.join("=");
  }
  return null;
}

/**
 * LE lien de retour à la liste — UN utilitaire pour tous : le retour de la
 * fiche, l'onglet Prospects, « À faire », l'import, la création, la
 * suppression. La liste retenue, à défaut la liste nue. **Plus aucun
 * `href="/prospects"` en dur pour revenir à la liste** (garde-fou :
 * `test:filtres-memorises`).
 */
export const LISTE_PROSPECTS = "/prospects";

export function lienListeProspects(cookie: string | null | undefined, maintenant: Date): string {
  const filtres = lireCookieFiltres(cookie, maintenant);
  return filtres ? `${LISTE_PROSPECTS}?${chaineFiltres(filtres)}` : LISTE_PROSPECTS;
}

/**
 * `/prospects` SANS AUCUN paramètre : la page reprend la liste retenue
 * (redirection). Le moindre paramètre — un filtre, la vue, le périmètre, ou
 * le marqueur `?filtres=aucun` — l'emporte sur le cookie.
 */
export function redirectionListe(
  parametres: Record<string, unknown>,
  cookie: string | null | undefined,
  maintenant: Date
): string | null {
  if (Object.keys(parametres).length > 0) return null;
  const lien = lienListeProspects(cookie, maintenant);
  return lien === LISTE_PROSPECTS ? null : lien;
}

/**
 * « Tout effacer » : la liste sans aucun filtre, en gardant la vue et le
 * périmètre (ils ont leurs propres mémoires). Le bouton efface AUSSI le
 * cookie lui-même ; le marqueur de `hrefProspects` n'est qu'un secours.
 */
export function lienToutEffacer(params: ParamsProspects): string {
  return hrefProspects({ vue: params.vue, perimetre: params.perimetre });
}

/** La clé de la position de défilement retenue pour une liste (son URL). */
export function cleDefilement(chemin: string, recherche: string): string {
  const r = recherche.startsWith("?") ? recherche.slice(1) : recherche;
  return `celya_defilement:${chemin}${r ? `?${r}` : ""}`;
}
