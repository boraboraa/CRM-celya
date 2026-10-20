/**
 * La silhouette de l'écran Appels IA, pendant que le serveur lit la base :
 * les trois onglets, puis deux cartes (la forme de « Numéro & test » comme de
 * « Campagnes », à grands traits). Module NEUTRE, rendu par app/(app)/appels-ia/loading.tsx.
 */

function Bloc({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-md bg-white/[0.06] ${className}`} />;
}

export function SqueletteAppelsIa() {
  return (
    <div aria-busy="true" aria-label="Chargement des appels IA">
      <div className="mb-7">
        <Bloc className="h-7 w-40" />
        <Bloc className="mt-2.5 h-3.5 w-96 max-w-full" />
      </div>

      <div className="mb-6 flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Bloc key={i} className="h-11 flex-1 rounded-xl" />
        ))}
      </div>

      <div className="space-y-6">
        <div className="card p-4 sm:p-5">
          <Bloc className="h-3.5 w-48" />
          <Bloc className="mt-3 h-3 w-full" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="mt-5 flex items-start gap-3">
              <Bloc className="h-6 w-6 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <Bloc className="h-4 w-36" />
                <Bloc className="mt-2 h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
        <div className="card p-4 sm:p-5">
          <Bloc className="h-3.5 w-32" />
          <Bloc className="mt-4 h-10 w-56 max-w-full rounded-xl" />
          <Bloc className="mt-3 h-3 w-2/3" />
        </div>
      </div>
    </div>
  );
}
