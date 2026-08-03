"use client";

import { useState, useTransition } from "react";
import {
  planifierRappelAction,
  archiverProspectAction,
} from "@/app/actions";
import { analyzeCallNoteAction } from "@/app/ai-actions";
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_ORDER,
  MAX_CALL_ATTEMPTS,
} from "@/lib/constants";
import type { CallOutcome } from "@/lib/types";

export type CallActionsProspect = {
  id: string;
  company_name: string;
  status: string;
  call_attempts: number;
};

/**
 * Saisie du résultat d'un appel : note libre + boutons de résultat.
 * Enregistrer un appel = choisir le résultat, confirmer. Deux clics.
 * Au-delà de MAX_CALL_ATTEMPTS tentatives sans réponse, propose l'archivage
 * (la bascule en Perdu reste une décision humaine).
 */
export function CallActions({
  prospect,
  slotHint,
}: {
  prospect: CallActionsProspect;
  slotHint?: string | null;
}) {
  const [selected, setSelected] = useState<CallOutcome | null>(null);
  const [note, setNote] = useState("");
  const [delay, setDelay] = useState("");
  const [dateLocale, setDateLocale] = useState("");
  const [motif, setMotif] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [keepCalling, setKeepCalling] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  // Proposition de l'IA (B2) — proposée, jamais appliquée sans clic.
  const [resume, setResume] = useState("");
  const [contactProposal, setContactProposal] = useState("");
  const [applyContact, setApplyContact] = useState(true);
  const [aiNote, setAiNote] = useState<string>();
  const [analyzing, startAnalyze] = useTransition();

  const overCap =
    prospect.call_attempts >= MAX_CALL_ATTEMPTS &&
    (prospect.status === "sans_reponse" || prospect.status === "a_appeler") &&
    !keepCalling;

  const config = selected ? CALL_OUTCOMES[selected] : null;

  function pick(outcome: CallOutcome) {
    setSelected(outcome);
    setError(undefined);
    const c = CALL_OUTCOMES[outcome];
    setDelay(c.delayDays !== null ? String(c.delayDays) : "");
    setDateLocale("");
    setMotif("");
  }

  function reset() {
    setSelected(null);
    setNote("");
    setDelay("");
    setDateLocale("");
    setMotif("");
    setResume("");
    setContactProposal("");
    setAiNote(undefined);
    setError(undefined);
  }

  /** B2 — envoie la note au modèle, pré-remplit le formulaire. Rien n'est
   *  enregistré : c'est le clic « Enregistrer » qui déclenche planifierRappel. */
  function analyze() {
    if (!note.trim()) return;
    setAiNote(undefined);
    setError(undefined);
    startAnalyze(async () => {
      const res = await analyzeCallNoteAction({ note });
      if (res.error) {
        setAiNote(res.error);
        return;
      }
      if (res.unavailable || !res.proposal) {
        setAiNote("Assistant indisponible — choisissez le résultat à la main.");
        return;
      }
      const p = res.proposal;
      if (p.resultat) {
        pick(p.resultat);
        if (p.dateLocale && CALL_OUTCOMES[p.resultat].needsDate) {
          setDateLocale(
            p.resultat === "rdv_fixe" && p.dateLocale.length === 10
              ? `${p.dateLocale}T09:00`
              : p.dateLocale
          );
        }
      } else {
        setAiNote("Résultat d'appel non reconnu — choisissez-le à la main.");
      }
      setResume(p.resume ?? "");
      setContactProposal(p.contact_name ?? "");
      setApplyContact(true);
    });
  }

  function save() {
    if (!selected || !config) return;
    setError(undefined);
    startTransition(async () => {
      const res = await planifierRappelAction({
        prospectId: prospect.id,
        resultat: selected,
        note: note || null,
        dateLocale:
          config.needsDate && dateLocale
            ? selected === "rappeler_plus_tard" && dateLocale.length === 10
              ? `${dateLocale}T09:00`
              : dateLocale
            : null,
        delaiJours:
          !config.needsDate && config.delayDays !== null && delay !== ""
            ? Number(delay)
            : null,
        motif: motif || null,
        resume: resume || null,
        contactName: applyContact && contactProposal ? contactProposal : null,
      });
      if (res.error) setError(res.error);
      else reset();
    });
  }

  function archive() {
    setError(undefined);
    startTransition(async () => {
      const res = await archiverProspectAction({
        prospectId: prospect.id,
        motif: motif || null,
      });
      if (res.error) setError(res.error);
    });
  }

  // ------------------------------------------------ plafond de tentatives
  if (overCap) {
    return (
      <div className="rounded-xl bg-amber-500/[0.08] p-3 ring-1 ring-amber-400/20">
        <p className="text-xs text-amber-200">
          {prospect.call_attempts} appels sans réponse — proposer autre chose que
          de rappeler ?
        </p>
        {archiving ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              className="input max-w-xs py-1.5 text-xs"
              placeholder={`Injoignable après ${prospect.call_attempts} tentatives`}
            />
            <button
              onClick={archive}
              disabled={pending}
              className="btn-danger px-3 py-1.5 text-xs"
            >
              {pending ? "…" : "Confirmer l'archivage"}
            </button>
            <button
              onClick={() => setArchiving(false)}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              Annuler
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => setArchiving(true)}
              className="btn-danger px-3 py-1.5 text-xs"
            >
              Archiver (Perdu)
            </button>
            <button
              onClick={() => setKeepCalling(true)}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              Continuer d&apos;appeler
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      </div>
    );
  }

  // ------------------------------------------------------- saisie normale
  return (
    <div>
      {slotHint && <p className="mb-2 text-[11px] text-amber-300/90">{slotHint}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="input min-w-[180px] flex-1 py-2 text-xs"
          placeholder="Note d'appel (facultatif)… ex. « rappeler après les fêtes, le gérant c'est Marc »"
        />
        <button
          type="button"
          onClick={analyze}
          disabled={analyzing || !note.trim()}
          title="Structurer la note avec l'assistant : résultat, date de rappel, contact"
          className="btn-ghost shrink-0 px-3 py-2 text-xs"
        >
          {analyzing ? "Analyse…" : "✨ Analyser"}
        </button>
      </div>

      {aiNote && <p className="mt-1.5 text-[11px] text-slate-500">{aiNote}</p>}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {CALL_OUTCOME_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => (selected === key ? reset() : pick(key))}
            className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium ring-1 transition ${
              selected === key
                ? "bg-celya-gradient text-slate-950 ring-transparent"
                : "bg-white/[0.04] text-slate-400 ring-white/10 hover:text-slate-200"
            }`}
          >
            {CALL_OUTCOMES[key].label}
          </button>
        ))}
      </div>

      {selected && config && (
        <div className="mt-2.5 space-y-2 rounded-xl bg-white/[0.03] p-2.5 ring-1 ring-white/[0.07]">
          {resume && (
            <p className="text-xs text-slate-300">
              <span className="text-slate-500">Résumé proposé :</span> {resume}
            </p>
          )}
          {contactProposal && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={applyContact}
                onChange={(e) => setApplyContact(e.target.checked)}
                className="h-3.5 w-3.5 accent-cyan-400"
              />
              Mettre à jour le contact : {contactProposal}
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
          {config.needsDate && selected === "rappeler_plus_tard" && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              Rappeler le
              <input
                type="date"
                value={dateLocale}
                onChange={(e) => setDateLocale(e.target.value)}
                className="input w-auto py-1.5 text-xs"
              />
            </label>
          )}

          {config.needsDate && selected === "rdv_fixe" && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              RDV le
              <input
                type="datetime-local"
                value={dateLocale}
                onChange={(e) => setDateLocale(e.target.value)}
                className="input w-auto py-1.5 text-xs"
              />
            </label>
          )}

          {!config.needsDate && config.delayDays !== null && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              Rappel dans
              <input
                type="number"
                min={0}
                max={365}
                value={delay}
                onChange={(e) => setDelay(e.target.value)}
                className="input w-16 py-1.5 text-center text-xs"
              />
              jour{Number(delay) > 1 ? "s" : ""}
            </label>
          )}

          {config.needsReason && (
            <input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              className="input max-w-[220px] py-1.5 text-xs"
              placeholder="Motif du refus…"
            />
          )}

          {selected === "mauvais_numero" && (
            <span className="text-xs text-slate-400">
              La fiche passera en Perdu (numéro invalide).
            </span>
          )}

          <button
            onClick={save}
            disabled={pending || (config.needsDate && !dateLocale)}
            className="btn-primary px-3.5 py-1.5 text-xs"
          >
            {pending ? "Enregistrement…" : "Enregistrer"}
          </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
