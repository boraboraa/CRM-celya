"use client";

import { useOptimistic, useState, useTransition } from "react";
import { leverPauseAction } from "@/app/appels-ia-actions";
import { Icone } from "@/components/ui";

/**
 * La pause du moteur : posée par lui-même sur une panne de NOTRE côté (clé
 * refusée, SIP sortant non activé…). Plus rien ne part tant que l'admin ne l'a
 * pas levée — d'où un bandeau ambre, la cause en clair, et un seul geste.
 *
 * Optimiste : au clic, le bandeau dit « levée » ; si le serveur refuse, il
 * revient tel quel avec le message.
 */
export function BandeauPause({ cause, depuis }: { cause: string; depuis: string | null }) {
  const [levee, lever] = useOptimistic(false);
  const [enCours, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string>();

  function auClic() {
    setErreur(undefined);
    startTransition(async () => {
      lever(true);
      const res = await leverPauseAction();
      if (res?.error) setErreur(res.error);
    });
  }

  if (levee) {
    return (
      <p role="status" className="mt-3 text-xs text-slate-400">
        Pause levée — le moteur reprend au prochain passage, si rien d&apos;autre ne l&apos;en empêche.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-xl bg-amber-500/10 px-4 py-3 ring-1 ring-amber-400/25">
      <p className="flex items-start gap-2 text-sm text-amber-200">
        <Icone nom="alerte" className="mt-0.5 h-4 w-4 text-amber-300" />
        <span className="min-w-0 break-words">
          Moteur en pause : {cause}
          {depuis && <span className="block text-xs text-amber-300/80">Depuis {depuis}.</span>}
        </span>
      </p>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        Corrigez la cause (secret, numéro, compte Telnyx), puis levez la pause : le moteur ne la lève jamais seul.
      </p>
      <button type="button" onClick={auClic} disabled={enCours} className="btn-ghost mt-3 px-3 py-1.5 text-xs">
        Lever la pause
      </button>
      {erreur && (
        <p
          role="alert"
          className="mt-2 rounded-xl bg-rose-500/10 px-3.5 py-2 text-xs text-rose-300 ring-1 ring-rose-400/20"
        >
          {erreur}
        </p>
      )}
    </div>
  );
}
