"use client";

import { useOptimistic, useState, useTransition } from "react";
import { statutCampagneAction } from "@/app/appels-ia-actions";
import type { ProgressionCampagne } from "@/lib/appelsIa/lectures";
import { Icone } from "@/components/ui";
import { AssistantCampagne, type ReglagesAssistant } from "./AssistantCampagne";
import { Retour } from "./commun";

type StatutCampagne = "active" | "pause" | "terminee";

export type CampagneVue = {
  id: string;
  nom: string;
  statut: StatutCampagne;
  systeme: string | null;
  creeLe: string;
  progression: ProgressionCampagne;
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

const CHIFFRES: { cle: keyof ProgressionCampagne; libelle: string }[] = [
  { cle: "enFile", libelle: "en file" },
  { cle: "appelees", libelle: "appelées" },
  { cle: "decrochees", libelle: "décrochées" },
  { cle: "rdv", libelle: "RDV posés" },
  { cle: "aRappeler", libelle: "à rappeler" },
  { cle: "refus", libelle: "refus" },
];

/**
 * Les campagnes, une carte chacune : statut, progression, Pause / Reprendre,
 * « Ajouter des fiches », « Terminer ». Et le bouton « Nouvelle campagne »,
 * qui ouvre l'assistant.
 *
 * Une campagne en pause garde ses lignes, que le moteur ne prend plus ; une
 * campagne terminée arrête ses lignes en attente — c'est définitif, d'où la
 * confirmation. Les deux campagnes SYSTÈME (inscription automatique, appels
 * depuis une fiche) se mettent en pause, jamais ne se terminent : la base le
 * refuse, l'écran ne le propose pas.
 *
 * Optimiste : la puce change au clic, et revient si le serveur refuse.
 */
export function Campagnes({
  campagnes,
  assistant,
}: {
  campagnes: CampagneVue[];
  assistant: {
    membres: { id: string; nom: string }[];
    moiId: string;
    reglages: ReglagesAssistant;
    testReussi: boolean;
    /** Pourquoi « Lancer » est bloqué (numéro, connexion, test réussi), ou null. */
    refusLancement: string | null;
    confirmationTest: string;
    confirmationReel: string;
  };
}) {
  const [vue, appliquer] = useOptimistic(
    campagnes,
    (liste: CampagneVue[], p: { id: string; statut: StatutCampagne }) =>
      liste.map((c) => (c.id === p.id ? { ...c, statut: p.statut } : c))
  );
  const [enCours, startTransition] = useTransition();
  const [aTerminer, setATerminer] = useState<string | null>(null);
  const [erreur, setErreur] = useState<{ id: string; message: string } | null>(null);
  /** L'assistant : fermé, ouvert pour une nouvelle campagne (null), ou pour en compléter une. */
  const [ouvert, setOuvert] = useState(false);
  const [cible, setCible] = useState<{ id: string; nom: string } | null>(null);

  function changer(id: string, statut: StatutCampagne) {
    setATerminer(null);
    setErreur(null);
    startTransition(async () => {
      appliquer({ id, statut });
      const res = await statutCampagneAction(id, statut);
      if (res?.error) setErreur({ id, message: res.error });
    });
  }

  function ouvrir(c: { id: string; nom: string } | null) {
    setCible(c);
    setOuvert(true);
  }

  return (
    <div className="space-y-4">
      {!ouvert && (
        <button type="button" onClick={() => ouvrir(null)} className="btn-primary">
          <Icone nom="plus" className="h-4 w-4" />
          Nouvelle campagne
        </button>
      )}

      <AssistantCampagne ouvert={ouvert} onFermer={() => setOuvert(false)} campagne={cible} {...assistant} />

      {vue.length === 0 ? (
        <p className="text-sm text-slate-500">
          Aucune campagne pour l&apos;instant. « Nouvelle campagne » : un nom, les fiches à appeler, et Janet s&apos;y met.
        </p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {vue.map((c) => (
            <li key={c.id} className="card min-w-0 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-medium text-slate-100">{c.nom}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {c.systeme ? `Système — ${SYSTEME[c.systeme] ?? c.systeme}` : `Créée le ${c.creeLe}`}
                  </p>
                </div>
                <span className={CHIP[c.statut]}>{LIBELLE[c.statut]}</span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-white/[0.06] sm:grid-cols-6">
                {CHIFFRES.map((x) => (
                  <p key={x.cle} className="bg-space px-2 py-2">
                    <span className="block font-display text-base font-semibold text-slate-100">{c.progression[x.cle]}</span>
                    <span className="block text-[10px] text-slate-500">{x.libelle}</span>
                  </p>
                ))}
              </div>

              {c.statut !== "terminee" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {c.statut === "active" ? (
                    <button type="button" onClick={() => changer(c.id, "pause")} disabled={enCours} className="btn-ghost px-3 py-2 text-xs">
                      Mettre en pause
                    </button>
                  ) : (
                    <button type="button" onClick={() => changer(c.id, "active")} disabled={enCours} className="btn-ghost px-3 py-2 text-xs">
                      Reprendre
                    </button>
                  )}
                  {!c.systeme && (
                    <>
                      <button type="button" onClick={() => ouvrir({ id: c.id, nom: c.nom })} className="btn-ghost px-3 py-2 text-xs">
                        <Icone nom="plus" className="h-3 w-3" />
                        Ajouter des fiches
                      </button>
                      <button
                        type="button"
                        onClick={() => setATerminer(aTerminer === c.id ? null : c.id)}
                        disabled={enCours}
                        className="btn-link px-2 py-2 text-xs hover:text-rose-300"
                      >
                        Terminer…
                      </button>
                    </>
                  )}
                </div>
              )}

              {aTerminer === c.id && (
                <div className="mt-2.5 rounded-xl bg-rose-500/[0.08] px-3.5 py-3 ring-1 ring-rose-400/20">
                  <p className="text-xs leading-relaxed text-rose-200">
                    Terminer « {c.nom} » ?{" "}
                    {c.progression.enFile > 0
                      ? `Ses ${c.progression.enFile} fiche${c.progression.enFile > 1 ? "s" : ""} en file ne seront plus appelée${
                          c.progression.enFile > 1 ? "s" : ""
                        }.`
                      : "Elle n'a plus rien en file."}{" "}
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
