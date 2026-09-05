import { lienMaps, lienItineraire } from "@/lib/crm/maps";
import { Icone } from "@/components/ui";

/**
 * Les deux boutons Maps — l'unique façon d'AFFICHER une adresse dans le CRM,
 * qu'elle vienne de la fiche (`prospects.address`) ou d'un rendez-vous
 * (`meetings.location`).
 *
 *   Ouvrir dans Maps → lienMaps(...)   — sur téléphone, ouvre l'application
 *   Y aller          → lienItineraire(...), MASQUÉ quand il vaut null
 *                         (un lien court ne nomme pas de destination)
 *
 * Rien n'est réécrit : ce sont les helpers purs de lib/crm/maps.ts qui
 * décident, et eux seuls. Si la valeur ne donne aucun lien exploitable
 * (`javascript:`, `data:`…), elle s'affiche comme du TEXTE — jamais un href.
 *
 * Composant neutre (ni serveur ni client) : utilisable dans une page comme
 * dans un composant « use client » (AgendaGrid). `Icone` l'est aussi.
 */
export function BoutonsMaps({
  valeur,
  ville,
  compact = false,
  className = "",
}: {
  /** Adresse libre ou lien Maps collé. */
  valeur: string | null | undefined;
  /** Ville de la fiche — complète l'adresse quand elle n'a pas de code postal. */
  ville?: string | null;
  /** Version minuscule, pour les cartes de l'agenda. */
  compact?: boolean;
  className?: string;
}) {
  const texte = (valeur ?? "").trim();
  if (!texte) return null;

  const ouvrir = lienMaps(texte, ville);
  const itineraire = lienItineraire(texte, ville);

  // Aucune URL exploitable : on montre ce qui a été saisi, sans lien.
  if (!ouvrir) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs text-slate-400 ${className}`}>
        <Icone nom="epingle" className="h-3 w-3" /> {texte}
      </span>
    );
  }

  // Classes complètes, jamais interpolées (règle JIT).
  const base = compact
    ? "inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-slate-200 ring-1 ring-white/10 transition hover:bg-white/[0.12] hover:text-slate-50"
    : "btn-ghost px-2.5 py-1.5 text-xs";

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <a
        href={ouvrir}
        target="_blank"
        rel="noopener noreferrer"
        title={texte}
        className={base}
      >
        <Icone nom="epingle" className="h-3 w-3" />
        {compact ? "Maps" : "Ouvrir dans Maps"}
      </a>
      {itineraire && (
        <a
          href={itineraire}
          target="_blank"
          rel="noopener noreferrer"
          title={`Itinéraire vers ${texte}`}
          className={base}
        >
          <Icone nom="itineraire" className="h-3 w-3" />
          Y aller
        </a>
      )}
    </span>
  );
}
