"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  poserRendezVousAction,
  deplacerRendezVousAction,
  cloturerRendezVousAction,
} from "@/app/actions";
import { FeuilleBas } from "@/components/FeuilleBas";
import { BoutonsMaps } from "@/components/BoutonsMaps";
import { heureCourte, isoToLocalInput, localInputToISO } from "@/lib/time";
import { phraseAnnulees } from "@/lib/crm/prochaineAction";
import { fmtDateTime } from "@/lib/constants";
import { lienTel } from "@/lib/crm/telephone";
import { Icone } from "@/components/ui";

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
  /** Posé par Janet, l'IA vocale, pendant un appel (admin seul). */
  parJanet?: boolean;
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
 *
 * TÉLÉPHONE (sous `sm`, 19/10) : en vue Jour, la LISTE des rendez-vous du jour
 * (heure, société, lieu, 📞) prend la place de la grille — repliée derrière
 * « Grille horaire » ; on change de jour d'un balayage ou par les flèches.
 * « ＋ RDV » ouvre la création dans la feuille du bas (même panneau, même
 * `poserRendezVousAction`, qui refuse un rendez-vous sans heure) ; toucher un
 * rendez-vous ouvre sa feuille : Reporter (`deplacerRendezVousAction`) ou
 * Annuler (`cloturerRendezVousAction`, issue « annulé » — le chemin de
 * l'outil MCP). Le glisser-déposer reste sur ordinateur.
 */
export function AgendaGrid({
  navigation,
  jours,
  aujourdHui,
  meetings,
  prospects,
}: {
  /** Les liens du jour (ou de la semaine) précédent et suivant — le balayage. */
  navigation: { precedent: string; suivant: string };
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
      patch: { id: string; starts_at?: string; ends_at?: string; status?: string }
    ) =>
      liste.map((m) =>
        m.id === patch.id
          ? {
              ...m,
              starts_at: patch.starts_at ?? m.starts_at,
              ends_at: patch.ends_at ?? m.ends_at,
              status: patch.status ?? "reporte",
            }
          : m
      )
  );
  const router = useRouter();
  /** Sous `sm` : les panneaux passent dans la feuille du bas. */
  const [telephone, setTelephone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const maj = () => setTelephone(mq.matches);
    maj();
    mq.addEventListener("change", maj);
    return () => mq.removeEventListener("change", maj);
  }, []);
  /** Téléphone : le rendez-vous dont la feuille est ouverte. */
  const [detail, setDetail] = useState<string | null>(null);
  const [report, setReport] = useState("");
  const [grille, setGrille] = useState(false);
  const [confirmerAnnulation, setConfirmerAnnulation] = useState(false);
  const toucher = useRef<{ x: number; y: number } | null>(null);
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

  /** « ＋ RDV » (téléphone) : le jour affiché, à la prochaine heure pleine. */
  function nouveauRdv() {
    const jour = jours[0];
    let h = 9;
    if (jour === aujourdHui) h = Math.min(Math.max(new Date().getHours() + 1, H_DEBUT), H_FIN - 1);
    setErreur(undefined);
    setInfo(undefined);
    setCreation({ local: `${jour}T${pad(h)}:00` });
    setMode(null);
  }

  /** Téléphone : reporter le rendez-vous de la feuille. */
  function reporter(m: AgendaMeeting) {
    const startsISO = localInputToISO(report);
    if (!startsISO || report.length < 16) return;
    const dureeMs = new Date(m.ends_at).getTime() - new Date(m.starts_at).getTime();
    setErreur(undefined);
    setInfo(undefined);
    setDetail(null);
    startTransition(async () => {
      deplacer({
        id: m.id,
        starts_at: startsISO,
        ends_at: new Date(new Date(startsISO).getTime() + dureeMs).toISOString(),
      });
      const res = await deplacerRendezVousAction({ id: m.id, startsAt: report });
      if (res?.error) setErreur(res.error);
      else {
        const avis = [
          res?.conflit
            ? `Déplacé — mais ce créneau chevauche « ${res.conflit.title} » (${fmtDateTime(
                res.conflit.starts_at
              )}).`
            : null,
          phraseAnnulees(res?.annulees),
        ].filter(Boolean);
        if (avis.length > 0) setInfo(avis.join(" "));
      }
    });
  }

  /** Téléphone : annuler — le chemin de l'outil MCP (issue « annulé »). */
  function annuler(m: AgendaMeeting) {
    setErreur(undefined);
    setInfo(undefined);
    setDetail(null);
    startTransition(async () => {
      deplacer({ id: m.id, status: "annule" });
      const res = await cloturerRendezVousAction({ id: m.id, issue: "annule" });
      if (res?.error) setErreur(res.error);
    });
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
      const avis = [
        res?.conflit
          ? `Posé — mais ce créneau chevauche « ${res.conflit.title} » (${fmtDateTime(
              res.conflit.starts_at
            )}).`
          : null,
        // Le RDV devient la prochaine action : on DIT quelles relances il a
        // clôturées, sans rien demander (migration 022).
        phraseAnnulees(res?.annulees),
      ].filter(Boolean);
      if (avis.length > 0) setInfo(avis.join(" "));
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
      else {
        const avis = [
          res?.conflit
            ? `Déplacé — mais ce créneau chevauche « ${res.conflit.title} » (${fmtDateTime(
                res.conflit.starts_at
              )}).`
            : null,
          phraseAnnulees(res?.annulees),
        ].filter(Boolean);
        if (avis.length > 0) setInfo(avis.join(" "));
      }
    });
  }

  const heures = Array.from({ length: H_FIN - H_DEBUT }, (_, i) => H_DEBUT + i);
  // Téléphone, vue Jour : la liste du jour, et le rendez-vous de la feuille.
  const jourSeul = jours.length === 1;
  const duJourListe = jourSeul
    ? vue
        .filter((m) => isoToLocalInput(m.starts_at).slice(0, 10) === jours[0])
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    : [];
  const enFeuille = vue.find((m) => m.id === detail) ?? null;

  // Le contenu du panneau de création — UN rendu, posé dans la carte
  // (ordinateur) ou dans la feuille du bas (téléphone).
  const contenuCreation = creation && (
        <>
          {/* Première question : avec un prospect, ou personnel ? */}
          {mode === null ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode("prospect")}
                className="rounded-xl bg-celya-blue/10 px-4 py-5 text-sm font-medium text-slate-100 ring-1 ring-celya-blue/35 transition hover:bg-celya-blue/20"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icone nom="calendrier" className="h-3.5 w-3.5" />
                  Avec un prospect
                </span>
                <span className="mt-1 block text-[11px] font-normal text-slate-400">
                  La fiche passera en « Rendez-vous », le débrief suivra.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMode("perso")}
                className="rounded-xl bg-celya-violet/10 px-4 py-5 text-sm font-medium text-slate-100 ring-1 ring-celya-violet/35 transition hover:bg-celya-violet/20"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icone nom="personne" className="h-3.5 w-3.5" />
                  Personnel
                </span>
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
                      <Icone nom="calendrier" className="h-3 w-3" />
                      {choisi.company_name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setChoisi(null)}
                      className="min-h-[44px] text-xs text-slate-500 hover:text-slate-300 sm:min-h-0"
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
                          className="min-h-[44px] rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-300 ring-1 ring-white/10 transition hover:bg-white/[0.09] hover:text-slate-100 sm:min-h-0"
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
                {/* Le jour et l'heure, deux champs : sans heure, le bouton
                    reste éteint (et le serveur refuserait de toute façon). */}
                <div>
                  <label className="label" htmlFor="rdv-date">
                    Jour
                  </label>
                  <input
                    id="rdv-date"
                    type="date"
                    value={creation.local.slice(0, 10)}
                    onChange={(e) =>
                      setCreation({ local: `${e.target.value}T${creation.local.slice(11, 16)}` })
                    }
                    className="input min-h-[44px] w-auto py-1.5 text-xs sm:min-h-0"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="rdv-heure">
                    Heure
                  </label>
                  <input
                    id="rdv-heure"
                    type="time"
                    step={900}
                    value={creation.local.slice(11, 16)}
                    onChange={(e) =>
                      setCreation({ local: `${creation.local.slice(0, 10)}T${e.target.value}` })
                    }
                    className="input min-h-[44px] w-auto py-1.5 text-xs sm:min-h-0"
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
                    className="input min-h-[44px] w-auto py-1.5 text-xs sm:min-h-0"
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
                    className="input min-h-[44px] py-1.5 text-xs sm:min-h-0"
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
                  className="btn-primary min-h-[48px] w-full sm:min-h-0 sm:w-auto"
                >
                  {pending ? "Enregistrement…" : "Poser le rendez-vous"}
                </button>
              </div>
            </div>
          )}
        </>
  );

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
        <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300 ring-1 ring-amber-400/20">
          <Icone nom="alerte" className="mt-0.5 h-3.5 w-3.5" />
          {info}
        </p>
      )}

      {/* ---------- Le panneau de création — sur téléphone, dans la feuille ---------- */}
      <FeuilleBas
        ouvert={Boolean(creation) && telephone}
        onFermer={fermerPanneau}
        titre="Nouveau rendez-vous"
      >
        {contenuCreation}
      </FeuilleBas>
      {creation && !telephone && (
        <div className="card mb-4 space-y-3 p-5 ring-1 ring-celya-blue/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-100">
              Nouveau rendez-vous
            </p>
            <button
              type="button"
              onClick={fermerPanneau}
              className="btn-link text-xs"
            >
              <Icone nom="croix" className="h-3 w-3" />
              Annuler
            </button>
          </div>

          {contenuCreation}
        </div>
      )}

      {/* ---------- Téléphone, vue Jour : la liste du jour ---------- */}
      {jourSeul && (
        <div
          className="mb-3 sm:hidden"
          // Balayer à gauche : le jour suivant ; à droite : le précédent.
          onTouchStart={(e) => {
            const t = e.touches[0];
            toucher.current = { x: t.clientX, y: t.clientY };
          }}
          onTouchEnd={(e) => {
            const debut = toucher.current;
            toucher.current = null;
            if (!debut) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - debut.x;
            if (Math.abs(dx) < 60 || Math.abs(t.clientY - debut.y) > 40) return;
            router.push(dx < 0 ? navigation.suivant : navigation.precedent);
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              {duJourListe.length === 0
                ? "Aucun rendez-vous ce jour-là."
                : `${duJourListe.length} rendez-vous`}
            </p>
            <button type="button" onClick={nouveauRdv} className="btn-primary min-h-[44px] px-4 text-sm">
              <Icone nom="plus" className="h-4 w-4" />
              RDV
            </button>
          </div>
          {duJourListe.length > 0 && (
            <ul className="card divide-y divide-white/[0.05]" aria-label="Rendez-vous du jour">
              {duJourListe.map((m) => {
                const tel = lienTel(m.prospect?.phone);
                return (
                  <li key={m.id} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => {
                        setReport("");
                        setConfirmerAnnulation(false);
                        setDetail(m.id);
                      }}
                      aria-haspopup="dialog"
                      className={`flex min-h-[60px] min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left ${
                        m.status === "annule" ? "opacity-60" : ""
                      }`}
                    >
                      <span className="w-14 shrink-0 text-sm font-semibold tabular-nums text-blue-300">
                        {heureCourte(isoToLocalInput(m.starts_at).slice(11, 16))}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-sm font-medium text-slate-100 ${
                            m.status === "annule" ? "line-through" : ""
                          }`}
                        >
                          {m.prospect?.company_name ?? m.title}
                        </span>
                        <span className="block truncate text-xs text-slate-400">
                          {[m.prospect?.contact_name, m.location].filter(Boolean).join(" · ") ||
                            (m.kind === "perso" ? "Personnel" : "—")}
                        </span>
                      </span>
                    </button>
                    {tel && (
                      <a
                        href={tel}
                        aria-label={`Appeler ${m.prospect?.company_name ?? ""}`}
                        className="mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-celya-blue active:bg-white/[0.06]"
                      >
                        <Icone nom="telephone" className="h-4 w-4" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setGrille((g) => !g)}
            aria-expanded={grille}
            className="btn-link mt-1 min-h-[44px] text-xs"
          >
            Grille horaire
            <Icone nom="chevron" className={`h-3 w-3 transition ${grille ? "rotate-180" : ""}`} />
          </button>
        </div>
      )}

      {/* ---------- Téléphone : la feuille d'un rendez-vous ---------- */}
      <FeuilleBas
        ouvert={enFeuille !== null}
        onFermer={() => setDetail(null)}
        titre={enFeuille?.prospect?.company_name ?? enFeuille?.title ?? "Rendez-vous"}
      >
        {enFeuille && (
          <div className="space-y-4">
            <p className="text-sm text-slate-200">
              {fmtDateTime(enFeuille.starts_at)} → {heureCourte(isoToLocalInput(enFeuille.ends_at).slice(11, 16))}
              {enFeuille.status === "annule" && <span className="ml-2 text-rose-300">Annulé</span>}
              {enFeuille.status === "honore" && <span className="ml-2 text-emerald-300">Tenu</span>}
              {enFeuille.status === "reporte" && <span className="ml-2 text-slate-400">Reporté</span>}
            </p>
            {enFeuille.prospect?.contact_name && (
              <p className="text-xs text-slate-400">{enFeuille.prospect.contact_name}</p>
            )}
            {enFeuille.location && (
              <BoutonsMaps valeur={enFeuille.location} ville={enFeuille.prospect?.city} />
            )}
            <div className="grid grid-cols-2 gap-2">
              {lienTel(enFeuille.prospect?.phone) && (
                <a href={lienTel(enFeuille.prospect?.phone)!} className="btn-primary min-h-[48px]">
                  <Icone nom="telephone" className="h-4 w-4" />
                  Appeler
                </a>
              )}
              {enFeuille.prospect && (
                <Link
                  href={`/prospects/${enFeuille.prospect.id}`}
                  prefetch={false}
                  onClick={() => setDetail(null)}
                  className="btn-ghost min-h-[48px]"
                >
                  Ouvrir la fiche
                </Link>
              )}
            </div>
            {enFeuille.canEdit &&
              enFeuille.status !== "annule" &&
              enFeuille.status !== "honore" && (
                <div className="space-y-3 border-t border-white/[0.06] pt-4">
                  <div>
                    <label className="label" htmlFor="rdv-report">
                      Reporter au
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="rdv-report"
                        type="datetime-local"
                        step={900}
                        value={report}
                        onChange={(e) => setReport(e.target.value)}
                        className="input min-h-[44px] min-w-0 flex-1"
                      />
                      <button
                        type="button"
                        disabled={pending || report.length < 16}
                        onClick={() => reporter(enFeuille)}
                        className="btn-ghost min-h-[44px] shrink-0 px-3.5 text-sm"
                      >
                        Reporter
                      </button>
                    </div>
                  </div>
                  {/* Annuler est définitif : on le demande deux fois. */}
                  {confirmerAnnulation ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => annuler(enFeuille)}
                        className="btn-danger min-h-[44px] flex-1"
                      >
                        Confirmer l&apos;annulation
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmerAnnulation(false)}
                        className="btn-link min-h-[44px] px-2 text-xs"
                      >
                        Garder
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmerAnnulation(true)}
                      className="btn-link min-h-[44px] text-xs text-rose-300"
                    >
                      Annuler le rendez-vous
                    </button>
                  )}
                </div>
              )}
          </div>
        )}
      </FeuilleBas>

      {/* ---------- La grille ---------- */}
      {/* Téléphone, vue Jour : repliée derrière « Grille horaire ». */}
      <div className={`card overflow-x-auto p-0 ${jourSeul && !grille ? "hidden sm:block" : ""}`}>
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
                          {local.slice(11, 16)}{" "}
                          {/* Carte trop courte pour une ligne de plus : l'étincelle
                              seule, le texte en infobulle. */}
                          {m.parJanet && height < 44 && (
                            <span title="Posé par Janet">
                              <Icone
                                nom="etincelle"
                                className="mr-0.5 inline-block h-3 w-3 align-[-1px] text-slate-300"
                              />
                              <span className="sr-only">posé par Janet,</span>
                            </span>
                          )}
                          {m.status === "honore" && (
                            <Icone
                              nom="coche"
                              className="mr-0.5 inline-block h-3 w-3 align-[-1px]"
                            />
                          )}
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
                        {height >= 44 &&
                          (m.parJanet || m.prospect?.phone || m.location) && (
                          <p className="truncate text-[10px] text-slate-300/90">
                            {/* En TÊTE de la ligne : une carte d'une heure n'a
                                pas la place d'une ligne de plus, et la fin de
                                celle-ci peut être tronquée. */}
                            {m.parJanet && (
                              <span title="Rendez-vous posé par Janet pendant un appel">
                                <Icone
                                  nom="etincelle"
                                  className="mr-0.5 inline-block h-2.5 w-2.5 align-[-1px]"
                                />
                                posé par Janet
                                {m.prospect?.phone || m.location ? " · " : ""}
                              </span>
                            )}
                            {m.prospect?.phone && (
                              <a
                                href={lienTel(m.prospect.phone) ?? undefined}
                                className="text-celya-blue hover:underline"
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

      <p className="mt-3 hidden text-xs text-slate-500 sm:block">
        Cliquez sur une plage vide pour poser un rendez-vous ; faites glisser
        une carte pour la déplacer. Un rendez-vous annulé reste visible, barré.
      </p>
    </>
  );
}
