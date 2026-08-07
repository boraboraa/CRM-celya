"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { moveProspectAction } from "@/app/actions";
import {
  STATUS_ORDER,
  STATUS_LABEL,
  STATUS_ICON,
  STATUS_EDGE,
  relative,
} from "@/lib/constants";
import { ConfidenceBadge, LastActionLine } from "@/components/ui";
import type { LastActionKind } from "@/lib/crm/lastAction";
import type { ConfidenceLevel, ProspectStatus } from "@/lib/types";

/**
 * La couleur de chaque étape, déclinée pour la colonne : bandeau d'en-tête,
 * pastille du compteur, halo de la colonne survolée pendant le drag et zone
 * « Déposer ici ». Classes complètes, jamais interpolées (règle JIT).
 */
const COLUMN_BANNER: Record<ProspectStatus, string> = {
  a_appeler: "bg-slate-500/20 text-slate-100 ring-slate-400/30",
  contacte: "bg-cyan-500/20 text-cyan-100 ring-cyan-400/30",
  rendez_vous: "bg-blue-500/20 text-blue-100 ring-blue-400/30",
  proposition: "bg-amber-500/20 text-amber-100 ring-amber-400/30",
  gagne: "bg-emerald-500/20 text-emerald-100 ring-emerald-400/30",
  perdu: "bg-rose-500/20 text-rose-100 ring-rose-400/30",
};

const COLUMN_COUNT: Record<ProspectStatus, string> = {
  a_appeler: "bg-slate-400/25 text-slate-100",
  contacte: "bg-cyan-400/25 text-cyan-100",
  rendez_vous: "bg-blue-400/25 text-blue-100",
  proposition: "bg-amber-400/25 text-amber-100",
  gagne: "bg-emerald-400/25 text-emerald-100",
  perdu: "bg-rose-400/25 text-rose-100",
};

/** La colonne cible s'illumine dans SA teinte pendant le drag. */
const COLUMN_TARGET: Record<ProspectStatus, string> = {
  a_appeler: "bg-slate-500/[0.08] ring-slate-400/40",
  contacte: "bg-cyan-500/[0.08] ring-cyan-400/40",
  rendez_vous: "bg-blue-500/[0.08] ring-blue-400/40",
  proposition: "bg-amber-500/[0.08] ring-amber-400/40",
  gagne: "bg-emerald-500/[0.08] ring-emerald-400/40",
  perdu: "bg-rose-500/[0.08] ring-rose-400/40",
};

const COLUMN_DROP: Record<ProspectStatus, string> = {
  a_appeler: "border-slate-400/50 bg-slate-500/[0.07] text-slate-300",
  contacte: "border-cyan-400/50 bg-cyan-500/[0.07] text-cyan-300",
  rendez_vous: "border-blue-400/50 bg-blue-500/[0.07] text-blue-300",
  proposition: "border-amber-400/50 bg-amber-500/[0.07] text-amber-300",
  gagne: "border-emerald-400/50 bg-emerald-500/[0.07] text-emerald-300",
  perdu: "border-rose-400/50 bg-rose-500/[0.07] text-rose-300",
};

export type BoardProspect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  status: ProspectStatus;
  confidence_level: ConfidenceLevel | null;
  confidence_reason: string | null;
  confidence_locked: boolean;
  next_action_at: string | null;
  /** Dernière action (canal + date) — vue prospect_action_state. */
  last_kind: LastActionKind | null;
  last_at: string | null;
};

/**
 * Le pipeline : une colonne par étape, glisser-déposer pour corriger.
 *
 * Déposer une fiche est une décision humaine — elle VERROUILLE l'étape
 * (moveProspectAction), et l'auto-classification n'y touchera plus.
 *
 * Plus aucun montant sur les cartes : c'est la CONFIANCE estimée par l'IA
 * (Chaud / Tiède / Froid, avec sa raison courte) qui dit si l'affaire est
 * chaude. « À évaluer » quand rien n'a pu être estimé.
 */
export function PipelineBoard({ prospects }: { prospects: BoardProspect[] }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<ProspectStatus | null>(null);
  const [justMoved, setJustMoved] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();

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

      <p className="mb-4 text-xs text-slate-500">
        Faites glisser une fiche d&apos;une colonne à l&apos;autre pour corriger son
        étape — ce choix est alors verrouillé, l&apos;assistant n&apos;y touchera plus.
        Sur mobile, utilisez le menu au bas de chaque carte.
      </p>

      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        <div className="flex min-w-max gap-4">
          {STATUS_ORDER.map((status, columnIndex) => {
            const list = items.filter((c) => c.status === status);
            const isTarget = overColumn === status;
            // Colonne d'origine de la carte en cours de déplacement : on la
            // laisse en retrait pour que la cible ressorte.
            const isSource = dragging !== null && dragging.status === status;

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
                className={`w-[272px] shrink-0 animate-rise rounded-2xl p-2 ring-1 transition-all duration-200 ${
                  isTarget
                    ? COLUMN_TARGET[status]
                    : isSource
                      ? "bg-white/[0.015] ring-white/[0.06]"
                      : "ring-transparent"
                }`}
              >
                <header className="mb-3">
                  {/* Un vrai bandeau dans la couleur de l'étape, compteur
                      dans une pastille de la même teinte. */}
                  <h2
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ring-1 transition-all duration-200 ${
                      COLUMN_BANNER[status]
                    } ${isTarget ? "brightness-125" : ""}`}
                  >
                    <span aria-hidden className="text-xs opacity-80">
                      {STATUS_ICON[status]}
                    </span>
                    {STATUS_LABEL[status]}
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${COLUMN_COUNT[status]}`}
                    >
                      {list.length}
                    </span>
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
                    const overdue =
                      c.next_action_at &&
                      new Date(c.next_action_at).getTime() < Date.now();
                    const isDragged = dragId === c.id;
                    const landed = justMoved === c.id;
                    // Le repère d'attente est sur LA carte manipulée, pas sur
                    // l'écran entier : le reste du pipeline reste utilisable.
                    const enregistre = enCours === c.id;

                    return (
                      <article
                        key={c.id}
                        draggable
                        onDragStart={(e) => {
                          setDragId(c.id);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", c.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverColumn(null);
                        }}
                        className={`card card-hover card-lift cursor-grab border-l-4 p-3.5 active:cursor-grabbing ${
                          STATUS_EDGE[c.status]
                        } ${
                          isDragged
                            ? "scale-[0.97] rotate-[-1.5deg] opacity-45 ring-celya-blue/40"
                            : ""
                        } ${landed ? "ring-2 ring-celya-cyan/60 shadow-glow" : ""}`}
                      >
                        {enregistre && (
                          <span
                            aria-label="Enregistrement en cours"
                            title="Enregistrement…"
                            className="float-right ml-2 mt-0.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-celya-cyan/70 border-t-transparent"
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
                          <p className="truncate text-sm font-semibold text-slate-50">
                            {c.company_name}
                          </p>
                          {c.contact_name && (
                            <p className="truncate text-xs text-slate-400">
                              {c.contact_name}
                            </p>
                          )}

                          {/* La DERNIÈRE ACTION : canal + résultat + date —
                              ce qui manquait le plus sur la carte. */}
                          {c.last_kind && c.last_at && (
                            <p className="mt-1.5 truncate text-[11px]">
                              <LastActionLine kind={c.last_kind} at={c.last_at} />
                            </p>
                          )}

                          {/* La confiance, d'un coup d'œil — et sa raison. */}
                          <p className="mt-2 flex items-center justify-between gap-2">
                            <ConfidenceBadge
                              level={c.confidence_level}
                              reason={c.confidence_reason}
                              locked={c.confidence_locked}
                            />
                            <span
                              className={`shrink-0 text-[11px] ${overdue ? "text-rose-400" : "text-slate-400"}`}
                            >
                              {c.next_action_at ? relative(c.next_action_at) : "—"}
                            </span>
                          </p>
                          {c.confidence_reason && !c.confidence_locked && (
                            <p className="mt-1 truncate text-[11px] text-slate-500">
                              {c.confidence_reason}
                            </p>
                          )}
                        </Link>

                        {/* Repli tactile : le glisser-déposer HTML5 ne marche pas au doigt. */}
                        <select
                          value={c.status}
                          onChange={(e) => move(c.id, e.target.value as ProspectStatus)}
                          aria-label={`Étape de ${c.company_name}`}
                          className="mt-2.5 w-full rounded-lg bg-white/[0.04] px-2 py-1.5 text-[11px] text-slate-300 ring-1 ring-white/10 outline-none transition focus:ring-celya-blue/60 lg:hidden"
                        >
                          {STATUS_ORDER.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABEL[s]}
                            </option>
                          ))}
                        </select>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
