"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import {
  cloturerRendezVousAction,
  deplacerRendezVousAction,
} from "@/app/actions";
import { fmtDateTime, relative, RACCOURCIS_RELANCE } from "@/lib/constants";
import { Icone } from "@/components/ui";

export type DebriefMeeting = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  prospect: {
    id: string;
    company_name: string;
    /** Gagné / Perdu : on ne pose plus rien, pas de « Et ensuite ? ». */
    close?: boolean;
  } | null;
};

/** « Et ensuite ? » — une date locale « YYYY-MM-DD », ou rien de dit. */
type Suite = string | undefined;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date locale décalée de N jours (le navigateur de Bora est à Bruxelles). */
function shiftedDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * « Rendez-vous à débriefer » — la boucle qui manquait : le parcours
 * s'arrêtait au rendez-vous posé, rien ne demandait jamais ce qu'il avait
 * donné.
 *
 * Trois gestes en un clic — « Ça s'est fait » · « Annulé » · « Reporté » —
 * plus un champ de compte rendu d'une ligne, versé au journal de la fiche
 * (attesté quand le rendez-vous a eu lieu). Optimiste : la ligne quitte la
 * zone au clic, et revient d'elle-même si le serveur refuse.
 *
 * « Et ensuite ? » (migration 022) : c'est ICI que la prochaine action se pose
 * — Demain / +3 j / +1 sem / une date. OFFERT, jamais exigé : « Ça s'est
 * fait » reste à UN tap. On ne paie un tap de plus que quand on a quelque
 * chose à dire. Ignoré, rien n'est posé : les relances d'avant le rendez-vous
 * ont été clôturées à sa pose, donc une fiche sans autre relance ne remonte
 * plus dans « À faire » (elle reste dans la liste, étape inchangée).
 */
export function DebriefList({ meetings }: { meetings: DebriefMeeting[] }) {
  const [vue, retirer] = useOptimistic(
    meetings,
    (liste: DebriefMeeting[], id: string) => liste.filter((m) => m.id !== id)
  );
  const [erreur, setErreur] = useState<string>();
  const [enCours, setEnCours] = useState<string | null>(null);
  /** Ligne dont le report est déplié (choix de la nouvelle date). */
  const [reportId, setReportId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [suites, setSuites] = useState<Record<string, Suite>>({});
  const choisir = (id: string, v: Suite) =>
    setSuites((s) => ({ ...s, [id]: s[id] === v ? undefined : v }));
  const [, startTransition] = useTransition();

  function cloturer(id: string, resultat: "honore" | "annule") {
    setErreur(undefined);
    setEnCours(id);
    startTransition(async () => {
      retirer(id);
      const res = await cloturerRendezVousAction({
        id,
        resultat,
        compteRendu: notes[id]?.trim() || null,
        suite: suites[id] ?? null,
      });
      if (res?.error) setErreur(res.error);
      setEnCours(null);
    });
  }

  function reporter(id: string, local: string) {
    if (!local || local.length < 16) return;
    setErreur(undefined);
    setEnCours(id);
    startTransition(async () => {
      retirer(id);
      const res = await deplacerRendezVousAction({
        id,
        startsAt: local.slice(0, 16),
        motif: notes[id]?.trim() || null,
      });
      if (res?.error) setErreur(res.error);
      setEnCours(null);
      setReportId(null);
    });
  }

  if (vue.length === 0 && !erreur) return null;

  return (
    <>
      {erreur && (
        <p
          role="alert"
          className="mb-2 rounded-xl bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300 ring-1 ring-rose-400/20"
        >
          {erreur}
        </p>
      )}
      <ul className="card animate-rise divide-y divide-white/[0.05]">
        {vue.map((m) => (
          <li
            key={m.id}
            className={`space-y-2 px-4 py-3.5 transition-opacity duration-150 ${
              enCours === m.id ? "opacity-60" : ""
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Icone nom="calendrier" className="h-4 w-4 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-100">
                  {m.prospect ? (
                    <Link
                      href={`/prospects/${m.prospect.id}`}
                      prefetch={false}
                      className="underline-offset-2 hover:text-celya-blue hover:underline"
                    >
                      {m.title}
                    </Link>
                  ) : (
                    m.title
                  )}
                </p>
                <p className="text-xs text-slate-400">
                  {fmtDateTime(m.starts_at)} · terminé {relative(m.ends_at)}
                </p>
              </div>
            </div>

            <input
              value={notes[m.id] ?? ""}
              onChange={(e) =>
                setNotes((n) => ({ ...n, [m.id]: e.target.value }))
              }
              placeholder="Compte rendu en une ligne (facultatif) — versé au journal de la fiche"
              className="input py-1.5 text-xs"
            />

            {m.prospect && !m.prospect.close && (
              <div
                className="flex flex-wrap items-center gap-1"
                role="group"
                aria-label="Et ensuite ? (facultatif)"
              >
                <span className="pr-0.5 text-[11px] text-slate-500">
                  Et ensuite&nbsp;? <span className="text-slate-600">(facultatif)</span>
                </span>
                {RACCOURCIS_RELANCE.map((r) => {
                  const v = shiftedDate(r.jours);
                  const actif = suites[m.id] === v;
                  return (
                    <button
                      key={r.label}
                      type="button"
                      aria-pressed={actif}
                      onClick={() => choisir(m.id, v)}
                      className={`min-h-[36px] rounded-lg px-2.5 text-[11px] transition ${
                        actif
                          ? "bg-celya-blue/20 text-blue-200 ring-1 ring-celya-blue/50"
                          : "text-slate-400 hover:bg-celya-blue/15 hover:text-blue-200"
                      }`}
                    >
                      {r.label}
                    </button>
                  );
                })}
                <input
                  type="date"
                  value={suites[m.id] ?? ""}
                  onChange={(e) => choisir(m.id, e.target.value || undefined)}
                  aria-label="Relancer à une date précise"
                  className="min-h-[36px] rounded-lg bg-white/[0.04] px-2 text-[11px] text-slate-300 ring-1 ring-white/10 outline-none focus:ring-celya-blue/60"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => cloturer(m.id, "honore")}
                disabled={enCours === m.id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-400/25 transition hover:bg-emerald-500/25"
              >
                <Icone nom="coche" className="h-3 w-3" />
                Ça s&apos;est fait
              </button>
              <button
                type="button"
                onClick={() => cloturer(m.id, "annule")}
                disabled={enCours === m.id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-medium text-rose-300 ring-1 ring-rose-400/20 transition hover:bg-rose-500/20"
              >
                <Icone nom="croix" className="h-3 w-3" />
                Annulé
              </button>
              <button
                type="button"
                onClick={() => setReportId((r) => (r === m.id ? null : m.id))}
                disabled={enCours === m.id}
                aria-expanded={reportId === m.id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 ring-1 ring-white/10 transition hover:bg-white/[0.08]"
              >
                <Icone nom="report" className="h-3 w-3" />
                Reporté
              </button>
              {reportId === m.id && (
                <input
                  type="datetime-local"
                  autoFocus
                  onChange={(e) => reporter(m.id, e.target.value)}
                  aria-label="Nouvelle date du rendez-vous"
                  className="rounded-lg bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300 ring-1 ring-white/10 outline-none focus:ring-celya-blue/60"
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
