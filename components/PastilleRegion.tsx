import { Icone } from "@/components/ui";
import { pastilleRegion } from "@/lib/crm/regions";

/**
 * La région d'une fiche, en petite pastille (29/10, demande de Bora : « sur
 * la fiche, quand c'est en aperçu, mettre la région ») — liste, pipeline et
 * tête de fiche. « Bruxelles · Auderghem », « Brabant flamand », ou
 * « Région ? » en gris quand on ne sait pas (ni commune, ni adresse, ni fixe
 * qui parle — migration 038). Le libellé vient de `pastilleRegion`
 * (lib/crm/regions.ts) ; tronqué, il se lit entier au survol.
 */
export function PastilleRegion({
  region,
  className = "",
}: {
  region: string | null | undefined;
  className?: string;
}) {
  const { label, connue } = pastilleRegion(region);
  return (
    <span
      title={connue ? label : "Région inconnue — ajoutez la commune ou l'adresse"}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 ${
        connue
          ? "border-white/10 bg-white/[0.04] text-slate-300"
          : "border-dashed border-white/15 text-slate-500"
      } ${className}`}
    >
      <Icone nom="epingle" className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}
