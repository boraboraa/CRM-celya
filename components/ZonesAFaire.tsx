import Link from "next/link";
import {
  EmptyState,
  Icone,
  ProchaineActionTexte,
  EtiquetteJanet,
} from "@/components/ui";
import { type TaskWithProspect } from "@/components/TaskRow";
import { TaskList } from "@/components/TaskList";
import { ReplyCard, type ReplyCardEmail } from "@/components/ReplyCard";
import { DebriefList, type DebriefMeeting } from "@/components/DebriefList";
import { BoutonsMaps } from "@/components/BoutonsMaps";
import { fmtDate, relative } from "@/lib/constants";
import type { LigneAgendaJour } from "@/lib/crm/agendaJour";
import { lienDepuisAFaire } from "@/lib/crm/ficheSuivante";

/** Une fiche en attente de réponse — la zone CALME du tableau. */
export type WaitingProspect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  next_action_at: string | null;
  next_action_kind: string | null;
  /** Date du dernier mail envoyé. */
  sent_at: string | null;
};

/**
 * Les zones de « À faire », sans leurs lectures (28/10) : la page charge et
 * trie, ce composant serveur affiche — comme `AffichageProspects` pour
 * /prospects. Ne reçoit que des VALEURS (voir test:frontiere).
 */
export function ZonesAFaire({
  lignesJour,
  debriefMeetings,
  overdue,
  today,
  relancesLues,
  waiting,
  replies,
  admin,
}: {
  /** L'agenda du jour, déjà dérivé (`ligneAgendaJour`). */
  lignesJour: LigneAgendaJour[];
  debriefMeetings: DebriefMeeting[];
  overdue: TaskWithProspect[];
  today: TaskWithProspect[];
  relancesLues: string[];
  waiting: WaitingProspect[];
  replies: ReplyCardEmail[];
  admin: boolean;
}) {
  const nothingAtAll =
    overdue.length +
      today.length +
      waiting.length +
      replies.length +
      lignesJour.length +
      debriefMeetings.length ===
    0;

  return (
    <>
      {/* ---------- 0. Aujourd'hui — l'agenda du jour, avant les relances ---------- */}
      {lignesJour.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
            Aujourd&apos;hui
            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] text-blue-300">
              {lignesJour.length}
            </span>
            <span className="ml-auto text-[11px] font-normal normal-case tracking-normal">
              <Link
                href="/agenda"
                className="text-slate-500 hover:text-slate-300"
              >
                Voir l&apos;agenda
              </Link>
            </span>
          </h2>
          <ul className="card animate-rise divide-y divide-white/[0.05]">
            {lignesJour.map((l) => {
              // Toute la dérivation vit dans lib/crm/agendaJour.ts (la page
              // l'appelle) — pur, donc testable, y compris la branche
              // « rendez-vous perso, sans fiche ni lieu ».
              return (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
                >
                  <span className="w-24 shrink-0 text-sm font-semibold tabular-nums text-blue-300">
                    {l.creneau}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100" title={l.titre}>
                      {l.lienFiche ? (
                        <Link
                          href={l.lienFiche}
                          prefetch={false}
                          className="underline-offset-2 hover:text-celya-blue hover:underline"
                        >
                          {l.titre}
                        </Link>
                      ) : (
                        l.titre
                      )}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                      {l.contact && <span>{l.contact}</span>}
                      {l.telHref && (
                        <a
                          href={l.telHref}
                          className="text-celya-blue hover:underline"
                        >
                          {l.telephone}
                        </a>
                      )}
                      {l.poseParJanet && (
                        <EtiquetteJanet
                          compact
                          texte="posé par Janet"
                          titre="Rendez-vous posé par Janet pendant un appel"
                        />
                      )}
                      {/* L'adresse en clientèle : un bouton, pas un texte à
                          recopier dans Maps. */}
                      {l.lieu && (
                        <BoutonsMaps
                          valeur={l.lieu}
                          ville={l.ville ?? undefined}
                          compact
                        />
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ---------- Rendez-vous à débriefer — EN TÊTE depuis le 18/10.
          Elle était la quatrième et dernière zone : 14 rendez-vous y
          attendaient sous 17 relances en retard, et personne ne l'atteignait.
          Un rendez-vous passé non débriefé RESTE ici tant que rien n'est
          posé après lui (027) : c'est le seul rappel du produit, ne pas en
          ajouter d'autre. Mêmes boutons d'issue que la fiche (DebriefRdv). */}
      {/* Toujours monté, même vide : quand le DERNIER rendez-vous est
          débriefé sans suite, la zone doit pouvoir dire « plus rien de prévu »
          après le rafraîchissement — un démontage effacerait ce message. */}
      <section
        id="a-debriefer"
        className={`scroll-mt-6 ${debriefMeetings.length > 0 ? "mb-8" : "mb-8 empty:hidden"}`}
      >
        {debriefMeetings.length > 0 && (
          <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
            Rendez-vous à débriefer
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300">
              {debriefMeetings.length}
            </span>
          </h2>
        )}
        <DebriefList meetings={debriefMeetings} />
      </section>

      {nothingAtAll ? (
        <EmptyState
          title="Rien à faire aujourd'hui"
          hint="Posez une relance ou un rendez-vous sur une fiche prospect : il remontera ici à sa date."
          href="/prospects"
          cta="Voir les prospects"
        />
      ) : (
        <div className="space-y-8">
          {/* ---------- 1. À appeler / à rappeler ---------- */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              À appeler / à rappeler
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-slate-400">
                {overdue.length + today.length}
              </span>
            </h2>

            {overdue.length + today.length === 0 ? (
              <div className="card px-5 py-6 text-center text-sm text-slate-500">
                Rien à appeler aujourd&apos;hui.
              </div>
            ) : (
              <div className="space-y-6">
                <TaskSection
                  title="En retard"
                  tone="late"
                  tasks={overdue}
                  lecture={relancesLues}
                />
                <TaskSection
                  title="Aujourd'hui"
                  tasks={today}
                  lecture={relancesLues}
                />
              </div>
            )}
          </section>

          {/* ---------- 2. En attente de réponse — zone CALME ---------- */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              En attente de réponse
              {waiting.length > 0 && (
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-slate-300">
                  {waiting.length}
                </span>
              )}
            </h2>

            {waiting.length === 0 ? (
              <div className="card px-5 py-5 text-center text-sm text-slate-500">
                Aucun mail en attente de réponse.
              </div>
            ) : (
              <>
                <p className="mb-2 text-[11px] text-slate-500">
                  Le mail est parti — rien à faire pour l&apos;instant. Sans
                  réponse, chaque fiche remonte dans « À appeler / à rappeler »
                  à la date indiquée.
                </p>
                <ul className="card animate-rise divide-y divide-white/[0.05]">
                  {waiting.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
                    >
                      <Icone
                        nom="enveloppe"
                        className="h-3.5 w-3.5 text-slate-400"
                      />
                      <div className="min-w-[12rem] flex-1">
                        <Link
                          href={lienDepuisAFaire(p.id)}
                          prefetch={false}
                          title={p.company_name}
                          className="block truncate text-sm font-medium text-slate-100 underline-offset-2 hover:text-celya-blue hover:underline"
                        >
                          {p.company_name}
                        </Link>
                        <p className="text-xs text-slate-400">
                          Mail envoyé{p.sent_at ? ` ${relative(p.sent_at)}` : ""}
                          {p.contact_name ? ` à ${p.contact_name}` : ""}
                        </p>
                      </div>
                      {p.next_action_kind === "rendez_vous" ? (
                        <ProchaineActionTexte
                          at={p.next_action_at}
                          kind={p.next_action_kind}
                          className="shrink-0 text-xs"
                        />
                      ) : (
                        <span className="shrink-0 text-xs text-slate-400">
                          {p.next_action_at
                            ? `Remonte le ${fmtDate(p.next_action_at)}`
                            : "Aucune relance posée"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      )}


      {/* ---------- 3. Réponses reçues — agir maintenant ---------- */}
      <section className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
          Réponses reçues
          {replies.length > 0 && (
            <span className="rounded-full bg-celya-blue/15 px-2 py-0.5 text-[11px] text-blue-300">
              {replies.length}
            </span>
          )}
          {admin && (
            <span className="ml-auto text-[11px] font-normal normal-case tracking-normal">
              <Link href="/emails" className="text-slate-500 hover:text-slate-300">
                Non rattachés
              </Link>
            </span>
          )}
        </h2>

        {replies.length === 0 ? (
          <div className="card px-5 py-6 text-center text-sm text-slate-500">
            Aucune réponse en attente. Les réponses aux emails remontent ici
            automatiquement (relève toutes les 5 minutes).
          </div>
        ) : (
          <ul className="card animate-rise divide-y divide-white/[0.05]">
            {replies.map((e) => (
              <ReplyCard key={e.id} email={e} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function TaskSection({
  title,
  tasks,
  tone,
  lecture,
}: {
  title: string;
  tasks: TaskWithProspect[];
  tone?: "late";
  /**
   * Les identifiants des relances qui se LISENT (voir `relanceLue`) — de la
   * donnée, pas un prédicat : `TaskList` est un composant client et nous
   * sommes côté serveur. Les identifiants étrangers à cette section ne
   * dérangent pas, la ligne se reconnaît par le sien.
   */
  lecture?: string[];
}) {
  if (tasks.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            tone === "late"
              ? "bg-amber-500/15 text-amber-300"
              : "bg-white/[0.06] text-slate-400"
          }`}
        >
          {tasks.length}
        </span>
      </h3>

      <TaskList
        tasks={tasks}
        className="card animate-rise divide-y divide-white/[0.05]"
        lecture={lecture}
      />
    </div>
  );
}
