/**
 * Les derniers appels de Janet (50 au plus) : un point de couleur, la société,
 * ce qu'a donné l'appel, le résumé, la durée, test ou réel, l'erreur s'il y en
 * a une. Les dix plus récents d'abord ; le reste se déplie.
 *
 * Composant SERVEUR, en lecture seule.
 */

import Link from "next/link";
import type { AppelResume } from "@/lib/appelsIa/lectures";
import { CLASSEMENT_LABEL, OUTCOME_LABEL_APPEL, STATUT_APPEL_LABEL } from "@/lib/appelsIa/libelles";
import { numeroLisible } from "@/lib/appelsIa/numeros";
import { OUTCOME_ICON, OUTCOME_TEXT, isCallOutcome } from "@/lib/constants";
import { Icone } from "@/components/ui";
import { PuceMode, Repliable } from "./commun";
import { dureeLisible, pointAppel, quandPasse } from "./format";

const PREMIERS = 10;

/** Classes entières (règle JIT) : d'où vient l'erreur. */
const ERREUR: Record<"nous" | "neutre" | "autre", { classe: string; libelle: string }> = {
  nous: {
    classe: "rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-300 ring-1 ring-rose-400/20",
    libelle: "Panne de notre côté (l'essai ne compte pas)",
  },
  neutre: {
    classe: "rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-300 ring-1 ring-amber-400/20",
    libelle: "Fin illisible (rien n'est écrit sur la fiche)",
  },
  autre: {
    classe: "rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-300 ring-1 ring-rose-400/20",
    libelle: "Erreur",
  },
};

const ACTIFS = new Set(["reserve", "composition", "sonnerie", "en_ligne"]);

function Appel({ a, maintenant }: { a: AppelResume; maintenant: Date }) {
  const resultat = isCallOutcome(a.resultat) ? a.resultat : null;
  const classement = a.classement ? CLASSEMENT_LABEL[a.classement] ?? a.classement : null;
  const duree = dureeLisible(a.duree_s);
  const enCours = ACTIFS.has(a.statut);
  const erreur = a.erreur_cote === "nous" || a.erreur_cote === "neutre" ? ERREUR[a.erreur_cote] : ERREUR.autre;

  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${pointAppel(a)}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {a.prospect_id && a.societe ? (
              <Link
                href={`/prospects/${a.prospect_id}`}
                prefetch={false}
                className="min-w-0 break-words text-sm font-medium text-slate-100 underline-offset-2 hover:underline"
              >
                {a.societe}
              </Link>
            ) : (
              <span className="text-sm font-medium text-slate-300">
                {a.prospect_id ? "Fiche introuvable" : "Fiche fictive"}
              </span>
            )}
            <PuceMode test={a.mode_test} />
            {a.meeting_id && (
              <span className="chip bg-celya-blue/15 text-blue-200 ring-blue-400/30">
                <Icone nom="calendrier" className="h-3 w-3" />
                RDV posé
              </span>
            )}
          </div>
          <span className="shrink-0 text-[11px] text-slate-500">{quandPasse(a.created_at, maintenant)}</span>
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
          {enCours ? (
            <span className="text-blue-200">{STATUT_APPEL_LABEL[a.statut] ?? a.statut}…</span>
          ) : (
            <>
              {classement && <span>{classement}</span>}
              {resultat && (
                <span className={`inline-flex items-center gap-1 ${OUTCOME_TEXT[resultat]}`}>
                  {classement && <span className="text-slate-600">·</span>}
                  <Icone nom={OUTCOME_ICON[resultat]} className="h-3 w-3" />
                  {OUTCOME_LABEL_APPEL[resultat]}
                </span>
              )}
              {!classement && !resultat && <span>{STATUT_APPEL_LABEL[a.statut] ?? a.statut}</span>}
            </>
          )}
          {duree && <span className="text-slate-500">· {duree}</span>}
          {a.essai > 1 && <span className="text-slate-500">· essai {a.essai}/3</span>}
          {a.interlocuteur && <span className="min-w-0 break-words text-slate-500">· avec {a.interlocuteur}</span>}
        </p>

        {a.resume && (
          <p className="mt-1 break-words text-xs leading-relaxed text-slate-300" title={a.resume}>
            {a.resume}
          </p>
        )}

        {(a.erreur_message || a.erreur_cote) && (
          <p className={`mt-1.5 break-words ${erreur.classe}`}>
            {erreur.libelle}
            {a.erreur_message ? ` : ${a.erreur_message}` : "."}
          </p>
        )}

        <p className="mt-1 text-[11px] text-slate-600">Composé : {numeroLisible(a.numero_compose)}</p>
      </div>
    </li>
  );
}

export function DerniersAppels({ appels, maintenant }: { appels: AppelResume[]; maintenant: Date }) {
  const premiers = appels.slice(0, PREMIERS);
  const suite = appels.slice(PREMIERS);
  return (
    <Repliable
      titre="Derniers appels"
      compte={appels.length === 0 ? "aucun" : `les ${appels.length} plus récents`}
      icone="telephone"
      ouvert={appels.length > 0}
    >
      {appels.length === 0 ? (
        <p className="text-sm text-slate-500">
          Janet n&apos;a encore passé aucun appel. Commencez par l&apos;appel de test vers votre GSM.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-white/[0.06]">
            {premiers.map((a) => (
              <Appel key={a.id} a={a} maintenant={maintenant} />
            ))}
          </ul>
          {suite.length > 0 && (
            <details className="group/suite mt-4 border-t border-white/[0.06] pt-4">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-slate-400 transition hover:text-slate-200 [&::-webkit-details-marker]:hidden">
                <Icone nom="chevron" className="h-3 w-3 transition-transform group-open/suite:rotate-180" />
                {suite.length} appel{suite.length > 1 ? "s" : ""} plus ancien{suite.length > 1 ? "s" : ""}
              </summary>
              <ul className="mt-3 divide-y divide-white/[0.06]">
                {suite.map((a) => (
                  <Appel key={a.id} a={a} maintenant={maintenant} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Repliable>
  );
}
