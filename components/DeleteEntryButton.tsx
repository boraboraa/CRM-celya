"use client";

import { useState, useTransition } from "react";
import { deleteActivityAction, deleteEmailAction } from "@/app/actions";
import { Icone } from "@/components/ui";

/**
 * Corbeille sur une entrée du journal — admin uniquement (le contrôle est
 * refait côté serveur : ce composant n'est que l'ergonomie).
 *
 * Confirmation en deux temps, inline : un premier clic ouvre la question,
 * le second supprime. Pas de `window.confirm` — la question dit ce qui
 * disparaît, et le ton s'endurcit pour un email réellement envoyé ou reçu,
 * qui est une trace, pas un brouillon.
 */
export function DeleteEntryButton({
  id,
  prospectId,
  source,
  /** Un vrai message parti/arrivé : on prévient plus fermement. */
  isRealEmail = false,
  label = "cette entrée",
}: {
  id: string;
  prospectId: string;
  source: "activity" | "email";
  isRealEmail?: boolean;
  label?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(undefined);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("prospect_id", prospectId);
      fd.set("confirm", "1");
      const res =
        source === "email"
          ? await deleteEmailAction(fd)
          : await deleteActivityAction(fd);
      if (res.error) {
        setError(res.error);
        setAsking(false);
      }
    });
  }

  if (!asking) {
    return (
      <span className="flex items-center gap-1.5">
        {error && <span className="text-[11px] text-rose-300">{error}</span>}
        <button
          type="button"
          onClick={() => setAsking(true)}
          title={`Supprimer ${label}`}
          aria-label={`Supprimer ${label}`}
          className="rounded-lg px-1.5 py-1 text-slate-600 transition hover:bg-rose-500/10 hover:text-rose-400"
        >
          <Icone nom="corbeille" className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      <span className="text-[11px] text-slate-400">
        {isRealEmail
          ? "Supprimer ce message réellement échangé ?"
          : `Supprimer ${label} ?`}
      </span>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="rounded-lg bg-rose-500/15 px-2 py-1 text-[11px] font-medium text-rose-300 ring-1 ring-rose-400/25 transition hover:bg-rose-500/25 disabled:opacity-50"
      >
        {pending ? "Suppression…" : "Supprimer"}
      </button>
      <button
        type="button"
        onClick={() => setAsking(false)}
        disabled={pending}
        className="btn-link text-[11px]"
      >
        Annuler
      </button>
    </span>
  );
}
