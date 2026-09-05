"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { saveExchangeAction } from "@/app/actions";
import { analyzeNoteAction } from "@/app/ai-actions";
import { STATUS_LABEL } from "@/lib/constants";
import { Icone, LienPourquoiIA } from "@/components/ui";
import { Pastille } from "@/components/Pastille";
import { lireRaccourcis, type Raccourci } from "@/lib/crm/raccourcis";
import type { TimelineEntry } from "@/components/Timeline";
import type { ActivityType, ProspectStatus } from "@/lib/types";

/**
 * La note redevient une note : du TEXTE, et ce que le parseur en lit.
 *
 * Ce qui reste ici :
 *  · la zone de texte — elle part au journal telle quelle, jamais réécrite ;
 *  · les pastilles du parseur déterministe (rendez-vous, lieu, relance, appel
 *    sans réponse, proposition, contact, « Perdu ? ») : ce qui SERA
 *    enregistré, retirable d'un clic sur la croix ;
 *  · « Analyser le texte » pour les notes que le parseur ne sait pas lire ;
 *  · trois options rares, repliées sous « Plus d'options » : un email déjà
 *    parti d'ailleurs, une note de repérage, une proposition envoyée.
 *
 * Ce qui est parti, et où :
 *  · le RÉSULTAT d'un appel → la carte PROCHAINE ACTION, sous le pouce ;
 *  · l'ÉTAPE → la pastille de l'en-tête de fiche ; ici elle ne se pose plus
 *    qu'en confirmant « Perdu ? » ou en retenant la suggestion de
 *    l'assistant, et la pastille ambre dit alors qu'elle sera verrouillée ;
 *  · la DATE de relance → la ligne « Relancer » de la carte, et le parseur
 *    (« rdv mardi 11h », « je le rappelle le 12 »).
 *
 * Le type d'échange ne se choisit plus : il se DÉDUIT. Un rendez-vous complet
 * lu dans la note en fait un rendez-vous, la case « Email déjà envoyé » en
 * fait un email, sinon c'est une note. Trois chips de moins pour une décision
 * que les faits prenaient déjà.
 */
export function QuickNote({
  prospectId,
  isAdmin = false,
  onOptimistic,
}: {
  prospectId: string;
  /** Admin : « Assistant indisponible » gagne un lien « Pourquoi ? ». */
  isAdmin?: boolean;
  /**
   * Inscrit l'échange en tête de la chronologie AVANT la réponse du serveur.
   * Fourni par ProspectJournal ; absent, le formulaire se comporte comme
   * avant (rien ne casse s'il est utilisé ailleurs).
   */
  onOptimistic?: (entree: TimelineEntry) => void;
}) {
  const [note, setNote] = useState("");
  /** "" = ne pas changer l'étape (elle suit les faits). */
  const [statut, setStatut] = useState<ProspectStatus | "">("");
  const [motif, setMotif] = useState("");
  const [resume, setResume] = useState("");
  const [contactProposal, setContactProposal] = useState("");
  const [applyContact, setApplyContact] = useState(true);
  /** Relance proposée par l'assistant — affichée en pastille, retirable. */
  const [dateProposee, setDateProposee] = useState<string | null>(null);
  // Les trois options rares, repliées sous « Plus d'options ».
  const [emailDeja, setEmailDeja] = useState(false);
  const [reperage, setReperage] = useState(false);
  const [proposalSent, setProposalSent] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    statut: ProspectStatus;
    reserve: string | null;
  }>();
  const [aiNote, setAiNote] = useState<string>();
  /** L'assistant n'a pas répondu : l'admin peut aller voir pourquoi. */
  const [aiIndisponible, setAiIndisponible] = useState(false);
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
    }).format(new Date(`${jourISO.slice(0, 10)}T12:00:00`));

  // ---- Les faits envoyés au serveur, tous DÉDUITS de ce qui précède.
  // Un rendez-vous complet lu dans la note prime sur tout : c'est le seul
  // chemin qui pose un créneau d'agenda. Sinon, la case « Email déjà
  // envoyé » dit qu'un mail est parti d'ailleurs ; à défaut, c'est une note.
  const typeEffectif: ActivityType = rdvComplet
    ? "rendez_vous"
    : emailDeja
      ? "email"
      : "note";
  // Un email ou un rendez-vous sont des faits par construction ; une note ne
  // l'est que si elle n'est pas un simple repérage. Cocher « repérage » ET
  // « email déjà envoyé » ne fait pas disparaître le mail : un email est un
  // fait, il l'emporte.
  const isExchange = typeEffectif === "note" ? !reperage : true;
  // Un appel sans réponse est un résultat, pas un échange — tracé même sans
  // texte. Il ne peut venir que d'une note.
  const noAnswer = typeEffectif === "note" && sansRepPastille;
  // La date : le rendez-vous lu dans la note, sinon la relance lue dans la
  // note, sinon celle que l'assistant a proposée (tant qu'on ne l'a pas
  // retirée d'un clic sur sa croix).
  const dateEffective = rdvComplet
    ? `${rdvJour}T${rdvHeure}`
    : (relancePastille?.date ?? dateProposee ?? null);

  // Une étape « Rendez-vous » retenue de la suggestion de l'assistant, sans
  // rendez-vous daté dans le texte : le serveur la refuserait (saveExchangeCore),
  // le bouton n'y envoie donc plus personne — la date s'écrit dans la note.
  const rdvSansDate = statut === "rendez_vous" && !rdvComplet;

  function reset() {
    setNote("");
    setStatut("");
    setMotif("");
    setResume("");
    setContactProposal("");
    setDateProposee(null);
    setEmailDeja(false);
    setReperage(false);
    setProposalSent(false);
    setSuggestion(undefined);
    setAiNote(undefined);
    setAiIndisponible(false);
    setError(undefined);
    setRaccourcis(null);
    setMasques(new Set());
    setComplement({});
  }

  /** Propose date, contact, résumé — et SUGGÈRE l'étape, sans l'appliquer. */
  function analyze() {
    if (!note.trim()) return;
    setAiNote(undefined);
    setAiIndisponible(false);
    setError(undefined);
    startAnalyze(async () => {
      const res = await analyzeNoteAction({ note });
      if (res.error) {
        setAiNote(res.error);
        return;
      }
      if (res.unavailable || !res.proposal) {
        setAiNote("Assistant indisponible — remplissez les champs à la main.");
        setAiIndisponible(true);
        return;
      }
      const p = res.proposal;
      // La date proposée n'a plus de champ : elle devient une pastille comme
      // celles du parseur, et se refuse de la même façon — d'une croix.
      setDateProposee(p.dateLocale ?? null);
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
   * `saveExchangeCore` : le type déduit décide de l'événement, et un appel
   * sans réponse se trace même sans texte.
   */
  function entreeProvisoire(): TimelineEntry | null {
    const texte = note.trim() || null;
    const resumeNet = resume.trim() || null;
    // Le serveur n'écrit au journal que dans ces cas-là : on n'annonce rien
    // qu'il n'écrira pas.
    if (!texte && !resumeNet && !noAnswer) return null;

    return {
      key: `provisoire-${Date.now()}`,
      id: "",
      source: "activity",
      kind:
        typeEffectif === "rendez_vous"
          ? "rendez_vous"
          : typeEffectif === "email"
            ? "email_sortant"
            : noAnswer
              ? "appel_sans_reponse"
              : reperage
                ? "note_interne"
                : "note",
      at: new Date().toISOString(),
      title: resumeNet ?? (noAnswer && !texte ? "Appel sans réponse" : null),
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
        isExchange,
        noAnswer,
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
        {(pastillesActives || perduSuggestion || dateProposee || statut) && (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {rdvBrut && rdvComplet && (
                <Pastille tone="bleu" onRetirer={() => masquer("rdv")}>
                  <Icone nom="calendrier" className="h-3 w-3" />
                  RDV {fmtJourCourt(rdvJour!)} {rdvHeure}
                  {rdvFinHM ? `–${rdvFinHM}` : ""}
                </Pastille>
              )}
              {rdvBrut && !rdvComplet && !rdvJour && (
                <Pastille tone="ambre" onRetirer={() => masquer("rdv")}>
                  <Icone nom="calendrier" className="h-3 w-3" />
                  RDV {rdvHeure ?? ""} — Quel jour ?
                </Pastille>
              )}
              {rdvBrut && !rdvComplet && rdvJour && (
                <Pastille tone="ambre" onRetirer={() => masquer("rdv")}>
                  <Icone nom="calendrier" className="h-3 w-3" />
                  RDV {fmtJourCourt(rdvJour)} — Quelle heure ?
                </Pastille>
              )}
              {rdvBrut && rdvLieu && (
                <Pastille onRetirer={() => masquer("lieu")}>
                  <Icone nom="epingle" className="h-3 w-3" />
                  {rdvLieu}
                </Pastille>
              )}
              {relancePastille && (
                <Pastille onRetirer={() => masquer("relance")}>
                  <Icone nom="calendrier" className="h-3 w-3" />
                  Relance {fmtJourCourt(relancePastille.date)}
                </Pastille>
              )}
              {/* La date que l'assistant a lue : même forme, même croix. */}
              {dateProposee && !relancePastille && !rdvComplet && (
                <Pastille onRetirer={() => setDateProposee(null)}>
                  <Icone nom="calendrier" className="h-3 w-3" />
                  Relance {fmtJourCourt(dateProposee)}
                  {dateProposee.length >= 16 ? ` ${dateProposee.slice(11, 16)}` : ""}
                </Pastille>
              )}
              {sansRepPastille && (
                <Pastille onRetirer={() => masquer("sans_reponse")}>
                  <Icone nom="telephone" className="h-3 w-3" />
                  Appelé, pas de réponse
                </Pastille>
              )}
              {propositionPastille && (
                <Pastille onRetirer={() => masquer("proposition")}>
                  <Icone nom="enveloppe" className="h-3 w-3" />
                  Proposition envoyée
                </Pastille>
              )}
              {contactPastille && (
                <Pastille onRetirer={() => masquer("contact")}>
                  <Icone nom="personne" className="h-3 w-3" />
                  {contactPastille}
                </Pastille>
              )}
              {/* L'étape posée à la main : la seule qui verrouille la fiche. */}
              {statut && (
                <Pastille tone="ambre" onRetirer={() => setStatut("")}>
                  Étape → {STATUS_LABEL[statut]}
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
                      setStatut("perdu");
                      if (perduSuggestion.motif && !motif) {
                        setMotif(perduSuggestion.motif);
                      }
                    }}
                    className="btn-ghost px-1.5 py-0.5 text-[10px]"
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

            {statut && (
              <p className="text-[11px] text-amber-300/80">
                Vous fixez l&apos;étape à la main : elle sera verrouillée.
              </p>
            )}
            {statut === "perdu" && (
              <input
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                className="input"
                placeholder="Raison de la perte…"
              />
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
            className="btn-link text-xs"
          >
            <Icone nom="etincelle" />
            {analyzing ? "Analyse…" : "Analyser le texte"}
          </button>
          {aiNote && <span className="text-[11px] text-slate-500">{aiNote}</span>}
          {aiIndisponible && <LienPourquoiIA isAdmin={isAdmin} />}
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
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setStatut(suggestion.statut)}
              className="btn-ghost px-2.5 py-1 text-[11px]"
            >
              Retenir cette étape
            </button>
            <button
              type="button"
              onClick={() => setSuggestion(undefined)}
              className="btn-link text-[11px]"
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
            className="h-3.5 w-3.5 accent-[#4F7BFF]"
          />
          Mettre à jour le contact : {contactProposal}
        </label>
      )}

      {/* Les trois faits que ni le texte ni le parseur ne donnent — rares,
          donc repliés : on les déclare, on ne les devine jamais. */}
      <details className="group rounded-xl bg-white/[0.02] px-3.5 py-3 ring-1 ring-white/[0.06]">
        <summary className="btn-link list-none text-xs cursor-pointer">
          <Icone nom="chevron" className="transition-transform group-open:rotate-180" />
          Plus d&apos;options
        </summary>
        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={emailDeja}
              onChange={(e) => setEmailDeja(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[#4F7BFF]"
            />
            <span>
              Email déjà envoyé
              <span className="block text-[11px] text-slate-500">
                Consigner un mail parti de votre boîte, hors du CRM. Pour en
                envoyer un, passez par l&apos;onglet Email.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={reperage}
              onChange={(e) => setReperage(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[#4F7BFF]"
            />
            <span>
              Note de repérage
              <span className="block text-[11px] text-slate-500">
                Aucun échange : rien ne bouge sur la fiche.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={proposalSent}
              onChange={(e) => setProposalSent(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[#4F7BFF]"
            />
            <span>
              J&apos;ai envoyé une proposition / un devis
              <span className="block text-[11px] text-slate-500">
                Seul ce geste fait passer la fiche en « Proposition ».
              </span>
            </span>
          </label>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || rdvSansDate || rdvIncomplet}
          className="btn-primary"
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {rdvSansDate && (
          <span className="text-xs text-amber-300/90">
            Un rendez-vous demande jour et heure : écrivez-les dans la note
            (ex. «&nbsp;rdv mardi 11h&nbsp;»).
          </span>
        )}
        {rdvIncomplet && (
          <span className="text-xs text-amber-300/90">
            Le rendez-vous détecté est incomplet : choisissez{" "}
            {rdvJour ? "l'heure" : "le jour"} ci-dessus, ou retirez la pastille.
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
