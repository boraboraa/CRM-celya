"use client";

import { useState } from "react";

/**
 * Le champ de date du CRM : un vrai <input type="date"> (ou datetime-local
 * quand l'heure compte, ex. rendez-vous), toujours modifiable à la main.
 * Les raccourcis (« Demain », « +1 mois »…) remplissent le champ au lieu de
 * s'y substituer — Bora peut ensuite corriger la date au jour près.
 */

const SHORTCUTS: { label: string; days?: number; months?: number }[] = [
  { label: "Demain", days: 1 },
  { label: "+3 jours", days: 3 },
  { label: "+1 semaine", days: 7 },
  { label: "+1 mois", months: 1 },
  { label: "+3 mois", months: 3 },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date locale du navigateur (celui de Bora est à l'heure de Bruxelles). */
function shiftedDate(days = 0, months = 0): string {
  const d = new Date();
  if (months) d.setMonth(d.getMonth() + months);
  if (days) d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function DateField({
  name,
  withTime = false,
  defaultValue = "",
  defaultTime = "09:00",
  required = false,
  compact = false,
  value: controlledValue,
  onChange,
}: {
  name: string;
  /** datetime-local (rendez-vous) au lieu de date seule. */
  withTime?: boolean;
  defaultValue?: string;
  /** Heure posée quand un raccourci remplit un champ avec heure. */
  defaultTime?: string;
  required?: boolean;
  compact?: boolean;
  /** Mode contrôlé (facultatif) pour les formulaires à état local. */
  value?: string;
  onChange?: (value: string) => void;
}) {
  const [inner, setInner] = useState(defaultValue);
  const value = controlledValue !== undefined ? controlledValue : inner;

  function set(v: string) {
    if (controlledValue === undefined) setInner(v);
    onChange?.(v);
  }

  function applyShortcut(s: (typeof SHORTCUTS)[number]) {
    const date = shiftedDate(s.days ?? 0, s.months ?? 0);
    // Le raccourci remplit la date ; l'heure déjà saisie est conservée.
    if (withTime) {
      const time = value.length >= 16 ? value.slice(11, 16) : defaultTime;
      set(`${date}T${time}`);
    } else {
      set(date);
    }
  }

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <input
        type={withTime ? "datetime-local" : "date"}
        name={name}
        required={required}
        value={value}
        onChange={(e) => set(e.target.value)}
        className={`input w-auto ${compact ? "py-1.5 text-xs" : ""}`}
      />
      <div className="flex flex-wrap gap-1">
        {SHORTCUTS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => applyShortcut(s)}
            className="rounded-md bg-white/[0.04] px-2 py-1 text-[11px] text-slate-400 ring-1 ring-white/10 transition hover:bg-white/[0.08] hover:text-slate-200"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
