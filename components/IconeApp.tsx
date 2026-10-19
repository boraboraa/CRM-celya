/**
 * L'icône de l'application installée (écran d'accueil, raccourcis) — dessinée
 * en JSX pour `next/og` (app/icon.tsx, app/apple-icon.tsx) : aucun fichier
 * binaire dans le dépôt. Le monogramme du logo (components/Logo.tsx) sur le
 * dégradé Celya — le seul endroit, avec le logo, où le dégradé a sa place.
 *
 * Le fond plein couvre TOUT le carré et le monogramme tient dans les 60 %
 * centraux : l'icône reste entière quand Android la découpe en cercle
 * (`purpose: "maskable"`).
 */
export function DessinIcone({ taille }: { taille: number }) {
  const pastille = Math.round(taille * 0.6);
  const trait = Math.round(pastille * 0.55);
  return (
    <div
      style={{
        width: taille,
        height: taille,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0A0E1A",
      }}
    >
      <div
        style={{
          width: pastille,
          height: pastille,
          borderRadius: Math.round(pastille * 0.28),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundImage: "linear-gradient(100deg, #22D3EE 0%, #4F7BFF 52%, #A855F7 100%)",
        }}
      >
        <svg width={trait} height={trait} viewBox="0 0 24 24" fill="none">
          <path d="M17 7.5A6.5 6.5 0 1 0 17 16.5" stroke="#0A0E1A" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M14 4.5h4.5V9" stroke="#0A0E1A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
