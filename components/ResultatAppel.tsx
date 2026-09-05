"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  enregistrerResultatAction,
  preciserResultatAction,
} from "@/app/actions";
import {
  OUTCOME_CHIP,
  OUTCOME_ICON,
  OUTCOME_LABEL,
  OUTCOME_ORDER,
  STATUS_LABEL,
} from "@/lib/constants";
import { Icone } from "@/components/ui";
import { Pastille } from "@/components/Pastille";
import { lireRaccourcis, type Raccourci } from "@/lib/crm/raccourcis";
import type { CallOutcome } from "@/lib/types";

function fmtJourCourt(jourISO: string): string {
  return new Intl.DateTimeFormat("fr-BE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${jourISO}T12:00:00`));
}

/**
 * LE RÉSULTAT D'APPEL, EN DEUX TAPS — pensé pour un téléphone, dans la voiture,
 * juste après avoir raccroché.
 *
 * Mesuré en base le 02/09/2026 : `activities.outcome` n'était renseigné que sur
 * 2 lignes sur 85, et 49 sur 85 n'avaient aucun sujet. La cause n'était pas la
 * discipline de Bora mais l'interface : consigner « il n'a pas répondu »
 * demandait CINQ décisions dans QuickNote (type · nature · case proposition ·
 * étape · date). Après un appel, personne ne les prend.
 *
 * Ici, UN tap enregistre. Le reste est facultatif :
 *   · un champ d'une ligne, dictable APRÈS le tap, qui devient le texte que la
 *     carte affichera (`activities.subject`) ;
 *   · pour « Pas intéressé », ce champ devient obligatoire et la raison va
 *     AUSSI dans `prospects.lost_reason` — sans jamais appliquer l'étape
 *     « Perdu », qui reste une décision humaine (invariant de status.ts).
 *
 * « À rappeler » ne date rien ici : la carte PROCHAINE ACTION porte la ligne
 * « Relancer », et un rappel s'y pose d'un tap. `onRappeler` sert exactement à
 * ça — prévenir la carte qu'il manque une date.
 *
 * Le champ passe par le MÊME parseur de raccourcis que QuickNote
 * (lib/crm/raccourcis.ts) : « rdv mardi 11h » pose un vrai rendez-vous,
 * « rappeler jeudi » une relance. Rien n'est deviné : un rendez-vous auquel il
 * manque le jour ou l'heure n'est PAS posé, et le dit.
 *
 * QuickNote n'est pas remplacé : il reste le formulaire complet des cas riches.
 */
export function ResultatAppel({
  prospectId,
  onRappeler,
  className = "",
}: {
  prospectId: string;
  /** « À rappeler » vient d'être enregistré : il reste à dire pour quand. */
  onRappeler?: () => void;
  className?: string;
}) {
  /**
   * Ce que l'écran montre MAINTENANT. Pas de `useOptimistic` ici : il n'y a
   * aucune donnée serveur à réconcilier (le composant n'en reçoit pas), et
   * aucun effet de resynchronisation. Le principe reste le même — on peint au
   * clic, et si le serveur refuse, on revient à l'état d'avant.
   */
  const [choisi, setChoisi] = useState<CallOutcome | null>(null);
  const [activiteId, setActiviteId] = useState<string | null>(null);
  const [texte, setTexte] = useState("");
  /** Le texte déjà parti au serveur — pour ne pas le renvoyer inchangé. */
  const [texteEnregistre, setTexteEnregistre] = useState("");
  const [besoinRaison, setBesoinRaison] = useState(false);
  const [erreur, setErreur] = useState<string>();
  const [note, setNote] = useState<string>();
  const [pending, startTransition] = useTransition();
  const champRef = useRef<HTMLInputElement>(null);

  // Les raccourcis, lus à la frappe (150 ms, aucun réseau) — même parseur que
  // QuickNote, jamais réécrit ici.
  const [raccourcis, setRaccourcis] = useState<Raccourci | null>(null);
  const [rdvRefuse, setRdvRefuse] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setRaccourcis(texte.trim() ? lireRaccourcis(texte, new Date()) : null);
    }, 150);
    return () => clearTimeout(t);
  }, [texte]);

  const rdv = !rdvRefuse ? (raccourcis?.rdv ?? null) : null;
  const rdvComplet = Boolean(rdv && !rdv.manque);
  const rdvIncomplet = Boolean(rdv) && !rdvComplet;
  const relance = raccourcis?.relance ?? null;

  /** Ce que le texte ajoute à l'enregistrement — jour ET heure, ou rien. */
  function chargeRaccourcis() {
    if (rdvComplet && rdv) {
      return {
        dateLocale: rdv.debut.slice(0, 16),
        rendezVous: true,
        rdvLieu: rdv.lieu ?? null,
        // `fin` suit la même convention que `debut` : complète seulement quand
        // jour ET heure sont lus. Sinon, l'agenda pose +60 min lui-même.
        rdvFin: rdv.fin && rdv.fin.length >= 16 ? rdv.fin.slice(0, 16) : null,
      };
    }
    if (relance) return { dateLocale: relance.date, rendezVous: false };
    return { dateLocale: null, rendezVous: false };
  }

  function tap(o: CallOutcome) {
    setErreur(undefined);
    setNote(undefined);

    // La seule issue qui exige une raison : « pas intéressé » sans pourquoi ne
    // sert à personne. On demande, on n'enregistre pas encore.
    if (o === "refus" && !texte.trim()) {
      setBesoinRaison(true);
      setChoisi("refus");
      champRef.current?.focus();
      return;
    }

    const avant = choisi;
    setChoisi(o); // l'écran bouge
    setBesoinRaison(false);

    // Un doigt qui vise mal ne doit pas créer DEUX entrées de journal : une
    // seconde pastille corrige la première au lieu de s'empiler.
    if (activiteId) {
      if (avant === o && texte.trim() === texteEnregistre) return; // rien à dire
      startTransition(async () => {
        const res = await preciserResultatAction({
          prospectId,
          activiteId,
          outcome: o,
          texte: texte.trim() || null,
        });
        if (res.error) {
          setChoisi(avant);
          setErreur(res.error);
          return;
        }
        setTexteEnregistre(texte.trim());
        setNote("Corrigé.");
        // Corrigé EN « à rappeler » : la date manque toujours, la carte le dit.
        if (o === "rappeler") onRappeler?.();
      });
      return;
    }

    startTransition(async () => {
      const res = await enregistrerResultatAction({
        prospectId,
        outcome: o,
        texte: texte.trim() || null,
        ...chargeRaccourcis(),
      });
      if (res.error) {
        setChoisi(avant);
        setErreur(res.error);
        return;
      }
      setActiviteId(res.activiteId ?? null);
      setTexteEnregistre(texte.trim());
      setNote(
        [
          "Enregistré.",
          res.autoStatus
            ? `Étape → « ${STATUS_LABEL[res.autoStatus]} » — ${res.autoReason}.`
            : null,
          rdvIncomplet
            ? "Le rendez-vous n'a PAS été posé : il manque le jour ou l'heure."
            : null,
          res.conflit ? `⚠ Ce créneau chevauche « ${res.conflit.title} ».` : null,
        ]
          .filter(Boolean)
          .join(" ")
      );
      // « À rappeler » : la date se choisit dans la ligne « Relancer » de la
      // carte, pas ici — on lui passe la main.
      if (o === "rappeler") onRappeler?.();
    });
  }

  /** La phrase dictée après le tap — avec ce que ses raccourcis ajoutent. */
  function preciser() {
    if (!activiteId) return;
    const nouveauTexte = texte.trim();
    if (nouveauTexte === texteEnregistre) return;
    setErreur(undefined);

    startTransition(async () => {
      const res = await preciserResultatAction({
        prospectId,
        activiteId,
        texte: nouveauTexte,
        ...chargeRaccourcis(),
      });
      if (res.error) {
        setErreur(res.error);
        return;
      }
      setTexteEnregistre(nouveauTexte);
      setNote("Enregistré.");
    });
  }

  const enregistre = activiteId !== null;

  return (
    <div className={`space-y-2.5 ${className}`} aria-label="Résultat de l'appel">
      {/* Cinq cibles LARGES : c'est un pouce qui vise, pas une souris. */}
      <div className="flex flex-wrap gap-1.5">
        {OUTCOME_ORDER.map((o) => {
          const actif = choisi === o;
          return (
            <button
              key={o}
              type="button"
              onClick={() => tap(o)}
              disabled={pending}
              aria-pressed={actif}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3.5 text-xs font-medium ring-1 transition duration-200 disabled:opacity-60 ${
                actif
                  ? `${OUTCOME_CHIP[o]} animate-pop`
                  : "bg-white/[0.04] text-slate-300 ring-white/10 hover:bg-white/[0.08] hover:text-slate-100"
              }`}
            >
              <Icone nom={OUTCOME_ICON[o]} />
              {OUTCOME_LABEL[o]}
              {actif && enregistre && <Icone nom="coche" className="h-3 w-3" />}
            </button>
          );
        })}
      </div>

      {/* Le mot de la fin — facultatif, sauf pour « Pas intéressé ». Il reste
          saisissable APRÈS le tap : on tape la pastille, puis on dicte. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={champRef}
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (besoinRaison) tap("refus");
            else if (enregistre) preciser();
          }}
          placeholder={
            besoinRaison ? "Pourquoi ?" : "En un mot, ce qui s'est dit…"
          }
          aria-label={besoinRaison ? "Pourquoi ?" : "En un mot, ce qui s'est dit"}
          className={`input min-h-[44px] flex-1 ${
            besoinRaison ? "ring-amber-400/40" : ""
          }`}
        />
        {besoinRaison ? (
          <button
            type="button"
            onClick={() => tap("refus")}
            disabled={pending || !texte.trim()}
            className="btn-primary min-h-[44px] px-3.5 text-xs disabled:opacity-40"
          >
            Enregistrer
          </button>
        ) : (
          enregistre &&
          texte.trim() !== texteEnregistre && (
            <button
              type="button"
              onClick={() => preciser()}
              disabled={pending}
              className="btn-ghost min-h-[44px] px-3.5 text-xs"
            >
              Ajouter
            </button>
          )
        )}
      </div>

      {besoinRaison && (
        <p className="text-[11px] text-amber-300/90">
          « Pas intéressé » sans raison ne sert à personne — un mot suffit. La
          fiche ne passera pas en « Perdu » pour autant : ça reste votre
          décision.
        </p>
      )}

      {/* Ce que le texte ajoutera — lu à la frappe, retirable d'un clic. */}
      {(rdv || relance) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {rdvComplet && rdv && (
            <Pastille tone="bleu" onRetirer={() => setRdvRefuse(true)}>
              <Icone nom="calendrier" /> RDV {fmtJourCourt(rdv.debut.slice(0, 10))}{" "}
              {rdv.debut.slice(11, 16)}
            </Pastille>
          )}
          {rdvIncomplet && (
            <Pastille tone="ambre" onRetirer={() => setRdvRefuse(true)}>
              <Icone nom="calendrier" /> RDV —{" "}
              {rdv?.manque === "jour" ? "quel jour ?" : "quelle heure ?"} · à compléter
              dans la note
            </Pastille>
          )}
          {rdv?.lieu && rdvComplet && (
            <Pastille>
              <Icone nom="epingle" /> {rdv.lieu}
            </Pastille>
          )}
          {!rdvComplet && relance && (
            <Pastille>
              <Icone nom="calendrier" /> Relance {fmtJourCourt(relance.date)}
            </Pastille>
          )}
        </div>
      )}

      {note && !erreur && <p className="text-[11px] text-emerald-300">{note}</p>}
      {erreur && (
        <p role="alert" className="text-[11px] text-rose-300">
          {erreur}
        </p>
      )}
    </div>
  );
}
