"use client";

import { useState, useTransition } from "react";
import { setProspectAddressAction } from "@/app/actions";
import { BoutonsMaps } from "@/components/BoutonsMaps";

/**
 * « Enregistrer cette adresse sur la fiche ? » — une ligne, un clic.
 *
 * Un rendez-vous porte un lieu, la fiche n'a pas d'adresse : on PROPOSE de le
 * remonter, on ne le fait jamais tout seul. Un lieu ponctuel (« visio »,
 * « chez le comptable ») n'est pas l'adresse du client, et le CRM ne réécrit
 * pas ce que l'utilisateur n'a pas demandé.
 *
 * Optimiste, comme tout geste visible : la ligne disparaît au clic, et ne
 * revient que si le serveur refuse.
 */
export function AdresseDepuisRdv({
  prospectId,
  lieu,
  ville,
}: {
  prospectId: string;
  lieu: string;
  ville?: string | null;
}) {
  const [enregistre, setEnregistre] = useState(false);
  const [erreur, setErreur] = useState<string>();
  const [pending, startTransition] = useTransition();

  if (enregistre && !erreur) {
    return (
      <p className="text-[11px] text-emerald-300">
        Adresse enregistrée sur la fiche.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.02] px-3 py-2 ring-1 ring-white/[0.06]">
      <BoutonsMaps valeur={lieu} ville={ville} compact />
      <span className="text-[11px] text-slate-400">
        Lieu du rendez-vous — enregistrer cette adresse sur la fiche ?
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setEnregistre(true);
            setErreur(undefined);
            const fd = new FormData();
            fd.set("id", prospectId);
            fd.set("address", lieu);
            const res = await setProspectAddressAction(fd);
            if (res?.error) {
              setEnregistre(false);
              setErreur(res.error);
            }
          })
        }
        className="rounded-lg bg-white/[0.07] px-2.5 py-1 text-[11px] font-medium text-slate-100 ring-1 ring-white/15 transition hover:bg-white/[0.12] disabled:opacity-50"
      >
        Enregistrer
      </button>
      {erreur && <span className="text-[11px] text-rose-300">{erreur}</span>}
    </div>
  );
}
