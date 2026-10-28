"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { attribuerProspectsAction, moveProspectAction } from "@/app/actions";
import {
  Avatar,
  EtiquetteJanet,
  Icone,
  LastActionLine,
  ProchaineActionTexte,
  StatusChip,
} from "@/components/ui";
import { BoutonEtoile } from "@/components/BoutonEtoile";
import { STATUS_LABEL, STATUS_ORDER, fmtDate, relative } from "@/lib/constants";
import { lienTel } from "@/lib/crm/telephone";
import { composerHref } from "@/lib/crm/composer";
import type { LastActionKind } from "@/lib/crm/lastAction";
import type { ConfidenceLevel, ProspectStatus } from "@/lib/types";

/** Une carte de la liste — des valeurs seulement (frontière serveur → client). */
export type LigneListe = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  status: ProspectStatus;
  confidence_level: ConfidenceLevel | null;
  confidence_reason: string | null;
  confidence_locked: boolean;
  next_action_at: string | null;
  next_action_kind: string | null;
  plus_rien: boolean;
  etoilee: boolean;
  /** « Ce qu'on sait » (prospects.notes), borné par la page. */
  note: string | null;
  /** La fiche est-elle à moi (ou suis-je admin) ? Sinon : lecture seule. */
  modifiable: boolean;
  /** Le nom du responsable — rempli quand la liste mêle plusieurs personnes. */
  responsable: string | null;
  janet: boolean;
  last_kind: LastActionKind | null;
  last_at: string | null;
  last_outcome: string | null;
  last_text: string | null;
  last_no_answer_streak: number | null;
  /** Rempli sous le filtre « Emails envoyés » seulement. */
  dernier_mail: string | null;
};

/**
 * La liste des prospects (27/10, au soir — « moche, plein de cases qui ne
 * servent à rien ») : UNE LIGNE par prospect, sans cadre autour de chaque
 * élément, dans l'ordre que la page a calculé (lib/crm/ordreProspects.ts :
 * étoilées, en retard, aujourd'hui, à venir, jamais appelées, rien de prévu).
 *
 * Sur la ligne, et rien d'autre : ⭐ · la société et son contact, « Ce qu'on
 * sait » en gris dessous · l'ÉTAPE en petite liste déroulante (le même chemin
 * que le glisser-déposer du pipeline : `moveProspectAction`, qui VERROUILLE) ·
 * le dernier résultat · la relance en date ET heure · Appeler. Toute la ligne
 * ouvre la fiche (lien étiré) ; l'étoile, l'étape, la note, « ✉ » et
 * « Appeler » passent au-dessus. Sur téléphone, la ligne devient une carte
 * compacte de trois lignes. La confiance n'y est plus : elle vit sur la fiche.
 *
 * Sur la fiche d'un collègue, l'étape est du TEXTE (masquer, pas désactiver :
 * la base refuserait après coup).
 *
 * ADMIN : une case par ligne, et « Attribuer à… » — la base revérifie
 * (`attribuer_prospects`, 031). Les membres arrivent en chaînes.
 */
export function ListeProspects({
  lignes,
  admin,
  membres,
  filtreEmails,
}: {
  lignes: LigneListe[];
  admin: boolean;
  /** [id, nom] des membres actifs — l'admin seul en reçoit. */
  membres: [string, string][];
  filtreEmails: boolean;
}) {
  const [choisies, setChoisies] = useState<Set<string>>(new Set());
  const [ouvertes, setOuvertes] = useState<Set<string>>(new Set());
  const [cible, setCible] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [pending, startTransition] = useTransition();
  /** L'étape change AU CHOIX ; le serveur suit (et un refus la ramène seule). */
  const [vue, appliquer] = useOptimistic(
    lignes,
    (liste: LigneListe[], patch: { id: string; status: ProspectStatus }) =>
      liste.map((l) => (l.id === patch.id ? { ...l, status: patch.status } : l))
  );

  const basculer = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  function changerEtape(id: string, status: ProspectStatus) {
    setMessage(null);
    startTransition(async () => {
      appliquer({ id, status });
      try {
        await moveProspectAction(id, status);
      } catch {
        setMessage({ ok: false, texte: "L'étape n'a pas pu être enregistrée. Réessayez." });
      }
    });
  }

  function attribuer() {
    if (!cible || choisies.size === 0) return;
    const nom = membres.find(([id]) => id === cible)?.[1] ?? "ce membre";
    const ids = [...choisies];
    setMessage(null);
    startTransition(async () => {
      const res = await attribuerProspectsAction(ids, cible);
      if (res.error) {
        setMessage({ ok: false, texte: res.error });
        return;
      }
      setChoisies(new Set());
      const n = res.n ?? 0;
      setMessage({
        ok: true,
        texte:
          n === 0
            ? `Rien à changer : ${ids.length > 1 ? "ces fiches étaient déjà" : "cette fiche était déjà"} à ${nom}.`
            : `${n} fiche${n > 1 ? "s" : ""} attribuée${n > 1 ? "s" : ""} à ${nom} — relances ouvertes et rendez-vous à venir compris.`,
      });
    });
  }

  const toutes = vue.length > 0 && choisies.size === vue.length;

  return (
    <>
      {(admin || message) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          {admin && (
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={toutes}
                onChange={() => setChoisies(toutes ? new Set() : new Set(vue.map((l) => l.id)))}
                className="h-5 w-5 accent-celya-blue"
              />
              Tout sélectionner
            </label>
          )}
          {message && (
            <span role="status" className={message.ok ? "text-emerald-300" : "text-rose-300"}>
              {message.texte}
            </span>
          )}
        </div>
      )}

      {/* Entêtes de colonne — grand écran (`xl`) seulement : plus étroit, la carte. */}
      <div
        aria-hidden
        className={`hidden px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 xl:grid xl:gap-3 ${
          admin ? GRILLE_ADMIN : GRILLE
        }`}
      >
        {admin && <span />}
        <span />
        <span>Prospect</span>
        <span>Étape</span>
        <span>{filtreEmails ? "Dernier mail" : "Dernier résultat"}</span>
        <span>Relance</span>
        <span />
      </div>

      <ul className="card animate-rise divide-y divide-white/[0.05] overflow-hidden">
        {vue.map((p) => {
          const tel = lienTel(p.phone);
          const noteOuverte = ouvertes.has(p.id);
          const qui = [p.contact_name, p.city].filter(Boolean).join(" · ") || p.email || "";
          return (
            <li
              key={p.id}
              className={`relative px-3 py-2.5 transition xl:grid xl:items-center xl:gap-3 xl:py-2 xl:hover:bg-white/[0.025] ${
                admin ? GRILLE_ADMIN : GRILLE
              } ${choisies.has(p.id) ? "bg-celya-blue/[0.06]" : ""}`}
            >
              {admin && (
                <label className="absolute left-0 top-1.5 z-10 inline-flex h-11 w-9 cursor-pointer items-center justify-center xl:static">
                  <input
                    type="checkbox"
                    checked={choisies.has(p.id)}
                    onChange={() => setChoisies((s) => basculer(s, p.id))}
                    aria-label={`Sélectionner ${p.company_name}`}
                    className="h-5 w-5 accent-celya-blue"
                  />
                </label>
              )}

              {/* ⭐ + qui c'est (téléphone : la première ligne, avec Appeler). */}
              <div className={`flex min-w-0 items-start gap-1 xl:contents ${admin ? "pl-8 xl:pl-0" : ""}`}>
                {/* Une cellule de grille TOUJOURS présente (ordinateur) : sur la
                    fiche d'un collègue sans étoile, le bouton ne rend rien, et
                    toute la ligne glissait d'une colonne — le nom écrasé à zéro. */}
                {p.modifiable || p.etoilee ? (
                  <BoutonEtoile
                    prospectId={p.id}
                    etoilee={p.etoilee}
                    modifiable={p.modifiable}
                    nom={p.company_name}
                    className="-ml-2 -mt-1.5 xl:-my-1.5"
                  />
                ) : (
                  <span aria-hidden className="hidden xl:block" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5">
                    {/* Pas de préchargement : 500 lignes, 500 rendus de fiche. */}
                    <Link
                      href={`/prospects/${p.id}`}
                      prefetch={false}
                      title={p.company_name}
                      className="min-w-[3rem] truncate font-semibold text-slate-50 before:absolute before:inset-0 before:content-['']"
                    >
                      {p.company_name}
                    </Link>
                    {qui && (
                      // Sur la ligne du nom à partir de `xl` seulement : plus étroit, le nom,
                      // l'étiquette Janet et l'avatar ne laissent pas de quoi lire.
                      <span className="hidden min-w-[3rem] max-w-[45%] truncate text-xs text-slate-400 xl:inline" title={qui}>
                        {qui}
                      </span>
                    )}
                    {p.janet && <EtiquetteJanet compact />}
                    {p.responsable && (
                      <span className="shrink-0" title={p.responsable}>
                        <Avatar name={p.responsable} />
                      </span>
                    )}
                  </p>
                  {qui && (
                    <p className="truncate text-xs text-slate-400 xl:hidden" title={qui}>
                      {qui}
                    </p>
                  )}
                  {p.note && (
                    <button
                      type="button"
                      onClick={() => setOuvertes((s) => basculer(s, p.id))}
                      aria-expanded={noteOuverte}
                      title={noteOuverte ? undefined : p.note}
                      // `block` et `line-clamp-1` ne vont pas ensemble : le
                      // second a besoin de `display: -webkit-box`.
                      className={`relative z-10 mt-0.5 w-full text-left text-xs leading-relaxed text-slate-500 ${
                        noteOuverte ? "block whitespace-pre-wrap text-slate-300" : "line-clamp-1"
                      }`}
                    >
                      {p.note}
                    </button>
                  )}
                </div>
                {tel && (
                  <a
                    href={tel}
                    aria-label={`Appeler ${p.company_name}`}
                    title={p.phone ?? undefined}
                    className="relative z-10 -mr-1 -mt-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-celya-blue transition hover:bg-white/[0.06] xl:hidden"
                  >
                    <Icone nom="telephone" className="h-4 w-4" />
                  </a>
                )}
              </div>

              {/* L'étape, la relance, le dernier résultat (téléphone : une ligne). */}
              <div className={`mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs xl:contents ${admin ? "pl-8 xl:pl-0" : ""}`}>
                <div className="relative z-10 xl:min-w-0">
                  {p.modifiable ? (
                    // La PUCE se voit, le menu natif est posé dessus, transparent :
                    // un tap ouvre le sélecteur du téléphone, et la règle des
                    // 16 px (anti-zoom iOS, globals.css) ne grossit pas la ligne.
                    <span className="relative inline-flex items-center rounded-full focus-within:ring-2 focus-within:ring-celya-blue/60">
                      <StatusChip status={p.status} />
                      <Icone nom="chevron" className="ml-1 h-2.5 w-2.5 text-slate-500" />
                      <select
                        value={p.status}
                        onChange={(e) => changerEtape(p.id, e.target.value as ProspectStatus)}
                        disabled={pending}
                        aria-label={`Étape de ${p.company_name}`}
                        title="Changer l'étape — ce choix est alors verrouillé"
                        className="absolute inset-0 h-full min-h-[36px] w-full cursor-pointer appearance-none opacity-0"
                      >
                        {STATUS_ORDER.map((s) => (
                          <option key={s} value={s} className="bg-[#121829] text-slate-100">
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </span>
                  ) : (
                    <StatusChip status={p.status} />
                  )}
                </div>
                <div className="min-w-0 truncate text-[11px] xl:order-none">
                  {filtreEmails && p.dernier_mail ? (
                    <span className="text-slate-400">
                      {fmtDate(p.dernier_mail)} · {relative(p.dernier_mail)}
                    </span>
                  ) : p.last_kind ? (
                    <LastActionLine
                      kind={p.last_kind}
                      at={p.last_at}
                      outcome={p.last_outcome}
                      text={p.last_text}
                      streak={p.last_no_answer_streak}
                    />
                  ) : (
                    <span className="text-slate-600 xl:inline">{p.status === "a_appeler" ? "Jamais appelée" : ""}</span>
                  )}
                </div>
                <div className="min-w-0 text-[11px] xl:text-xs">
                  <ProchaineActionTexte
                    at={p.next_action_at}
                    kind={p.next_action_kind}
                    statut={p.status}
                    plusRien={p.plus_rien}
                    avecHeure
                    couleurNeutre="text-slate-300"
                    sansDate=""
                    className="whitespace-nowrap"
                  />
                </div>
              </div>

              {/* Les gestes, ordinateur — au-dessus du lien étiré. */}
              <div className="relative z-10 hidden items-center justify-end xl:flex">
                {p.email && p.modifiable && (
                  <Link
                    href={composerHref(p.id)}
                    prefetch={false}
                    title={`Écrire à ${p.email}`}
                    aria-label={`Écrire à ${p.company_name}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white/[0.06] hover:text-celya-blue"
                  >
                    <Icone nom="enveloppe" className="h-4 w-4" />
                  </Link>
                )}
                {tel && (
                  <a
                    href={tel}
                    aria-label={`Appeler ${p.company_name}`}
                    title={p.phone ?? undefined}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-celya-blue transition hover:bg-celya-blue/10"
                  >
                    <Icone nom="telephone" className="h-3.5 w-3.5" />
                    Appeler
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* La barre d'attribution — au-dessus de la barre d'onglets du téléphone. */}
      {admin && choisies.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 px-4 lg:bottom-6 lg:left-64">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl bg-[#121829] px-3 py-2 shadow-2xl ring-1 ring-white/15">
            <span className="text-sm text-slate-200">
              {choisies.size} sélectionnée{choisies.size > 1 ? "s" : ""}
            </span>
            <select
              value={cible}
              onChange={(e) => setCible(e.target.value)}
              aria-label="Attribuer à"
              className="input min-h-[44px] w-auto min-w-0 flex-1 py-1.5 text-sm"
            >
              <option value="">Attribuer à…</option>
              {membres.map(([id, nom]) => (
                <option key={id} value={id}>
                  {nom}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={attribuer}
              disabled={!cible || pending}
              className="btn-primary min-h-[44px] px-4 text-sm"
            >
              {pending ? "Attribution…" : "Attribuer"}
            </button>
            <button
              type="button"
              onClick={() => setChoisies(new Set())}
              className="btn-link min-h-[44px] text-xs"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Les colonnes de la ligne, à partir de `xl` (classes complètes : règle JIT). */
const GRILLE =
  "xl:grid-cols-[2.25rem_minmax(0,2.2fr)_9.5rem_minmax(0,1.5fr)_9rem_8rem]";
const GRILLE_ADMIN =
  "xl:grid-cols-[2.25rem_2.25rem_minmax(0,2.2fr)_9.5rem_minmax(0,1.5fr)_9rem_8rem]";
