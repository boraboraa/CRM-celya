"use client";

import { useState, useTransition } from "react";
import {
  cloturerRendezVousAction,
  deplacerRendezVousAction,
} from "@/app/actions";
import { Icone } from "@/components/ui";
import { ChampExtensible } from "@/components/ChampExtensible";
import { ChoixRelance } from "@/components/ChoixRelance";
import { PastilleContact } from "@/components/PastilleContact";
import {
  ISSUES_TENUES,
  ISSUE_CHIP,
  ISSUE_ICON,
  ISSUE_LABEL,
  manqueDebrief,
  type IssueDebrief,
} from "@/lib/crm/debrief";

/** Les issues qui attendent un complément avant de partir. */
type IssueDepliee = "a_rappeler" | "suivi_email" | "pas_interesse" | "pas_decroche";
const DEPLIEES: IssueDebrief[] = ["a_rappeler", "suivi_email", "pas_interesse", "pas_decroche"];
const estDepliee = (i: IssueDebrief): i is IssueDepliee => DEPLIEES.includes(i);

/** Ce que demande le panneau des dates, par issue. */
const QUAND: Record<"a_rappeler" | "suivi_email" | "pas_decroche", string> = {
  a_rappeler: "Rappeler quand ?",
  suivi_email: "Relancer quand ?",
  pas_decroche: "Rappeler quand ? (facultatif)",
};

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
 * tout de suite. « Intéressé — à rappeler » et « Suivi par email » déplient les
 * dates (un tap de plus, c'est la date qui envoie) ; « Pas intéressé » déplie la
 * raison, exigée. Le compte rendu reste facultatif. En secondaire, « N'a pas eu
 * lieu » → Pas décroché (la relance est proposée, jamais exigée), Reporter
 * (nouvelle date connue) ou Annulé.
 *
 * `pendant` est appelé DANS la transition, avant l'appel serveur : c'est là
 * que le parent retire la ligne de façon optimiste (elle revient seule si le
 * serveur refuse). `apres` reçoit l'issue.
 */
export function DebriefRdv({
  meetingId,
  prospectId,
  contactActuel = null,
  pendant,
  apres,
}: {
  meetingId: string;
  /** La fiche du RDV : sans elle, pas de pastille « Contact → … ». */
  prospectId?: string | null;
  contactActuel?: string | null;
  pendant?: () => void;
  apres?: (r: IssueEnvoyee) => void;
}) {
  const [pending, startTransition] = useTransition();
  /** Ce qui manque (ambre) ou ce que le serveur a refusé (rose). */
  const [erreur, setErreur] = useState<{ texte: string; serveur: boolean }>();
  const [compteRendu, setCompteRendu] = useState("");
  const [raison, setRaison] = useState("");
  /** L'issue dépliée qui attend son complément (date ou raison). */
  const [ouverte, setOuverte] = useState<IssueDepliee | null>(null);
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
    if (estDepliee(issue)) {
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

      {prospectId && (
        <PastilleContact prospectId={prospectId} texte={compteRendu} contactActuel={contactActuel} />
      )}

      {/* Téléphone : les six issues en grille de deux (une issue impaire, la
          dernière, prendrait toute la ligne : aucune orpheline). */}
      <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap" role="group" aria-label="Ce qu'a donné le rendez-vous">
        {ISSUES_TENUES.map((issue, i) => (
          <button
            key={issue}
            type="button"
            disabled={pending}
            aria-expanded={estDepliee(issue) ? ouverte === issue : undefined}
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

      {(ouverte === "a_rappeler" || ouverte === "suivi_email" || ouverte === "pas_decroche") && (
        // Le jour en liste, l'heure en un tap : c'est l'heure qui envoie
        // (lib/crm/relance.ts — le même composant que la carte et « À faire »).
        <ChoixRelance
          titre={QUAND[ouverte]}
          onChoisir={(valeur) => envoyer(ouverte, valeur)}
          pending={pending}
          extra={
            ouverte === "pas_decroche" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => envoyer("pas_decroche")}
                className="btn-link min-h-[44px] px-2 text-[11px]"
              >
                Sans relance
              </button>
            ) : null
          }
        />
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
              onClick={() => choisir("pas_decroche")}
              aria-expanded={ouverte === "pas_decroche"}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium ring-1 transition ${ISSUE_CHIP.pas_decroche}`}
            >
              <Icone nom={ISSUE_ICON.pas_decroche} className="h-3 w-3" />
              {ISSUE_LABEL.pas_decroche}
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
