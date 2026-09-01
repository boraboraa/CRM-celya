"use client";

import { useEffect, useState } from "react";
import { BoutonsMaps } from "@/components/BoutonsMaps";
import { estLienMaps, adressePrecise } from "@/lib/crm/maps";

/**
 * Le champ d'adresse — UN SEUL champ, pour une adresse libre OU un lien Google
 * Maps collé. Deux cases pour la même chose et personne ne sait laquelle
 * remplir : c'est lib/crm/maps.ts qui distingue les deux, pas l'utilisateur.
 *
 * Trois retours immédiats, à la frappe et sans réseau :
 *   · l'aperçu des boutons qui seront rendus sur la fiche ;
 *   · « Lien Google Maps reconnu », pour qu'un collage se voie compris ;
 *   · l'avertissement ambre quand ni code postal ni ville ne sont connus —
 *     sans repère, Maps peut se tromper de pays (les fiches lyonnaises de
 *     Rémi portent toutes country='Belgique', jamais lu par le CRM).
 *
 * Le champ s'affiche pour TOUT LE MONDE, commercial comme admin : aucun rendu
 * conditionnel sur le rôle.
 */
export function AdresseField({
  name = "address",
  defaultValue,
  ville,
  villeInputId = "city",
  className = "input",
}: {
  name?: string;
  defaultValue?: string | null;
  /** Ville connue de la fiche, au premier rendu. */
  ville?: string | null;
  /**
   * Id du champ « Ville » du même formulaire. Le composant s'y branche pour
   * que l'avertissement disparaisse dès que la ville est saisie — c'est le
   * seul lien entre les deux champs, et il évite de transformer tout le
   * formulaire (un composant serveur) en composant client.
   */
  villeInputId?: string;
  className?: string;
}) {
  const [valeur, setValeur] = useState(defaultValue ?? "");
  const [villeVive, setVilleVive] = useState(ville ?? "");

  useEffect(() => {
    const champ = document.getElementById(villeInputId);
    if (!(champ instanceof HTMLInputElement)) return;
    const maj = () => setVilleVive(champ.value);
    maj();
    champ.addEventListener("input", maj);
    return () => champ.removeEventListener("input", maj);
  }, [villeInputId]);

  const texte = valeur.trim();
  const lien = estLienMaps(texte);
  const imprecis = texte.length > 0 && !adressePrecise(texte, villeVive);

  return (
    <div>
      <label className="label" htmlFor={name}>
        Adresse ou lien Google Maps
      </label>
      <input
        id={name}
        name={name}
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        className={className}
        placeholder="Chaussée de Namur 393, 5310 Eghezée — ou collez un lien Maps"
      />

      {texte && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <BoutonsMaps valeur={texte} ville={villeVive || null} />
          {lien && (
            <span className="text-[11px] text-slate-500">
              Lien Google Maps reconnu
            </span>
          )}
        </div>
      )}

      {imprecis && (
        <p className="mt-1.5 text-[11px] text-amber-300/90">
          Ajoutez la ville ou le code postal : Maps peut se tromper de pays.
        </p>
      )}
    </div>
  );
}
