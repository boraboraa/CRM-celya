"use client";

import { useOptimistic } from "react";
import { Timeline, type TimelineEntry } from "@/components/Timeline";
import { DeleteEntryButton } from "@/components/DeleteEntryButton";
import { QuickNote } from "@/components/QuickNote";
import { EmailComposer } from "@/components/EmailComposer";

/**
 * La CHRONOLOGIE et « Noter un échange », réunis — parce qu'ils partagent
 * désormais un état.
 *
 * Enregistrer un échange faisait attendre l'aller-retour serveur avant que
 * quoi que ce soit n'apparaisse : Bora tapait sa note, cliquait, et l'écran
 * restait immobile une seconde. L'entrée s'inscrit maintenant en tête du fil
 * à l'instant du clic, en retrait et marquée « Enregistrement… », puis la
 * version du serveur la remplace. En cas d'échec, `useOptimistic` rend la
 * main aux données du serveur : l'entrée provisoire disparaît d'elle-même et
 * le formulaire affiche l'erreur — le texte saisi n'est pas perdu.
 */
export function ProspectJournal({
  entries,
  prospectId,
  companyName,
  contactName,
  prospectEmail,
  isAdmin,
}: {
  entries: TimelineEntry[];
  prospectId: string;
  companyName: string;
  contactName: string | null;
  /** Adresse du prospect — sans elle, pas de composeur. */
  prospectEmail: string | null;
  isAdmin: boolean;
}) {
  const [vue, ajouter] = useOptimistic(
    entries,
    (liste: TimelineEntry[], entree: TimelineEntry) => [entree, ...liste]
  );

  return (
    <>
      <section>
        <h2 className="mb-4 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
          Chronologie
        </h2>
        <Timeline
          entries={vue}
          renderAction={
            isAdmin
              ? (entry) => (
                  <DeleteEntryButton
                    id={entry.id}
                    prospectId={prospectId}
                    source={entry.source}
                    isRealEmail={entry.source === "email"}
                    label="cette entrée du journal"
                  />
                )
              : undefined
          }
        />
      </section>

      <section id="noter-un-echange" className="scroll-mt-6">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
          Noter un échange
        </h2>
        {/* Le sélecteur d'étape part sur « ne pas changer » : aucun état
            local ne peut plus rétrograder la fiche. */}
        <QuickNote
          prospectId={prospectId}
          companyName={companyName}
          contactName={contactName}
          onOptimistic={ajouter}
        />
      </section>

      {prospectEmail && (
        <section>
          <details className="card p-0">
            <summary className="cursor-pointer px-6 py-4 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              Écrire un email
            </summary>
            <div className="px-1 pb-1">
              <EmailComposer
                prospectId={prospectId}
                defaultTo={prospectEmail}
                contactName={contactName}
                companyName={companyName}
                onOptimistic={ajouter}
              />
            </div>
          </details>
        </section>
      )}
    </>
  );
}
