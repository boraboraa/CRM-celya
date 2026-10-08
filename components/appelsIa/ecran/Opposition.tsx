/**
 * La liste d'opposition : les numéros que Janet ne compose plus jamais — ceux
 * qu'une personne a demandé au téléphone de ne plus appeler (outil
 * « opposition », sur-le-champ), et ceux ajoutés à la main ou par Claude.
 *
 * Retirer un numéro se confirme : c'est autoriser Janet à le rappeler.
 *
 * Composant SERVEUR ; le geste est dans les composants clients.
 */

import type { PageAppels } from "@/lib/appelsIa/lectures";
import { numeroLisible } from "@/lib/appelsIa/numeros";
import { AjoutOpposition } from "./AjoutOpposition";
import { LigneRetirable } from "./LigneRetirable";
import { Repliable } from "./commun";
import { quandPasse } from "./format";

const SOURCE: Record<string, string> = {
  appel: "demandé au téléphone",
  manuel: "ajouté à la main",
  mcp: "ajouté par Claude",
};

export function Opposition({
  numeros,
  maintenant,
}: {
  numeros: PageAppels["opposition"];
  maintenant: Date;
}) {
  return (
    <Repliable
      titre="Liste d'opposition"
      compte={numeros.length === 0 ? "vide" : `${numeros.length} numéro${numeros.length > 1 ? "s" : ""}`}
      icone="telephone-barre"
    >
      <p className="mb-4 text-xs leading-relaxed text-slate-400">
        Janet ne compose jamais ces numéros. Quand quelqu&apos;un dit « ne m&apos;appelez plus », elle
        l&apos;ajoute elle-même, sur-le-champ.
      </p>

      <div className="mb-5">
        <AjoutOpposition />
      </div>

      {numeros.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun numéro pour l&apos;instant.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {numeros.map((o) => {
            const lisible = numeroLisible(o.numero);
            return (
              <LigneRetirable
                key={o.numero}
                genre="opposition"
                cle={o.numero}
                bouton="Retirer"
                confirmation={{
                  texte: `Retirer le ${lisible} de la liste ? Janet pourra de nouveau le composer.${
                    o.source === "appel" ? " Cette personne avait demandé, au téléphone, à ne plus être appelée." : ""
                  }`,
                  bouton: "Retirer de la liste",
                }}
              >
                <p className="font-mono text-sm text-slate-100">{lisible}</p>
                <p className="mt-0.5 break-words text-[11px] text-slate-500">
                  {SOURCE[o.source] ?? o.source} · {quandPasse(o.created_at, maintenant)}
                  {o.motif && <span className="text-slate-400"> — {o.motif}</span>}
                </p>
              </LigneRetirable>
            );
          })}
        </ul>
      )}
    </Repliable>
  );
}
