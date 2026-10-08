import type { EtatAppels } from "@/lib/appelsIa/lectures";
import { ColonneAppels } from "@/components/appelsIa/ColonneAppels";

/**
 * La mise en page du tableau de bord quand la colonne « Appels » existe :
 * le contenu habituel à gauche, la colonne à DROITE sur grand écran (`xl`,
 * 20 rem) — et EN TÊTE, au-dessus du contenu, sur GSM et tablette.
 *
 * Sans état (compte non admin) ou sans migration 025 (`disponible` faux), elle
 * rend ses enfants TELS QUELS : la page reste exactement celle d'avant, sans
 * grille ni conteneur de plus.
 *
 * Composant SERVEUR : il ne passe à la colonne (client) que de la donnée.
 */
export function AvecColonneAppels({
  etat,
  children,
}: {
  etat: EtatAppels | null;
  children: React.ReactNode;
}) {
  if (!etat?.disponible) return <>{children}</>;
  return (
    // `grid-cols-1` et `minmax(0, 1fr)` : une colonne de grille ne doit jamais
    // s'élargir au contenu le plus large — sans quoi la page déborderait à
    // 390 px au lieu de replier ses lignes.
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-6">
      <aside className="min-w-0 xl:col-start-2 xl:row-start-1">
        <ColonneAppels initial={etat} />
      </aside>
      <div className="min-w-0 xl:col-start-1 xl:row-start-1">{children}</div>
    </div>
  );
}
