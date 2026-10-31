"use client";

import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { moveProspectAction } from "@/app/actions";
import {
  STATUS_ORDER,
  STATUS_LABEL,
  STATUS_ICON,
  STATUS_EDGE,
} from "@/lib/constants";
import {
  ConfidenceBadge,
  EtiquetteJanet,
  Icone,
  LastActionLine,
  ProchaineActionTexte,
} from "@/components/ui";
import type { LastActionKind } from "@/lib/crm/lastAction";
import type { ConfidenceLevel, ProspectStatus } from "@/lib/types";
import { PastilleRegion } from "@/components/PastilleRegion";
import { communeAffichee } from "@/lib/crm/regions";

/**
 * La couleur de chaque étape, déclinée pour la colonne : bandeau d'en-tête,
 * pastille du compteur, halo de la colonne survolée pendant le drag et zone
 * « Déposer ici ». Classes complètes, jamais interpolées (règle JIT).
 */
const COLUMN_BANNER: Record<ProspectStatus, string> = {
  a_appeler: "bg-slate-500/20 text-slate-100 ring-slate-400/30",
  rendez_vous: "bg-blue-500/20 text-blue-100 ring-blue-400/30",
  a_rappeler: "bg-indigo-500/20 text-indigo-100 ring-indigo-400/30",
  suivi_email: "bg-sky-500/20 text-sky-100 ring-sky-400/30",
  essai_gratuit: "bg-teal-500/20 text-teal-100 ring-teal-400/30",
  gagne: "bg-emerald-500/20 text-emerald-100 ring-emerald-400/30",
  perdu: "bg-rose-500/20 text-rose-100 ring-rose-400/30",
};

const COLUMN_COUNT: Record<ProspectStatus, string> = {
  a_appeler: "bg-slate-400/25 text-slate-100",
  rendez_vous: "bg-blue-400/25 text-blue-100",
  a_rappeler: "bg-indigo-400/25 text-indigo-100",
  suivi_email: "bg-sky-400/25 text-sky-100",
  essai_gratuit: "bg-teal-400/25 text-teal-100",
  gagne: "bg-emerald-400/25 text-emerald-100",
  perdu: "bg-rose-400/25 text-rose-100",
};

/** La colonne cible s'illumine dans SA teinte pendant le drag. */
const COLUMN_TARGET: Record<ProspectStatus, string> = {
  a_appeler: "bg-slate-500/[0.08] ring-slate-400/40",
  rendez_vous: "bg-blue-500/[0.08] ring-blue-400/40",
  a_rappeler: "bg-indigo-500/[0.08] ring-indigo-400/40",
  suivi_email: "bg-sky-500/[0.08] ring-sky-400/40",
  essai_gratuit: "bg-teal-500/[0.08] ring-teal-400/40",
  gagne: "bg-emerald-500/[0.08] ring-emerald-400/40",
  perdu: "bg-rose-500/[0.08] ring-rose-400/40",
};

const COLUMN_DROP: Record<ProspectStatus, string> = {
  a_appeler: "border-slate-400/50 bg-slate-500/[0.07] text-slate-300",
  rendez_vous: "border-blue-400/50 bg-blue-500/[0.07] text-blue-300",
  a_rappeler: "border-indigo-400/50 bg-indigo-500/[0.07] text-indigo-300",
  suivi_email: "border-sky-400/50 bg-sky-500/[0.07] text-sky-300",
  essai_gratuit: "border-teal-400/50 bg-teal-500/[0.07] text-teal-300",
  gagne: "border-emerald-400/50 bg-emerald-500/[0.07] text-emerald-300",
  perdu: "border-rose-400/50 bg-rose-500/[0.07] text-rose-300",
};

export type BoardProspect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  /** La commune et la région (034, 038) — la pastille de la carte. */
  city?: string | null;
  region?: string | null;
  status: ProspectStatus;
  confidence_level: ConfidenceLevel | null;
  confidence_reason: string | null;
  confidence_locked: boolean;
  next_action_at: string | null;
  /** Ce que désigne next_action_at (migration 022) : un RDV n'est jamais en retard. */
  next_action_kind: string | null;
  /** RDV clos sans suite : la carte dit « Plus rien de prévu » (022). */
  plus_rien: boolean;
  /** Dernière action (canal + résultat + texte + date) — prospect_action_state. */
  last_kind: LastActionKind | null;
  last_at: string | null;
  last_outcome: string | null;
  last_text: string | null;
  last_no_answer_streak: number | null;
  /**
   * Peut-on la DÉPLACER ? Faux sur la fiche d'un collègue vue grâce à
   * l'interrupteur d'équipe (migration 020) : changer l'étape est une écriture,
   * et `prospects_update` la refuse. Une carte qui se laisse saisir puis revient
   * en place est pire qu'une carte qui ne bouge pas.
   */
  modifiable?: boolean;
};

/** Repliées à droite par défaut — les fins de parcours (27/10). */
const REPLIEES: ProspectStatus[] = ["gagne", "perdu"];

/**
 * Le pipeline : une colonne par étape, glisser-déposer pour corriger.
 *
 * Déposer une fiche est une décision humaine — elle VERROUILLE l'étape
 * (moveProspectAction), et l'auto-classification n'y touchera plus.
 *
 * Plus aucun montant sur les cartes : c'est la CONFIANCE estimée par l'IA
 * (Chaud / Tiède / Froid, avec sa raison courte) qui dit si l'affaire est
 * chaude. « À évaluer » quand rien n'a pu être estimé.
 *
 * `janetIds` : les fiches qu'un appel réel de Janet a touchées (admin seul —
 * vide sinon). Un TABLEAU, pas un `Set` : la page est un composant serveur,
 * et seule la donnée simple traverse la frontière.
 */
export function PipelineBoard({
  prospects,
  janetIds = [],
}: {
  prospects: BoardProspect[];
  janetIds?: string[];
}) {
  const parJanet = useMemo(() => new Set(janetIds), [janetIds]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<ProspectStatus | null>(null);
  const [justMoved, setJustMoved] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  /**
   * Gagné et Perdu sont REPLIÉS à droite (27/10) : une colonne étroite qui dit
   * combien, et qu'on déplie d'un clic. On peut toujours y déposer une fiche.
   */
  const [deplies, setDeplies] = useState<Set<ProspectStatus>>(new Set());
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();
  /**
   * Téléphone (sous `lg`) : UNE étape à la fois, choisie dans la rangée du
   * haut — six colonnes de 272 px ne tiennent pas dans 390. Par défaut, la
   * première étape qui a des fiches.
   */
  const [etapeMobile, setEtapeMobile] = useState<ProspectStatus>(
    () => STATUS_ORDER.find((s) => prospects.some((p) => p.status === s)) ?? STATUS_ORDER[0]
  );

  /**
   * La carte change de colonne AU MOMENT DU DÉPÔT, pas quand le serveur
   * répond. `useOptimistic` remplace l'ancien duo useState + useEffect de
   * resynchronisation : c'est React qui rend la main aux données du serveur
   * à la fin de la transition, sans fenêtre où un déplacement en cours
   * pouvait être écrasé par des props arrivées entre-temps. Un refus du
   * serveur ramène la carte à sa colonne d'origine tout seul.
   */
  const [items, appliquer] = useOptimistic(
    prospects,
    (liste: BoardProspect[], patch: { id: string; status: ProspectStatus }) =>
      liste.map((c) => (c.id === patch.id ? { ...c, status: patch.status } : c))
  );

  // Retire le halo « déplacé » après l'animation.
  useEffect(() => {
    if (!justMoved) return;
    const t = setTimeout(() => setJustMoved(null), 1400);
    return () => clearTimeout(t);
  }, [justMoved]);

  function move(id: string, status: ProspectStatus) {
    const current = items.find((c) => c.id === id);
    if (!current || current.status === status) return;

    setJustMoved(id);
    setError(undefined);
    setEnCours(id);

    startTransition(async () => {
      appliquer({ id, status });
      try {
        await moveProspectAction(id, status);
      } catch {
        setJustMoved(null);
        setError("Le déplacement n'a pas pu être enregistré. Réessayez.");
      } finally {
        setEnCours(null);
      }
    });
  }

  const dragging = items.find((c) => c.id === dragId) ?? null;

  return (
    <>
      {error && (
        <p className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300 ring-1 ring-rose-400/20">
          {error}
        </p>
      )}

      <p className="mb-4 hidden text-xs text-slate-500 lg:block">
        Faites glisser une fiche d&apos;une colonne à l&apos;autre pour corriger son
        étape — ce choix est alors verrouillé, l&apos;assistant n&apos;y touchera plus.
      </p>

      {/* Téléphone : le sélecteur d'étape. Il défile de côté dans son propre
          cadre — la page, elle, ne déborde jamais. */}
      {/* `data-defile` : ce défilement de côté est VOULU (banc, cadres.ts). */}
      <div data-defile className="-mx-4 mb-3 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:hidden">
        <div className="flex w-max gap-1.5" role="group" aria-label="Étape affichée">
          {STATUS_ORDER.map((status) => {
            const n = items.filter((c) => c.status === status).length;
            const actif = status === etapeMobile;
            return (
              <button
                key={status}
                type="button"
                onClick={() => setEtapeMobile(status)}
                aria-pressed={actif}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-xs font-medium ring-1 transition ${
                  actif ? COLUMN_BANNER[status] : "text-slate-400 ring-white/10"
                }`}
              >
                <Icone nom={STATUS_ICON[status]} className="h-3.5 w-3.5" />
                {STATUS_LABEL[status]}
                <span className="tabular-nums opacity-80">{n}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="mb-3 text-[11px] text-slate-500 lg:hidden">
        Pour changer l&apos;étape d&apos;une fiche, utilisez le menu de sa carte — ce
        choix est alors verrouillé.
      </p>

      <div data-defile className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        <div className="lg:flex lg:min-w-max lg:gap-4">
          {STATUS_ORDER.map((status, columnIndex) => {
            const list = items.filter((c) => c.status === status);
            const isTarget = overColumn === status;
            // Colonne d'origine de la carte en cours de déplacement : on la
            // laisse en retrait pour que la cible ressorte.
            const isSource = dragging !== null && dragging.status === status;
            const repliee = REPLIEES.includes(status) && !deplies.has(status);

            return (
              <section
                key={status}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overColumn !== status) setOverColumn(status);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setOverColumn((c) => (c === status ? null : c));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = dragId ?? e.dataTransfer.getData("text/plain");
                  setOverColumn(null);
                  setDragId(null);
                  if (id) move(id, status);
                }}
                style={{ animationDelay: `${columnIndex * 40}ms` }}
                className={`w-full shrink-0 animate-rise rounded-2xl p-2 ring-1 transition-all duration-200 lg:block ${
                  repliee ? "lg:w-[76px]" : "lg:w-[272px]"
                } ${
                  status === etapeMobile ? "" : "hidden"
                } ${
                  isTarget
                    ? COLUMN_TARGET[status]
                    : isSource
                      ? "bg-white/[0.015] ring-white/[0.06]"
                      : "ring-transparent"
                }`}
              >
                {repliee && (
                  <button
                    type="button"
                    onClick={() => setDeplies((d) => new Set(d).add(status))}
                    title={`Déplier « ${STATUS_LABEL[status]} »`}
                    className={`hidden w-full flex-col items-center gap-2 rounded-xl px-1 py-3 text-xs font-semibold ring-1 transition lg:flex ${COLUMN_BANNER[status]} ${
                      isTarget ? "brightness-125" : ""
                    }`}
                  >
                    <Icone nom={STATUS_ICON[status]} className="h-3.5 w-3.5 opacity-80" />
                    <span className="[writing-mode:vertical-rl]">{STATUS_LABEL[status]}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums ${COLUMN_COUNT[status]}`}>
                      {list.length}
                    </span>
                    {isTarget && <span className="text-[10px] font-normal">Déposer</span>}
                  </button>
                )}
                <div className={repliee ? "lg:hidden" : ""}>
                <header className="mb-3">
                  {/* Un vrai bandeau dans la couleur de l'étape, compteur
                      dans une pastille de la même teinte. */}
                  <h2
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ring-1 transition-all duration-200 ${
                      COLUMN_BANNER[status]
                    } ${isTarget ? "brightness-125" : ""}`}
                  >
                    <Icone nom={STATUS_ICON[status]} className="h-3.5 w-3.5 opacity-80" />
                    {STATUS_LABEL[status]}
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${COLUMN_COUNT[status]}`}
                    >
                      {list.length}
                    </span>
                    {REPLIEES.includes(status) && (
                      <button
                        type="button"
                        onClick={() =>
                          setDeplies((d) => {
                            const n = new Set(d);
                            n.delete(status);
                            return n;
                          })
                        }
                        aria-label={`Replier « ${STATUS_LABEL[status]} »`}
                        className="hidden h-7 w-7 items-center justify-center rounded-lg opacity-70 transition hover:bg-white/10 hover:opacity-100 lg:inline-flex"
                      >
                        <Icone nom="chevron" className="h-3 w-3 rotate-90" />
                      </button>
                    )}
                  </h2>
                </header>

                <div className="space-y-2.5">
                  {list.length === 0 && (
                    <p
                      className={`rounded-xl border border-dashed px-3 py-6 text-center text-xs transition-all duration-200 ${
                        isTarget
                          ? COLUMN_DROP[status]
                          : "border-white/[0.07] text-slate-500"
                      }`}
                    >
                      {isTarget ? "Déposer ici" : "Vide"}
                    </p>
                  )}

                  {/* Emplacement d'accueil au-dessus de la pile. */}
                  {isTarget && list.length > 0 && !isSource && (
                    <p
                      className={`rounded-xl border border-dashed px-3 py-3 text-center text-[11px] ${COLUMN_DROP[status]}`}
                    >
                      Déposer ici
                    </p>
                  )}

                  {list.map((c) => {
                    const isDragged = dragId === c.id;
                    const landed = justMoved === c.id;
                    // Le repère d'attente est sur LA carte manipulée, pas sur
                    // l'écran entier : le reste du pipeline reste utilisable.
                    const enregistre = enCours === c.id;

                    return (
                      <article
                        key={c.id}
                        draggable={c.modifiable !== false}
                        onDragStart={(e) => {
                          if (c.modifiable === false) {
                            e.preventDefault();
                            return;
                          }
                          setDragId(c.id);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", c.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverColumn(null);
                        }}
                        className={`card card-hover card-lift border-l-4 p-3.5 ${
                          c.modifiable === false
                            ? "cursor-default"
                            : "cursor-grab active:cursor-grabbing"
                        } ${
                          STATUS_EDGE[c.status]
                        } ${
                          isDragged
                            ? "scale-[0.97] rotate-[-1.5deg] opacity-45 ring-celya-blue/40"
                            : ""
                        } ${landed ? "ring-2 ring-celya-blue/60" : ""}`}
                      >
                        {enregistre && (
                          <span
                            aria-label="Enregistrement en cours"
                            title="Enregistrement…"
                            className="float-right ml-2 mt-0.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-celya-blue/70 border-t-transparent"
                          />
                        )}
                        {/* prefetch désactivé : une colonne peut porter des
                            dizaines de cartes, et Next préchargeait la fiche
                            de CHACUNE — autant de rendus serveur complets
                            pour une seule que Bora finira par ouvrir. */}
                        <Link
                          href={`/prospects/${c.id}`}
                          prefetch={false}
                          className="block"
                        >
                          <p className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-slate-50" title={c.company_name}>
                              {c.company_name}
                            </span>
                            {parJanet.has(c.id) && <EtiquetteJanet compact />}
                          </p>
                          {c.contact_name && (
                            <p className="truncate text-xs text-slate-400" title={c.contact_name}>
                              {c.contact_name}
                            </p>
                          )}
                          {/* La région (29/10) : « Bruxelles · Auderghem »,
                              « Brabant flamand · Overijse », ou « Région ? ». */}
                          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-slate-500">
                            <PastilleRegion region={c.region} className="min-w-0" />
                            {communeAffichee(c.city, c.region) && (
                              <span className="min-w-0 truncate" title={communeAffichee(c.city, c.region)!}>
                                {communeAffichee(c.city, c.region)}
                              </span>
                            )}
                          </p>

                          {/* La DERNIÈRE ACTION : canal + résultat + date —
                              ce qui manquait le plus sur la carte. */}
                          {c.last_kind && c.last_at && (
                            <p className="mt-1.5 truncate text-[11px]">
                              <LastActionLine
                                kind={c.last_kind}
                                at={c.last_at}
                                outcome={c.last_outcome}
                                text={c.last_text}
                                streak={c.last_no_answer_streak}
                              />
                            </p>
                          )}

                          {/* La confiance, d'un coup d'œil — et sa raison. */}
                          <p className="mt-2 flex items-center justify-between gap-2">
                            {/* « À évaluer » (null) n'apprend rien : rien ne
                                s'affiche (27/10) — la carte s'allège d'autant. */}
                            {c.confidence_level ? (
                              <ConfidenceBadge
                                level={c.confidence_level}
                                reason={c.confidence_reason}
                                locked={c.confidence_locked}
                              />
                            ) : (
                              <span />
                            )}
                            <ProchaineActionTexte
                              at={c.next_action_at}
                              kind={c.next_action_kind}
                              statut={c.status}
                              plusRien={c.plus_rien}
                              avecHeure
                              className="shrink-0 text-[11px]"
                              couleurNeutre="text-slate-400"
                            />
                          </p>
                          {c.confidence_level && c.confidence_reason && !c.confidence_locked && (
                            <p className="mt-1 truncate text-[11px] text-slate-500" title={c.confidence_reason}>
                              {c.confidence_reason}
                            </p>
                          )}
                        </Link>

                        {/* Repli tactile : le glisser-déposer HTML5 ne marche pas
                            au doigt. Absent sur la fiche d'un collègue : masquer,
                            pas désactiver (la base refuserait après coup). */}
                        {c.modifiable !== false && (
                        <select
                          value={c.status}
                          onChange={(e) => move(c.id, e.target.value as ProspectStatus)}
                          aria-label={`Étape de ${c.company_name}`}
                          className="mt-2.5 min-h-[44px] w-full rounded-lg bg-white/[0.04] px-2 py-1.5 text-[11px] text-slate-300 ring-1 ring-white/10 outline-none transition focus:ring-celya-blue/60 lg:hidden"
                        >
                          {STATUS_ORDER.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                        )}
                      </article>
                    );
                  })}
                </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
