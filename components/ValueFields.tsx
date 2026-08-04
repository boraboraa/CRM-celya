"use client";

import { useState } from "react";
import {
  PROBABILITY_PRESETS,
  fmtMoney,
  weightedValue,
} from "@/lib/constants";
import { ProbabilityGauge } from "@/components/ui";

/** « 4 800 » / « 4.800,50 » / « 4800 € » → 4800.5 */
function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\s/g, "");
  if (!cleaned) return null;
  const normalised =
    cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

/**
 * Valeur estimée + probabilité de conclure, et la valeur pondérée qui en
 * découle, calculée en direct sous les deux champs.
 *
 * Les raccourcis (10 / 25 / 50 / 75 / 90 %) REMPLISSENT le champ au lieu de
 * s'y substituer — même principe que DateField : Bora peut toujours écrire
 * 62 % à la main. Sans probabilité, pas de valeur pondérée.
 */
export function ValueFields({
  defaultValue,
  defaultProbability,
  currency = "EUR",
}: {
  defaultValue?: number | string | null;
  defaultProbability?: number | null;
  currency?: string;
}) {
  const [value, setValue] = useState(
    defaultValue === null || defaultValue === undefined ? "" : String(defaultValue)
  );
  const [probability, setProbability] = useState(
    defaultProbability === null || defaultProbability === undefined
      ? ""
      : String(defaultProbability)
  );

  const numericValue = toNumber(value);
  const numericProbability = probability === "" ? null : Number(probability);
  const weighted = weightedValue(
    numericValue,
    numericProbability !== null && Number.isFinite(numericProbability)
      ? numericProbability
      : null
  );

  return (
    <>
      <div>
        <label className="label" htmlFor="value_estimate">
          Valeur estimée (€)
        </label>
        <input
          id="value_estimate"
          name="value_estimate"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="input"
          placeholder="4800"
        />
      </div>

      <div>
        <label className="label" htmlFor="probability">
          Probabilité de conclure (%)
        </label>
        <input
          id="probability"
          name="probability"
          inputMode="numeric"
          min={0}
          max={100}
          value={probability}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d]/g, "").slice(0, 3);
            if (raw === "") return setProbability("");
            setProbability(String(Math.min(100, Number(raw))));
          }}
          className="input"
          placeholder="Non renseignée"
        />
        <div className="mt-1.5 flex flex-wrap gap-1">
          {PROBABILITY_PRESETS.map((p) => {
            const active = probability === String(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => setProbability(active ? "" : String(p))}
                aria-pressed={active}
                className={`rounded-md px-2 py-1 text-[11px] ring-1 transition duration-200 ${
                  active
                    ? "bg-celya-blue/25 text-slate-100 ring-celya-blue/50"
                    : "bg-white/[0.04] text-slate-400 ring-white/10 hover:bg-white/[0.08] hover:text-slate-200"
                }`}
              >
                {p} %
              </button>
            );
          })}
          {probability !== "" && (
            <button
              type="button"
              onClick={() => setProbability("")}
              title="Retirer la probabilité"
              className="rounded-md px-2 py-1 text-[11px] text-slate-600 transition hover:text-rose-400"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* La valeur pondérée — l'indicateur de priorisation, en direct. */}
      <div className="sm:col-span-2">
        <div
          className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl px-3.5 py-2.5 text-sm ring-1 transition duration-300 ${
            weighted !== null
              ? "bg-celya-blue/[0.08] text-slate-200 ring-celya-blue/25"
              : "bg-white/[0.02] text-slate-500 ring-white/[0.06]"
          }`}
        >
          <span className="text-[11px] uppercase tracking-wider text-slate-500">
            Valeur pondérée
          </span>
          {weighted !== null ? (
            <>
              <span className="font-display text-base font-semibold text-slate-50">
                {fmtMoney(weighted, currency)}
              </span>
              <span className="text-xs text-slate-400">
                {fmtMoney(numericValue, currency)} ×
              </span>
              <ProbabilityGauge probability={numericProbability} size="sm" />
            </>
          ) : (
            <span className="text-xs">
              Renseignez une valeur et une probabilité pour la calculer.
            </span>
          )}
        </div>
      </div>
    </>
  );
}
