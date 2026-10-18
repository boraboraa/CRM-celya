"use client";

import { useRouter } from "next/navigation";

/**
 * Le menu déroulant « un commercial » du sélecteur de périmètre. Neuf noms
 * en ligne débordaient (18/10, quatre comptes à zéro fiche compris) : les deux
 * choix fréquents restent des boutons, les personnes passent dans un menu.
 *
 * Reçoit des CHAÎNES seulement (liens déjà construits par le serveur) : aucune
 * fonction ne traverse la frontière serveur → client (test:frontiere).
 */
export function ChoixMembrePerimetre({
  options,
}: {
  options: { href: string; label: string; actif: boolean }[];
}) {
  const router = useRouter();
  const actif = options.find((o) => o.actif);
  return (
    <select
      aria-label="Voir les fiches d'un commercial"
      value={actif?.href ?? ""}
      onChange={(e) => e.target.value && router.push(e.target.value)}
      className={`min-h-[34px] rounded-lg bg-transparent px-2 text-xs font-medium outline-none ring-1 transition focus:ring-celya-blue/60 ${
        actif
          ? "bg-white/[0.09] text-slate-100 ring-white/15"
          : "text-slate-400 ring-transparent hover:text-slate-200"
      }`}
    >
      <option value="" disabled>
        Un commercial…
      </option>
      {options.map((o) => (
        <option key={o.href} value={o.href} className="bg-slate-900 text-slate-100">
          {o.label}
        </option>
      ))}
    </select>
  );
}
