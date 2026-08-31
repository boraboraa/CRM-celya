"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { saveExchangeAction } from "@/app/actions";
import { analyzeNoteAction } from "@/app/ai-actions";
import { ACTIVITY_LABEL, STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { DateField } from "@/components/DateField";
import { lireRaccourcis, type Raccourci } from "@/lib/crm/raccourcis";
import type { TimelineEntry } from "@/components/Timeline";
import type { ActivityType, ProspectStatus } from "@/lib/types";

const TYPES: ActivityType[] = ["note", "email", "rendez_vous"];

/**
 * Ce qu'une note ATTESTE — le fait que le CRM ne devine jamais. Trois natures :
 * l'échange a eu lieu, l'appel est resté sans réponse (un résultat, pas un
 * échange — c'est lui que la carte affiche), ou simple repérage.
 */
type NoteNature = "echange" | "sans_reponse" | "reperage";

const NOTE_NATURES: { value: NoteNature; label: string; hint: string }[] = [
  {
    value: "echange",
    label: "J'ai réellement eu cet échange (appel, visite)",
    hint: "Un échange attesté peut faire passer la fiche en « Contacté ».",
  },
  {
    value: "sans_reponse",
    label: "Appelé, pas de réponse",
    hint: "La fiche reste « À appeler » ; la carte affichera « Appelé, pas de réponse ».",
  },
  {
    value: "reperage",
    label: "Note de repérage",
    hint: "Aucun échange : rien ne bouge sur la fiche.",
  },
];

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
  onOptimistic,
}: {
  prospectId: string;
  companyName: string;
  contactName?: string | null;
  /**
   * Inscrit l'échange en tête de la chronologie AVANT la réponse du serveur.
   * Fourni par ProspectJournal ; absent, le formulaire se comporte comme
   * avant (rien ne casse s'il est utilisé ailleurs).
   */
  onOptimistic?: (entree: TimelineEntry) => void;
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
  const [nature, setNature] = useState<NoteNature>("echange");
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

  // ---- Les raccourcis — un parseur DÉTERMINISTE tourne à la frappe (150 ms
  // de debounce, AUCUN appel réseau) et affiche en pastilles ce qui SERA
  // enregistré. Chaque pastille se retire d'un clic : c'est la façon de dire
  // « non ». Le texte de la note, lui, part au journal TEL QUEL.
  const [raccourcis, setRaccourcis] = useState<Raccourci | null>(null);
  /** Pastilles refusées d'un clic sur leur croix (par rôle). */
  const [masques, setMasques] = useState<Set<string>>(new Set());
  /** Jour/heure complétés d'un clic quand la note n'en donne qu'une moitié. */
  const [complement, setComplement] = useState<{ jour?: string; heure?: string }>({});

  useEffect(() => {
    const t = setTimeout(() => {
      setRaccourcis(note.trim() ? lireRaccourcis(note, new Date()) : null);
    }, 150);
    return () => clearTimeout(t);
  }, [note]);

  const masquer = (role: string) =>
    setMasques((s) => {
      const suivant = new Set(s);
      suivant.add(role);
      return suivant;
    });

  // Ce que les pastilles enregistreront — le complément (jour ou heure choisi
  // en un clic) se fond dans ce qui a été lu : ZÉRO ressaisie.
  const rdvBrut = raccourcis?.rdv && !masques.has("rdv") ? raccourcis.rdv : null;
  let rdvJour: string | null = null;
  let rdvHeure: string | null = null;
  let rdvFinHM: string | null = null;
  if (rdvBrut) {
    if (!rdvBrut.manque) {
      rdvJour = rdvBrut.debut.slice(0, 10);
      rdvHeure = rdvBrut.debut.slice(11, 16);
      rdvFinHM = rdvBrut.fin ? rdvBrut.fin.slice(11, 16) : null;
    } else if (rdvBrut.manque === "jour") {
      rdvHeure = rdvBrut.debut || null;
      rdvJour = complement.jour ?? null;
      rdvFinHM = rdvBrut.fin ?? null;
      if (!rdvHeure && complement.heure) rdvHeure = complement.heure;
    } else {
      rdvJour = rdvBrut.debut;
      rdvHeure = complement.heure ?? null;
    }
  }
  const rdvComplet = Boolean(rdvBrut && rdvJour && rdvHeure);
  const rdvIncomplet = Boolean(rdvBrut) && !rdvComplet;
  const rdvLieu = rdvBrut && !masques.has("lieu") ? (rdvBrut.lieu ?? null) : null;
  const relancePastille =
    raccourcis?.relance && !masques.has("relance") ? raccourcis.relance : null;
  const sansRepPastille =
    Boolean(raccourcis?.sansReponse) && !masques.has("sans_reponse");
  const propositionPastille =
    Boolean(raccourcis?.propositionEnvoyee) && !masques.has("proposition");
  const contactPastille =
    raccourcis?.contact && !masques.has("contact") ? raccourcis.contact : null;
  const perduSuggestion =
    raccourcis?.suggestionPerdu && !masques.has("perdu")
      ? raccourcis.suggestionPerdu
      : null;
  const pastillesActives = Boolean(
    rdvBrut || relancePastille || sansRepPastille || propositionPastille || contactPastille
  );

  /** Les 14 prochains jours — pour compléter « Quel jour ? » d'un clic. */
  const prochainsJours = useMemo(() => {
    const fmt = new Intl.DateTimeFormat("fr-BE", { weekday: "short", day: "numeric" });
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      return { date, label: i === 0 ? "auj." : i === 1 ? "dem." : fmt.format(d) };
    });
  }, []);

  /** Créneaux à la demi-heure, 8h → 19h — pour « Quelle heure ? ». */
  const creneaux = useMemo(() => {
    const liste: string[] = [];
    for (let m = 8 * 60; m <= 19 * 60; m += 30) {
      liste.push(
        `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
      );
    }
    return liste;
  }, []);

  const fmtJourCourt = (jourISO: string) =>
    new Intl.DateTimeFormat("fr-BE", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(new Date(`${jourISO}T12:00:00`));

  // Un rendez-vous se note avec sa date ET son heure — que le rendez-vous
  // vienne du type d'échange ou de l'étape forcée au menu déroulant. C'est ce
  // second chemin (étape « Rendez-vous » choisie, champ date jamais touché)
  // qui laissait passer des rendez-vous sans date : le serveur les refuse
  // désormais (saveExchangeCore), et le bouton n'y envoie plus personne.
  const withTime = type === "rendez_vous" || statut === "rendez_vous";
  const rdvSansDate = withTime && dateLocale.length < 16;

  /** Garde la valeur du champ cohérente quand on passe date ↔ date+heure. */
  function coerceDate(value: string, needsTime: boolean): string {
    if (!value) return value;
    if (needsTime && value.length === 10) return `${value}T09:00`;
    if (!needsTime && value.length > 10) return value.slice(0, 10);
    return value;
  }

  function pickType(t: ActivityType) {
    setType(t);
    setDateLocale((v) => coerceDate(v, t === "rendez_vous" || statut === "rendez_vous"));
  }

  function pickStatut(s: ProspectStatus | "") {
    setStatut(s);
    setDateLocale((v) => coerceDate(v, type === "rendez_vous" || s === "rendez_vous"));
  }

  function reset() {
    setType("note");
    setNote("");
    setStatut("");
    setDateLocale("");
    setMotif("");
    setResume("");
    setContactProposal("");
    setNature("echange");
    setProposalSent(false);
    setSuggestion(undefined);
    setAiNote(undefined);
    setError(undefined);
    setRaccourcis(null);
    setMasques(new Set());
    setComplement({});
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

  /**
   * L'entrée telle qu'elle apparaîtra dans la chronologie — mêmes règles que
   * `saveExchangeCore` : la nature de la note décide du type d'événement, et
   * un appel sans réponse se trace même sans texte.
   */
  // Les pastilles pilotent l'appel : un rdv complet devient un vrai
  // rendez-vous d'agenda (type rendez_vous + date+heure+lieu), une relance
  // devient la prochaine action, « pas de réponse » devient le résultat.
  // Un champ rempli À LA MAIN (date, contact) garde la priorité.
  const typeEffectif: ActivityType = rdvComplet ? "rendez_vous" : type;
  const dateEffective = rdvComplet
    ? `${rdvJour}T${rdvHeure}`
    : dateLocale || relancePastille?.date || null;
  const sansReponseEffectif =
    typeEffectif === "note" && (nature === "sans_reponse" || sansRepPastille);

  function entreeProvisoire(): TimelineEntry | null {
    const texte = note.trim() || null;
    const resumeNet = resume.trim() || null;
    // Le serveur n'écrit au journal que dans ces cas-là : on n'annonce rien
    // qu'il n'écrira pas.
    if (!texte && !resumeNet && !sansReponseEffectif) return null;

    return {
      key: `provisoire-${Date.now()}`,
      id: "",
      source: "activity",
      kind:
        typeEffectif === "rendez_vous"
          ? "rendez_vous"
          : typeEffectif === "email"
            ? "email_sortant"
            : sansReponseEffectif
              ? "appel_sans_reponse"
              : nature === "reperage"
                ? "note_interne"
                : "note",
      at: new Date().toISOString(),
      title:
        resumeNet ?? (sansReponseEffectif && !texte ? "Appel sans réponse" : null),
      body: texte,
      by: null,
      pending: true,
    };
  }

  function save() {
    setError(undefined);
    setFeedback(undefined);
    const provisoire = entreeProvisoire();
    startTransition(async () => {
      if (provisoire) onOptimistic?.(provisoire);
      const res = await saveExchangeAction({
        prospectId,
        type: typeEffectif,
        note: note || null,
        resume: resume || null,
        contactName:
          applyContact && contactProposal
            ? contactProposal
            : (contactPastille ?? null),
        statut: statut === "" ? null : statut,
        motif: motif || null,
        dateLocale: dateEffective,
        rdvLieu: rdvComplet ? rdvLieu : null,
        rdvFin: rdvComplet && rdvFinHM ? `${rdvJour}T${rdvFinHM}` : null,
        // Un email ou un rendez-vous sont des faits par construction ; une
        // note ne l'est que si Bora l'atteste. Un appel sans réponse est un
        // résultat, pas un échange — tracé même sans texte.
        isExchange: typeEffectif === "note" ? nature === "echange" : true,
        noAnswer: sansReponseEffectif,
        proposalSent: proposalSent || propositionPastille,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      reset();
      setFeedback(
        [
          res.autoStatus
            ? `Enregistré. Étape → « ${STATUS_LABEL[res.autoStatus]} » — ${res.autoReason}.`
            : "Enregistré.",
          res.conflit
            ? `⚠ Ce créneau chevauche « ${res.conflit.title} » — voir l'agenda.`
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      );
    });
  }

  return (
    <div className="card space-y-4 p-5">
      {/* Type d'échange */}
      <div>
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
        {type === "email" && (
          <p className="mt-2 text-[11px] text-slate-500">
            On consigne ici un email déjà échangé (parti de votre boîte Zoho,
            par exemple). Pour en <strong className="font-medium text-slate-400">envoyer</strong>{" "}
            un, passez par l&apos;onglet « ✉ Envoyer un email ».
          </p>
        )}
      </div>

      {/* Note + raccourcis + assistant */}
      <div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="input resize-y"
          placeholder="Ce qu'il faut retenir de l'échange… ex. « rdv mardi 11h eghezée chaussée de namur 393 »"
        />

        {/* ---- Les pastilles : ce qui SERA enregistré, lu à la frappe, sans
             réseau. La croix d'une pastille = « non ». Le texte de la note,
             lui, part au journal tel quel — jamais réécrit. ---- */}
        {(pastillesActives || perduSuggestion) && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {rdvBrut && rdvComplet && (
                <Pastille tone="bleu" onRetirer={() => masquer("rdv")}>
                  📅 RDV {fmtJourCourt(rdvJour!)} {rdvHeure}
                  {rdvFinHM ? `–${rdvFinHM}` : ""}
                </Pastille>
              )}
              {rdvBrut && !rdvComplet && !rdvJour && (
                <Pastille tone="ambre" onRetirer={() => masquer("rdv")}>
                  📅 RDV {rdvHeure ?? ""} — Quel jour ?
                </Pastille>
              )}
              {rdvBrut && !rdvComplet && rdvJour && (
                <Pastille tone="ambre" onRetirer={() => masquer("rdv")}>
                  📅 RDV {fmtJourCourt(rdvJour)} — Quelle heure ?
                </Pastille>
              )}
              {rdvBrut && rdvLieu && (
                <Pastille onRetirer={() => masquer("lieu")}>📍 {rdvLieu}</Pastille>
              )}
              {relancePastille && (
                <Pastille onRetirer={() => masquer("relance")}>
                  📆 Relance {fmtJourCourt(relancePastille.date)}
                </Pastille>
              )}
              {sansRepPastille && (
                <Pastille onRetirer={() => masquer("sans_reponse")}>
                  📞 Appelé, pas de réponse
                </Pastille>
              )}
              {propositionPastille && (
                <Pastille onRetirer={() => masquer("proposition")}>
                  ✉ Proposition envoyée
                </Pastille>
              )}
              {contactPastille && (
                <Pastille onRetirer={() => masquer("contact")}>
                  👤 {contactPastille}
                </Pastille>
              )}
              {perduSuggestion && statut !== "perdu" && (
                <Pastille tone="ambre" onRetirer={() => masquer("perdu")}>
                  Perdu ?
                  <button
                    type="button"
                    onClick={() => {
                      // « Perdu » ne s'applique JAMAIS tout seul : ce clic
                      // est la décision humaine.
                      pickStatut("perdu");
                      if (perduSuggestion.motif && !motif) {
                        setMotif(perduSuggestion.motif);
                      }
                    }}
                    className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-semibold hover:bg-white/[0.15]"
                  >
                    Confirmer
                  </button>
                </Pastille>
              )}
            </div>

            {/* « Quel jour ? » — un clic complète, L'HEURE DÉJÀ LUE RESTE. */}
            {rdvBrut && !rdvComplet && !rdvJour && (
              <div className="flex flex-wrap gap-1">
                {prochainsJours.map((j) => (
                  <button
                    key={j.date}
                    type="button"
                    onClick={() => setComplement((c) => ({ ...c, jour: j.date }))}
                    className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200 ring-1 ring-amber-400/25 transition hover:bg-amber-500/20"
                  >
                    {j.label}
                  </button>
                ))}
              </div>
            )}
            {/* « Quelle heure ? » — même mécanique, à la demi-heure. */}
            {rdvBrut && !rdvComplet && rdvJour && (
              <div className="flex flex-wrap gap-1">
                {creneaux.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setComplement((c) => ({ ...c, heure: h }))}
                    className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200 ring-1 ring-amber-400/25 transition hover:bg-amber-500/20"
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Le modèle ne sert plus qu'au RATTRAPAGE : quand des pastilles
              sont là, le déterministe a déjà fait le travail. */}
          <button
            type="button"
            onClick={analyze}
            disabled={analyzing || !note.trim() || pastillesActives}
            title={
              pastillesActives
                ? "Les raccourcis de la note sont déjà lus — les pastilles ci-dessus disent ce qui sera enregistré."
                : "Structurer un texte libre avec l'assistant : date de relance, contact, résumé"
            }
            className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-40"
          >
            {analyzing ? "Analyse…" : "✨ Analyser le texte"}
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

      {/* Les faits que le CRM ne devine jamais. */}
      <div className="space-y-2 rounded-xl bg-white/[0.02] px-3.5 py-3 ring-1 ring-white/[0.06]">
        {type === "note" && (
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">
              Ce que cette note atteste
            </legend>
            {NOTE_NATURES.map((n) => (
              <label
                key={n.value}
                className="flex items-start gap-2 text-xs text-slate-300"
              >
                <input
                  type="radio"
                  name="note-nature"
                  checked={nature === n.value}
                  onChange={() => setNature(n.value)}
                  className="mt-0.5 h-3.5 w-3.5 accent-cyan-400"
                />
                <span>
                  {n.label}
                  {nature === n.value && (
                    <span className="block text-[11px] text-slate-500">
                      {n.hint}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
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
            onChange={(e) => pickStatut(e.target.value as ProspectStatus | "")}
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
          {rdvSansDate ? (
            <p className="mt-1.5 text-[11px] text-amber-300/90">
              Choisissez la date et l&apos;heure du rendez-vous.
            </p>
          ) : withTime ? (
            <p className="mt-1.5 text-[11px] text-slate-500">
              Une date réelle fait passer {contactName ?? companyName} en
              « Rendez-vous ».
            </p>
          ) : null}
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
          disabled={pending || rdvSansDate || rdvIncomplet}
          className="btn-primary"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {rdvIncomplet && (
          <span className="text-xs text-amber-300/90">
            Le rendez-vous détecté est incomplet : choisissez{" "}
            {rdvJour ? "l'heure" : "le jour"} ci-dessus, ou retirez la pastille.
          </span>
        )}
        {rdvComplet && dateLocale && (
          <span className="text-xs text-slate-500">
            Le rendez-vous détecté dans la note prime sur le champ de date —
            retirez la pastille pour utiliser le champ.
          </span>
        )}
        {feedback && !error && (
          <span className="text-xs text-emerald-300">{feedback}</span>
        )}
        {error && <span className="text-xs text-rose-300">{error}</span>}
      </div>
    </div>
  );
}

/** Une pastille de raccourci : ce qui sera enregistré, retirable d'un clic. */
function Pastille({
  children,
  tone = "neutre",
  onRetirer,
}: {
  children: React.ReactNode;
  tone?: "neutre" | "bleu" | "ambre";
  onRetirer?: () => void;
}) {
  const classes =
    tone === "ambre"
      ? "bg-amber-500/15 text-amber-300 ring-amber-400/30"
      : tone === "bleu"
        ? "bg-celya-blue/15 text-blue-300 ring-blue-400/30"
        : "bg-white/[0.06] text-slate-200 ring-white/15";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium ring-1 ${classes}`}
    >
      {children}
      {onRetirer && (
        <button
          type="button"
          onClick={onRetirer}
          aria-label="Retirer cette pastille"
          title="Ne pas enregistrer cet élément"
          className="opacity-60 transition hover:opacity-100"
        >
          ✕
        </button>
      )}
    </span>
  );
}
