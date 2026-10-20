"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AppelDetail } from "@/lib/appelsIa/lectures";
import { ETAPES_SUIVI, LIBELLE_ETAPE, dureeLisible, etapeSuivi, marcheASuivre } from "@/lib/appelsIa/ecran";
import { CLASSEMENT_LABEL, OUTCOME_LABEL_APPEL } from "@/lib/appelsIa/libelles";
import { Icone } from "@/components/ui";
import { useSondage } from "@/components/appelsIa/sondage";
import { ListeRepliques } from "./commun";

/** Classes entières (règle JIT) : une étape franchie, en cours, à venir. */
const PASTILLE: Record<"faite" | "courante" | "avenir" | "echec", string> = {
  faite: "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-celya-blue text-white",
  courante: "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-celya-blue/20 text-blue-100 ring-2 ring-celya-blue animate-pulse",
  avenir: "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-slate-500 ring-1 ring-white/10",
  echec: "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-300 ring-1 ring-rose-400/40",
};
const TEXTE: Record<"faite" | "courante" | "avenir" | "echec", string> = {
  faite: "text-xs text-slate-200",
  courante: "text-xs font-medium text-blue-100",
  avenir: "text-xs text-slate-500",
  echec: "text-xs font-medium text-rose-300",
};

/**
 * Le suivi EN DIRECT d'un appel : compose → sonne → en ligne → terminé, puis
 * le résultat et la transcription — sans quitter la page. Sonde
 * /api/appels-ia/appel toutes les 2 s tant que l'appel vit (useSondage, le
 * rythme partagé des appels), et s'arrête dès qu'il est fini.
 *
 * Un échec se dit en français sous le bouton, avec la marche à suivre
 * (`marcheASuivre`, lib/appelsIa/ecran.ts) : clé refusée, SIP sortant non
 * activé, identifiants SIP refusés.
 *
 * Fini, il rafraîchit la page une fois : l'onglet « Mise en route » passe en ✓
 * après un test réussi, et la pause posée par le moteur s'affiche.
 */
export function SuiviAppel({ initial }: { initial: AppelDetail }) {
  const router = useRouter();
  const [appel, setAppel] = useState(initial);
  const [initialVu, setInitialVu] = useState(initial);
  if (initial.id !== initialVu.id) {
    setInitialVu(initial);
    setAppel(initial);
  }
  const etat = etapeSuivi(appel.statut);
  useSondage<{ appel: AppelDetail | null }>(
    `/api/appels-ia/appel?id=${appel.id}`,
    !etat.fini,
    (d) => {
      if (d?.appel) setAppel(d.appel);
    },
    0,
    2_000
  );

  // Une seule actualisation, au moment où l'appel se termine sous nos yeux.
  const vuVivant = useRef(!etat.fini);
  useEffect(() => {
    if (etat.fini && vuVivant.current) {
      vuVivant.current = false;
      router.refresh();
    }
  }, [etat.fini, router]);

  const rang = ETAPES_SUIVI.indexOf(etat.etape);
  const resultat = appel.resultat && appel.resultat in OUTCOME_LABEL_APPEL ? OUTCOME_LABEL_APPEL[appel.resultat as keyof typeof OUTCOME_LABEL_APPEL] : null;
  const classement = appel.classement ? CLASSEMENT_LABEL[appel.classement] ?? appel.classement : null;
  const conseil = etat.echec || appel.erreur_message ? marcheASuivre(appel.erreur_code, appel.erreur_message) : null;
  const d = dureeLisible(appel.duree_s);

  return (
    <div className="space-y-4 rounded-xl bg-white/[0.02] p-3.5 ring-1 ring-white/[0.06] sm:p-4" aria-live="polite">
      <ol className="grid grid-cols-4 gap-1.5" aria-label="Où en est l'appel">
        {ETAPES_SUIVI.map((e, i) => {
          const ton =
            etat.echec && i === rang ? "echec" : i < rang || (etat.fini && i === rang) ? "faite" : i === rang ? "courante" : "avenir";
          return (
            <li key={e} className="flex min-w-0 flex-col items-center gap-1 text-center">
              <span className={PASTILLE[ton]} aria-hidden>
                {ton === "faite" ? (
                  <Icone nom="coche" className="h-3 w-3" />
                ) : ton === "echec" ? (
                  <Icone nom="croix" className="h-3 w-3" />
                ) : (
                  <span className="text-[10px]">{i + 1}</span>
                )}
              </span>
              <span className={TEXTE[ton]}>{etat.echec && i === rang ? "Échec" : LIBELLE_ETAPE[e]}</span>
            </li>
          );
        })}
      </ol>

      {etat.fini && !etat.echec && (
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-100">
            {classement && <span>{classement}</span>}
            {resultat && <span className="text-slate-300">· {resultat}</span>}
            {d && <span className="text-xs text-slate-500">· {d}</span>}
          </p>
          {appel.resume && <p className="break-words text-xs leading-relaxed text-slate-300">{appel.resume}</p>}
        </div>
      )}

      {appel.erreur_message && (
        <div role="alert" className="space-y-2 rounded-xl bg-rose-500/10 px-3.5 py-3 ring-1 ring-rose-400/20">
          <p className="break-words text-xs leading-relaxed text-rose-200">{appel.erreur_message}</p>
          {conseil && (
            <div>
              <p className="text-xs font-medium text-slate-100">{conseil.titre} — que faire :</p>
              <ol className="mt-1 list-inside list-decimal space-y-1 text-xs leading-relaxed text-slate-300">
                {conseil.etapes.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {appel.transcription.length > 0 && (
        <details className="group/transcription" open={etat.fini}>
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-slate-400 transition hover:text-slate-200 [&::-webkit-details-marker]:hidden">
            <Icone nom="chevron" className="h-3 w-3 transition-transform group-open/transcription:rotate-180" />
            Transcription ({appel.transcription.length} réplique{appel.transcription.length > 1 ? "s" : ""})
          </summary>
          <div className="mt-2">
            <ListeRepliques repliques={appel.transcription} />
          </div>
        </details>
      )}
    </div>
  );
}
