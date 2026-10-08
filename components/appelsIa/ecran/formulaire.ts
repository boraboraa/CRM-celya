"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import type { EtatAction } from "@/app/appels-ia-actions";

/**
 * Un formulaire branché sur une server action de l'écran Appels IA, par
 * `useActionState`.
 *
 * Envoyé par `onSubmit` + `startTransition`, et non par `<form action>` : avec
 * `action`, React 19 REMET le formulaire à zéro à la fin de chaque envoi —
 * y compris quand le serveur refuse. Un réglage mal saisi effacerait alors
 * tout ce qui venait d'être tapé, au moment précis où l'on veut le corriger.
 * Ici, on ne vide que sur demande (`viderSiOk`) et seulement après un succès :
 * un secret posé, une campagne créée, un numéro ajouté.
 */
export function useFormulaire(
  action: (prev: EtatAction, fd: FormData) => Promise<EtatAction>,
  o: { viderSiOk?: boolean } = {}
) {
  const [etat, envoyer, enCours] = useActionState(action, {} as EtatAction);
  const ref = useRef<HTMLFormElement>(null);
  const vider = o.viderSiOk === true;

  useEffect(() => {
    if (vider && etat.ok) ref.current?.reset();
  }, [etat, vider]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => envoyer(fd));
  }

  return { etat, onSubmit, enCours, ref };
}
