"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  completeTaskAction,
  rescheduleTaskAction,
  deleteTaskAction,
} from "@/app/actions";
import { TaskRow, type TaskWithProspect } from "@/components/TaskRow";

/**
 * L'état optimiste d'une liste de relances, et les trois gestes qui la
 * modifient.
 *
 * Tout est OPTIMISTE : cocher une relance la retire immédiatement, la reporter
 * affiche tout de suite la nouvelle date, la supprimer la fait disparaître. Le
 * serveur travaille pendant ce temps ; s'il refuse, `useOptimistic` rend la
 * main à la donnée serveur à la fin de la transition — la ligne réapparaît
 * telle qu'elle était et le message dit pourquoi. Avant, cocher une relance
 * immobilisait l'écran le temps de l'aller-retour.
 */

export type PatchRelance =
  | { type: "fait"; id: string }
  | { type: "reporte"; id: string; due_at: string }
  | { type: "supprime"; id: string }
  | { type: "ajoute"; tache: TaskWithProspect };

function appliquerPatch(
  taches: TaskWithProspect[],
  patch: PatchRelance
): TaskWithProspect[] {
  switch (patch.type) {
    case "supprime":
    case "fait":
      // La ligne quitte la liste où elle était : relances ouvertes et relances
      // passées ne se mélangent pas.
      return taches.filter((t) => t.id !== patch.id);
    case "reporte":
      return taches
        .map((t) => (t.id === patch.id ? { ...t, due_at: patch.due_at } : t))
        .sort((a, b) => a.due_at.localeCompare(b.due_at));
    case "ajoute":
      return [...taches, patch.tache].sort((a, b) =>
        a.due_at.localeCompare(b.due_at)
      );
  }
}

export function useOptimisticTasks(tasks: TaskWithProspect[]) {
  const [vue, appliquer] = useOptimistic(tasks, appliquerPatch);
  const [erreur, setErreur] = useState<string>();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /** Un geste : on peint d'abord, on enregistre ensuite. */
  function geste(
    id: string,
    patch: PatchRelance,
    action: () => Promise<{ error?: string } | void>
  ) {
    setErreur(undefined);
    setEnCours(id);
    startTransition(async () => {
      appliquer(patch);
      try {
        const res = await action();
        if (res && "error" in res && res.error) setErreur(res.error);
      } catch {
        setErreur("Action impossible pour l'instant. Réessayez.");
      } finally {
        setEnCours(null);
      }
    });
  }

  return { vue, erreur, setErreur, enCours, geste };
}

/** Les champs communs aux trois gestes. */
export function champsRelance(
  t: TaskWithProspect,
  extra: Record<string, string> = {}
) {
  const fd = new FormData();
  fd.set("id", t.id);
  fd.set("prospect_id", t.prospect_id ?? "");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

export function MessageErreur({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mb-2 rounded-xl bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300 ring-1 ring-rose-400/20"
    >
      {message}
    </p>
  );
}

/**
 * Les lignes de relance, branchées sur l'état optimiste. `provisoires` liste
 * les identifiants encore inconnus du serveur : ces lignes s'affichent, mais
 * sans commandes — on ne coche pas une relance qui n'existe pas encore.
 *
 * `lecture` traverse jusqu'à `TaskRow`, qui n'affiche alors plus aucune
 * commande. Elle se décide ligne par ligne (`(index) => boolean`) : sur la
 * fiche, seule la PREMIÈRE relance se lit — c'est celle que pilote la carte
 * PROCHAINE ACTION. Les rappels restent branchés : c'est la ligne qui les
 * ignore, et l'état optimiste reste le même des deux côtés.
 */
type Geste = ReturnType<typeof useOptimisticTasks>["geste"];

export function TaskRows({
  vue,
  enCours,
  geste,
  compact,
  lecture,
  provisoires,
}: {
  vue: TaskWithProspect[];
  enCours: string | null;
  geste: Geste;
  compact?: boolean;
  /**
   * Lecture seule : la ligne se lit, les gestes vivent ailleurs. En fonction,
   * elle se décide ligne par ligne à partir du rang dans la liste.
   */
  lecture?: boolean | ((index: number) => boolean);
  /** Identifiants pas encore connus du serveur (lignes provisoires). */
  provisoires?: Set<string>;
}) {
  return (
    <>
      {vue.map((t, i) => {
        const provisoire = provisoires?.has(t.id) ?? false;
        const enLecture =
          typeof lecture === "function" ? lecture(i) : Boolean(lecture);
        return (
          <TaskRow
            key={t.id}
            task={t}
            compact={compact}
            lecture={enLecture}
            pending={enCours === t.id || provisoire}
            onComplete={
              provisoire
                ? undefined
                : () =>
                    geste(t.id, { type: "fait", id: t.id }, () =>
                      completeTaskAction(
                        champsRelance(t, {
                          done: t.status === "fait" ? "0" : "1",
                        })
                      )
                    )
            }
            onReschedule={
              provisoire
                ? undefined
                : (dueLocal, dueISO) =>
                    geste(
                      t.id,
                      { type: "reporte", id: t.id, due_at: dueISO },
                      () =>
                        rescheduleTaskAction(
                          champsRelance(t, { due_local: dueLocal })
                        )
                    )
            }
            onDelete={
              provisoire
                ? undefined
                : () =>
                    geste(t.id, { type: "supprime", id: t.id }, () =>
                      deleteTaskAction(champsRelance(t))
                    )
            }
          />
        );
      })}
    </>
  );
}

/**
 * La liste seule — dashboard, et relances passées de la fiche. Ses lignes
 * gardent toujours leurs commandes : une relance passée se rouvre d'un clic.
 */
export function TaskList({
  tasks,
  compact = false,
  className = "card divide-y divide-white/[0.05]",
}: {
  tasks: TaskWithProspect[];
  compact?: boolean;
  className?: string;
}) {
  const { vue, erreur, enCours, geste } = useOptimisticTasks(tasks);

  if (vue.length === 0) return null;

  return (
    <>
      <MessageErreur message={erreur} />
      <ul className={className}>
        <TaskRows vue={vue} enCours={enCours} geste={geste} compact={compact} />
      </ul>
    </>
  );
}
