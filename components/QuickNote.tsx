"use client";

import { useState, useTransition } from "react";
import { saveExchangeAction } from "@/app/actions";
import { analyzeNoteAction } from "@/app/ai-actions";
import { ACTIVITY_LABEL, STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { DateField } from "@/components/DateField";
import type { ActivityType, ProspectStatus } from "@/lib/types";

const TYPES: ActivityType[] = ["note", "email", "rendez_vous"];

/**
 * Noter un échange : le geste central de la fiche. Une note (ce qu'il faut
 * retenir), la prochaine action à une date précise — et l'étape, qui suit
 * désormais les FAITS et non le texte :
 *
 *  · un rendez-vous daté fait passer la fiche en « Rendez-vous » ;
 *  · une note ne compte comme échange que si la case est cochée ;
 *  · « Gagné » / « Perdu » restent des décisions manuelles ;
 *  · fixer l'étape ici est une décision humaine — elle verrouille la fiche.
 *
 * Le bouton ✨ propose date, contact et résumé à partir de la note ; l'étape
 * n'est jamais appliquée par l'assistant, seulement suggérée.
 */
export function QuickNote({
  prospectId,
  companyName,
  contactName,
}: {
  prospectId: string;
  companyName: string;
  contactName?: string | null;
}) {
  const [type, setType] = useState<ActivityType>("note");
  const [note, setNote] = useState("");
  /** "" = ne pas changer l'étape (elle suit les faits). */
  const [statut, setStatut] = useState<ProspectStatus | "">("");
  const [dateLocale, setDateLocale] = useState("");
  const [motif, setMotif] = useState("");
  const [resume, setResume] = useState("");
  const [contactProposal, setContactProposal] = useState("");
  const [applyContact, setApplyContact] = useState(true);
  const [isExchange, setIsExchange] = useState(true);
  const [proposalSent, setProposalSent] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    statut: ProspectStatus;
    reserve: string | null;
  }>();
  const [aiNote, setAiNote] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [analyzing, startAnalyze] = useTransition();

  // C'est le TYPE d'échange qui fait le rendez-vous, pas l'étape choisie :
  // un rendez-vous se note avec sa date et son heure.
  const withTime = type === "rendez_vous";

  /** Garde la valeur du champ cohérente quand on passe date ↔ date+heure. */
  function coerceDate(value: string, needsTime: boolean): string {
    if (!value) return value;
    if (needsTime && value.length === 10) return `${value}T09:00`;
    if (!needsTime && value.length > 10) return value.slice(0, 10);
    return value;
  }

  function pickType(t: ActivityType) {
    setType(t);
    setDateLocale((v) => coerceDate(v, t === "rendez_vous"));
  }

  function reset() {
    setType("note");
    setNote("");
    setStatut("");
    setDateLocale("");
    setMotif("");
    setResume("");
    setContactProposal("");
    setIsExchange(true);
    setProposalSent(false);
    setSuggestion(undefined);
    setAiNote(undefined);
    setError(undefined);
  }

  /** Propose date, contact, résumé — et SUGGÈRE l'étape, sans l'appliquer. */
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
      if (p.dateLocale) {
        setDateLocale(coerceDate(p.dateLocale, type === "rendez_vous"));
      }
      setResume(p.resume ?? "");
      setContactProposal(p.contact_name ?? "");
      setApplyContact(true);
      // L'étape n'est PAS appliquée : elle s'affiche comme suggestion, et
      // c'est un clic de Bora qui la retient. C'est la règle qui a manqué
      // le 4 août — une fiche s'était retrouvée en « Rendez-vous » sans RDV.
      setSuggestion(p.statut ? { statut: p.statut, reserve: p.statutReserve } : undefined);
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
        statut: statut === "" ? null : statut,
        motif: motif || null,
        dateLocale: dateLocale || null,
        // Un email ou un rendez-vous sont des faits par construction ; une
        // note ne l'est que si Bora l'atteste.
        isExchange: type === "note" ? isExchange : true,
        proposalSent,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      reset();
      setFeedback(
        res.autoStatus
          ? `Enregistré. Étape → « ${STATUS_LABEL[res.autoStatus]} » — ${res.autoReason}.`
          : "Enregistré."
      );
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
            aria-pressed={type === t}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 transition duration-200 ${
              type === t
                ? "bg-celya-gradient text-slate-950 ring-transparent shadow-glow"
                : "bg-white/[0.04] text-slate-400 ring-white/10 hover:bg-white/[0.08] hover:text-slate-200"
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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={analyze}
            disabled={analyzing || !note.trim()}
            title="Structurer la note avec l'assistant : date de relance, contact, résumé"
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            {analyzing ? "Analyse…" : "✨ Analyser"}
          </button>
          {aiNote && <span className="text-[11px] text-slate-500">{aiNote}</span>}
        </div>
      </div>

      {/* Suggestion d'étape — proposée, jamais appliquée d'office. */}
      {suggestion && statut !== suggestion.statut && (
        <div className="rounded-xl bg-celya-blue/[0.08] px-3.5 py-3 ring-1 ring-celya-blue/25">
          <p className="text-xs text-slate-300">
            L&apos;assistant suggère l&apos;étape{" "}
            <span className="font-medium text-slate-100">
              « {STATUS_LABEL[suggestion.statut]} »
            </span>
            .
          </p>
          {suggestion.reserve && (
            <p className="mt-1 text-[11px] leading-relaxed text-amber-300/90">
              {suggestion.reserve}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStatut(suggestion.statut)}
              className="rounded-lg bg-white/[0.07] px-2.5 py-1 text-[11px] font-medium text-slate-100 ring-1 ring-white/15 transition hover:bg-white/[0.12]"
            >
              Retenir cette étape
            </button>
            <button
              type="button"
              onClick={() => setSuggestion(undefined)}
              className="rounded-lg px-2.5 py-1 text-[11px] text-slate-500 transition hover:text-slate-300"
            >
              Ignorer
            </button>
          </div>
        </div>
      )}

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

      {/* Les deux faits que le CRM ne devine jamais. */}
      <div className="space-y-2 rounded-xl bg-white/[0.02] px-3.5 py-3 ring-1 ring-white/[0.06]">
        {type === "note" && (
          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={isExchange}
              onChange={(e) => setIsExchange(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-cyan-400"
            />
            <span>
              J&apos;ai réellement eu cet échange (appel, visite)
              <span className="block text-[11px] text-slate-500">
                Décochez pour une note de repérage : la fiche restera « À appeler ».
              </span>
            </span>
          </label>
        )}
        <label className="flex items-start gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={proposalSent}
            onChange={(e) => setProposalSent(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-cyan-400"
          />
          <span>
            J&apos;ai envoyé une proposition / un devis
            <span className="block text-[11px] text-slate-500">
              Seul ce geste fait passer la fiche en « Proposition ».
            </span>
          </span>
        </label>
      </div>

      {/* Étape + prochaine action */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="exchange-statut">
            Étape
          </label>
          <select
            id="exchange-statut"
            value={statut}
            onChange={(e) => setStatut(e.target.value as ProspectStatus | "")}
            className="input"
          >
            <option value="">Ne pas changer (suit les faits)</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {statut === "" ? (
            <p className="mt-1.5 text-[11px] text-slate-500">
              L&apos;étape se déduit de ce que vous enregistrez.
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-amber-300/80">
              Vous fixez l&apos;étape à la main : elle sera verrouillée.
            </p>
          )}
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
          {withTime && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              Une date réelle fait passer {contactName ?? companyName} en
              « Rendez-vous ».
            </p>
          )}
          {!dateLocale && !withTime && statut !== "perdu" && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              Sans date, {companyName} ne remontera pas dans « À faire ».
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
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
