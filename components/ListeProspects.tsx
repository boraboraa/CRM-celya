"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { attribuerProspectsAction } from "@/app/actions";
import {
  Avatar,
  ConfidenceBadge,
  EtiquetteJanet,
  Icone,
  LastActionLine,
  ProchaineActionTexte,
  StatusChip,
} from "@/components/ui";
import { BoutonEtoile } from "@/components/BoutonEtoile";
import { STATUS_EDGE, fmtDate, relative } from "@/lib/constants";
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
 * La liste des prospects (27/10) — UNE carte par fiche, au téléphone comme à
 * l'ordinateur, dans l'ordre que la page a calculé (lib/crm/ordreProspects.ts :
 * étoilées, puis dû, puis le reste).
 *
 * Chaque carte dit, d'un coup d'œil : la société et son étape, l'étoile,
 * « Ce qu'on sait » DÈS « À appeler » (la recherche faite avant le premier
 * appel — tronquée, entière au survol ou au tap), la prochaine action, ce
 * qu'a donné le dernier appel, et « Appeler ». Toute la carte ouvre la fiche
 * (lien étiré) ; l'étoile, « Appeler », « ✉ » et la case passent au-dessus.
 *
 * ADMIN : une case par carte, et « Attribuer à… » — la base revérifie
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

  const basculer = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

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

  const toutes = lignes.length > 0 && choisies.size === lignes.length;

  return (
    <>
      {admin && (
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
          <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={toutes}
              onChange={() => setChoisies(toutes ? new Set() : new Set(lignes.map((l) => l.id)))}
              className="h-5 w-5 accent-celya-blue"
            />
            Tout sélectionner
          </label>
          {message && (
            <span role="status" className={message.ok ? "text-emerald-300" : "text-rose-300"}>
              {message.texte}
            </span>
          )}
        </div>
      )}

      <ul className="animate-rise space-y-2">
        {lignes.map((p) => {
          const tel = lienTel(p.phone);
          const noteOuverte = ouvertes.has(p.id);
          return (
            <li
              key={p.id}
              className={`card relative border-l-4 px-3 py-2.5 transition active:scale-[0.998] sm:px-4 lg:hover:bg-white/[0.03] ${STATUS_EDGE[p.status]} ${
                choisies.has(p.id) ? "ring-1 ring-celya-blue/50" : ""
              }`}
            >
              <div className="flex min-w-0 items-start gap-1">
                {admin && (
                  <label className="relative z-10 -ml-1 inline-flex h-11 w-9 shrink-0 cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      checked={choisies.has(p.id)}
                      onChange={() => setChoisies((s) => basculer(s, p.id))}
                      aria-label={`Sélectionner ${p.company_name}`}
                      className="h-5 w-5 accent-celya-blue"
                    />
                  </label>
                )}
                <BoutonEtoile
                  prospectId={p.id}
                  etoilee={p.etoilee}
                  modifiable={p.modifiable}
                  nom={p.company_name}
                  className={p.modifiable ? "-ml-2" : "mt-3.5 mr-1"}
                />

                <div className="min-w-0 flex-1 pt-1.5 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-4">
                  {/* Qui c'est, et ce qu'on en sait. */}
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-1.5">
                      {/* Pas de préchargement : 500 lignes, 500 rendus de fiche. */}
                      <Link
                        href={`/prospects/${p.id}`}
                        prefetch={false}
                        className="truncate font-semibold text-slate-50 before:absolute before:inset-0 before:content-['']"
                      >
                        {p.company_name}
                      </Link>
                      {p.janet && <EtiquetteJanet compact />}
                    </p>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusChip status={p.status} />
                      <span className="min-w-0 truncate text-xs text-slate-400">
                        {[p.contact_name, p.city].filter(Boolean).join(" · ") || p.email || ""}
                      </span>
                      <span className="hidden lg:inline-flex">
                        <ConfidenceBadge
                          level={p.confidence_level}
                          reason={p.confidence_reason}
                          locked={p.confidence_locked}
                        />
                      </span>
                    </div>
                    {p.note && (
                      <button
                        type="button"
                        onClick={() => setOuvertes((s) => basculer(s, p.id))}
                        aria-expanded={noteOuverte}
                        title={noteOuverte ? undefined : p.note}
                        className={`relative z-10 mt-1.5 block w-full rounded-lg text-left text-xs leading-relaxed text-slate-300 ${
                          noteOuverte ? "whitespace-pre-wrap" : "line-clamp-2"
                        }`}
                      >
                        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          Ce qu&apos;on sait
                        </span>
                        {p.note}
                      </button>
                    )}
                  </div>

                  {/* Ce qui vient, et ce qui s'est passé. */}
                  <div className="mt-1.5 min-w-0 space-y-1 text-xs lg:mt-0">
                    <p className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-500 lg:hidden">
                        Ensuite
                      </span>
                      <ProchaineActionTexte
                        at={p.next_action_at}
                        kind={p.next_action_kind}
                        statut={p.status}
                        plusRien={p.plus_rien}
                        className="min-w-0 truncate"
                      />
                    </p>
                    {p.last_kind && (
                      <p className="truncate text-[11px]">
                        <LastActionLine
                          kind={p.last_kind}
                          at={p.last_at}
                          outcome={p.last_outcome}
                          text={p.last_text}
                          streak={p.last_no_answer_streak}
                        />
                      </p>
                    )}
                    {filtreEmails && p.dernier_mail && (
                      <p className="text-[11px] text-slate-400">
                        Dernier mail : {fmtDate(p.dernier_mail)} · {relative(p.dernier_mail)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Les gestes — au-dessus du lien étiré. */}
                <div className="relative z-10 flex shrink-0 items-center">
                  {p.responsable && (
                    <span className="mr-1 hidden sm:inline-flex">
                      <Avatar name={p.responsable} />
                    </span>
                  )}
                  {p.email && p.modifiable && (
                    <Link
                      href={composerHref(p.id)}
                      prefetch={false}
                      title={`Écrire à ${p.email}`}
                      aria-label={`Écrire à ${p.company_name}`}
                      className="hidden h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white/[0.06] hover:text-celya-blue sm:inline-flex"
                    >
                      <Icone nom="enveloppe" className="h-4 w-4" />
                    </Link>
                  )}
                  {tel && (
                    <a
                      href={tel}
                      aria-label={`Appeler ${p.company_name}`}
                      title={p.phone ?? undefined}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-celya-blue transition hover:bg-white/[0.06] active:bg-white/[0.06]"
                    >
                      <Icone nom="telephone" className="h-4 w-4" />
                    </a>
                  )}
                </div>
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
