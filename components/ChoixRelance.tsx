"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icone } from "@/components/ui";
import {
  HEURES_TACTILES,
  choixParDefaut,
  decalerJour,
  heureDisponible,
  heurePourJour,
  jourMinimum,
  jourSaisi,
  libelleJour,
  libelleRelance,
  valeurRelance,
} from "@/lib/crm/relance";

function heureDite(hm: string): string {
  const [h, m] = hm.split(":");
  return `${Number(h)}h${m && m !== "00" ? m : ""}`;
}

/**
 * Dater une relance — LE composant, partout (carte PROCHAINE ACTION, ligne de
 * « À faire », après un résultat d'appel, débrief, « Planifier une relance »).
 * Les règles vivent dans lib/crm/relance.ts.
 *
 * Tactile (28/10, retour de Bora : « pas assez tactile ») :
 *   · le JOUR se règle par « − / + » — un tap sur la date ouvre le calendrier
 *     du téléphone pour aller loin ; jamais avant aujourd'hui (ni avant demain
 *     quand la journée est finie) ;
 *   · l'HEURE en grosses pastilles (9h · 10h · 11h · 14h · 15h · 16h · 17h),
 *     « Autre » ouvre l'horloge du téléphone ; aujourd'hui, les heures passées
 *     sont grisées ;
 *   · puis UN bouton qui dit ce qui partira : « Valider · demain à 9h » —
 *     « Demain à 9h » reste à UN tap, n'importe quel autre choix se voit
 *     avant d'être enregistré.
 *
 * Deux usages :
 *   · `onChoisir` — le bouton « Valider » envoie ;
 *   · `name` — dans un formulaire : un champ caché porte la valeur
 *     « YYYY-MM-DDTHH:mm », le bouton du formulaire envoie.
 *
 * L'instant de référence est lu APRÈS le montage : le rendu serveur et le
 * premier rendu client sont identiques (aucun écart d'hydratation).
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
  /** Un geste de plus à côté de « Valider » (« Sans relance »). */
  extra?: ReactNode;
  className?: string;
}) {
  const [now, setNow] = useState<Date | null>(null);
  const [ymd, setYmd] = useState<string | null>(null);
  const [hm, setHm] = useState<string>("09:00");

  useEffect(() => {
    const t = new Date();
    const d = choixParDefaut(t);
    setNow(t);
    setYmd(d.ymd);
    setHm(d.hm);
  }, []);

  const pret = Boolean(now && ymd);
  const valeur = pret ? valeurRelance(ymd!, hm) : "";
  const libelle = pret ? libelleRelance(valeur, now!) : "demain à 9h";
  const jour = pret ? libelleJour(ymd!, now!) : { principal: "Demain", detail: null };
  const auMinimum = pret && ymd === jourMinimum(now!);
  const heureLibre = !(HEURES_TACTILES as readonly string[]).includes(hm);

  function changerJour(nouveau: string) {
    if (!now) return;
    setYmd(nouveau);
    setHm((h) => heurePourJour(nouveau, h, now));
  }

  const carre =
    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-lg text-slate-100 ring-1 ring-white/10 transition active:scale-95 hover:bg-white/[0.08] disabled:opacity-35";
  const pastille = (actif: boolean) =>
    `relative inline-flex min-h-[44px] min-w-[52px] items-center justify-center rounded-xl px-3 text-sm ring-1 transition active:scale-95 disabled:opacity-35 ${
      actif
        ? "bg-celya-blue/25 font-medium text-blue-50 ring-celya-blue/60"
        : "bg-white/[0.04] text-slate-200 ring-white/10 hover:bg-celya-blue/15"
    }`;

  return (
    <div
      className={`w-full max-w-xl space-y-2 rounded-xl bg-white/[0.03] p-2 ring-1 ring-white/[0.08] ${className}`}
      role="group"
      aria-label={titre}
    >
      {avertissement && <p className="px-1 text-xs text-amber-300">{avertissement}</p>}
      <p className="px-1 text-[11px] uppercase tracking-wide text-slate-400">{titre}</p>

      {/* Le jour : − / + ; un tap sur la date ouvre le calendrier. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={carre}
          disabled={pending || !pret || auMinimum}
          onClick={() => changerJour(decalerJour(ymd!, -1, now!))}
          aria-label="Jour précédent"
        >
          −
        </button>
        <div className="relative flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center rounded-xl bg-white/[0.04] px-2 text-center ring-1 ring-white/10">
          <span className="max-w-full truncate text-sm font-medium text-slate-50" title={jour.principal}>
            {jour.principal}
          </span>
          {jour.detail && (
            <span className="max-w-full truncate text-[11px] text-slate-400" title={jour.detail}>
              {jour.detail}
            </span>
          )}
          <input
            type="date"
            value={ymd ?? ""}
            min={now ? jourMinimum(now) : undefined}
            disabled={pending || !pret}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker?.();
              } catch {
                /* navigateur sans showPicker : le champ s'ouvre seul au tap */
              }
            }}
            onChange={(e) => {
              const v = now ? jourSaisi(e.target.value, now) : null;
              if (v) changerJour(v);
            }}
            aria-label={`${titre} — choisir la date`}
            title="Choisir une date"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
        <button
          type="button"
          className={carre}
          disabled={pending || !pret}
          onClick={() => changerJour(decalerJour(ymd!, 1, now!))}
          aria-label="Jour suivant"
        >
          +
        </button>
      </div>

      {/* L'heure : de grosses pastilles ; « Autre » ouvre l'horloge. */}
      <div className="flex flex-wrap gap-1.5">
        {HEURES_TACTILES.map((h) => (
          <button
            key={h}
            type="button"
            disabled={pending || !pret || !heureDisponible(ymd!, h, now!)}
            onClick={() => setHm(h)}
            aria-pressed={pret && h === hm}
            className={pastille(pret && h === hm)}
          >
            {heureDite(h)}
          </button>
        ))}
        <label className={pastille(pret && heureLibre)}>
          {pret && heureLibre ? heureDite(hm) : "Autre"}
          <input
            type="time"
            step={300}
            value={hm}
            disabled={pending || !pret}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker?.();
              } catch {
                /* idem */
              }
            }}
            onChange={(e) => {
              const v = e.target.value;
              if (now && ymd && /^\d{2}:\d{2}$/.test(v) && heureDisponible(ymd, v, now)) setHm(v);
            }}
            aria-label={`${titre} — autre heure`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>

      {onChoisir ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending || !pret}
            onClick={() => onChoisir(valeur)}
            className="btn-primary min-h-[44px] min-w-0 max-w-full flex-1 justify-center px-4 text-sm sm:flex-none"
          >
            <Icone nom="coche" className="h-4 w-4 shrink-0" />
            <span className="truncate">Valider · {libelle}</span>
          </button>
          {extra}
        </div>
      ) : (
        <>
          {name && <input type="hidden" name={name} value={valeur} required={required} />}
          <p className="px-1 text-xs text-slate-300">→ {libelle}</p>
        </>
      )}

      {info && (
        <p className="flex items-center gap-1 px-1 text-[11px] text-slate-400">
          <Icone nom="calendrier" className="h-3 w-3 shrink-0" />
          {info}
        </p>
      )}
    </div>
  );
}
