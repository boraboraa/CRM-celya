"use client";

import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import {
  poserRendezVousAction,
  deplacerRendezVousAction,
} from "@/app/actions";
import { BoutonsMaps } from "@/components/BoutonsMaps";
import { isoToLocalInput, localInputToISO } from "@/lib/time";
import { fmtDateTime } from "@/lib/constants";

export type AgendaProspect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  city: string | null;
};

export type AgendaMeeting = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  kind: string;
  location: string | null;
  isMine: boolean;
  canEdit: boolean;
  /** Initiale du propriétaire — mode équipe seulement (null = à moi). */
  ownerInitial: string | null;
  prospect: AgendaProspect | null;
};

const H_DEBUT = 7;
const H_FIN = 21;
const HAUTEUR_HEURE = 48; // px

/**
 * La palette celya, rien d'autre : mes rendez-vous prospects en bleu, mes
 * personnels en violet, ceux des autres (mode équipe) en cyan avec l'initiale
 * du propriétaire. Un rendez-vous annulé est barré et désaturé — jamais
 * retiré de la vue. Classes complètes (règle JIT).
 */
function classesCarte(m: AgendaMeeting): string {
  if (m.status === "annule") {
    return "bg-white/[0.04] ring-white/10 text-slate-500 line-through opacity-60";
  }
  if (!m.isMine) return "bg-celya-cyan/10 ring-celya-cyan/40 text-slate-100";
  if (m.kind === "perso") return "bg-celya-violet/15 ring-celya-violet/40 text-slate-100";
  return "bg-celya-blue/15 ring-celya-blue/45 text-slate-100";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Position verticale (px) d'un instant local « HH:mm » dans la colonne. */
function topDe(local: string): number {
  const h = Number(local.slice(11, 13));
  const min = Number(local.slice(14, 16));
  return ((h - H_DEBUT) * 60 + min) * (HAUTEUR_HEURE / 60);
}

/**
 * L'agenda en grille — semaine (lundi → samedi) ou jour, 7h–21h.
 *
 * Clic sur une plage vide → panneau de création (« Avec un prospect » ou
 * « Personnel »). Glisser-déposer une carte → deplacerRendezVousAction, en
 * optimiste. Aucune logique métier ici : tout passe par les server actions,
 * qui délèguent à lib/crm/agenda.ts.
 */
export function AgendaGrid({
  jours,
  aujourdHui,
  meetings,
  prospects,
}: {
  /** Les jours affichés, « YYYY-MM-DD » (Bruxelles). */
  jours: string[];
  aujourdHui: string;
  meetings: AgendaMeeting[];
  /** Fiches proposées à la création (autocomplétion, filtrée au clavier). */
  prospects: AgendaProspect[];
}) {
  const [vue, deplacer] = useOptimistic(
    meetings,
    (
      liste: AgendaMeeting[],
      patch: { id: string; starts_at: string; ends_at: string }
    ) =>
      liste.map((m) =>
        m.id === patch.id
          ? { ...m, starts_at: patch.starts_at, ends_at: patch.ends_at, status: "reporte" }
          : m
      )
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [pending, startTransition] = useTransition();

  // Le panneau de création — ouvert par un clic sur une plage vide.
  const [creation, setCreation] = useState<{ local: string } | null>(null);
  const [mode, setMode] = useState<"prospect" | "perso" | null>(null);
  const [recherche, setRecherche] = useState("");
  const [choisi, setChoisi] = useState<AgendaProspect | null>(null);
  const [titre, setTitre] = useState("");
  const [duree, setDuree] = useState(60);
  const [lieu, setLieu] = useState("");

  // La ligne de l'heure courante — posée après montage (pas au rendu serveur,
  // sinon l'hydratation divergerait), rafraîchie chaque minute.
  const [minutesCourantes, setMinutesCourantes] = useState<number | null>(null);
  useEffect(() => {
    const maj = () => {
      const d = new Date();
      setMinutesCourantes(d.getHours() * 60 + d.getMinutes());
    };
    maj();
    const t = setInterval(maj, 60_000);
    return () => clearInterval(t);
  }, []);

  const nomsJours = useMemo(() => {
    const fmt = new Intl.DateTimeFormat("fr-BE", {
      weekday: "short",
      day: "numeric",
      timeZone: "Europe/Brussels",
    });
    return new Map(
      jours.map((j) => [j, fmt.format(new Date(`${j}T12:00:00Z`))])
    );
  }, [jours]);

  const candidats = useMemo(() => {
    const plie = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const q = plie(recherche.trim());
    if (!q) return prospects.slice(0, 8);
    return prospects
      .filter((p) =>
        plie(`${p.company_name} ${p.contact_name ?? ""} ${p.city ?? ""}`).includes(q)
      )
      .slice(0, 8);
  }, [prospects, recherche]);

  function fermerPanneau() {
    setCreation(null);
    setMode(null);
    setRecherche("");
    setChoisi(null);
    setTitre("");
    setDuree(60);
    setLieu("");
  }

  /** Minute cliquée dans une colonne, arrondie à la demi-heure. */
  function minuteAuClic(e: React.MouseEvent<HTMLElement> | React.DragEvent<HTMLElement>): number {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = Math.max(0, e.clientY - rect.top);
    const minutes = H_DEBUT * 60 + Math.round((y / HAUTEUR_HEURE) * 60 / 30) * 30;
    return Math.min(Math.max(minutes, H_DEBUT * 60), (H_FIN - 1) * 60 + 30);
  }

  function ouvrirCreation(jour: string, e: React.MouseEvent<HTMLElement>) {
    if (e.target !== e.currentTarget) return; // pas sur une carte
    const minutes = minuteAuClic(e);
    setErreur(undefined);
    setInfo(undefined);
    setCreation({
      local: `${jour}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
    });
    setMode(null);
  }

  function poser() {
    if (!creation) return;
    if (mode === "prospect" && !choisi) return;
    setErreur(undefined);
    setInfo(undefined);
    startTransition(async () => {
      const res = await poserRendezVousAction({
        prospectId: mode === "prospect" ? choisi!.id : null,
        personnel: mode === "perso",
        title: mode === "perso" ? titre || null : null,
        startsAt: creation.local,
        dureeMin: duree,
        location: lieu || null,
      });
      if (res?.error) {
        setErreur(res.error);
        return;
      }
      if (res?.conflit) {
        setInfo(
          `Posé — mais ce créneau chevauche « ${res.conflit.title} » (${fmtDateTime(
            res.conflit.starts_at
          )}).`
        );
      }
      fermerPanneau();
    });
  }

  function deposer(jour: string, e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    const id = dragId ?? e.dataTransfer.getData("text/plain");
    setDragId(null);
    if (!id) return;
    const m = vue.find((x) => x.id === id);
    if (!m || !m.canEdit) return;

    const minutes = minuteAuClic(e);
    const local = `${jour}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    const startsISO = localInputToISO(local);
    if (!startsISO) return;
    const dureeMs =
      new Date(m.ends_at).getTime() - new Date(m.starts_at).getTime();
    const endsISO = new Date(new Date(startsISO).getTime() + dureeMs).toISOString();

    setErreur(undefined);
    setInfo(undefined);
    startTransition(async () => {
      deplacer({ id, starts_at: startsISO, ends_at: endsISO });
      const res = await deplacerRendezVousAction({ id, startsAt: local });
      if (res?.error) setErreur(res.error);
      else if (res?.conflit) {
        setInfo(
          `Déplacé — mais ce créneau chevauche « ${res.conflit.title} » (${fmtDateTime(
            res.conflit.starts_at
          )}).`
        );
      }
    });
  }

  const heures = Array.from({ length: H_FIN - H_DEBUT }, (_, i) => H_DEBUT + i);

  return (
    <>
      {erreur && (
        <p
          role="alert"
          className="mb-3 rounded-xl bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300 ring-1 ring-rose-400/20"
        >
          {erreur}
        </p>
      )}
      {info && (
        <p className="mb-3 rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300 ring-1 ring-amber-400/20">
          ⚠ {info}
        </p>
      )}

      {/* ---------- Le panneau de création ---------- */}
      {creation && (
        <div className="card mb-4 space-y-3 p-5 ring-1 ring-celya-blue/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-100">
              Nouveau rendez-vous
            </p>
            <button
              type="button"
              onClick={fermerPanneau}
              className="text-xs text-slate-500 transition hover:text-slate-300"
            >
              ✕ Annuler
            </button>
          </div>

          {/* Première question : avec un prospect, ou personnel ? */}
          {mode === null ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode("prospect")}
                className="rounded-xl bg-celya-blue/10 px-4 py-5 text-sm font-medium text-slate-100 ring-1 ring-celya-blue/35 transition hover:bg-celya-blue/20"
              >
                ◆ Avec un prospect
                <span className="mt-1 block text-[11px] font-normal text-slate-400">
                  La fiche passera en « Rendez-vous », le débrief suivra.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMode("perso")}
                className="rounded-xl bg-celya-violet/10 px-4 py-5 text-sm font-medium text-slate-100 ring-1 ring-celya-violet/35 transition hover:bg-celya-violet/20"
              >
                ● Personnel
                <span className="mt-1 block text-[11px] font-normal text-slate-400">
                  Les autres ne verront que « Occupé ».
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {mode === "prospect" ? (
                choisi ? (
                  <p className="flex items-center gap-2 text-sm text-slate-200">
                    <span className="chip bg-celya-blue/15 text-blue-300 ring-blue-400/25">
                      ◆ {choisi.company_name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setChoisi(null)}
                      className="text-xs text-slate-500 hover:text-slate-300"
                    >
                      changer
                    </button>
                  </p>
                ) : (
                  <div>
                    <input
                      autoFocus
                      value={recherche}
                      onChange={(e) => setRecherche(e.target.value)}
                      placeholder="Chercher une fiche… (société, contact, ville)"
                      className="input"
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {candidats.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setChoisi(p)}
                          className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-300 ring-1 ring-white/10 transition hover:bg-white/[0.09] hover:text-slate-100"
                        >
                          {p.company_name}
                          {p.contact_name ? ` · ${p.contact_name}` : ""}
                        </button>
                      ))}
                      {candidats.length === 0 && (
                        <p className="text-xs text-slate-500">
                          Aucune fiche ne correspond.
                        </p>
                      )}
                    </div>
                  </div>
                )
              ) : (
                <input
                  autoFocus
                  value={titre}
                  onChange={(e) => setTitre(e.target.value)}
                  placeholder="Titre du rendez-vous personnel…"
                  className="input"
                />
              )}

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="label" htmlFor="rdv-date">
                    Date et heure
                  </label>
                  <input
                    id="rdv-date"
                    type="datetime-local"
                    value={creation.local}
                    onChange={(e) =>
                      setCreation({ local: e.target.value })
                    }
                    className="input w-auto py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="rdv-duree">
                    Durée
                  </label>
                  <select
                    id="rdv-duree"
                    value={duree}
                    onChange={(e) => setDuree(Number(e.target.value))}
                    className="input w-auto py-1.5 text-xs"
                  >
                    {[30, 60, 90, 120].map((d) => (
                      <option key={d} value={d}>
                        {d} min
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[200px] flex-1">
                  <label className="label" htmlFor="rdv-lieu">
                    Lieu
                  </label>
                  <input
                    id="rdv-lieu"
                    value={lieu}
                    onChange={(e) => setLieu(e.target.value)}
                    placeholder={
                      mode === "prospect"
                        ? "Adresse, visio… (vide : l'adresse de la fiche)"
                        : "Adresse, visio…"
                    }
                    className="input py-1.5 text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={poser}
                  disabled={
                    pending ||
                    creation.local.length < 16 ||
                    (mode === "prospect" && !choisi)
                  }
                  className="btn-primary"
                >
                  {pending ? "Enregistrement…" : "Poser le rendez-vous"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- La grille ---------- */}
      <div className="card overflow-x-auto p-0">
        <div className="flex min-w-[680px]">
          {/* Colonne des heures */}
          <div
            className="w-12 shrink-0 border-r border-white/[0.05] pt-9"
            aria-hidden
          >
            {heures.map((h) => (
              <div
                key={h}
                style={{ height: HAUTEUR_HEURE }}
                className="pr-1.5 text-right text-[10px] leading-none text-slate-500"
              >
                {h}h
              </div>
            ))}
          </div>

          {jours.map((jour) => {
            const duJour = vue.filter(
              (m) => isoToLocalInput(m.starts_at).slice(0, 10) === jour
            );
            const estAujourdHui = jour === aujourdHui;

            return (
              <div
                key={jour}
                className="min-w-0 flex-1 border-r border-white/[0.05] last:border-r-0"
              >
                <p
                  className={`flex h-9 items-center justify-center text-xs font-semibold ${
                    estAujourdHui
                      ? "bg-celya-cyan/10 text-celya-cyan"
                      : "text-slate-400"
                  }`}
                >
                  {nomsJours.get(jour)}
                </p>

                {/* Le corps de la colonne : clic = créer, dépôt = déplacer. */}
                <div
                  role="presentation"
                  onClick={(e) => ouvrirCreation(jour, e)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => deposer(jour, e)}
                  style={{ height: (H_FIN - H_DEBUT) * HAUTEUR_HEURE }}
                  className={`relative cursor-pointer ${
                    estAujourdHui ? "bg-celya-cyan/[0.03]" : ""
                  }`}
                >
                  {heures.map((h) => (
                    <span
                      key={h}
                      aria-hidden
                      style={{ top: (h - H_DEBUT) * HAUTEUR_HEURE }}
                      className="pointer-events-none absolute inset-x-0 border-t border-white/[0.04]"
                    />
                  ))}

                  {/* La ligne de l'heure courante, sur la colonne du jour. */}
                  {estAujourdHui &&
                    minutesCourantes !== null &&
                    minutesCourantes >= H_DEBUT * 60 &&
                    minutesCourantes <= H_FIN * 60 && (
                      <span
                        aria-hidden
                        style={{
                          top:
                            (minutesCourantes - H_DEBUT * 60) *
                            (HAUTEUR_HEURE / 60),
                        }}
                        className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-celya-cyan/70"
                      />
                    )}

                  {duJour.map((m, i) => {
                    const local = isoToLocalInput(m.starts_at);
                    const finLocale = isoToLocalInput(m.ends_at);
                    const top = Math.max(0, topDe(local));
                    const height = Math.max(
                      28,
                      topDe(finLocale) - topDe(local) || HAUTEUR_HEURE
                    );
                    const chevauche =
                      i > 0 &&
                      isoToLocalInput(duJour[i - 1].ends_at) > local;
                    const draggable =
                      m.canEdit && m.status !== "annule" && m.status !== "honore";

                    return (
                      <article
                        key={m.id}
                        draggable={draggable}
                        onClick={(e) => e.stopPropagation()}
                        onDragStart={(e) => {
                          setDragId(m.id);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", m.id);
                        }}
                        onDragEnd={() => setDragId(null)}
                        style={{
                          top,
                          height,
                          left: chevauche ? "18%" : "2%",
                          right: "2%",
                        }}
                        className={`absolute z-10 overflow-hidden rounded-lg px-2 py-1 ring-1 transition ${classesCarte(
                          m
                        )} ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${
                          dragId === m.id ? "opacity-50" : ""
                        }`}
                      >
                        <p className="truncate text-[11px] font-semibold leading-tight">
                          {m.ownerInitial && (
                            <span
                              title="Rendez-vous d'un autre membre"
                              className="mr-1 inline-grid h-4 w-4 place-items-center rounded-full bg-celya-cyan/25 text-[9px] font-bold text-celya-cyan"
                            >
                              {m.ownerInitial}
                            </span>
                          )}
                          {local.slice(11, 16)} {m.status === "honore" ? "✓ " : ""}
                          {m.prospect ? (
                            <Link
                              href={`/prospects/${m.prospect.id}`}
                              prefetch={false}
                              className="underline-offset-2 hover:underline"
                            >
                              {m.title}
                            </Link>
                          ) : (
                            m.title
                          )}
                        </p>
                        {height >= 44 && (m.prospect?.phone || m.location) && (
                          <p className="truncate text-[10px] text-slate-300/90">
                            {m.prospect?.phone && (
                              <a
                                href={`tel:${m.prospect.phone.replace(/\s/g, "")}`}
                                className="text-celya-cyan hover:underline"
                              >
                                {m.prospect.phone}
                              </a>
                            )}
                            {m.prospect?.phone && m.location ? " · " : ""}
                            {/* L'adresse du rendez-vous : un bouton qui ouvre
                                Maps, jamais un texte à recopier. */}
                            {m.location && (
                              <BoutonsMaps
                                valeur={m.location}
                                ville={m.prospect?.city}
                                compact
                              />
                            )}
                          </p>
                        )}
                        {height >= 60 && m.prospect?.contact_name && (
                          <p className="truncate text-[10px] text-slate-400">
                            {m.prospect.contact_name}
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Cliquez sur une plage vide pour poser un rendez-vous ; faites glisser
        une carte pour la déplacer. Un rendez-vous annulé reste visible, barré.
      </p>
    </>
  );
}
