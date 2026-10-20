"use client";

import { useRouter } from "next/navigation";
import type { AppelDetail, EtatAppels } from "@/lib/appelsIa/lectures";
import { useSondage } from "@/components/appelsIa/sondage";
import { SuiviAppel } from "./SuiviAppel";

/**
 * « En ce moment », en tête de l'onglet Suivi : l'appel en cours, suivi en
 * direct (SuiviAppel) ; sinon le dernier appel, relu tel quel.
 *
 * Sans appel en cours, il sonde l'état du moteur (/api/appels-ia/etat, le
 * rythme partagé des appels) tant que Janet a de quoi appeler : dès qu'un
 * appel part, la page se recharge et le montre. Une journée calme ne coûte
 * aucune requête.
 */
export function EnDirect({
  appel,
  enCours,
  sonder,
}: {
  /** L'appel en cours, sinon le dernier — ou null s'il n'y en a jamais eu. */
  appel: AppelDetail | null;
  enCours: boolean;
  /** L'interrupteur est allumé et la file n'est pas vide : un appel peut partir. */
  sonder: boolean;
}) {
  const router = useRouter();
  useSondage<EtatAppels>("/api/appels-ia/etat", !enCours && sonder, (d) => {
    if (d?.disponible && d.enCours) router.refresh();
  });

  return (
    <section className="card p-4 sm:p-5" aria-label="En ce moment">
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
        {enCours && <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-celya-blue" />}
        {enCours ? "Appel en cours" : "Dernier appel"}
      </h2>
      {appel ? (
        <>
          <p className="mb-3 break-words text-sm font-medium text-slate-100">
            {appel.societe ?? (appel.prospect_id ? "Fiche introuvable" : "Appel de test — fiche fictive")}
            {appel.mode_test && <span className="ml-2 text-xs font-normal text-amber-300">test</span>}
          </p>
          <SuiviAppel initial={appel} />
        </>
      ) : (
        <p className="text-sm text-slate-500">
          Aucun appel pour l&apos;instant.{sonder ? " Janet compose dès qu'une fiche de la file est prête." : ""}
        </p>
      )}
    </section>
  );
}
