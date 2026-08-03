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
  next_action_at: string | null;
};

export function PipelineBoard({ prospects }: { prospects: BoardProspect[] }) {
  const [items, setItems] = useState(prospects);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<ProspectStatus | null>(null);
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();

  // Resynchronise quand le serveur renvoie des données fraîches.
  useEffect(() => setItems(prospects), [prospects]);

  function move(id: string, status: ProspectStatus) {
    const current = items.find((c) => c.id === id);
    if (!current || current.status === status) return;

    const previous = items;
    setItems((list) =>
      list.map((c) => (c.id === id ? { ...c, status } : c))
    );
    setError(undefined);

    startTransition(async () => {
      try {
        await moveProspectAction(id, status);
      } catch {
        setItems(previous);
        setError("Le déplacement n'a pas pu être enregistré. Réessayez.");
      }
    });
  }

  return (
    <>
      {error && (
        <p className="mb-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300 ring-1 ring-rose-400/20">
          {error}
        </p>
      )}

      <p className="mb-4 text-xs text-slate-500">
        Faites glisser une fiche d&apos;une colonne à l&apos;autre pour changer son
        statut. Sur mobile, utilisez le menu au bas de chaque carte.
      </p>

      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        <div className="flex min-w-max gap-4">
          {STATUS_ORDER.map((status) => {
            const list = items.filter((c) => c.status === status);
            const total = list.reduce(
              (sum, c) => sum + Number(c.value_estimate ?? 0),
              0
            );
            const isTarget = overColumn === status;

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
                className={`w-[264px] shrink-0 rounded-2xl p-2 transition ${
                  isTarget ? "bg-celya-blue/10 ring-1 ring-celya-blue/40" : ""
                }`}
              >
                <header className="mb-3 flex items-center justify-between px-1">
                  <h2 className="flex items-center gap-2 text-sm font-medium text-slate-200">
                    <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
                    {STATUS_LABEL[status]}
                    <span className="text-xs text-slate-500">{list.length}</span>
                  </h2>
                  {total > 0 && (
                    <span className="text-[11px] text-slate-500">{fmtMoney(total)}</span>
                  )}
                </header>

                <div className="space-y-2.5">
                  {list.length === 0 && (
                    <p className="rounded-xl border border-dashed border-white/[0.07] px-3 py-6 text-center text-xs text-slate-600">
                      {isTarget ? "Déposer ici" : "Vide"}
                    </p>
                  )}

                  {list.map((c) => {
                    const overdue =
                      c.next_action_at &&
                      new Date(c.next_action_at).getTime() < Date.now();
                    const dragging = dragId === c.id;

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
                        className={`card card-hover cursor-grab p-3.5 active:cursor-grabbing ${
                          dragging ? "opacity-40" : ""
                        }`}
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
                              {fmtMoney(c.value_estimate)}
                            </span>
                            <span
                              className={overdue ? "text-rose-400" : "text-slate-500"}
                            >
                              {c.next_action_at ? relative(c.next_action_at) : "—"}
                            </span>
                          </p>
                        </Link>

                        {/* Repli tactile : le glisser-déposer HTML5 ne marche pas au doigt. */}
                        <select
                          value={c.status}
                          onChange={(e) => move(c.id, e.target.value as ProspectStatus)}
                          aria-label={`Statut de ${c.company_name}`}
                          className="mt-2.5 w-full rounded-lg bg-white/[0.04] px-2 py-1.5 text-[11px] text-slate-300 ring-1 ring-white/10 outline-none focus:ring-celya-blue/60 lg:hidden"
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
