import type { LigneClassement } from "@/lib/crm/lectureObjectifs";

const COLONNES = [
  ["appels", "Appels"],
  ["reponses", "Réponses"],
  ["interesses", "Intéressés"],
  ["rdv", "RDV"],
  ["essais", "Essais"],
  ["numeros", "Numéros ajoutés"],
] as const;

/** Les essais se lisent d'abord : c'est le « win » d'un étudiant. */
const chiffre = (k: (typeof COLONNES)[number][0], l: LigneClassement) =>
  k === "essais" && l.essais > 0 ? "font-semibold text-teal-300" : "text-slate-200";

/**
 * Le tableau du classement — des CHIFFRES par personne, jamais une fiche.
 * Extrait de la page (28/10) pour être rendu sur le banc d'affichage.
 *
 * Téléphone : une carte par personne, les six chiffres en grille 3 × 2 — le
 * tableau de six colonnes défilait de côté DANS sa carte, et les chiffres,
 * c'est-à-dire tout ce qu'on vient lire ici, étaient hors de l'écran.
 * À partir de `sm` : le tableau, le nom tronqué (entier au survol).
 */
export function TableauClassement({ lignes, moiId }: { lignes: LigneClassement[]; moiId: string | null }) {
  return (
    <>
      <ol className="space-y-2 sm:hidden">
        {lignes.map((l, i) => {
          const moi = l.user_id === moiId;
          return (
            <li key={l.user_id} className={`card px-4 py-3 ${moi ? "ring-1 ring-celya-blue/40" : ""}`}>
              <p className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 tabular-nums text-slate-400">{i + 1}</span>
                <span className="min-w-0 truncate font-medium text-slate-100" title={l.nom}>
                  {l.nom}
                </span>
                {moi && <span className="shrink-0 text-xs text-celya-blue">(vous)</span>}
              </p>
              <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2">
                {COLONNES.map(([k, label]) => (
                  <div key={k} className="min-w-0">
                    <dt className="truncate text-[11px] text-slate-500" title={label}>
                      {label}
                    </dt>
                    <dd className={`tabular-nums ${chiffre(k, l)}`}>{l[k]}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ol>

      <div className="card hidden sm:block">
        <table className="w-full table-fixed text-sm">
          <thead className="border-b border-white/[0.06]">
            <tr>
              <th className="th w-10">#</th>
              <th className="th">Nom</th>
              {COLONNES.map(([k, l]) => (
                <th key={k} className="th w-[11%] text-right">
                  <span className="block truncate" title={l}>
                    {l}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {lignes.map((l, i) => {
              const moi = l.user_id === moiId;
              return (
                <tr key={l.user_id} className={moi ? "bg-celya-blue/[0.07]" : undefined}>
                  <td className="td tabular-nums text-slate-400">{i + 1}</td>
                  <td className="td font-medium text-slate-100">
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="min-w-0 truncate" title={l.nom}>
                        {l.nom}
                      </span>
                      {moi && <span className="shrink-0 text-xs text-celya-blue">(vous)</span>}
                    </span>
                  </td>
                  {COLONNES.map(([k]) => (
                    <td key={k} className={`td text-right tabular-nums ${chiffre(k, l)}`}>
                      {l[k]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
