/**
 * Les quatre scripts de Janet (garage, restaurant, cabinet, autre) : le
 * secteur de la fiche choisit le script. Chacun se déplie et s'enregistre
 * seul.
 *
 * Composant SERVEUR ; chaque formulaire est un composant client.
 */

import type { ScriptLu } from "@/lib/appelsIa/lectures";
import { SECTEUR_LABEL } from "@/lib/appelsIa/secteur";
import { Icone } from "@/components/ui";
import { Script } from "./Script";
import { Repliable } from "./commun";
import { quandPasse } from "./format";

export function Scripts({ scripts, maintenant }: { scripts: ScriptLu[]; maintenant: Date }) {
  return (
    <Repliable titre="Scripts d'appel" compte={`${scripts.length} secteurs`} icone="note">
      <p className="mb-4 rounded-xl bg-white/[0.03] px-3.5 py-3 text-xs leading-relaxed text-slate-300 ring-1 ring-white/[0.06]">
        Les règles intouchables (IA annoncée dans la première phrase, jamais de prix, jamais de nom de
        client, liste noire, opposition respectée) vivent dans le code : un script ne peut pas les
        retirer.
      </p>

      {scripts.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun script en base : Janet se présente alors en termes généraux.</p>
      ) : (
        <div className="space-y-3">
          {scripts.map((s) => (
            <details
              key={s.secteur}
              className="group/script rounded-xl bg-white/[0.02] p-3.5 ring-1 ring-white/[0.06] sm:p-4"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="text-sm font-medium text-slate-100">{SECTEUR_LABEL[s.secteur]}</span>
                  {s.updated_at && (
                    <span className="ml-2 text-[11px] text-slate-500">
                      modifié {quandPasse(s.updated_at, maintenant)}
                    </span>
                  )}
                </span>
                <Icone
                  nom="chevron"
                  className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 group-open/script:rotate-180"
                />
              </summary>
              <div className="mt-4">
                <Script
                  s={{
                    secteur: s.secteur,
                    libelle: SECTEUR_LABEL[s.secteur],
                    accueil: s.accueil,
                    presentation: s.presentation,
                    objectif: s.objectif,
                    questions: s.questions,
                    objections: s.objections,
                  }}
                />
              </div>
            </details>
          ))}
        </div>
      )}
    </Repliable>
  );
}
