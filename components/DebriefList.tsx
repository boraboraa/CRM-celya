"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import {
  cloturerRendezVousAction,
  deplacerRendezVousAction,
} from "@/app/actions";
import { fmtDateTime, relative } from "@/lib/constants";
import { Icone } from "@/components/ui";

export type DebriefMeeting = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  prospect: { id: string; company_name: string } | null;
};

/**
 * « Rendez-vous à débriefer » — la boucle qui manquait : le parcours
 * s'arrêtait au rendez-vous posé, rien ne demandait jamais ce qu'il avait
 * donné.
 *
 * Trois gestes en un clic — « Ça s'est fait » · « Annulé » · « Reporté » —
 * plus un champ de compte rendu d'une ligne, versé au journal de la fiche
 * (attesté quand le rendez-vous a eu lieu). Optimiste : la ligne quitte la
 * zone au clic, et revient d'elle-même si le serveur refuse.
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
