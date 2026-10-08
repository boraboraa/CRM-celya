/**
 * La file de Janet : une ligne par cycle d'appels d'une fiche (trois essais au
 * plus). Ce qui attend d'abord, dans l'ordre où le moteur le prendra ; puis
 * l'historique, replié.
 *
 * Composant SERVEUR : les dates sont écrites ici, en chaînes — aucun composant
 * client ne recalcule « maintenant ».
 */

import Link from "next/link";
import type { LigneFileResume } from "@/lib/appelsIa/lectures";
import { Icone } from "@/components/ui";
import { ORIGINE_LABEL, STATUT_FILE_LABEL } from "@/lib/appelsIa/libelles";
import { LigneRetirable } from "./LigneRetirable";
import { ViderFileTest } from "./ViderFileTest";
import { PuceMode, Repliable } from "./commun";
import { quandAVenir, quandPasse } from "./format";

/** Classes entières (règle JIT). */
const CHIP_FILE: Record<string, string> = {
  en_attente: "chip bg-celya-blue/15 text-blue-200 ring-blue-400/30",
  en_cours: "chip bg-celya-blue/25 text-blue-100 ring-blue-400/40",
  termine: "chip bg-white/[0.04] text-slate-300 ring-white/10",
  arrete: "chip bg-white/[0.04] text-slate-400 ring-white/10",
};

function Contenu({ l, maintenant }: { l: LigneFileResume; maintenant: Date }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {l.societe ? (
          <Link
            href={`/prospects/${l.prospect_id}`}
            prefetch={false}
            className="min-w-0 break-words text-sm font-medium text-slate-100 underline-offset-2 hover:underline"
          >
            {l.societe}
          </Link>
        ) : (
          <span className="text-sm text-slate-400">Fiche introuvable</span>
        )}
        <span className={CHIP_FILE[l.statut] ?? CHIP_FILE.arrete}>{STATUT_FILE_LABEL[l.statut] ?? l.statut}</span>
        <PuceMode test={l.mode_test} />
        {l.priorite > 0 && l.statut === "en_attente" && (
          <span className="chip bg-celya-blue/15 text-blue-200 ring-blue-400/30">Prioritaire</span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Essais : {l.essais}/3
        {" · "}
        {l.statut === "en_attente"
          ? `prochain essai ${quandAVenir(l.pas_avant, maintenant)}`
          : l.statut === "en_cours"
            ? "Janet appelle en ce moment"
            : `${l.fin_motif ?? STATUT_FILE_LABEL[l.statut] ?? l.statut} — ${quandPasse(l.updated_at, maintenant)}`}
      </p>
      <p className="mt-0.5 break-words text-[11px] text-slate-500">
        {l.campagne ?? "Campagne inconnue"} · origine : {ORIGINE_LABEL[l.origine] ?? l.origine}
      </p>
      {l.derniere_note && (
        <p className="mt-1 break-words text-[11px] italic leading-relaxed text-slate-400">{l.derniere_note}</p>
      )}
    </>
  );
}

const ORDRE_STATUT: Record<string, number> = { en_cours: 0, en_attente: 1 };

export function FileAppels({
  lignes,
  total,
  maintenant,
}: {
  lignes: LigneFileResume[];
  /** Le compte exact des lignes vivantes (la liste est bornée à 200). */
  total: number;
  maintenant: Date;
}) {
  // Ce qui attend, dans l'ordre du moteur : l'appel en cours, puis la
  // priorité, puis l'ancienneté de `pas_avant`.
  const vivantes = lignes
    .filter((l) => l.statut === "en_attente" || l.statut === "en_cours")
    .sort(
      (a, b) =>
        (ORDRE_STATUT[a.statut] ?? 2) - (ORDRE_STATUT[b.statut] ?? 2) ||
        b.priorite - a.priorite ||
        Date.parse(a.pas_avant) - Date.parse(b.pas_avant)
    );
  const historique = lignes.filter((l) => l.statut === "termine" || l.statut === "arrete");
  const testEnAttente = lignes.filter((l) => l.statut === "en_attente" && l.mode_test).length;

  return (
    <Repliable
      titre="File d'appels"
      compte={total === 0 ? "vide" : `${total} en file`}
      icone="taches"
      ouvert={vivantes.length > 0}
    >
      <p className="mb-4 text-xs leading-relaxed text-slate-400">
        Une ligne par fiche : trois essais au plus, dans la fenêtre d&apos;appel. Le moteur prend la plus
        prioritaire, puis la plus ancienne. Une campagne en pause garde ses lignes sans les composer.
      </p>

      <div className="mb-4">
        <ViderFileTest nombre={testEnAttente} />
      </div>

      {vivantes.length === 0 ? (
        <p className="text-sm text-slate-500">Rien n&apos;attend dans la file.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {vivantes.map((l) =>
            l.statut === "en_attente" ? (
              <LigneRetirable key={l.id} genre="file" cle={l.id} bouton="Retirer">
                <Contenu l={l} maintenant={maintenant} />
              </LigneRetirable>
            ) : (
              <li key={l.id} className="py-3 first:pt-0 last:pb-0">
                <Contenu l={l} maintenant={maintenant} />
              </li>
            )
          )}
        </ul>
      )}

      {historique.length > 0 && (
        <details className="group/histo mt-5 border-t border-white/[0.06] pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-slate-400 transition hover:text-slate-200 [&::-webkit-details-marker]:hidden">
            <Icone nom="chevron" className="h-3 w-3 transition-transform group-open/histo:rotate-180" />
            Historique de la file ({historique.length})
          </summary>
          <ul className="mt-3 divide-y divide-white/[0.06]">
            {historique.map((l) => (
              <li key={l.id} className="py-3 first:pt-0 last:pb-0">
                <Contenu l={l} maintenant={maintenant} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </Repliable>
  );
}
