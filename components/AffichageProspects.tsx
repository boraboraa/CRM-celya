import Link from "next/link";
import { PageHeader, EmptyState, Icone } from "@/components/ui";
import { ListeProspects, type LigneListe } from "@/components/ListeProspects";
import { PipelineBoard, type BoardProspect } from "@/components/PipelineBoard";
import { FiltresProspects } from "@/components/FiltresProspects";
import { FeuilleFiltres } from "@/components/FeuilleFiltres";
import { BasculeAffichage } from "@/components/BasculeAffichage";
import type { OptionPerimetre } from "@/components/PerimetreSwitcher";
import { STATUS_ORDER, STATUS_LABEL } from "@/lib/constants";
import {
  FILTRES_RAPIDES,
  TRIS,
  filtresActifs,
  hrefProspects,
  valeurEtape,
  type ParamsProspects,
  type Vue,
} from "@/lib/crm/filtresProspects";
import { optionsFiltreRegion, valeurFiltreRegion } from "@/lib/crm/regions";
import { AVEC_PERDUES, LIBELLE_AVEC_PERDUES, LIBELLE_SANS_PERDUES } from "@/lib/crm/perdues";

/**
 * L'écran /prospects, sans ses lectures (27/10, au soir) : la page charge, ce
 * composant serveur affiche. En tête, « Liste | Pipeline » — les deux
 * affichages des mêmes fiches, pour tout le monde, le dernier choix retenu ;
 * puis UNE ligne de filtres (recherche · qui · étape · tri) ; puis la liste ou
 * le pipeline.
 *
 * Ne reçoit que des VALEURS (aucune fonction ne traverse vers les composants
 * clients — voir test:frontiere).
 */
export function AffichageProspects({
  params,
  vue,
  lignes,
  board,
  janetIds,
  erreur,
  qui,
  admin,
  membresAttribution,
  tri,
}: {
  params: ParamsProspects;
  vue: Vue;
  lignes: LigneListe[];
  board: BoardProspect[];
  janetIds: string[];
  erreur: string | null;
  /** Le périmètre, en liens tout faits (optionsPerimetre) — null : pas de choix. */
  qui: OptionPerimetre[] | null;
  admin: boolean;
  /** [id, nom] — l'admin seul en reçoit (attribution). */
  membresAttribution: [string, string][];
  tri: string;
}) {
  const filtreEmails = params.filtre === "emails";
  const filtreDebrief = params.filtre === "a_debriefer";
  const total = lignes.length;
  const libellesEtapes = Object.fromEntries(STATUS_ORDER.map((st) => [st, STATUS_LABEL[st]]));
  const actifs = filtresActifs(params, libellesEtapes);
  const lien = (over: Parameters<typeof hrefProspects>[1], label: string, actif: boolean) => ({
    href: hrefProspects(params, over),
    label,
    actif,
  });
  // Les perdues sont masquées par défaut EN LISTE (29/10, lib/crm/perdues.ts) :
  // le choix par défaut le dit, et « Toutes, perdues comprises » les rend. Le
  // pipeline n'en a pas besoin — sa colonne « Perdu » est déjà repliée.
  const enListe = vue === "liste";
  const libelleTous = enListe ? LIBELLE_SANS_PERDUES : "Toutes les étapes";
  const avecPerdues: [string, string] | null = enListe ? [AVEC_PERDUES, LIBELLE_AVEC_PERDUES] : null;
  const etapesLiens = [
    lien({ statut: null }, enListe ? LIBELLE_SANS_PERDUES : "Toutes", !params.statut || params.statut === "tous"),
    ...(avecPerdues ? [lien({ statut: AVEC_PERDUES }, LIBELLE_AVEC_PERDUES, params.statut === AVEC_PERDUES)] : []),
    ...STATUS_ORDER.map((st) => lien({ statut: st }, STATUS_LABEL[st], params.statut === st)),
  ];
  const liensVue: [Vue, string][] = [
    ["liste", hrefProspects(params, { vue: "liste" })],
    ["colonnes", hrefProspects(params, { vue: "colonnes" })],
  ];
  const etapes: [string, string][] = STATUS_ORDER.map((st) => [st, STATUS_LABEL[st]]);
  const raccourcis = Object.entries(FILTRES_RAPIDES) as [string, string][];
  // La région (034) : le même jeu d'options, en menu sur les deux écrans.
  const regions = optionsFiltreRegion();
  const regionActive = valeurFiltreRegion(params.region) ?? "";
  const menuRegion = {
    tous: lien({ region: null }, "Toutes les régions", !regionActive),
    groupes: regions.map(
      ([g, opts]) => [g, opts.map(([v, l]) => lien({ region: v }, l, regionActive === v))] as [string, ReturnType<typeof lien>[]]
    ),
  };
  const nbFiches = `${total} fiche${total > 1 ? "s" : ""}`;

  return (
    <>
      <PageHeader
        title="Prospects"
        subtitle={nbFiches}
        compactMobile
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/prospects/ma-liste" className="btn-ghost">
              Coller ma liste
            </Link>
            <Link href="/prospects/import" className="btn-ghost">
              Importer un CSV
            </Link>
            <Link href="/prospects/nouveau" className="btn-primary">
              + Nouveau prospect
            </Link>
          </div>
        }
      />

      {/* Téléphone : Liste | Pipeline, la recherche, et UNE puce « Filtres »
          pour tout le reste ; les filtres posés restent visibles, chacun
          retirable d'un tap. */}
      <div className="mb-3 space-y-2 lg:hidden">
        <div className="flex items-center justify-between gap-2">
          <BasculeAffichage vue={vue} liens={liensVue} />
          <Link href="/prospects/ma-liste" className="btn-ghost min-h-[44px] shrink-0 px-3 text-sm">
            Coller ma liste
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <FiltresProspects
            q={params.q ?? ""}
            etape={valeurEtape(params)}
            tri={params.tri ?? ""}
            etapes={[]}
            avecTri={false}
            seulementRecherche
          />
          <FeuilleFiltres
            nbActifs={actifs.filter((f) => f.cle !== "q").length}
            vues={[]}
            perimetre={qui}
            raccourcis={(Object.keys(FILTRES_RAPIDES) as (keyof typeof FILTRES_RAPIDES)[]).map((f) =>
              lien({ filtre: params.filtre === f ? null : f }, FILTRES_RAPIDES[f], params.filtre === f)
            )}
            etapes={etapesLiens}
            regions={menuRegion}
            tris={
              vue === "liste"
                ? (Object.keys(TRIS) as (keyof typeof TRIS)[]).map((t) =>
                    lien({ tri: t === "priorite" ? null : t }, TRIS[t], (tri ?? "priorite") === t)
                  )
                : null
            }
          />
        </div>
        {actifs.some((f) => f.cle !== "q") && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Filtres actifs">
            {actifs
              .filter((f) => f.cle !== "q")
              .map((f) => (
                <li key={f.cle}>
                  <Link
                    href={f.retirer}
                    prefetch={false}
                    aria-label={`Retirer le filtre ${f.label}`}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-celya-blue/10 px-3 text-xs text-blue-100 ring-1 ring-celya-blue/30"
                  >
                    {f.label}
                    <Icone nom="croix" className="h-3 w-3" />
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </div>

      {/* Ordinateur : Liste | Pipeline, puis UNE ligne de filtres. */}
      <div className="mb-4 hidden items-center gap-3 lg:flex">
        <BasculeAffichage vue={vue} liens={liensVue} />
        <FiltresProspects
          q={params.q ?? ""}
          etape={valeurEtape(params)}
          tri={params.tri ?? ""}
          etapes={etapes}
          raccourcis={raccourcis}
          region={regionActive}
          regions={regions}
          qui={qui}
          avecTri={vue === "liste"}
          libelleTous={libelleTous}
          avecPerdues={avecPerdues}
        />
      </div>

      {erreur && (
        <p className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{erreur}</p>
      )}

      {total === 0 ? (
        <EmptyState
          title={
            filtreEmails
              ? "Aucun email envoyé"
              : filtreDebrief
                ? "Aucun rendez-vous à débriefer"
                : params.q || params.statut
                  ? "Aucun résultat"
                  : "Aucun prospect pour l'instant"
          }
          hint={
            filtreEmails
              ? "Aucun mail n'est encore parti vers ces prospects — le filtre ne montre que les fiches déjà démarchées par email."
              : filtreDebrief
                ? "Aucun rendez-vous passé n'attend son issue dans ce périmètre."
                : params.q || params.statut
                  ? "Essayez d'élargir la recherche ou de retirer le filtre d'étape."
                  : "Collez votre liste (« Coller ma liste »), importez un CSV, ou créez une première fiche."
          }
          href="/prospects/ma-liste"
          cta="Coller ma liste"
        />
      ) : vue === "colonnes" ? (
        <PipelineBoard prospects={board} janetIds={janetIds} />
      ) : (
        <ListeProspects
          lignes={lignes}
          admin={admin}
          membres={membresAttribution}
          filtreEmails={filtreEmails}
        />
      )}
    </>
  );
}
