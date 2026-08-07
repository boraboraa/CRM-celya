"use client";

import { useRef, useState, useTransition } from "react";
import { createTaskAction } from "@/app/actions";
import { DateField } from "@/components/DateField";

/**
 * « Nouvelle relance » du tableau À faire — une relance libre, avec ou sans
 * prospect.
 *
 * Pas d'ajout optimiste ici, et c'est volontaire : cet écran ne montre que ce
 * qui échoit AUJOURD'HUI ou avant. Une relance posée pour le 14 octobre n'y a
 * pas sa place — l'y faire apparaître une seconde serait un mensonge. Ce que
 * Bora obtient tout de suite, c'est le retour du geste : bouton en attente,
 * champ vidé, et la confirmation qui dit où la relance a atterri.
 */
export function NouvelleRelanceLibre({ assigneeId }: { assigneeId: string }) {
  const [message, setMessage] = useState<{ texte: string; erreur?: boolean }>();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function planifier(fd: FormData) {
    setMessage(undefined);
    startTransition(async () => {
      const res = await createTaskAction(fd);
      if (res?.error) {
        setMessage({ texte: res.error, erreur: true });
        return;
      }
      formRef.current?.reset();
      setMessage({
        texte: "Relance planifiée — elle remontera ici à sa date.",
      });
    });
  }

  return (
    <form
      ref={formRef}
      action={planifier}
      className="card mt-8 flex flex-wrap items-end gap-4 p-4"
    >
      <div className="min-w-[240px] flex-1">
        <label className="label" htmlFor="title">
          Nouvelle relance
        </label>
        <input
          id="title"
          name="title"
          required
          className="input"
          placeholder="Préparer la proposition pour lundi"
        />
      </div>
      <div>
        <span className="label">Échéance</span>
        <DateField name="due_local" compact />
      </div>
      <input type="hidden" name="assignee_id" value={assigneeId} />
      <button type="submit" disabled={pending} className="btn-ghost">
        {pending ? "Ajout…" : "Ajouter"}
      </button>
      {message && (
        <p
          role={message.erreur ? "alert" : "status"}
          className={`w-full text-xs ${
            message.erreur ? "text-rose-300" : "text-emerald-300"
          }`}
        >
          {message.texte}
        </p>
      )}
    </form>
  );
}
