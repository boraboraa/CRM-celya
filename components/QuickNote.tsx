"use client";

import { useState, useTransition } from "react";
import { saveExchangeAction } from "@/app/actions";
import { analyzeNoteAction } from "@/app/ai-actions";
import {
  ACTIVITY_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
  normalizeStatus,
} from "@/lib/constants";
import { DateField } from "@/components/DateField";
import type { ActivityType, ProspectStatus } from "@/lib/types";

const TYPES: ActivityType[] = ["note", "email", "rendez_vous"];

/**
 * Noter un échange : le geste central de la fiche. Une note (ce qu'il faut
 * retenir), l'étape si elle change, et la prochaine action à une date
 * précise — champ de date réel, raccourcis qui le remplissent.
 * Le bouton ✨ propose étape, date, contact et résumé à partir de la note ;
 * rien ne s'enregistre sans le clic Enregistrer.
 */
export function QuickNote({
  prospectId,
  companyName,
  currentStatus,
}: {
  prospectId: string;
  companyName: string;
  currentStatus: string;
}) {
  const initialStatus = normalizeStatus(currentStatus);

  const [type, setType] = useState<ActivityType>("note");
  const [note, setNote] = useState("");
  const [statut, setStatut] = useState<ProspectStatus>(initialStatus);
  const [dateLocale, setDateLocale] = useState("");
  const [motif, setMotif] = useState("");
  const [resume, setResume] = useState("");
  const [contactProposal, setContactProposal] = useState("");
  const [applyContact, setApplyContact] = useState(true);
  const [aiNote, setAiNote] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [analyzing, startAnalyze] = useTransition();

  const withTime = type === "rendez_vous" || statut === "rendez_vous";

  /** Garde la valeur du champ cohérente quand on passe date ↔ date+heure. */
  function coerceDate(value: string, needsTime: boolean): string {
    if (!value) return value;
    if (needsTime && value.length === 10) return `${value}T09:00`;
    if (!needsTime && value.length > 10) return value.slice(0, 10);
    return value;
  }

  function pickType(t: ActivityType) {
    setType(t);
    const nextStatut = t === "rendez_vous" ? "rendez_vous" : statut;
    if (t === "rendez_vous") setStatut("rendez_vous");
    setDateLocale((v) =>
      coerceDate(v, t === "rendez_vous" || nextStatut === "rendez_vous")
    );
  }

  function pickStatut(s: ProspectStatus) {
    setStatut(s);
    setDateLocale((v) => coerceDate(v, type === "rendez_vous" || s === "rendez_vous"));
  }

  function reset() {
    setType("note");
    setNote("");
    setStatut(initialStatus);
    setDateLocale("");
    setMotif("");
    setResume("");
    setContactProposal("");
    setAiNote(undefined);
    setError(undefined);
  }

  /** Propose étape, date, contact, résumé — proposés, jamais appliqués seuls. */
  function analyze() {
    if (!note.trim()) return;
    setAiNote(undefined);
    setError(undefined);
    startAnalyze(async () => {
      const res = await analyzeNoteAction({ note });
      if (res.error) {
        setAiNote(res.error);
        return;
      }
      if (res.unavailable || !res.proposal) {
        setAiNote("Assistant indisponible — remplissez les champs à la main.");
        return;
      }
      const p = res.proposal;
      const proposedStatut = p.statut ?? statut;
      if (p.statut) setStatut(p.statut);
      if (p.dateLocale) {
        setDateLocale(
          coerceDate(
            p.dateLocale,
            type === "rendez_vous" || proposedStatut === "rendez_vous"
          )
        );
      }
      setResume(p.resume ?? "");
      setContactProposal(p.contact_name ?? "");
      setApplyContact(true);
      setAiNote("Proposition de l'assistant — vérifiez avant d'enregistrer.");
    });
  }

  function save() {
    setError(undefined);
    setFeedback(undefined);
    startTransition(async () => {
      const res = await saveExchangeAction({
        prospectId,
        type,
        note: note || null,
        resume: resume || null,
        contactName: applyContact && contactProposal ? contactProposal : null,
        statut: statut !== initialStatus ? statut : null,
        motif: motif || null,
        dateLocale: dateLocale || null,
      });
      if (res.error) setError(res.error);
      else {
        reset();
        setFeedback("Enregistré.");
      }
    });
  }

  return (
    <div className="card space-y-4 p-5">
      {/* Type d'échange */}
      <div className="flex flex-wrap gap-1.5">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => pickType(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 transition ${
              type === t
                ? "bg-celya-gradient text-slate-950 ring-transparent"
                : "bg-white/[0.04] text-slate-400 ring-white/10 hover:text-slate-200"
            }`}
          >
            {ACTIVITY_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Note + assistant */}
      <div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="input resize-y"
          placeholder="Ce qu'il faut retenir de l'échange… ex. « revoir ça après les fêtes, le gérant c'est Marc »"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={analyze}
            disabled={analyzing || !note.trim()}
            title="Structurer la note avec l'assistant : étape, date de relance, contact, résumé"
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            {analyzing ? "Analyse…" : "✨ Analyser"}
          </button>
          {aiNote && <span className="text-[11px] text-slate-500">{aiNote}</span>}
        </div>
      </div>

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

      {/* Étape + prochaine action */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="exchange-statut">
            Étape
          </label>
          <select
            id="exchange-statut"
            value={statut}
            onChange={(e) => pickStatut(e.target.value as ProspectStatus)}
            className="input"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {statut === "perdu" && (
            <input
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              className="input mt-2"
              placeholder="Raison de la perte…"
            />
          )}
        </div>

        <div>
          <label className="label">
            {withTime ? "Date et heure du rendez-vous" : "Prochaine relance"}
          </label>
          <DateField
            name="exchange-date"
            withTime={withTime}
            value={dateLocale}
            onChange={setDateLocale}
            compact
          />
          {!dateLocale && statut !== "perdu" && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              Sans date, {companyName} ne remontera pas dans « À faire ».
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || (withTime && dateLocale.length > 0 && dateLocale.length < 16)}
          className="btn-primary"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {feedback && !error && (
          <span className="text-xs text-emerald-300">{feedback}</span>
        )}
        {error && <span className="text-xs text-rose-300">{error}</span>}
      </div>
    </div>
  );
}
