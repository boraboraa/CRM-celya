"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icone } from "@/components/ui";
import {
  JOURS_RELANCE,
  JOUR_DEFAUT,
  dateDuChoix,
  estJourRelance,
  heureParDefaut,
  heuresProposees,
  joursProposes,
  libelleRelance,
  valeurRelance,
  type JourRelance,
} from "@/lib/crm/relance";

function heureDite(hm: string): string {
  const [h, m] = hm.split(":");
  return `${Number(h)}h${m && m !== "00" ? m : ""}`;
}

/**
 * Dater une relance — LE composant, partout (carte PROCHAINE ACTION, ligne de
 * « À faire », après un résultat d'appel, débrief, « Planifier une relance »).
 * La table des choix et le calcul vivent dans lib/crm/relance.ts.
 *
 * Deux usages :
 *   · `onChoisir` — en un geste : le jour est déjà sur « Demain », un tap sur
 *     une heure ENVOIE (« Demain à 9h » = un tap) ;
 *   · `name` — dans un formulaire : les taps choisissent, un champ caché porte
 *     la valeur « YYYY-MM-DDTHH:mm », le bouton du formulaire envoie.
 *
 * L'instant de référence est lu APRÈS le montage : le rendu serveur et le
 * premier rendu client montrent la même liste (aucun écart d'hydratation),
 * puis « Plus tard aujourd'hui » et les heures passées se retirent.
 */
export function ChoixRelance({
  titre = "Relancer",
  onChoisir,
  name,
  required = false,
  pending = false,
  info,
  avertissement,
  extra,
  className = "",
}: {
  titre?: string;
  onChoisir?: (valeur: string) => void;
  /** Mode formulaire : le nom du champ caché. */
  name?: string;
  required?: boolean;
  pending?: boolean;
  /** Une ligne d'information sous le choix (ex. « Un rendez-vous est prévu… »). */
  info?: string | null;
  /** Une phrase ambre au-dessus (ex. « Pour quand ? » après « À rappeler »). */
  avertissement?: string | null;
  /** Un geste de plus en fin de ligne (« Sans relance »). */
  extra?: ReactNode;
  className?: string;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const [jour, setJour] = useState<JourRelance>(JOUR_DEFAUT);
  const [autreDate, setAutreDate] = useState("");
  const [autreHeure, setAutreHeure] = useState(false);
  const [heureLibre, setHeureLibre] = useState("");
  /** Mode formulaire : l'heure retenue (null = l'heure par défaut). */
  const [heureChoisie, setHeureChoisie] = useState<string | null>(null);

  const ref = now ?? new Date(0);
  const jours = now ? joursProposes(now) : JOURS_RELANCE;
  const date = now ? dateDuChoix(jour, now, autreDate) : null;
  const heures = now && date ? heuresProposees(date, now) : ["09:00", "11:00", "14:00", "16:00"];
  const heure = heureChoisie ?? (now && date ? heureParDefaut(date, now) : "09:00");
  const valeur = date ? valeurRelance(date, heure) : "";

  function choisirHeure(hm: string) {
    if (!date) return;
    if (onChoisir) {
      onChoisir(valeurRelance(date, hm));
      return;
    }
    setHeureChoisie(hm);
  }

  function valider() {
    if (!date || !/^\d{2}:\d{2}$/.test(heureLibre)) return;
    choisirHeure(heureLibre);
    setAutreHeure(false);
  }

  const bouton =
    "min-h-[44px] rounded-lg px-2.5 text-[11px] transition disabled:opacity-50";

  return (
    <div className={`space-y-1 ${className}`}>
      {avertissement && <p className="px-1 text-[11px] text-amber-300">{avertissement}</p>}
      <div
        className="flex flex-wrap items-center gap-1 rounded-xl bg-white/[0.03] px-1.5 py-1 ring-1 ring-white/[0.08]"
        role="group"
        aria-label={titre}
      >
        <span className="pl-1 pr-0.5 text-[11px] text-slate-500">{titre}</span>
        <select
          value={jour}
          disabled={pending}
          onChange={(e) => {
            if (estJourRelance(e.target.value)) setJour(e.target.value);
            setHeureChoisie(null);
          }}
          aria-label={`${titre} — quel jour`}
          className="min-h-[44px] rounded-lg bg-white/[0.04] px-2 text-[11px] text-slate-200 ring-1 ring-white/10 outline-none focus:ring-celya-blue/60"
        >
          {jours.map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
            </option>
          ))}
        </select>
        {jour === "autre" && (
          <input
            type="date"
            value={autreDate}
            min={now ? dateDuChoix("demain", now) ?? undefined : undefined}
            disabled={pending}
            onChange={(e) => setAutreDate(e.target.value)}
            aria-label={`${titre} — la date`}
            className="min-h-[44px] rounded-lg bg-white/[0.04] px-2 text-[11px] text-slate-300 ring-1 ring-white/10 outline-none focus:ring-celya-blue/60"
          />
        )}
        {heures.map((hm) => {
          const actif = !onChoisir && hm === heure && Boolean(date);
          return (
            <button
              key={hm}
              type="button"
              disabled={pending || !date}
              onClick={() => choisirHeure(hm)}
              aria-pressed={onChoisir ? undefined : actif}
              title={date && now ? libelleRelance(valeurRelance(date, hm), ref) : undefined}
              className={`${bouton} ${
                actif
                  ? "bg-celya-blue/20 text-blue-100 ring-1 ring-celya-blue/40"
                  : "text-slate-300 hover:bg-celya-blue/15 hover:text-blue-200"
              }`}
            >
              {heureDite(hm)}
            </button>
          );
        })}
        {autreHeure ? (
          <span className="inline-flex items-center gap-1">
            <input
              type="time"
              autoFocus
              value={heureLibre}
              disabled={pending}
              onChange={(e) => setHeureLibre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  valider();
                }
              }}
              aria-label={`${titre} — autre heure`}
              className="min-h-[44px] rounded-lg bg-white/[0.04] px-2 text-[11px] text-slate-300 ring-1 ring-white/10 outline-none focus:ring-celya-blue/60"
            />
            <button
              type="button"
              disabled={pending || !date || !heureLibre}
              onClick={valider}
              className={`${bouton} text-blue-200 hover:bg-celya-blue/15`}
            >
              OK
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={pending || !date}
            onClick={() => setAutreHeure(true)}
            className={`${bouton} text-slate-500 hover:bg-white/[0.06] hover:text-slate-200`}
          >
            Autre heure
          </button>
        )}
        {extra}
        {info && (
          <span className="flex basis-full items-center gap-1 px-1 pb-0.5 text-[11px] text-slate-400">
            <Icone nom="calendrier" className="h-3 w-3 shrink-0" />
            {info}
          </span>
        )}
      </div>
      {name && (
        <>
          <input type="hidden" name={name} value={valeur} required={required} />
          <p className="px-1 text-[11px] text-slate-400">
            {date && now ? `→ ${libelleRelance(valeur, ref)}` : jour === "autre" ? "Choisissez la date." : ""}
          </p>
        </>
      )}
    </div>
  );
}
