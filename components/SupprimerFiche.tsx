"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icone } from "@/components/ui";
import { supprimerProspectsAction } from "@/app/actions";
import { questionSuppression } from "@/lib/crm/suppression";

/**
 * « Supprimer la fiche » (28/10) — en deux temps : un clic montre la question
 * (le nom, et ce qui part avec la fiche), un second supprime. Elle était
 * cachée sous « Modifier la fiche » et partait au PREMIER clic.
 * Affiché seulement à qui peut supprimer (responsable ou admin) : masquer,
 * pas désactiver — la base refuserait de toute façon.
 */
export function SupprimerFiche({ prospectId, nom }: { prospectId: string; nom: string }) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function supprimer() {
    setErreur(null);
    startTransition(async () => {
      const res = await supprimerProspectsAction([prospectId]);
      if (res.error || !res.n) {
        setErreur(res.error ?? res.texte ?? "La fiche n'a pas pu être supprimée.");
        return;
      }
      router.push("/prospects");
    });
  }

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-xs text-slate-500 transition hover:text-rose-300"
      >
        <Icone nom="croix" className="h-3 w-3" />
        Supprimer la fiche
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl bg-rose-500/[0.07] p-4 ring-1 ring-rose-400/25" role="alertdialog" aria-label="Supprimer la fiche">
      <p className="text-sm text-rose-100">{questionSuppression([nom])}</p>
      {erreur && <p className="text-xs text-rose-300">{erreur}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={supprimer} disabled={pending} className="btn-danger min-h-[44px] px-4 text-sm">
          {pending ? "Suppression…" : "Oui, supprimer"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOuvert(false);
            setErreur(null);
          }}
          disabled={pending}
          className="btn-ghost min-h-[44px] px-4 text-sm"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
