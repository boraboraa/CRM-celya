/**
 * La silhouette de l'écran Appels IA, pendant que le serveur lit la base :
 * l'état du moteur, les deux cartes (test, inscription), puis les sections
 * repliées. Module NEUTRE, rendu par app/(app)/appels-ia/loading.tsx.
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

      <div className="space-y-6">
        <div className="card p-4 sm:p-5">
          <Bloc className="h-3.5 w-40" />
          <div className="mt-4 flex items-start gap-3">
            <Bloc className="mt-1.5 h-2.5 w-2.5 rounded-full" />
            <div className="min-w-0 flex-1">
              <Bloc className="h-6 w-48 max-w-full" />
              <Bloc className="mt-2 h-4 w-80 max-w-full" />
            </div>
          </div>
          <div className="mt-5 grid gap-5 border-t border-white/[0.06] pt-5 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Bloc className="h-6 w-11 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <Bloc className="h-4 w-36" />
                  <Bloc className="mt-2 h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Bloc key={i} className="h-14 rounded-none" />
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="card p-4 sm:p-5">
              <Bloc className="h-3.5 w-36" />
              <Bloc className="mt-4 h-10 w-56 max-w-full rounded-xl" />
              <Bloc className="mt-4 h-3 w-full" />
              <Bloc className="mt-2 h-3 w-2/3" />
            </div>
          ))}
        </div>

        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card flex items-center justify-between p-4 sm:p-5">
            <Bloc className="h-3.5 w-44" />
            <Bloc className="h-4 w-4" />
          </div>
        ))}
      </div>
    </div>
  );
}
