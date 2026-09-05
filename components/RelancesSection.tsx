"use client";

import { useRef, useState, useTransition } from "react";
import { createTaskAction } from "@/app/actions";
import { DateField } from "@/components/DateField";
import { Icone } from "@/components/ui";
import type { TaskWithProspect } from "@/components/TaskRow";
import {
  MessageErreur,
  TaskRows,
  useOptimisticTasks,
} from "@/components/TaskList";
import { dateInputToISO } from "@/lib/time";

/**
 * Les relances de la fiche : la liste ouverte, le formulaire pour en poser une
 * nouvelle, et les relances passées.
 *
 * Les deux partagent le même état optimiste — sans quoi une relance
 * fraîchement planifiée n'apparaîtrait qu'après l'aller-retour serveur.
 * Elle s'ajoute donc à sa place (la liste est triée par échéance) dès la
 * validation, sans commandes tant que le serveur ne lui a pas donné son
 * identifiant : on ne coche pas une relance qui n'existe pas encore.
 *
 * Contrairement au tableau « À faire », cette liste montre TOUTES les relances
 * ouvertes quelle que soit leur date — une relance au 14 octobre y a donc bien
 * sa place tout de suite.
 *
 * Ici, la PREMIÈRE ligne se LIT : « Fait » et « Relancer » vivent dans la
 * carte PROCHAINE ACTION, un geste à un seul endroit. Une deuxième relance,
 * rare, garde ses commandes ici — parce qu'À faire ne la montrera qu'à sa
 * date : sans elles, une relance ouverte au 14 octobre ne serait modifiable
 * nulle part.
 */
export function RelancesSection({
  prospectId,
  openTasks,
}: {
  prospectId: string;
  openTasks: TaskWithProspect[];
}) {
  const { vue, erreur, setErreur, enCours, geste } = useOptimisticTasks(openTasks);
  const [provisoires, setProvisoires] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function planifier(fd: FormData) {
    const titre = String(fd.get("title") ?? "").trim();
    const dueLocal = String(fd.get("due_local") ?? "");
    // Même conversion que le serveur : « YYYY-MM-DD » vaut 09:00 à Bruxelles.
    const due = dateInputToISO(dueLocal || null);
    if (!titre || !due) {
      setErreur("Indiquez ce qu'il faut faire, et pour quand.");
      return;
    }

    const idProvisoire = `provisoire-${Date.now()}`;
    setProvisoires((s) => new Set(s).add(idProvisoire));
    formRef.current?.reset();

    geste(
      idProvisoire,
      {
        type: "ajoute",
        tache: {
          id: idProvisoire,
          title: titre,
          details: null,
          due_at: due,
          status: "a_faire",
          priority: Number(fd.get("priority") ?? 2),
          prospect_id: prospectId,
          prospects: null,
        },
      },
      async () => {
        const res = await createTaskAction(fd);
        startTransition(() =>
          setProvisoires((s) => {
            const n = new Set(s);
            n.delete(idProvisoire);
            return n;
          })
        );
        return res;
      }
    );
  }

  return (
    <>
      <MessageErreur message={erreur} />

      {vue.length === 0 ? (
        <p className="card px-5 py-6 text-center text-sm text-slate-500">
          Aucune relance planifiée.
        </p>
      ) : (
        <ul className="card divide-y divide-white/[0.05]">
          <TaskRows
            vue={vue}
            enCours={enCours}
            geste={geste}
            compact
            lecture={(i) => i === 0}
            provisoires={provisoires}
          />
        </ul>
      )}

      <details className="group mt-3">
        <summary className="btn-link cursor-pointer list-none text-xs">
          {/* Le ＋ pivote en ✕ une fois le formulaire ouvert : l'état du bloc
              se lit sur son propre bouton. */}
          <Icone
            nom="plus"
            className="h-3 w-3 transition-transform group-open:rotate-45"
          />
          Planifier une relance
        </summary>
        <form ref={formRef} action={planifier} className="card mt-2 space-y-3 p-5">
          <input type="hidden" name="prospect_id" value={prospectId} />
          <div>
            <label className="label" htmlFor="title">
              Quoi faire
            </label>
            <input
              id="title"
              name="title"
              required
              className="input"
              placeholder="Relancer pour le devis"
            />
          </div>
          <div>
            <span className="label">Quand</span>
            <DateField name="due_local" required compact />
          </div>
          <div>
            <label className="label" htmlFor="priority">
              Priorité
            </label>
            <select id="priority" name="priority" defaultValue="2" className="input">
              <option value="1">Haute</option>
              <option value="2">Normale</option>
              <option value="3">Basse</option>
            </select>
          </div>
          <button type="submit" className="btn-primary w-full">
            Planifier
          </button>
        </form>
      </details>
    </>
  );
}
