"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { appelTestAction, type EtatAction } from "@/app/appels-ia-actions";
import type { AppelDetail } from "@/lib/appelsIa/lectures";
import { Icone } from "@/components/ui";
import { Retour } from "./commun";
import { SuiviAppel } from "./SuiviAppel";

/** Un identifiant de fiche dans ce que l'admin a collé : l'uuid seul, ou un lien `/prospects/<uuid>`. */
function uuidDans(texte: string): string | null {
  const m = texte.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : null;
}

/**
 * « Appeler mon GSM (test) » — la dernière marche de la mise en route.
 *
 * Grisé, il dit TOUT ce qui manque (`refusAppelTest`, lib/appelsIa/ecran.ts —
 * la même phrase que l'action serveur, qui refuse de toute façon). Lancé, il
 * montre l'appel en direct, puis le résultat et la transcription, ou l'échec
 * en français avec la marche à suivre (`SuiviAppel`).
 *
 * Janet lit le brief d'une fiche fictive (par défaut) ou d'une fiche précise.
 * Toujours en mode test : rien n'est écrit sur la fiche. Pas optimiste, et
 * c'est voulu : ce qu'on attend, c'est la réponse du moteur.
 */
export function AppelTest({
  gsm,
  bloque,
  suivi,
  reussi,
}: {
  /** Le GSM de test, lisible (« 0470 12 34 56 »), ou null s'il n'est pas réglé. */
  gsm: string | null;
  /** Pourquoi le bouton ne peut pas partir — tout ce qui manque — ou null. */
  bloque: string | null;
  /** Le dernier appel de test, à suivre (ou à relire), ou null. */
  suivi: AppelDetail | null;
  /** Un appel de test a déjà réussi : la mise en route est faite. */
  reussi: boolean;
}) {
  const [enCours, startTransition] = useTransition();
  const [source, setSource] = useState<"fictive" | "fiche">("fictive");
  const [saisie, setSaisie] = useState("");
  const [etat, setEtat] = useState<EtatAction>();

  function lancer() {
    let prospectId: string | null = null;
    if (source === "fiche") {
      prospectId = uuidDans(saisie);
      if (!prospectId) {
        setEtat({ error: "Collez le lien de la fiche (ou son identifiant) : aucun identifiant de fiche n'y a été trouvé." });
        return;
      }
    }
    setEtat(undefined);
    startTransition(async () => {
      // L'action revalide la page : le nouvel appel revient en `suivi`, et
      // son suivi en direct démarre de lui-même.
      const res = await appelTestAction(prospectId);
      setEtat(res.ok ? undefined : res);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={lancer} disabled={enCours || Boolean(bloque)} className="btn-primary">
          <Icone nom="telephone" className="h-4 w-4" />
          {enCours ? "Lancement…" : "Appeler mon GSM (test)"}
        </button>
        {gsm && <span className="text-xs text-slate-400">vers le {gsm}</span>}
      </div>

      {bloque && (
        <p id="appel-test-bloque" className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-300">
          <Icone nom="alerte" className="mt-0.5 h-3 w-3" />
          <span className="min-w-0">{bloque}</span>
        </p>
      )}

      <Retour etat={etat} />

      {suivi && <SuiviAppel initial={suivi} />}

      {reussi && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-500/10 px-3.5 py-3 ring-1 ring-emerald-400/20">
          <p className="flex items-center gap-2 text-sm text-emerald-200">
            <Icone nom="coche" className="h-4 w-4" />
            Mise en route terminée : Janet a déjà appelé votre GSM sans erreur.
          </p>
          <Link href="/appels-ia?onglet=campagnes" className="btn-primary px-3.5 py-2 text-sm">
            Lancer une campagne →
          </Link>
        </div>
      )}

      <details className="group/source">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-slate-400 transition hover:text-slate-200 [&::-webkit-details-marker]:hidden">
          <Icone nom="chevron" className="h-3 w-3 transition-transform group-open/source:rotate-180" />
          Janet lit le brief {source === "fictive" ? "d'une fiche fictive" : "d'une de vos fiches"}
        </summary>
        <fieldset className="mt-3 min-w-0 space-y-2">
          <legend className="sr-only">Janet lit le brief de</legend>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-300 sm:min-h-0">
            <input
              type="radio"
              name="source-test"
              checked={source === "fictive"}
              onChange={() => setSource("fictive")}
              className="accent-celya-blue"
            />
            une fiche fictive
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-300 sm:min-h-0">
            <input
              type="radio"
              name="source-test"
              checked={source === "fiche"}
              onChange={() => setSource("fiche")}
              className="accent-celya-blue"
            />
            une de vos fiches
          </label>
          {source === "fiche" && (
            <div>
              <input
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                className="input"
                placeholder="Lien de la fiche (…/prospects/…) ou son identifiant"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                Ouvrez la fiche et copiez l&apos;adresse de la page. Le numéro de la fiche n&apos;est pas
                composé : seul son brief sert.
              </p>
            </div>
          )}
        </fieldset>
      </details>

      <p className="text-[11px] leading-relaxed text-slate-500">
        L&apos;appel de test ignore l&apos;interrupteur général et la fenêtre d&apos;appel, jamais les
        plafonds ni le numéro appelant. Rien n&apos;est écrit sur la fiche.
      </p>
    </div>
  );
}
