"use client";

import { useState, useTransition } from "react";
import {
  planifierRappelAction,
  archiverProspectAction,
} from "@/app/actions";
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
    setError(undefined);
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
          placeholder="Note d'appel (facultatif)…"
        />
      </div>

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
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.03] p-2.5 ring-1 ring-white/[0.07]">
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
      )}

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
