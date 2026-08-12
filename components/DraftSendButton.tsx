"use client";

import { useActionState } from "react";
import { sendDraftAction } from "@/app/mail-actions";
import { openComposer } from "@/lib/crm/composer";
import { FormError } from "@/components/ui";
import type { ActionState } from "@/app/actions";

/**
 * « ✉ Envoyer » sur un brouillon — le geste qui manquait.
 *
 * Un brouillon est un texte écrit par Claude via le connecteur MCP. Jusqu'ici
 * il fallait le sélectionner, le copier, dérouler le composeur enterré en bas
 * de page et le coller. Ce bouton l'envoie tel quel à l'adresse de la fiche,
 * puis le brouillon disparaît : c'est l'email réellement parti qui prend sa
 * place dans la chronologie.
 *
 * « Modifier » ne part pas : il verse le brouillon dans le composeur (onglet
 * « Envoyer un email »), qui se déplie et défile jusqu'à l'écran.
 */
export function DraftSendButton({
  prospectId,
  draftId,
  subject,
  body,
  to,
  onSending,
}: {
  prospectId: string;
  draftId: string;
  subject: string | null;
  body: string | null;
  /** Adresse de la fiche — sans elle, rien ne peut partir. */
  to: string | null;
  /** Retire le brouillon de la liste pendant que le SMTP travaille. */
  onSending?: () => void;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, fd) => {
      onSending?.();
      return sendDraftAction(prev, fd);
    },
    {}
  );

  const sansAdresse = !to;
  const sansObjet = !subject?.trim();
  const empeche = sansAdresse
    ? "Ajoutez une adresse email sur la fiche"
    : sansObjet
      ? "Ce brouillon n'a pas d'objet — passez par « Modifier »"
      : undefined;

  return (
    <form action={formAction} className="mt-2 space-y-1.5">
      <input type="hidden" name="prospect_id" value={prospectId} />
      <input type="hidden" name="draft_id" value={draftId} />

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="submit"
          disabled={pending || Boolean(empeche)}
          title={empeche ?? `Envoyer ce brouillon à ${to}`}
          className="btn-primary px-2.5 py-1 text-[11px]"
        >
          {pending ? "Envoi…" : "✉ Envoyer"}
        </button>
        <button
          type="button"
          onClick={() => openComposer({ to, subject, body })}
          title="Reprendre ce texte dans le composeur avant d'envoyer"
          className="btn-ghost px-2.5 py-1 text-[11px]"
        >
          Modifier
        </button>
      </div>

      <FormError message={state.error} />
    </form>
  );
}
