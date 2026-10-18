"use client";

import { useOptimistic, useState } from "react";
import Link from "next/link";
import { fmtDateTime, relative } from "@/lib/constants";
import { Icone } from "@/components/ui";
import { DebriefRdv } from "@/components/DebriefRdv";
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

  if (vue.length === 0 && !erreur && sansSuite.length === 0) return null;

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
        <ul className="card animate-rise divide-y divide-white/[0.05]">
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
              <DebriefRdv
                meetingId={m.id}
                pendant={() => {
                  setErreur(undefined);
                  retirer(m.id);
                }}
                apres={(r) => {
                  if (!r.ok) setErreur(r.error);
                  else if (r.plusRien) {
                    const nom = m.prospect?.company_name ?? m.title;
                    setSansSuite((l) => (l.includes(nom) ? l : [...l, nom]));
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
