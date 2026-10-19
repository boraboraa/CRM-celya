"use client";

import { useOptimistic, useState } from "react";
import Link from "next/link";
import { fmtDateTime, relative } from "@/lib/constants";
import { Icone } from "@/components/ui";
import { DebriefRdv, type IssueEnvoyee } from "@/components/DebriefRdv";
import { FeuilleBas } from "@/components/FeuilleBas";
import { PLUS_RIEN } from "@/lib/crm/prochaineAction";
import { lienDepuisAFaire } from "@/lib/crm/ficheSuivante";

export type DebriefMeeting = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  /**
   * Toujours une fiche, ni gagnée ni perdue : un RDV personnel ne réclame
   * jamais de débrief, une fiche close non plus (023) — le tableau de bord
   * les écarte avant d'arriver ici (`rdvADebriefer`, lib/crm/debrief.ts).
   */
  prospect: {
    id: string;
    company_name: string;
  } | null;
};

/**
 * « Rendez-vous à débriefer » — en TÊTE de « À faire » depuis le 18/10 : 14
 * rendez-vous y attendaient, en quatrième et dernière zone, sans que personne
 * ne l'atteigne.
 *
 * Chaque ligne porte LE MÊME débrief que la carte PROCHAINE ACTION de la fiche
 * (`DebriefRdv`) : l'issue en un tap — à rappeler, proposition, signé, pas
 * intéressé — ou « n'a pas eu lieu ». Optimiste : la ligne quitte la zone au
 * clic, et revient d'elle-même si le serveur refuse.
 *
 * TÉLÉPHONE (sous `lg`, 19/10) : neuf cartes hautes repoussaient la première
 * relance du jour à plusieurs écrans. Chaque RDV y tient sur UNE ligne
 * (société · date · « il y a X j ») ; un tap ouvre l'issue dans la feuille du
 * bas — le même `DebriefRdv`, pas une copie. Trois lignes, puis « Voir les N ».
 */
export function DebriefList({ meetings }: { meetings: DebriefMeeting[] }) {
  const [vue, retirer] = useOptimistic(
    meetings,
    (liste: DebriefMeeting[], id: string) => liste.filter((m) => m.id !== id)
  );
  const [erreur, setErreur] = useState<string>();
  /**
   * Fiches laissées sans rien de prévu par un débrief sans suite : on le DIT,
   * passivement, là où la ligne vient de disparaître — aucun geste réclamé.
   */
  const [sansSuite, setSansSuite] = useState<string[]>([]);
  /** Téléphone : le RDV dont l'issue est ouverte dans la feuille du bas. */
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [tout, setTout] = useState(false);

  if (vue.length === 0 && !erreur && sansSuite.length === 0) return null;

  // Un seul chemin pour les deux affichages : retrait optimiste, puis l'issue.
  const pendant = (m: DebriefMeeting) => () => {
    setErreur(undefined);
    retirer(m.id);
  };
  const apres = (m: DebriefMeeting) => (r: IssueEnvoyee) => {
    if (!r.ok) setErreur(r.error);
    else if (r.plusRien) {
      const nom = m.prospect?.company_name ?? m.title;
      setSansSuite((l) => (l.includes(nom) ? l : [...l, nom]));
    }
  };
  // Retiré de la liste (optimiste) : la feuille se referme d'elle-même.
  const enFeuille = vue.find((m) => m.id === ouvert) ?? null;
  const APERCU = 3;
  const lignes = tout ? vue : vue.slice(0, APERCU);

  return (
    <>
      {erreur && (
        <p
          role="alert"
          className="mb-2 rounded-xl bg-rose-500/10 px-4 py-2.5 text-xs text-rose-300 ring-1 ring-rose-400/20"
        >
          {erreur}
        </p>
      )}
      {sansSuite.map((nom) => (
        <p
          key={nom}
          role="status"
          className="mb-2 flex items-center gap-2 rounded-xl bg-white/[0.03] px-4 py-2.5 text-xs text-slate-300 ring-1 ring-white/[0.08]"
        >
          <Icone nom="calendrier" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span>
            <span className="font-medium text-slate-200">{nom}</span> — {PLUS_RIEN.toLowerCase()}.
            Elle ne remontera plus dans « À faire ».
          </span>
        </p>
      ))}
      {vue.length > 0 && (
        <>
          {/* Téléphone : une ligne par rendez-vous. */}
          <ul className="card animate-rise divide-y divide-white/[0.05] lg:hidden">
            {lignes.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setOuvert(m.id)}
                  aria-haspopup="dialog"
                  className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left transition active:bg-white/[0.04]"
                >
                  <Icone nom="calendrier" className="h-4 w-4 shrink-0 text-amber-300/80" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-100">
                      {m.prospect?.company_name ?? m.title}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {fmtDateTime(m.starts_at)} · {relative(m.starts_at)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-celya-blue">Débriefer</span>
                </button>
              </li>
            ))}
          </ul>
          {vue.length > APERCU && (
            <button
              type="button"
              onClick={() => setTout((t) => !t)}
              className="btn-link mt-1 min-h-[44px] min-w-[44px] text-xs lg:hidden"
            >
              {tout ? "Réduire" : `Voir les ${vue.length}`}
            </button>
          )}
          <FeuilleBas
            ouvert={enFeuille !== null}
            onFermer={() => setOuvert(null)}
            titre={enFeuille?.prospect?.company_name ?? enFeuille?.title ?? "Débrief"}
          >
            {enFeuille && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  Rendez-vous du {fmtDateTime(enFeuille.starts_at)} · {relative(enFeuille.starts_at)}
                  {enFeuille.prospect && (
                    <>
                      {" · "}
                      <Link
                        href={lienDepuisAFaire(enFeuille.prospect.id)}
                        prefetch={false}
                        className="text-celya-blue underline-offset-2 hover:underline"
                      >
                        Ouvrir la fiche
                      </Link>
                    </>
                  )}
                </p>
                <DebriefRdv
                  key={enFeuille.id}
                  meetingId={enFeuille.id}
                  pendant={pendant(enFeuille)}
                  apres={apres(enFeuille)}
                />
              </div>
            )}
          </FeuilleBas>

          {/* Ordinateur : la carte complète, l'issue à même la ligne. */}
          <ul className="card animate-rise hidden divide-y divide-white/[0.05] lg:block">
            {vue.map((m) => (
              <li key={m.id} className="space-y-2.5 px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <Icone nom="calendrier" className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {m.prospect ? (
                        <Link
                          href={lienDepuisAFaire(m.prospect.id)}
                          prefetch={false}
                          className="underline-offset-2 hover:text-celya-blue hover:underline"
                        >
                          {m.prospect.company_name}
                        </Link>
                      ) : (
                        m.title
                      )}
                    </p>
                    <p className="text-xs text-slate-400">
                      {fmtDateTime(m.starts_at)} · {relative(m.starts_at)}
                    </p>
                  </div>
                </div>
                <DebriefRdv meetingId={m.id} pendant={pendant(m)} apres={apres(m)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
