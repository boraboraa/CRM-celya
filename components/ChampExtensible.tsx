"use client";

import { useEffect, useRef } from "react";

/**
 * Un champ COURT qui s'agrandit avec le texte (19/10) — « Ce qui s'est
 * passé », le compte rendu d'un débrief. Une ligne au départ ; la dictée du
 * téléphone y verse trois phrases d'un coup, et elles doivent rester lisibles
 * sans défiler dans un champ d'une ligne. Plafonné : au-delà, il défile.
 */
export function ChampExtensible({
  value,
  onChange,
  max = 160,
  className = "",
  ...reste
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (valeur: string) => void;
  /** Hauteur maximale en px. */
  max?: number;
}) {
  const zone = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const z = zone.current;
    if (!z) return;
    z.style.height = "auto";
    z.style.height = `${Math.min(z.scrollHeight, max)}px`;
  }, [value, max]);
  return (
    <textarea
      ref={zone}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoCapitalize="sentences"
      className={`resize-none leading-snug ${className}`}
      {...reste}
    />
  );
}
