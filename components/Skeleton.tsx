/**
 * Silhouettes de chargement.
 *
 * Ce que Bora doit voir au clic : la forme de l'écran demandé, tout de suite,
 * plutôt qu'un écran figé sur la page précédente pendant que le serveur
 * interroge Supabase. Les proportions reprennent celles du vrai contenu pour
 * qu'aucun bloc ne saute à l'arrivée des données.
 *
 * Module neutre (ni client ni serveur) : rendu par les fichiers loading.tsx.
 */

/** Un bloc gris qui respire. `prefers-reduced-motion` neutralise l'animation. */
function Bloc({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`block animate-pulse rounded-md bg-white/[0.06] ${className}`}
    />
  );
}

function EnTete() {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <Bloc className="h-7 w-56" />
        <Bloc className="mt-2.5 h-3.5 w-80 max-w-full" />
      </div>
      <Bloc className="h-10 w-44 rounded-xl" />
    </div>
  );
}

/** Une pile de lignes dans une carte — relances, listes, chronologie. */
function Lignes({ n = 4 }: { n?: number }) {
  return (
    <ul className="card divide-y divide-white/[0.05]">
      {Array.from({ length: n }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 px-4 py-3.5">
          <Bloc className="mt-0.5 h-5 w-5 shrink-0 rounded-md" />
          <span className="min-w-0 flex-1">
            <Bloc className="h-4 w-1/2" />
            <Bloc className="mt-2 h-3 w-3/4" />
          </span>
          <Bloc className="h-6 w-24 shrink-0 rounded-lg" />
        </li>
      ))}
    </ul>
  );
}

function Titre() {
  return <Bloc className="mb-3 h-3.5 w-48" />;
}

/** « À faire » — ses trois zones, dans l'ordre. */
export function SqueletteTableauDeBord() {
  return (
    <div aria-busy="true" aria-label="Chargement de l'écran À faire">
      <EnTete />
      <div className="space-y-8">
        <section>
          <Titre />
          <Lignes n={3} />
        </section>
        <section>
          <Titre />
          <Lignes n={2} />
        </section>
      </div>
    </div>
  );
}

/** La liste des prospects — tableau ou colonnes, même silhouette de départ. */
export function SqueletteProspects() {
  return (
    <div aria-busy="true" aria-label="Chargement des prospects">
      <EnTete />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Bloc className="h-9 w-44 rounded-xl" />
        <Bloc className="h-9 w-40 rounded-xl" />
        <Bloc className="h-9 flex-1 rounded-xl" />
      </div>
      <Lignes n={8} />
    </div>
  );
}

/** La fiche prospect — en-tête, prochaine action, chronologie, colonne. */
export function SqueletteFiche() {
  return (
    <div aria-busy="true" aria-label="Chargement de la fiche">
      <Bloc className="h-3 w-32" />
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Bloc className="h-8 w-72 max-w-full" />
          <Bloc className="mt-2.5 h-3.5 w-96 max-w-full" />
          <Bloc className="mt-3 h-6 w-40 rounded-full" />
        </div>
        <div className="flex w-full max-w-md flex-wrap gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Bloc key={i} className="h-6 w-24 rounded-full" />
          ))}
        </div>
      </div>

      {/* Prochaine action */}
      <div className="card mb-6 mt-6 p-5">
        <Bloc className="h-3 w-32" />
        <Bloc className="mt-3 h-6 w-64 max-w-full" />
        <Bloc className="mt-2.5 h-4 w-80 max-w-full" />
        <div className="mt-4 flex flex-wrap gap-2">
          <Bloc className="h-8 w-44 rounded-xl" />
          <Bloc className="h-8 w-32 rounded-xl" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Titre />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card px-4 py-3.5">
              <Bloc className="h-5 w-40 rounded-full" />
              <Bloc className="mt-2.5 h-4 w-full" />
              <Bloc className="mt-1.5 h-4 w-2/3" />
            </div>
          ))}
        </div>
        <div className="space-y-6">
          <div className="card space-y-3 p-5">
            <Bloc className="h-3 w-28" />
            <Bloc className="h-4 w-24" />
            <Bloc className="h-px w-full" />
            <Bloc className="h-4 w-40" />
          </div>
          <Lignes n={2} />
        </div>
      </div>
    </div>
  );
}

/** L'écran Équipe — le tableau des comptes. */
export function SqueletteEquipe() {
  return (
    <div aria-busy="true" aria-label="Chargement de l'équipe">
      <EnTete />
      <div className="card mb-7 h-40 p-5">
        <Bloc className="h-4 w-48" />
        <Bloc className="mt-4 h-9 w-full rounded-xl" />
      </div>
      <Lignes n={4} />
    </div>
  );
}

/** L'agenda — bandeau de commandes puis grille de la semaine. */
export function SqueletteAgenda() {
  return (
    <div aria-busy="true" aria-label="Chargement de l'agenda">
      <EnTete />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Bloc className="h-9 w-56 rounded-xl" />
        <Bloc className="h-9 w-40 rounded-xl" />
        <Bloc className="h-9 w-48 rounded-xl" />
      </div>
      <div className="card flex gap-px overflow-hidden p-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="min-w-0 flex-1 p-2">
            <Bloc className="h-6 w-full" />
            <Bloc className="mt-2 h-[560px] w-full" />
          </span>
        ))}
      </div>
    </div>
  );
}
