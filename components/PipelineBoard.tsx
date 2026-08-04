"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { moveProspectAction } from "@/app/actions";
import {
  STATUS_ORDER,
  STATUS_LABEL,
  STATUS_DOT,
  fmtMoney,
  relative,
} from "@/lib/constants";
import type { ProspectStatus } from "@/lib/types";

export type BoardProspect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  status: ProspectStatus;
  value_estimate: number | null;
  probability: number | null;
  weighted_value: number | null;
  next_action_at: string | null;
};

/**
 * Le pipeline : une colonne par étape, glisser-déposer pour corriger.
 *
 * Déposer une fiche est une décision humaine — elle VERROUILLE l'étape
 * (moveProspectAction), et l'auto-classification n'y touchera plus.
 *
 * En tête de colonne : le total pondéré (valeur estimée × probabilité), qui
 * est l'indicateur de priorisation, et le total brut en second.
 */
export function PipelineBoard({ prospects }: { prospects: BoardProspect[] }) {
  const [items, setItems] = useState(prospects);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<ProspectStatus | null>(null);
  const [justMoved, setJustMoved] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();

  // Resynchronise quand le serveur renvoie des données fraîches.
  useEffect(() => setItems(prospects), [prospects]);

  // Retire le halo « déplacé » après l'animation.
  useEffect(() => {
    if (!justMoved) return;
    const t = setTimeout(() => setJustMoved(null), 1400);
    return () => clearTimeout(t);
  }, [justMoved]);

  function move(id: string, status: ProspectStatus) {
    const current = items.find((c) => c.id === id);
    if (!current || current.status === status) return;

    const previous = items;
    setItems((list) => list.map((c) => (c.id === id ? { ...c, status } : c)));
    setJustMoved(id);
    setError(undefined);

    startTransition(async () => {
      try {
        await moveProspectAction(id, status);
      } catch {
        setItems(previous);
        setJustMoved(null);
        setError("Le déplacement n'a pas pu être enregistré. Réessayez.");
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
          {STATUS_ORDER.map((status) => {
            const list = items.filter((c) => c.status === status);
            const total = list.reduce((sum, c) => sum + Number(c.value_estimate ?? 0), 0);
            const weighted = list.reduce(
              (sum, c) => sum + Number(c.weighted_value ?? 0),
              0
            );
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
                className={`w-[272px] shrink-0 rounded-2xl p-2 ring-1 transition-all duration-200 ${
                  isTarget
                    ? "bg-celya-blue/10 ring-celya-blue/45 shadow-glow"
                    : isSource
                      ? "bg-white/[0.015] ring-white/[0.06]"
                      : "ring-transparent"
                }`}
              >
                <header className="mb-3 px-1">
                  <h2 className="flex items-center gap-2 text-sm font-medium text-slate-200">
                    <span
                      className={`h-2 w-2 rounded-full transition-transform duration-200 ${
                        STATUS_DOT[status]
                      } ${isTarget ? "scale-150" : ""}`}
                    />
                    {STATUS_LABEL[status]}
                    <span className="text-xs text-slate-500">{list.length}</span>
                  </h2>
                  {/* Total pondéré d'abord : c'est lui qui sert à prioriser. */}
                  {(weighted > 0 || total > 0) && (
                    <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[11px]">
                      {weighted > 0 && (
                        <span
                          className="font-medium text-celya-cyan"
                          title="Total pondéré : somme des valeurs × probabilités"
                        >
                          {fmtMoney(weighted)}
                        </span>
                      )}
                      {total > 0 && (
                        <span className="text-slate-600" title="Total des valeurs estimées">
                          / {fmtMoney(total)} brut
                        </span>
                      )}
                    </p>
                  )}
                </header>

                <div className="space-y-2.5">
                  {list.length === 0 && (
                    <p
                      className={`rounded-xl border border-dashed px-3 py-6 text-center text-xs transition-all duration-200 ${
                        isTarget
                          ? "border-celya-blue/50 bg-celya-blue/[0.07] text-celya-cyan"
                          : "border-white/[0.07] text-slate-600"
                      }`}
                    >
                      {isTarget ? "Déposer ici" : "Vide"}
                    </p>
                  )}

                  {/* Emplacement d'accueil au-dessus de la pile. */}
                  {isTarget && list.length > 0 && !isSource && (
                    <p className="rounded-xl border border-dashed border-celya-blue/50 bg-celya-blue/[0.07] px-3 py-3 text-center text-[11px] text-celya-cyan">
                      Déposer ici
                    </p>
                  )}

                  {list.map((c) => {
                    const overdue =
                      c.next_action_at &&
                      new Date(c.next_action_at).getTime() < Date.now();
                    const isDragged = dragId === c.id;
                    const landed = justMoved === c.id;

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
                        className={`card card-hover cursor-grab p-3.5 transition-all duration-200 active:cursor-grabbing ${
                          isDragged
                            ? "scale-[0.97] rotate-[-1.5deg] opacity-45 ring-celya-blue/40"
                            : "hover:-translate-y-0.5"
                        } ${landed ? "ring-2 ring-celya-cyan/60 shadow-glow" : ""}`}
                      >
                        <Link href={`/prospects/${c.id}`} className="block">
                          <p className="truncate text-sm font-medium text-slate-100">
                            {c.company_name}
                          </p>
                          {c.contact_name && (
                            <p className="truncate text-xs text-slate-500">
                              {c.contact_name}
                            </p>
                          )}

                          <p className="mt-2 flex items-center justify-between text-[11px]">
                            <span className="text-slate-400">
                              {c.weighted_value !== null ? (
                                <>
                                  <span className="font-medium text-celya-cyan">
                                    {fmtMoney(c.weighted_value)}
                                  </span>
                                  <span className="text-slate-600">
                                    {" "}
                                    · {fmtMoney(c.value_estimate)} × {c.probability} %
                                  </span>
                                </>
                              ) : (
                                fmtMoney(c.value_estimate)
                              )}
                            </span>
                            <span className={overdue ? "text-rose-400" : "text-slate-500"}>
                              {c.next_action_at ? relative(c.next_action_at) : "—"}
                            </span>
                          </p>
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
