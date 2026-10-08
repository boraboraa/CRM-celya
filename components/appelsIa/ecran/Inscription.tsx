"use client";

import { useState, useTransition } from "react";
import { rattrapageAction } from "@/app/appels-ia-actions";
import { Interrupteur } from "./Interrupteur";
import { Retour } from "./commun";

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/**
 * L'inscription automatique, et le rattrapage des fiches déjà là.
 *
 * L'inscription automatique ne vaut que pour les NOUVELLES fiches (ou celles
 * qui reçoivent un numéro après coup). Les fiches « À appeler » qui existaient
 * avant passent par le rattrapage — jamais en silence : le bouton COMPTE
 * d'abord (relu au clic, la valeur de la page peut avoir vieilli), annonce le
 * nombre, et n'inscrit qu'après un « oui ».
 */
export function Inscription({
  valeur,
  allumeeParAutre,
  rattrapage,
  modeTest,
}: {
  valeur: boolean;
  /** Le nom de l'admin qui l'a allumée, si ce n'est pas vous. */
  allumeeParAutre: string | null;
  /** Combien de vos fiches le rattrapage inscrirait (null : illisible). */
  rattrapage: number | null;
  modeTest: boolean;
}) {
  const [enCours, startTransition] = useTransition();
  const [aConfirmer, setAConfirmer] = useState<number | null>(null);
  const [etat, setEtat] = useState<{ ok?: boolean; error?: string; message?: string }>();

  function compter() {
    setEtat(undefined);
    startTransition(async () => {
      const res = await rattrapageAction(false);
      if (res.error) {
        setEtat({ error: res.error });
        return;
      }
      const n = res.nombre ?? 0;
      if (n === 0) {
        setAConfirmer(null);
        setEtat({ ok: true, message: "Plus aucune fiche à inscrire : elles sont déjà dans la file, ou ne remplissent plus les conditions." });
        return;
      }
      setAConfirmer(n);
    });
  }

  function confirmer() {
    startTransition(async () => {
      const res = await rattrapageAction(true);
      setAConfirmer(null);
      setEtat(res.error ? { error: res.error } : { ok: true, message: res.message });
    });
  }

  return (
    <div className="space-y-5">
      <Interrupteur
        champ="inscription_auto"
        valeur={valeur}
        libelle="Inscription automatique"
        texteOui="Chaque nouvelle fiche qui remplit les conditions entre dans la file, cinq minutes après sa création."
        texteNon="Aucune fiche n'entre seule dans la file : elles s'ajoutent depuis la fiche ou par le rattrapage."
      />

      <div className="rounded-xl bg-white/[0.03] px-3.5 py-3 text-xs leading-relaxed text-slate-400 ring-1 ring-white/[0.06]">
        <p className="mb-1 font-medium text-slate-300">À qui elle s&apos;applique</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li>aux fiches de l&apos;administrateur qui l&apos;allume — jamais à celles des commerciaux ;</li>
          <li>en « À appeler » ;</li>
          <li>avec un numéro belge appelable (ni surtaxé, ni 070/077/078) ;</li>
          <li>sans rendez-vous à venir ;</li>
          <li>hors liste d&apos;opposition ;</li>
          <li>jamais passées par la file de Janet dans le mode actuel (test ou réel).</li>
        </ul>
        {valeur && allumeeParAutre && (
          <p className="mt-2 text-amber-300">
            Allumée par {allumeeParAutre} : ce sont ses fiches qui entrent dans la file. La couper puis la
            rallumer la reporte sur les vôtres.
          </p>
        )}
      </div>

      <div className="border-t border-white/[0.06] pt-4">
        <p className="text-sm font-medium text-slate-100">Rattrapage</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
          {rattrapage === null
            ? "Le nombre de fiches à rattraper n'a pas pu être lu."
            : rattrapage === 0
              ? "Aucune de vos fiches « À appeler » n'attend d'être inscrite."
              : `${pluriel(rattrapage, "fiche")} « À appeler » déjà existante${rattrapage > 1 ? "s" : ""} ${
                  rattrapage > 1 ? "peuvent" : "peut"
                } entrer dans la file.`}
        </p>

        {aConfirmer === null ? (
          rattrapage !== 0 && (
            <button type="button" onClick={compter} disabled={enCours} className="btn-ghost mt-3 px-3 py-1.5 text-xs">
              {enCours ? "Comptage…" : "Inscrire ces fiches…"}
            </button>
          )
        ) : (
          <div className="mt-3 rounded-xl bg-amber-500/[0.08] px-3.5 py-3 ring-1 ring-amber-400/25">
            <p className="text-xs leading-relaxed text-amber-200">
              {pluriel(aConfirmer, "fiche")} {aConfirmer > 1 ? "vont entrer" : "va entrer"} dans la file
              {modeTest
                ? " en mode test : Janet appellera votre GSM avec leur brief, rien ne sera écrit sur les fiches."
                : " : Janet appellera leurs vrais numéros, dans la fenêtre d'appel, trois essais au plus."}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <button type="button" onClick={confirmer} disabled={enCours} className="btn-ghost px-3 py-1.5 text-xs">
                {enCours ? "Inscription…" : `Inscrire ${pluriel(aConfirmer, "fiche")}`}
              </button>
              <button type="button" onClick={() => setAConfirmer(null)} disabled={enCours} className="btn-link text-xs">
                Annuler
              </button>
            </div>
          </div>
        )}

        <div className="mt-3">
          <Retour etat={etat} />
        </div>
      </div>
    </div>
  );
}
