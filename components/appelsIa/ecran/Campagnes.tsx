"use client";

import { useOptimistic, useState, useTransition } from "react";
import { creerCampagneAction, statutCampagneAction } from "@/app/appels-ia-actions";
import { Retour } from "./commun";
import { useFormulaire } from "./formulaire";

type StatutCampagne = "active" | "pause" | "terminee";

export type CampagneVue = {
  id: string;
  nom: string;
  statut: StatutCampagne;
  systeme: string | null;
  enAttente: number;
  termine: number;
  creeLe: string;
};

/** Classes entières (règle JIT) : bleu = normal, ambre = en pause, neutre = terminée. */
const CHIP: Record<StatutCampagne, string> = {
  active: "chip bg-celya-blue/15 text-blue-200 ring-blue-400/30",
  pause: "chip bg-amber-500/15 text-amber-300 ring-amber-400/25",
  terminee: "chip bg-white/[0.04] text-slate-400 ring-white/10",
};
const LIBELLE: Record<StatutCampagne, string> = {
  active: "Active",
  pause: "En pause",
  terminee: "Terminée",
};
const SYSTEME: Record<string, string> = {
  auto: "inscription automatique",
  fiche: "appels lancés depuis une fiche",
};

/**
 * Les campagnes. Une campagne en pause garde ses lignes, que le moteur ne
 * prend plus ; une campagne terminée arrête ses lignes en attente — c'est
 * définitif, d'où la confirmation. Les deux campagnes SYSTÈME (inscription
 * automatique, appels depuis une fiche) se mettent en pause, jamais ne se
 * terminent : la base le refuse, l'écran ne le propose pas.
 *
 * Optimiste : la puce change au clic, et revient si le serveur refuse.
 */
export function Campagnes({ campagnes }: { campagnes: CampagneVue[] }) {
  const creation = useFormulaire(creerCampagneAction, { viderSiOk: true });
  const [vue, appliquer] = useOptimistic(
    campagnes,
    (liste: CampagneVue[], p: { id: string; statut: StatutCampagne }) =>
      liste.map((c) => (c.id === p.id ? { ...c, statut: p.statut } : c))
  );
  const [enCours, startTransition] = useTransition();
  const [aTerminer, setATerminer] = useState<string | null>(null);
  const [erreur, setErreur] = useState<{ id: string; message: string } | null>(null);

  function changer(id: string, statut: StatutCampagne) {
    setATerminer(null);
    setErreur(null);
    startTransition(async () => {
      appliquer({ id, statut });
      const res = await statutCampagneAction(id, statut);
      if (res?.error) setErreur({ id, message: res.error });
    });
  }

  return (
    <div className="space-y-4">
      <form ref={creation.ref} onSubmit={creation.onSubmit} className="flex flex-wrap gap-2">
        <label htmlFor="nouvelle-campagne" className="sr-only">
          Nom de la nouvelle campagne
        </label>
        <input
          id="nouvelle-campagne"
          name="nom"
          required
          maxLength={120}
          placeholder="Nom d'une nouvelle campagne"
          className="input min-w-0 flex-1 basis-48"
        />
        <button type="submit" disabled={creation.enCours} className="btn-ghost shrink-0 px-3 py-2 text-xs">
          {creation.enCours ? "Création…" : "Créer"}
        </button>
      </form>
      <Retour etat={creation.etat} />

      {vue.length === 0 ? (
        <p className="text-xs text-slate-500">
          Aucune campagne pour l&apos;instant : la première naît avec la première fiche inscrite.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {vue.map((c) => (
            <li key={c.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm text-slate-100">{c.nom}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {c.systeme ? `Système — ${SYSTEME[c.systeme] ?? c.systeme}` : `Créée le ${c.creeLe}`}
                    {" · "}
                    {c.enAttente} en file · {c.termine} terminée{c.termine > 1 ? "s" : ""}
                  </p>
                </div>
                <span className={CHIP[c.statut]}>{LIBELLE[c.statut]}</span>
              </div>

              {c.statut !== "terminee" && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {c.statut === "active" ? (
                    <button
                      type="button"
                      onClick={() => changer(c.id, "pause")}
                      disabled={enCours}
                      className="btn-ghost px-2.5 py-1 text-[11px]"
                    >
                      Mettre en pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => changer(c.id, "active")}
                      disabled={enCours}
                      className="btn-ghost px-2.5 py-1 text-[11px]"
                    >
                      Reprendre
                    </button>
                  )}
                  {!c.systeme && (
                    <button
                      type="button"
                      onClick={() => setATerminer(aTerminer === c.id ? null : c.id)}
                      disabled={enCours}
                      className="btn-link text-[11px] hover:text-rose-300"
                    >
                      Terminer…
                    </button>
                  )}
                </div>
              )}

              {aTerminer === c.id && (
                <div className="mt-2.5 rounded-xl bg-rose-500/[0.08] px-3.5 py-3 ring-1 ring-rose-400/20">
                  <p className="text-xs leading-relaxed text-rose-200">
                    Terminer « {c.nom} » ?{" "}
                    {c.enAttente > 0
                      ? `Ses ${c.enAttente} ligne${c.enAttente > 1 ? "s" : ""} en attente seront arrêtée${
                          c.enAttente > 1 ? "s" : ""
                        }.`
                      : "Elle n'a plus rien en attente."}{" "}
                    C&apos;est définitif.
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => changer(c.id, "terminee")} className="btn-danger px-3 py-1.5 text-xs">
                      Terminer la campagne
                    </button>
                    <button type="button" onClick={() => setATerminer(null)} className="btn-link text-xs">
                      Annuler
                    </button>
                  </div>
                </div>
              )}

              {erreur?.id === c.id && (
                <div className="mt-2">
                  <Retour etat={{ error: erreur.message }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
