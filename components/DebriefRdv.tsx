"use client";

import { useState, useTransition } from "react";
import {
  cloturerRendezVousAction,
  deplacerRendezVousAction,
} from "@/app/actions";
import { RACCOURCIS_RELANCE } from "@/lib/constants";
import { Icone } from "@/components/ui";
import { ChampExtensible } from "@/components/ChampExtensible";
import {
  ISSUES_TENUES,
  ISSUE_CHIP,
  ISSUE_ICON,
  ISSUE_LABEL,
  manqueDebrief,
  type IssueDebrief,
} from "@/lib/crm/debrief";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date locale décalée de N jours (le navigateur de Bora est à Bruxelles). */
function shiftedDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Ce qu'a donné le débrief, pour le parent qui l'affiche. */
export type IssueEnvoyee =
  | { ok: true; plusRien: boolean }
  | { ok: false; error: string };

/**
 * Le DÉBRIEF d'un rendez-vous passé — UN SEUL composant, sur la fiche (carte
 * PROCHAINE ACTION) et dans la zone « Rendez-vous à débriefer » du tableau de
 * bord. Un seul chemin serveur : `cloturerRendezVousAction`, qui passe par la
 * règle de lib/crm/debrief.ts — la même que l'outil MCP.
 *
 * Un tap suffit pour l'issue : « Proposition envoyée » et « Signé » partent
 * tout de suite. « Intéressé — à rappeler » déplie les dates (un tap de plus,
 * c'est la date qui envoie) ; « Pas intéressé » déplie la raison, exigée. Le
 * compte rendu reste facultatif. En secondaire, « N'a pas eu lieu » →
 * Reporter (nouvelle date) ou Annulé.
 *
 * `pendant` est appelé DANS la transition, avant l'appel serveur : c'est là
 * que le parent retire la ligne de façon optimiste (elle revient seule si le
 * serveur refuse). `apres` reçoit l'issue.
 */
export function DebriefRdv({
  meetingId,
  pendant,
  apres,
}: {
  meetingId: string;
  pendant?: () => void;
  apres?: (r: IssueEnvoyee) => void;
}) {
  const [pending, startTransition] = useTransition();
  /** Ce qui manque (ambre) ou ce que le serveur a refusé (rose). */
  const [erreur, setErreur] = useState<{ texte: string; serveur: boolean }>();
  const [compteRendu, setCompteRendu] = useState("");
  const [raison, setRaison] = useState("");
  /** L'issue dépliée qui attend son complément (date ou raison). */
  const [ouverte, setOuverte] = useState<"a_rappeler" | "pas_interesse" | null>(null);
  /** « N'a pas eu lieu » : Reporter / Annulé. */
  const [pasEuLieu, setPasEuLieu] = useState(false);
  const [report, setReport] = useState(false);

  function envoyer(issue: IssueDebrief, suite?: string) {
    const manque = manqueDebrief({ issue, suite, raison });
    if (manque) {
      setErreur({ texte: manque, serveur: false });
      return;
    }
    setErreur(undefined);
    startTransition(async () => {
      pendant?.();
      const res = await cloturerRendezVousAction({
        id: meetingId,
        issue,
        compteRendu: compteRendu.trim() || null,
        raison: issue === "pas_interesse" ? raison.trim() : null,
        suite: suite ?? null,
      });
      if (res?.error) {
        setErreur({ texte: res.error, serveur: true });
        apres?.({ ok: false, error: res.error });
      } else {
        apres?.({ ok: true, plusRien: res?.plusRien ?? false });
      }
    });
  }

  function reporter(local: string) {
    if (!local || local.length < 16) return;
    setErreur(undefined);
    startTransition(async () => {
      pendant?.();
      const res = await deplacerRendezVousAction({
        id: meetingId,
        startsAt: local.slice(0, 16),
        motif: compteRendu.trim() || null,
      });
      if (res?.error) {
        setErreur({ texte: res.error, serveur: true });
        apres?.({ ok: false, error: res.error });
      } else {
        apres?.({ ok: true, plusRien: false });
      }
    });
  }

  function choisir(issue: IssueDebrief) {
    setErreur(undefined);
    if (issue === "a_rappeler" || issue === "pas_interesse") {
      setOuverte((o) => (o === issue ? null : issue));
      return;
    }
    envoyer(issue);
  }

  return (
    <div className={`space-y-2 transition-opacity ${pending ? "opacity-60" : ""}`}>
      {/* Une ligne au départ, qui grandit avec la dictée. */}
      <ChampExtensible
        value={compteRendu}
        onChange={setCompteRendu}
        placeholder="Compte rendu en une ligne (facultatif)"
        aria-label="Compte rendu du rendez-vous (facultatif)"
        className="input py-1.5 text-xs"
      />

      {/* Téléphone : les cinq issues en grille de deux — « Pas intéressé »,
          la dernière, prend toute la ligne : aucune issue orpheline. */}
      <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap" role="group" aria-label="Ce qu'a donné le rendez-vous">
        {ISSUES_TENUES.map((issue, i) => (
          <button
            key={issue}
            type="button"
            disabled={pending}
            aria-expanded={
              issue === "a_rappeler" || issue === "pas_interesse"
                ? ouverte === issue
                : undefined
            }
            onClick={() => choisir(issue)}
            className={`inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl px-2.5 text-center text-xs font-medium leading-tight ring-1 transition sm:min-h-[44px] sm:justify-start sm:px-3 sm:text-left ${ISSUE_CHIP[issue]} ${
              ISSUES_TENUES.length % 2 === 1 && i === ISSUES_TENUES.length - 1 ? "col-span-2 sm:col-span-1" : ""
            } ${
              ouverte === issue ? "ring-2" : ""
            }`}
          >
            <Icone nom={ISSUE_ICON[issue]} className="h-3.5 w-3.5" />
            {ISSUE_LABEL[issue]}
          </button>
        ))}
      </div>

      {ouverte === "a_rappeler" && (
        <div
          className="flex flex-wrap items-center gap-1 rounded-xl bg-indigo-500/[0.06] px-1.5 py-1 ring-1 ring-indigo-400/20"
          role="group"
          aria-label="Rappeler quand ?"
        >
          <span className="pl-1 pr-0.5 text-[11px] text-indigo-200">Rappeler quand&nbsp;?</span>
          {RACCOURCIS_RELANCE.map((r) => (
            <button
              key={r.label}
              type="button"
              disabled={pending}
              onClick={() => envoyer("a_rappeler", shiftedDate(r.jours))}
              className="min-h-[44px] rounded-lg px-2.5 text-[11px] text-slate-300 transition hover:bg-indigo-500/20 hover:text-indigo-100"
            >
              {r.label}
            </button>
          ))}
          <input
            type="date"
            disabled={pending}
            onChange={(e) => e.target.value && envoyer("a_rappeler", e.target.value)}
            aria-label="Rappeler à une date précise"
            className="min-h-[44px] rounded-lg bg-white/[0.04] px-2 text-[11px] text-slate-300 ring-1 ring-white/10 outline-none focus:ring-celya-blue/60"
          />
        </div>
      )}

      {ouverte === "pas_interesse" && (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            envoyer("pas_interesse");
          }}
        >
          <input
            autoFocus
            value={raison}
            onChange={(e) => setRaison(e.target.value)}
            placeholder="Pourquoi ? (obligatoire)"
            aria-label="Raison du refus (obligatoire)"
            className="input min-w-0 flex-1 py-1.5 text-xs"
          />
          <button
            type="submit"
            disabled={pending || !raison.trim()}
            className="btn-ghost min-h-[44px] px-3 text-xs"
          >
            Confirmer
          </button>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setPasEuLieu((v) => !v);
            setReport(false);
          }}
          aria-expanded={pasEuLieu}
          className="btn-link min-h-[44px] text-xs"
        >
          N&apos;a pas eu lieu
        </button>
        {pasEuLieu && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => setReport((r) => !r)}
              aria-expanded={report}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 text-[11px] font-medium text-slate-300 ring-1 ring-white/10 transition hover:bg-white/[0.08]"
            >
              <Icone nom="report" className="h-3 w-3" />
              Reporter
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => envoyer("annule")}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium ring-1 transition ${ISSUE_CHIP.annule}`}
            >
              <Icone nom="croix" className="h-3 w-3" />
              Annulé
            </button>
            {report && (
              <input
                type="datetime-local"
                autoFocus
                onChange={(e) => reporter(e.target.value)}
                aria-label="Nouvelle date du rendez-vous"
                className="min-h-[44px] rounded-lg bg-white/[0.04] px-2 text-[11px] text-slate-300 ring-1 ring-white/10 outline-none focus:ring-celya-blue/60"
              />
            )}
          </>
        )}
      </div>

      {erreur && (
        <p
          role="alert"
          className={`rounded-xl px-3 py-2 text-xs ring-1 ${
            erreur.serveur
              ? "bg-rose-500/10 text-rose-300 ring-rose-400/20"
              : "bg-amber-500/10 text-amber-200 ring-amber-400/25"
          }`}
        >
          {erreur.texte}
        </p>
      )}
    </div>
  );
}
