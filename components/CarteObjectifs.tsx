import Link from "next/link";
import { Icone } from "@/components/ui";
import { avancement, phraseObjectifs } from "@/lib/crm/compteurs";
import type { MesObjectifs } from "@/lib/crm/lectureObjectifs";

/**
 * « Cette semaine : 23/60 appels · 6/15 réponses · 1/3 RDV · 0/2 essais »
 * (27/10) — en haut de « À faire ». Les compteurs viennent de la base
 * (`compteurs_de`, 031) ; les essais comptent sur la PÉRIODE (depuis le 2/11).
 * Le classement s'ouvre d'ici : la barre du bas d'un commercial reste à
 * quatre onglets.
 *
 * Composant serveur, sans état : une barre par objectif, la couleur ne porte
 * jamais seule (le chiffre est écrit).
 */
export function CarteObjectifs({ donnees }: { donnees: MesObjectifs }) {
  const { semaine, essaisPeriode, objectifs } = donnees;
  const barres: { libelle: string; n: number; cible: number | null }[] = [
    { libelle: "Appels", n: semaine.appels, cible: objectifs?.appels ?? null },
    { libelle: "Réponses", n: semaine.reponses, cible: objectifs?.reponses ?? null },
    { libelle: "RDV", n: semaine.rdv, cible: objectifs?.rdv ?? null },
    { libelle: "Essais (période)", n: essaisPeriode, cible: objectifs?.essaisPeriode ?? null },
  ];
  return (
    <section aria-labelledby="objectifs-titre" className="card mb-5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="objectifs-titre" className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
          <Icone nom="cible" className="h-4 w-4 text-celya-blue" />
          Cette semaine
        </h2>
        {/* Téléphone : la phrase passe SOUS le titre (pleine largeur) — ou
            disparaît quand les barres disent déjà la même chose. */}
        <p
          className={`order-last min-w-0 basis-full text-xs text-slate-300 sm:order-none sm:basis-0 sm:flex-1 ${
            objectifs ? "hidden sm:block" : ""
          }`}
        >
          {phraseObjectifs(semaine, essaisPeriode, objectifs)}
        </p>
        <Link
          href="/classement"
          className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 text-xs font-medium text-celya-blue hover:underline"
        >
          <Icone nom="trophee" className="h-3.5 w-3.5" />
          Classement
        </Link>
      </div>
      {objectifs && (
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {barres.map((b) => {
            const pct = avancement(b.n, b.cible);
            return (
              <li key={b.libelle} className="min-w-0">
                <p className="flex items-baseline justify-between text-[11px] text-slate-400">
                  <span className="truncate" title={b.libelle}>
                    {b.libelle}
                  </span>
                  <span className="tabular-nums text-slate-200">
                    {b.n}
                    {b.cible ? `/${b.cible}` : ""}
                  </span>
                </p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
                  {pct !== null && (
                    <div
                      className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-400" : "bg-celya-blue"}`}
                      style={{ width: `${pct}%` }}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
