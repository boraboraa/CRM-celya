"use client";

import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import {
  completeTaskAction,
  rescheduleTaskAction,
  deleteTaskAction,
} from "@/app/actions";
import { TaskRow, type TaskWithProspect } from "@/components/TaskRow";
import {
  annuler as annulerGeste,
  avancer,
  demarrer,
  echec,
  finRetour,
  gesteDeLaCase,
  oublierPartis,
  valeurDone,
  vider,
  vueStable,
  type GesteLigne,
  type SensCase,
  type TypeGeste,
} from "@/lib/crm/gesteRelance";

/**
 * L'état d'une liste de relances, et les gestes qui la modifient — UN hook,
 * `useGesteRelance` (3/11 : il remplace `useOptimisticTasks`).
 *
 * Deux familles de gestes :
 * - **cocher, rouvrir, supprimer** passent par `lib/crm/gesteRelance.ts` : la
 *   ligne RESTE à sa place, barrée, avec « Annuler » ~1,5 s, puis se replie.
 *   Un second tap sur une ligne engagée est ignoré ; la case d'une relance
 *   ouverte ne sait que « faire » (jamais « rouvrir ») ;
 * - **reporter, ajouter** restent optimistes (`useOptimistic`) : la nouvelle
 *   date ou la nouvelle ligne s'affiche tout de suite, et revient seule si le
 *   serveur refuse.
 *
 * `enCours` est un ENSEMBLE : deux gestes rapprochés sur deux lignes ont
 * chacun leur indicateur (avec un seul identifiant, la fin du premier effaçait
 * celui du second).
 */

export type PatchRelance =
  | { type: "reporte"; id: string; due_at: string }
  | { type: "ajoute"; tache: TaskWithProspect };

function appliquerPatch(
  taches: TaskWithProspect[],
  patch: PatchRelance
): TaskWithProspect[] {
  switch (patch.type) {
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

type Reponse = { error?: string } | void;

/** L'écriture d'un geste de ligne (cocher, rouvrir, supprimer). */
function ecrire(type: TypeGeste, t: TaskWithProspect): Promise<Reponse> {
  if (type === "supprime") return deleteTaskAction(champsRelance(t));
  return completeTaskAction(champsRelance(t, { done: valeurDone(type) }));
}

export function useGesteRelance(tasks: TaskWithProspect[]) {
  const [optimiste, appliquer] = useOptimistic(tasks, appliquerPatch);
  const [erreur, setErreur] = useState<string>();
  const [enCours, setEnCours] = useState<ReadonlySet<string>>(new Set());
  const [gestes, setGestes] = useState<Map<string, GesteLigne<TaskWithProspect>>>(new Map());
  const [partis, setPartis] = useState<ReadonlySet<string>>(new Set());
  const [, startTransition] = useTransition();

  // La dernière valeur, pour les écouteurs (arrière-plan, démontage).
  const gestesRef = useRef(gestes);
  gestesRef.current = gestes;

  const marquer = useCallback((id: string, oui: boolean) => {
    setEnCours((s) => {
      const n = new Set(s);
      if (oui) n.add(id);
      else n.delete(id);
      return n;
    });
  }, []);

  /** Envoie l'écriture d'un geste ; un refus ramène la ligne, avec le message. */
  const envoyer = useCallback(
    (type: TypeGeste, t: TaskWithProspect, apres?: () => void) => {
      marquer(t.id, true);
      startTransition(async () => {
        try {
          const res = await ecrire(type, t);
          if (res && "error" in res && res.error) {
            setErreur(res.error);
            const r = echec(gestesRef.current, new Set(), t.id);
            setGestes(r.gestes);
            setPartis((p) => {
              const n = new Set(p);
              n.delete(t.id);
              return n;
            });
          }
        } catch {
          setErreur("Action impossible pour l'instant. Réessayez.");
          setGestes((g) => echec(g, new Set(), t.id).gestes);
          setPartis((p) => {
            const n = new Set(p);
            n.delete(t.id);
            return n;
          });
        } finally {
          marquer(t.id, false);
          apres?.();
        }
      });
    },
    [marquer]
  );

  // L'horloge : attente → repli → parti. Une minuterie, sur la prochaine échéance.
  useEffect(() => {
    if (gestes.size === 0) return;
    const r = avancer(gestes, partis, Date.now());
    if (r.prochain === null) return;
    const t = setTimeout(() => {
      const s = avancer(gestesRef.current, partis, Date.now());
      for (const g of s.aEnvoyer) envoyer(g.type, g.tache);
      setGestes(s.gestes);
      setPartis(s.partis);
    }, Math.max(0, r.prochain - Date.now()));
    return () => clearTimeout(t);
  }, [gestes, partis, envoyer]);

  // Arrière-plan ou démontage : les suppressions en attente partent TOUT DE SUITE.
  useEffect(() => {
    const viderMaintenant = () => {
      const r = vider(gestesRef.current);
      if (r.aEnvoyer.length === 0) return;
      gestesRef.current = r.gestes;
      setGestes(r.gestes);
      for (const g of r.aEnvoyer) void ecrire(g.type, g.tache);
    };
    const visibilite = () => {
      if (document.visibilityState === "hidden") viderMaintenant();
    };
    document.addEventListener("visibilitychange", visibilite);
    window.addEventListener("pagehide", viderMaintenant);
    return () => {
      document.removeEventListener("visibilitychange", visibilite);
      window.removeEventListener("pagehide", viderMaintenant);
      // Démontage (on quitte l'écran) : rien d'engagé ne se perd.
      for (const g of vider(gestesRef.current).aEnvoyer) void ecrire(g.type, g.tache);
    };
  }, []);

  // Les lignes parties que le serveur ne renvoie plus peuvent être oubliées.
  const partisUtiles = useMemo(() => oublierPartis(optimiste, partis), [optimiste, partis]);

  const vue = useMemo(() => vueStable(optimiste, gestes, partisUtiles), [optimiste, gestes, partisUtiles]);

  /** Cocher, rouvrir ou supprimer : la ligne s'engage, ou le tap est ignoré. */
  function geste(type: TypeGeste, t: TaskWithProspect) {
    // La place de la ligne : les lignes au-dessus, la plus proche d'abord.
    const index = vue.findIndex((l) => l.tache.id === t.id);
    const avant = vue
      .slice(0, index < 0 ? vue.length : index)
      .map((l) => l.tache.id)
      .reverse();
    const suite = demarrer(gestesRef.current, enCours, {
      id: t.id,
      type,
      avant,
      tache: t,
      maintenant: Date.now(),
    });
    if (!suite) return; // déjà engagée : un double tap ne fait rien de plus
    setErreur(undefined);
    gestesRef.current = suite;
    setGestes(suite);
    if (type !== "supprime") envoyer(type, t);
  }

  /** « Annuler » : rejoue l'inverse (ou retient une suppression pas encore partie). */
  function annuler(id: string) {
    const r = annulerGeste(gestesRef.current, id);
    if (!r) return;
    gestesRef.current = r.gestes;
    setGestes(r.gestes);
    const g = gestes.get(id);
    if (r.ecrire && g) {
      envoyer(r.ecrire, g.tache, () => setGestes((s) => finRetour(s, id)));
    }
  }

  /** Reporter ou ajouter : optimiste — on peint, puis on enregistre. */
  function optimisteGeste(
    id: string,
    patch: PatchRelance,
    action: () => Promise<Reponse>
  ) {
    if (enCours.has(id) || gestesRef.current.has(id)) return;
    setErreur(undefined);
    marquer(id, true);
    startTransition(async () => {
      appliquer(patch);
      try {
        const res = await action();
        if (res && "error" in res && res.error) setErreur(res.error);
      } catch {
        setErreur("Action impossible pour l'instant. Réessayez.");
      } finally {
        marquer(id, false);
      }
    });
  }

  return { vue, erreur, setErreur, enCours, geste, annuler, optimisteGeste };
}

/** Les champs communs aux gestes. */
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
 * Les lignes de relance, branchées sur `useGesteRelance`. `provisoires` liste
 * les identifiants encore inconnus du serveur : ces lignes s'affichent, mais
 * sans commandes — on ne coche pas une relance qui n'existe pas encore.
 *
 * `lecture` traverse jusqu'à `TaskRow`, qui n'affiche alors plus aucune
 * commande. Elle se décide ligne par ligne (`(index) => boolean`) : sur la
 * fiche, seule la PREMIÈRE relance se lit — c'est celle que pilote la carte
 * PROCHAINE ACTION.
 *
 * `sens` : ce que fait la case. « faire » sur les relances ouvertes (défaut),
 * « rouvrir » sur la liste des relances passées — jamais déduit du statut.
 */
type Etat = ReturnType<typeof useGesteRelance>;

export function TaskRows({
  etat,
  compact,
  lecture,
  provisoires,
  sens = "faire",
}: {
  etat: Etat;
  compact?: boolean;
  /**
   * Lecture seule : la ligne se lit, les gestes vivent ailleurs. En fonction,
   * elle se décide ligne par ligne à partir du rang dans la liste.
   */
  lecture?: boolean | ((index: number, task: TaskWithProspect) => boolean);
  /** Identifiants pas encore connus du serveur (lignes provisoires). */
  provisoires?: Set<string>;
  sens?: SensCase;
}) {
  const { vue, enCours, geste, annuler, optimisteGeste } = etat;
  return (
    <>
      {vue.map(({ tache: t, geste: g }, i) => {
        const provisoire = provisoires?.has(t.id) ?? false;
        const enLecture =
          typeof lecture === "function" ? lecture(i, t) : Boolean(lecture);
        return (
          <TaskRow
            key={t.id}
            task={t}
            compact={compact}
            lecture={enLecture}
            pending={enCours.has(t.id) || provisoire}
            geste={g ? { type: g.type, phase: g.phase } : undefined}
            onAnnuler={g?.phase === "attente" ? () => annuler(t.id) : undefined}
            onComplete={provisoire ? undefined : () => geste(gesteDeLaCase(sens), t)}
            onReschedule={
              provisoire
                ? undefined
                : (dueLocal, dueISO) =>
                    optimisteGeste(
                      t.id,
                      { type: "reporte", id: t.id, due_at: dueISO },
                      () =>
                        rescheduleTaskAction(
                          champsRelance(t, { due_local: dueLocal })
                        )
                    )
            }
            onDelete={provisoire ? undefined : () => geste("supprime", t)}
          />
        );
      })}
    </>
  );
}

/**
 * La liste seule — dashboard, et relances passées de la fiche (`sens =
 * "rouvrir"` : la case y rouvre, et ne sait faire que ça).
 */
export function TaskList({
  tasks,
  compact = false,
  className = "card divide-y divide-white/[0.05]",
  lecture,
  sens = "faire",
}: {
  tasks: TaskWithProspect[];
  compact?: boolean;
  className?: string;
  /**
   * Lecture seule. « À faire » s'en sert en périmètre d'équipe : la relance
   * d'un collègue se LIT (savoir qu'il l'a en main), elle ne se coche pas —
   * `tasks_update` la refuserait, et cocher la relance d'un autre déplacerait
   * SON « À faire ».
   *
   * UN BOOLÉEN OU DES IDENTIFIANTS — JAMAIS UNE FONCTION, et c'est le type qui
   * le tient. `TaskList` est un composant CLIENT que « À faire » rend depuis un
   * composant SERVEUR : une fonction ne franchit pas cette frontière, React la
   * refuse à la sérialisation du flux et toute la page tombe en « Application
   * error » (vécu le 21/09 — voir le piège dans CLAUDE.md). `TaskRows`, lui,
   * n'est appelé que depuis du client et garde la forme fonction.
   *
   * Le serveur envoie donc la LISTE des relances à lire, pas le prédicat qui
   * la calcule.
   */
  lecture?: boolean | string[];
  /** Ce que fait la case : « faire » (relances ouvertes) ou « rouvrir » (passées). */
  sens?: SensCase;
}) {
  const etat = useGesteRelance(tasks);

  if (etat.vue.length === 0) return null;

  // La closure naît ICI, du côté client de la frontière : elle ne traverse rien.
  const lues = Array.isArray(lecture) ? new Set(lecture) : null;

  return (
    <>
      <MessageErreur message={etat.erreur} />
      <ul className={className}>
        <TaskRows
          etat={etat}
          compact={compact}
          sens={sens}
          lecture={lues ? (_i, t) => lues.has(t.id) : Boolean(lecture)}
        />
      </ul>
    </>
  );
}
