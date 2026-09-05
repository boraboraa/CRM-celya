"use client";

import { useOptimistic, useState, useTransition } from "react";
import { setProspectAddressAction } from "@/app/actions";
import { AdresseField } from "@/components/AdresseField";
import { BoutonsMaps } from "@/components/BoutonsMaps";
import { Icone } from "@/components/ui";

/**
 * L'adresse EN TÊTE DE FICHE — le seul point d'entrée visible.
 *
 * Le champ existait, mais uniquement dans « Modifier la fiche », replié tout
 * en bas sous la chronologie : sur les 33 fiches sans adresse, personne ne
 * trouvait où coller son lien Maps. Ici, le geste tient sur la même ligne que
 * le téléphone :
 *
 *   · pas d'adresse → « Ajouter une adresse », qui déplie le champ EN PLACE
 *     (aucune navigation, aucune modale) ;
 *   · une adresse → les boutons Maps, et rien d'autre.
 *
 * « Modifier » est parti d'ici : corriger une adresse déjà saisie est rare, et
 * le champ existe déjà dans « Modifier la fiche » (AdresseField, le même
 * composant). L'AJOUT, lui, ne l'était pas — c'est le geste qui reste en tête.
 *
 * Aucun rendu conditionnel sur le rôle : la RLS tranche qui peut écrire, et un
 * commercial remplit ce champ plus souvent que l'admin.
 *
 * Optimiste, comme tout geste visible : l'adresse s'affiche au clic, et ne
 * revient en arrière que si le serveur refuse.
 */
export function AdresseInline({
  prospectId,
  address,
  ville,
}: {
  prospectId: string;
  address: string | null;
  ville?: string | null;
}) {
  const [vue, appliquer] = useOptimistic(
    address ?? "",
    (_courante: string, suivante: string) => suivante
  );
  const [ouvert, setOuvert] = useState(false);
  const [valeur, setValeur] = useState(address ?? "");
  const [erreur, setErreur] = useState<string>();
  const [pending, startTransition] = useTransition();

  function ouvrir() {
    setValeur(vue);
    setErreur(undefined);
    setOuvert(true);
  }

  function enregistrer() {
    const nette = valeur.trim();
    if (!nette) return;
    setErreur(undefined);
    startTransition(async () => {
      appliquer(nette);
      setOuvert(false);
      const fd = new FormData();
      fd.set("id", prospectId);
      fd.set("address", nette);
      // setProspectAddressAction n'écrit QUE `address` : passer par
      // updateProspectAction depuis ce mini-formulaire viderait tous les
      // autres champs de la fiche, qu'il ne porte pas.
      const res = await setProspectAddressAction(fd);
      if (res?.error) {
        setErreur(res.error);
        setOuvert(true);
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {vue ? (
          <BoutonsMaps valeur={vue} ville={ville} />
        ) : (
          !ouvert && (
            <button
              type="button"
              onClick={ouvrir}
              className="btn-ghost px-2.5 py-1.5 text-xs"
            >
              <Icone nom="plus" className="h-3 w-3" /> Ajouter une adresse
            </button>
          )
        )}
        {pending && (
          <span className="text-[11px] text-slate-500">Enregistrement…</span>
        )}
      </div>

      {ouvert && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enregistrer();
          }}
          // Le champ vit dans AdresseField, qui garde sa valeur pour lui : on
          // l'écoute remonter plutôt que de lui ajouter un rappel — le
          // composant reste utilisable tel quel dans le formulaire complet.
          onInput={(e) =>
            setValeur((e.target as HTMLInputElement).value ?? "")
          }
          className="max-w-md space-y-2 rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06]"
        >
          {/* Un nom distinct : le formulaire complet (replié plus bas) porte
              déjà un champ « address », et deux id identiques dans la page se
              marcheraient dessus. */}
          <AdresseField
            name="adresse-entete"
            defaultValue={vue}
            ville={ville}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={pending || !valeur.trim()}
              className="btn-primary px-3 py-1.5 text-xs"
            >
              Enregistrer
            </button>
            <button
              type="button"
              onClick={() => {
                setOuvert(false);
                setErreur(undefined);
              }}
              className="btn-link text-xs"
            >
              Annuler
            </button>
            {erreur && <span className="text-xs text-rose-300">{erreur}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
