"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icone } from "@/components/ui";
import {
  MEMOIRE_A_FAIRE,
  ficheSuivante,
  lienDepuisAFaire,
  lireListe,
  type PositionAFaire,
} from "@/lib/crm/ficheSuivante";

/**
 * Le tableau de bord MÉMORISE l'ordre de ses lignes (une liste d'identifiants,
 * dans cet onglet). Ne rend rien. Stockage bloqué (navigation privée,
 * aperçu) : tant pis, la fiche n'offrira simplement pas « Fiche suivante ».
 */
export function MemoireAFaire({ ids }: { ids: string[] }) {
  useEffect(() => {
    try {
      sessionStorage.setItem(MEMOIRE_A_FAIRE, JSON.stringify(ids));
    } catch {
      /* stockage indisponible : la fiche s'en passera */
    }
  }, [ids]);
  return null;
}

/**
 * « Fiche suivante → » sur une fiche ouverte depuis « À faire » : la ligne
 * d'après, dans l'ordre de l'écran, sans repasser par le tableau de bord. À
 * la dernière, il le dit et ramène à « À faire ».
 */
export function BoutonFicheSuivante({ courant }: { courant: string }) {
  const [pos, setPos] = useState<PositionAFaire | null>(null);
  useEffect(() => {
    try {
      setPos(ficheSuivante(lireListe(sessionStorage.getItem(MEMOIRE_A_FAIRE)), courant));
    } catch {
      setPos(null);
    }
  }, [courant]);

  if (!pos) return null;
  return pos.suivante ? (
    <Link
      href={lienDepuisAFaire(pos.suivante)}
      prefetch={false}
      className="btn-ghost min-h-[40px] px-3 text-xs"
    >
      Fiche suivante
      <span className="text-slate-500">
        {pos.position}/{pos.total}
      </span>
      <Icone nom="suivant" className="h-3.5 w-3.5" />
    </Link>
  ) : (
    <Link href="/dashboard" className="btn-link text-xs">
      Dernière fiche de « À faire » — revenir au tableau de bord
    </Link>
  );
}
