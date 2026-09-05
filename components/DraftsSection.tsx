"use client";

import { useOptimistic } from "react";
import { DeleteEntryButton } from "@/components/DeleteEntryButton";
import { DraftSendButton } from "@/components/DraftSendButton";
import { fmtDateTime } from "@/lib/constants";

export type DraftEntry = {
  id: string;
  subject: string | null;
  body: string | null;
  occurred_at: string;
};

/**
 * BROUILLONS — hors chronologie, clairement séparés.
 *
 * Un texte jamais envoyé n'est pas un échange : il ne compte pour aucun fait,
 * ne touche pas au dernier contact, et se supprime d'un clic. Ce qui change
 * ici, c'est qu'il peut maintenant PARTIR d'un clic : « Envoyer » l'envoie
 * à l'adresse de la fiche, « Modifier » le verse dans le composeur.
 *
 * Optimiste, comme tout geste visible du CRM : le brouillon quitte la liste à
 * l'instant du clic, et revient tout seul si le serveur refuse (useOptimistic
 * rend la main aux données du serveur à la fin de la transition) — l'erreur
 * s'affiche alors sous le brouillon revenu.
 */
export function DraftsSection({
  drafts,
  prospectId,
  prospectEmail,
  isAdmin,
}: {
  drafts: DraftEntry[];
  prospectId: string;
  prospectEmail: string | null;
  isAdmin: boolean;
}) {
  const [vue, retirer] = useOptimistic(
    drafts,
    (liste: DraftEntry[], id: string) => liste.filter((d) => d.id !== id)
  );

  if (vue.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
        Brouillons
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-normal normal-case tracking-normal text-slate-400">
          {vue.length}
        </span>
      </h2>
      <p className="mb-2 text-[11px] text-slate-600">
        Textes non envoyés — hors chronologie.
      </p>
      <ul className="card divide-y divide-white/[0.05]">
        {vue.map((d) => (
          <li key={d.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-xs font-medium text-slate-300">
                {d.subject ?? "Brouillon"}
              </p>
              {isAdmin && (
                <DeleteEntryButton
                  id={d.id}
                  prospectId={prospectId}
                  source="activity"
                  label="ce brouillon"
                />
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-600">
              {fmtDateTime(d.occurred_at)}
            </p>
            {d.body && (
              <details className="mt-1.5">
                <summary className="btn-link cursor-pointer list-none text-[11px]">
                  Voir le texte
                </summary>
                <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-500">
                  {d.body.slice(0, 2000)}
                </p>
              </details>
            )}

            <DraftSendButton
              prospectId={prospectId}
              draftId={d.id}
              subject={d.subject}
              body={d.body}
              to={prospectEmail}
              onSending={() => retirer(d.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
