"use client";

import { useState, useTransition } from "react";
import { appelTestAction, type EtatAction } from "@/app/appels-ia-actions";
import { Icone } from "@/components/ui";
import { Retour } from "./commun";

/** Un identifiant de fiche dans ce que l'admin a collé : l'uuid seul, ou un lien `/prospects/<uuid>`. */
function uuidDans(texte: string): string | null {
  const m = texte.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : null;
}

/**
 * « Appel de test vers mon GSM » — le geste principal de l'écran.
 *
 * Janet appelle le GSM de test, avec le brief d'une fiche fictive (par défaut)
 * ou d'une fiche précise. Toujours en mode test : rien n'est écrit sur la
 * fiche. Pas optimiste, et c'est voulu : ce qu'on attend, c'est la réponse du
 * moteur (il compose, ou il dit pourquoi pas) — l'écran ne peut pas la deviner.
 */
export function AppelTest({
  gsm,
  bloque,
}: {
  /** Le GSM de test, lisible (« 0470 12 34 56 »), ou null s'il n'est pas réglé. */
  gsm: string | null;
  /** Pourquoi le bouton ne peut pas partir (numéro appelant, GSM, appel en cours), ou null. */
  bloque: string | null;
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
      setEtat(await appelTestAction(prospectId));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={lancer}
          disabled={enCours || Boolean(bloque)}
          className="btn-primary"
        >
          <Icone nom="telephone" className="h-4 w-4" />
          {enCours ? "Lancement…" : "Appel de test vers mon GSM"}
        </button>
        {gsm && <span className="text-xs text-slate-400">vers le {gsm}</span>}
      </div>

      {bloque && (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-300">
          <Icone nom="alerte" className="mt-0.5 h-3 w-3" />
          <span className="min-w-0">{bloque}</span>
        </p>
      )}

      <fieldset className="min-w-0 space-y-2">
        <legend className="label">Janet lit le brief de</legend>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="radio"
            name="source-test"
            checked={source === "fictive"}
            onChange={() => setSource("fictive")}
            className="accent-celya-blue"
          />
          une fiche fictive
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
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

      <Retour etat={etat} />

      <p className="text-[11px] leading-relaxed text-slate-500">
        L&apos;appel de test ignore l&apos;interrupteur général et la fenêtre d&apos;appel, jamais les
        plafonds ni le numéro appelant. Rien n&apos;est écrit sur la fiche.
      </p>
    </div>
  );
}
