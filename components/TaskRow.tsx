"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { fmtDate, fmtDateTime, relative } from "@/lib/constants";
import { localInputToISO } from "@/lib/time";
import { composerHref } from "@/lib/crm/composer";
import { infoRdvPrevu, jourHeureCourt } from "@/lib/crm/prochaineAction";
import { ResultatAppel } from "@/components/ResultatAppel";
import { DebriefRdv } from "@/components/DebriefRdv";
import { ChoixRelance } from "@/components/ChoixRelance";
import { Icone, LastActionLine } from "@/components/ui";
import type { LastActionKind } from "@/lib/crm/lastAction";
import { lienDepuisAFaire } from "@/lib/crm/ficheSuivante";
import { lienTel } from "@/lib/crm/telephone";
import { DUREE_REPLI_MS, type Phase, type TypeGeste } from "@/lib/crm/gesteRelance";

/** Ce que la ligne dit pendant un geste — « Annuler » à côté. */
const LIBELLE_GESTE: Record<TypeGeste, string> = {
  fait: "Faite",
  rouvrir: "Rouverte",
  supprime: "Supprimée",
};

export type TaskWithProspect = {
  id: string;
  title: string;
  details: string | null;
  due_at: string;
  status: string;
  priority: number;
  prospect_id: string | null;
  /**
   * À qui la relance est assignée. Chargée seulement là où il faut savoir si
   * on a le droit d'y toucher — « À faire » en périmètre d'équipe, où l'on voit
   * aussi les relances d'un collègue (interrupteur d'équipe, migration 020).
   */
  assignee_id?: string | null;
  prospects?: {
    id: string;
    company_name: string;
    contact_name: string | null;
    phone?: string | null;
    email?: string | null;
    /** Étoilée (031) : une étoile devant le nom, et la ligne en tête de zone. */
    starred_at?: string | null;
    /**
     * La prochaine action de la fiche (« À faire » seulement) : un rendez-vous
     * à venir s'y lit, et la ligne le dit (024) — la relance reste à faire,
     * mais le rendez-vous demeure la prochaine action de la fiche.
     */
    next_action_at?: string | null;
    next_action_kind?: string | null;
  } | null;
  /**
   * Le rendez-vous PASSÉ de la fiche qui attend son issue (« À faire »
   * seulement, tiré de `rdvADebriefer`). Présent : la ligne offre le débrief
   * À LA PLACE de « Résultat », comme la carte de la fiche — un résultat
   * d'appel n'a pas de sens tant qu'on ne sait pas ce qu'a donné le RDV.
   * Des chaînes seulement : la ligne vit côté client.
   */
  rdv_a_debriefer?: { id: string; starts_at: string } | null;
  /**
   * La dernière action de la fiche (vue prospect_action_state), quand
   * l'appelant l'a chargée. C'est elle qui dit « Pas décroché (3e fois) »
   * AVANT de rappeler — l'information qui manquait le plus dans « À faire ».
   * Seul « À faire » la charge : la fiche ne passe jamais `derniere_action`.
   */
  derniere_action?: {
    kind: LastActionKind | null;
    at: string | null;
    outcome: string | null;
    text: string | null;
    streak: number | null;
  } | null;
};

/**
 * Une ligne de relance — purement présentation.
 *
 * Elle ne parle plus au serveur elle-même : c'est `TaskList` qui tient l'état
 * optimiste de la liste et déclenche les server actions. Sans quoi chaque
 * ligne aurait attendu son propre aller-retour avant de bouger, et cocher une
 * relance figeait l'écran une seconde et demie.
 *
 * Deux modes. Sur « À faire », la ligne se travaille : case à cocher, date,
 * raccourcis, suppression, « Résultat ». Sur la fiche, seule la PREMIÈRE
 * relance passe en `lecture` — celle-là se pilote dans la carte PROCHAINE
 * ACTION, un geste à un seul endroit. Une deuxième, rare, garde ses commandes
 * là où elle s'affiche, parce qu'À faire ne la montrera qu'à sa date.
 */
export function TaskRow({
  task,
  compact = false,
  lecture = false,
  pending = false,
  geste,
  onAnnuler,
  onComplete,
  onReschedule,
  onDelete,
}: {
  task: TaskWithProspect;
  /** Colonne étroite (fiche prospect) : les commandes passent sous le titre. */
  compact?: boolean;
  /** Lecture seule : le titre, la date et le détail, rien à taper. */
  lecture?: boolean;
  /** Un geste est en cours sur CETTE ligne — le spinner est ici, pas ailleurs. */
  pending?: boolean;
  /**
   * Un geste a ENGAGÉ la ligne (lib/crm/gesteRelance.ts) : elle reste à sa
   * place, barrée, « Annuler » offert, puis se replie — et ne reçoit plus
   * aucun tap. Rien sous le doigt ne remonte pendant ce temps.
   */
  geste?: { type: TypeGeste; phase: Phase };
  onAnnuler?: () => void;
  onComplete?: () => void;
  /** (valeur du champ « YYYY-MM-DDTHH:mm » en heure de Bruxelles, ISO UTC) */
  onReschedule?: (dueLocal: string, dueISO: string) => void;
  onDelete?: () => void;
}) {
  const done = task.status === "fait";
  const overdue = !done && new Date(task.due_at).getTime() < Date.now();
  /** Le résultat d'appel se déplie EN PLACE — sans ouvrir la fiche. */
  const [resultatOuvert, setResultatOuvert] = useState(false);
  /**
   * Le débrief vient d'être envoyé : la ligne repasse à « Résultat » sans
   * attendre le rendu serveur (et y revient seule si le serveur refuse).
   */
  const [debriefFait, setDebriefFait] = useState(false);
  const rdvEnAttente = debriefFait ? null : task.rdv_a_debriefer ?? null;
  /** « À rappeler » vient d'être tapé : la ligne réclame une date. */
  const [pourQuand, setPourQuand] = useState(false);
  /**
   * La date et son choix (jour − / +, heures) se déplient d'un tap sur la
   * date, sous la ligne — téléphone comme ordinateur depuis le 28/10.
   */
  const [reprogOuvert, setReprogOuvert] = useState(false);
  const tel = lienTel(task.prospects?.phone);
  /** Une ligne engagée ou en cours d'enregistrement ne prend plus aucun tap. */
  const bloque = pending || Boolean(geste);
  const engagee = geste && geste.phase !== "retour";
  const repliee = geste?.phase === "repli";
  /**
   * Le repli se fait EN HAUTEUR, depuis la hauteur réelle de la ligne : on la
   * mesure quand le geste l'engage, et la transition part de là vers zéro.
   */
  const ref = useRef<HTMLLIElement>(null);
  const [hauteur, setHauteur] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (engagee && hauteur === null && ref.current) setHauteur(ref.current.offsetHeight);
    if (!engagee && hauteur !== null) setHauteur(null);
  }, [engagee, hauteur]);

  /** Reprogramme au jour ET à l'heure choisis (ChoixRelance : « YYYY-MM-DDTHH:mm »). */
  function reschedule(valeur: string) {
    if (!valeur || !onReschedule) return;
    setPourQuand(false);
    const local = valeur.length >= 16 ? valeur.slice(0, 16) : `${valeur}T09:00`;
    // La date affichée tout de suite doit être la vraie : même conversion que
    // le serveur (heure de Bruxelles → UTC), par le même utilitaire.
    onReschedule(local, localInputToISO(local) ?? task.due_at);
  }

  return (
    <li
      ref={ref}
      aria-busy={pending || undefined}
      // Pendant le repli, la ligne ne reçoit plus de taps (et ne se lit plus).
      aria-hidden={repliee || undefined}
      style={
        engagee && hauteur !== null
          ? {
              maxHeight: repliee ? 0 : hauteur,
              transition: `max-height ${DUREE_REPLI_MS}ms ease-out, opacity ${DUREE_REPLI_MS}ms ease-out, padding ${DUREE_REPLI_MS}ms ease-out`,
              overflow: "hidden",
              ...(repliee ? { paddingTop: 0, paddingBottom: 0, opacity: 0 } : {}),
            }
          : undefined
      }
      className={`gap-3 px-4 py-3.5 transition-opacity duration-150 ${
        repliee ? "pointer-events-none" : ""
      } ${
        !engagee && pending ? "opacity-60" : ""
      } ${
        lecture
          ? "block"
          : compact
            ? "grid grid-cols-[auto_minmax(0,1fr)] items-start"
            : "flex flex-wrap items-start"
      }`}
    >
      {!lecture && (
        <div className="pt-0.5">
          {/* La case garde son dessin de 20 px ; sur téléphone, la zone qui
              répond au doigt fait 44 px (marges négatives : la ligne ne bouge pas). */}
          <button
            type="button"
            onClick={onComplete}
            disabled={!onComplete || bloque}
            aria-busy={pending || undefined}
            aria-label={done ? "Rouvrir la relance" : "Marquer comme faite"}
            className="group -m-3 grid h-11 w-11 place-items-center lg:souris:m-0 lg:souris:h-5 lg:souris:w-5"
          >
            <span
              className={`grid h-5 w-5 place-items-center rounded-md ring-1 transition ${
                (geste ? geste.type === "fait" : done)
                  ? "bg-emerald-500/25 text-emerald-300 ring-emerald-400/30"
                  : "bg-white/[0.04] text-transparent ring-white/15 group-hover:ring-celya-blue/60"
              }`}
            >
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
                <path d="M8 13.2 4.8 10l-1.2 1.2L8 15.6l8.4-8.4-1.2-1.2z" />
              </svg>
            </span>
          </button>
        </div>
      )}

      <div className={`min-w-0 flex-1 ${engagee ? "[&>*:not(.geste-annuler)]:opacity-60" : ""}`}>
        {/* Un bloc, pas une rangée flex : le texte d'un élément flex ne passe
            pas à la ligne au milieu d'un mot trop long, il pousse la ligne. */}
        <p
          className={`text-sm font-medium ${
            (done && geste?.type !== "rouvrir") || (engagee && geste?.type !== "rouvrir")
              ? "text-slate-500 line-through"
              : "text-slate-100"
          }`}
        >
          {task.priority === 1 && !done && (
            <span className="mr-1.5 inline-flex align-[-1px] text-amber-400" title="Priorité haute">
              <Icone nom="alerte" className="h-3 w-3" />
            </span>
          )}
          {task.title}
        </p>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
          {!lecture && task.prospects && (
            <>
              <Link
                // Ce lien n'existe que sur « À faire » (seul écran qui joint la
                // fiche à ses relances) : il porte `depuis`, pour « Fiche
                // suivante » (lib/crm/ficheSuivante.ts).
                href={lienDepuisAFaire(task.prospects.id)}
                prefetch={false}
                className="min-w-0 text-slate-400 underline-offset-2 hover:text-celya-blue hover:underline"
              >
                {task.prospects.starred_at && (
                  <span className="mr-1 inline-flex align-[-2px] text-amber-300" title="Étoilée">
                    <Icone nom="etoile" className="h-3.5 w-3.5 fill-current" />
                  </span>
                )}
                {task.prospects.company_name}
              </Link>
              {tel && (
                <a href={tel} className="hidden text-celya-blue hover:underline lg:souris:inline">
                  {task.prospects.phone}
                </a>
              )}
              {/* Écrire depuis « À faire » : le composeur s'ouvre déplié sur
                  la fiche, sans chercher où il se cache. */}
              {task.prospects.email && (
                <Link
                  href={composerHref(task.prospects.id)}
                  prefetch={false}
                  title={`Écrire à ${task.prospects.email}`}
                  aria-label={`Écrire à ${task.prospects.company_name}`}
                  className="text-slate-500 transition hover:text-celya-blue"
                >
                  <Icone nom="enveloppe" className="h-3.5 w-3.5" />
                </Link>
              )}
              <span aria-hidden>·</span>
            </>
          )}
          {/* En lecture, la date est le seul signal de retard qui reste : elle
              porte donc son pictogramme — la couleur ne parle jamais seule. */}
          <span
            className={overdue ? "inline-flex items-center gap-1 text-amber-300" : ""}
          >
            {overdue && lecture && <Icone nom="alerte" className="h-3 w-3" />}
            {overdue ? "En retard — " : ""}
            {fmtDateTime(task.due_at)}
          </span>
          <span aria-hidden>·</span>
          <span>{relative(task.due_at)}</span>
        </p>

        {task.details && (
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{task.details}</p>
        )}

        {/* La fiche a un rendez-vous à venir : c'est lui sa prochaine action
            (024). La relance se fait quand même — on informe, on ne bloque rien. */}
        {task.prospects?.next_action_kind === "rendez_vous" &&
          task.prospects.next_action_at &&
          new Date(task.prospects.next_action_at).getTime() > Date.now() && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-blue-200/90">
              <Icone nom="calendrier" className="h-3 w-3 shrink-0" />
              {infoRdvPrevu(task.prospects.next_action_at)}
            </p>
          )}

        {/* Ce qu'a donné le dernier appel — avant d'en passer un autre. Seul
            « À faire » charge `derniere_action` ; la fiche ne la passe pas. */}
        {task.derniere_action?.kind && (
          <p className="mt-1 truncate">
            <LastActionLine
              kind={task.derniere_action.kind}
              at={task.derniere_action.at}
              outcome={task.derniere_action.outcome}
              text={task.derniere_action.text}
              streak={task.derniere_action.streak}
            />
          </p>
        )}

        {/* Le geste vient d'être fait : la ligne le DIT, à sa place, et offre
            « Annuler » ~1,5 s avant de se replier (lib/crm/gesteRelance.ts). */}
        {/* Au doigt (et sur la fiche), à la place EXACTE de la rangée d'actions
            (mêmes marge et hauteur) : la ligne ne change pas de taille, rien
            ne bouge sous le doigt. À la souris, « Annuler » est à droite du
            titre, à la place de la date. */}
        {engagee && geste && (
          <p
            className={`geste-annuler mt-2.5 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300 ${
              compact ? "flex" : "flex lg:souris:hidden"
            }`}
            aria-live="polite"
          >
            <span className="inline-flex items-center gap-1">
              <Icone nom={geste.type === "supprime" ? "croix" : "coche"} className="h-3 w-3" />
              {LIBELLE_GESTE[geste.type]}
            </span>
            {onAnnuler && (
              <button
                type="button"
                onClick={onAnnuler}
                className="btn-ghost min-h-[44px] px-3.5 py-1.5 text-xs"
              >
                Annuler
              </button>
            )}
          </p>
        )}

        {/* « Résultat » : deux taps depuis « À faire », sans ouvrir la fiche.
            C'est le geste qui manquait — après un appel, on ne navigue pas.
            Absent en lecture : sur la fiche, le résultat d'appel vit dans la
            carte PROCHAINE ACTION, et ici c'est le SEUL endroit où il tient. */}
        {!lecture && !done && !geste && task.prospects && rdvEnAttente && (
          <div className="mt-2">
            {resultatOuvert ? (
              <div className="rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06]">
                <p className="mb-2 text-[11px] text-slate-400">
                  Le rendez-vous du {jourHeureCourt(rdvEnAttente.starts_at)} attend son issue.
                </p>
                <DebriefRdv
                  meetingId={rdvEnAttente.id}
                  prospectId={task.prospects?.id ?? null}
                  contactActuel={task.prospects?.contact_name ?? null}
                  apres={(r) => {
                    if (r.ok) {
                      setDebriefFait(true);
                      setResultatOuvert(false);
                    }
                  }}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setResultatOuvert(true)}
                disabled={bloque}
                aria-expanded={resultatOuvert}
                className="btn-link hidden text-[11px] lg:souris:inline-flex"
              >
                Débriefer le RDV du {jourHeureCourt(rdvEnAttente.starts_at)}
              </button>
            )}
          </div>
        )}
        {!lecture && !done && !geste && task.prospects && !rdvEnAttente && (
          <div className="mt-2">
            {resultatOuvert ? (
              <ResultatAppel
                prospectId={task.prospects.id}
                contactActuel={task.prospects.contact_name}
                onRappeler={() => setPourQuand(true)}
                className="rounded-xl bg-white/[0.02] p-3 ring-1 ring-white/[0.06]"
              />
            ) : (
              <button
                type="button"
                onClick={() => setResultatOuvert(true)}
                disabled={bloque}
                aria-expanded={resultatOuvert}
                className="btn-link hidden text-[11px] lg:souris:inline-flex"
              >
                Résultat
              </button>
            )}
          </div>
        )}

        {/* Téléphone : UNE ligne d'actions sous le titre, au pouce (19/10) —
            Appeler, Résultat (ou le débrief du RDV), la date. Le titre garde
            toute la largeur au lieu d'être écrasé par les commandes. */}
        {!lecture && !done && !geste && !compact && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 lg:souris:hidden">
            {tel && (
              <a href={tel} className="btn-ghost min-h-[44px] px-3.5 text-xs">
                <Icone nom="telephone" className="h-4 w-4" />
                Appeler
              </a>
            )}
            {task.prospects && !resultatOuvert && (
              <button
                type="button"
                onClick={() => setResultatOuvert(true)}
                disabled={bloque}
                aria-expanded={false}
                className="btn-ghost min-h-[44px] px-3.5 text-xs"
              >
                {rdvEnAttente ? (
                  <>
                    <Icone nom="calendrier" className="h-4 w-4" />
                    Débriefer le RDV
                  </>
                ) : (
                  "Résultat"
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => setReprogOuvert((o) => !o)}
              disabled={bloque}
              aria-expanded={reprogOuvert}
              aria-label={`Reprogrammer — ${fmtDateTime(task.due_at)}`}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-xs ring-1 ring-white/10 transition hover:bg-white/[0.05] ${
                overdue ? "text-amber-300" : "text-slate-300"
              }`}
            >
              <Icone nom="report" className="h-3.5 w-3.5" />
              {jourHeureCourt(task.due_at)}
              <Icone nom="chevron" className={`h-3 w-3 transition ${reprogOuvert ? "rotate-180" : ""}`} />
            </button>
          </div>
        )}
      </div>

      {!lecture && engagee && geste && !compact && (
        <div className="hidden shrink-0 items-center gap-2 text-xs text-slate-300 lg:souris:flex" aria-live="polite">
          <span className="inline-flex items-center gap-1">
            <Icone nom={geste.type === "supprime" ? "croix" : "coche"} className="h-3 w-3" />
            {LIBELLE_GESTE[geste.type]}
          </span>
          {onAnnuler && (
            <button type="button" onClick={onAnnuler} className="btn-ghost min-h-[36px] px-3 py-1 text-xs">
              Annuler
            </button>
          )}
        </div>
      )}

      {!lecture && !done && !geste && !compact && (
        // Ordinateur : à droite du titre, la date — un clic déplie le choix
        // SOUS la ligne (28/10 : le choix tactile est trop grand pour rester
        // ouvert sur chaque relance), et la croix.
        <div className="hidden shrink-0 items-center gap-1 lg:souris:flex">
          <button
            type="button"
            onClick={() => setReprogOuvert((o) => !o)}
              disabled={bloque}
            aria-expanded={reprogOuvert || pourQuand}
            aria-label={`Reprogrammer — ${fmtDateTime(task.due_at)}`}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 text-xs ring-1 ring-white/10 transition hover:bg-white/[0.05] ${
              overdue ? "text-amber-300" : "text-slate-300"
            }`}
          >
            <Icone nom="report" className="h-3.5 w-3.5" />
            {jourHeureCourt(task.due_at)}
            <Icone nom="chevron" className={`h-3 w-3 transition ${reprogOuvert || pourQuand ? "rotate-180" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={!onDelete || bloque}
            title="Supprimer la relance"
            aria-label="Supprimer la relance"
            className="rounded-lg px-2 py-1 text-[11px] text-slate-600 transition hover:text-rose-400"
          >
            <Icone nom="croix" className="h-3 w-3" />
          </button>
        </div>
      )}

      {!lecture && !done && !geste && (
        // Le choix du jour et de l'heure (lib/crm/relance.ts — le même
        // composant que la carte PROCHAINE ACTION) : déplié SOUS la ligne,
        // aligné sur le titre (pl-8, la largeur de la case à cocher), d'un tap
        // sur la date. « À rappeler » vient d'être enregistré : il ne manque
        // plus que le jour, et il s'ouvre seul.
        <div
          className={
            compact
              ? "col-start-2 mt-2 flex flex-wrap items-center gap-1"
              : `basis-full pl-8 ${reprogOuvert || pourQuand ? "block" : "hidden"}`
          }
        >
          <ChoixRelance
            titre="Reprogrammer"
            onChoisir={(v) => {
              setReprogOuvert(false);
              reschedule(v);
            }}
            pending={!onReschedule || bloque}
            avertissement={pourQuand ? "Pour quand ?" : null}
          />
          {/* Supprimer est définitif : c'est le seul rose de la ligne. Sur
              ordinateur, la croix est à droite du titre. */}
          <button
            type="button"
            onClick={onDelete}
            disabled={!onDelete || bloque}
            title="Supprimer la relance"
            aria-label="Supprimer la relance"
            className={`min-h-[44px] min-w-[44px] rounded-lg px-2 py-1 text-[11px] text-slate-600 transition hover:text-rose-400 ${
              compact ? "" : "mt-1 lg:souris:hidden"
            }`}
          >
            <Icone nom="croix" className="h-3 w-3" />
          </button>
        </div>
      )}
    </li>
  );
}
