"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  corrigerMaListeAction,
  importerMaListeAction,
  lireMaListeAction,
  verifierMaListeAction,
  type EtatListe,
} from "@/app/ma-liste-actions";
import {
  appliquerCorrection,
  estUnCollage,
  lireCorrection,
  phraseCorrection,
  PLAFOND_CARACTERES,
  PLAFOND_FICHES,
  SECTEURS_PROPOSES,
  type EtatFiche,
  type FicheCollee,
} from "@/lib/crm/maListe";
import { SECTEURS } from "@/lib/crm/secteurs";
import { Icone } from "@/components/ui";
import { ChampExtensible } from "@/components/ChampExtensible";

type Message = { de: "moi" | "janet"; texte: string; ton?: "ok" | "alerte" };

const BADGE: Record<EtatFiche["statut"], string> = {
  a_creer: "bg-celya-blue/10 text-blue-100 ring-celya-blue/30",
  doublon_lot: "bg-white/[0.05] text-slate-300 ring-white/15",
  doublon_equipe: "bg-amber-500/10 text-amber-200 ring-amber-400/30",
  a_moi: "bg-white/[0.05] text-slate-300 ring-white/15",
};
const LIBELLE: Record<EtatFiche["statut"], string> = {
  a_creer: "À créer",
  doublon_lot: "En double",
  doublon_equipe: "Déjà suivie",
  a_moi: "Déjà à vous",
};

/**
 * « MA LISTE » — un chat où l'on colle sa liste, et Janet range (27/10).
 *
 * L'état vit ICI, en mémoire (aucune table) : la liste lue, son état ligne à
 * ligne, les messages. Rien n'est écrit avant « Importer » — un récapitulatif
 * et un tableau éditable d'abord. Corrections : le code d'abord
 * (`lireCorrection` : « enlève la 3 », « le secteur c'est kiné »), le modèle
 * ensuite ; et toujours à la main, dans le tableau.
 *
 * Mobile 390 px : le collage, des cartes (pas de tableau), et « Importer »
 * dans une barre au-dessus des onglets.
 */
export function MaListe({
  admin,
  moi,
  membres,
  etatInitial,
}: {
  admin: boolean;
  moi: string;
  /** [id, nom] — l'admin seul en reçoit (« Pour… »). */
  membres: [string, string][];
  /**
   * Une liste déjà lue — pour le banc d'affichage seulement (page de
   * démonstration locale, données fictives) ; la page réelle ne la passe pas.
   */
  etatInitial?: EtatListe;
}) {
  const [texte, setTexte] = useState("");
  const [secteur, setSecteur] = useState("");
  const [ville, setVille] = useState("");
  const [pour, setPour] = useState(moi);
  const [etat, setEtat] = useState<EtatListe>(
    etatInitial ?? { fiches: [], etats: [], recap: "", equipeIndisponible: false }
  );
  const [aVerifier, setAVerifier] = useState<string[][]>([]);
  const [messages, setMessages] = useState<Message[]>([
    {
      de: "janet",
      texte:
        "Collez votre liste — « nom + numéro » par ligne, ou un tableau, avec vos remarques au milieu si vous voulez. Je fais les fiches ; rien n'est créé avant votre clic sur « Importer ».",
    },
  ]);
  const [importee, setImportee] = useState<{ n: number; ignorees: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const dire = (m: Message) => setMessages((ms) => [...ms, m]);
  const aCreer = etat.fiches.filter((_, i) => etat.etats[i]?.statut === "a_creer");

  function envoyer() {
    const t = texte.trim();
    if (!t || pending) return;
    setImportee(null);
    const n = etat.fiches.length;
    dire({ de: "moi", texte: t.length > 240 ? `${t.slice(0, 240)}… (${t.split("\n").length} lignes)` : t });
    setTexte("");

    if (estUnCollage(t, n)) {
      startTransition(async () => {
        const r = await lireMaListeAction({
          texte: t,
          defauts: { secteur: secteur || null, ville: ville.trim() || null },
          existantes: etat.fiches,
        });
        setEtat(r);
        setAVerifier((a) => [...a, ...r.lecture.aVerifier]);
        const l = r.lecture;
        if (l.error) {
          dire({ de: "janet", texte: l.error, ton: "alerte" });
          return;
        }
        const bits = [
          l.nouvelles === 0
            ? "Je n'ai trouvé aucune société dans ce texte."
            : `J'ai lu ${l.nouvelles} société${l.nouvelles > 1 ? "s" : ""}${l.source === "lecture" ? "" : " (avec l'assistant)"}.`,
          r.recap ? `En tout : ${r.recap}.` : "",
        ];
        if (l.assistantIndisponible && l.nonLues.length) {
          bits.push(
            `L'assistant est indisponible : ${l.nonLues.length} ligne${l.nonLues.length > 1 ? "s" : ""} non lue${l.nonLues.length > 1 ? "s" : ""}. Remettez-les au format « nom + numéro », ou passez par l'import CSV.`
          );
        }
        if (l.tronque) bits.push(`La fin n'a pas été lue (au plus ${PLAFOND_FICHES} fiches par collage) : collez la suite ensuite.`);
        if (r.equipeIndisponible) bits.push("Je n'ai pas pu vérifier l'équipe : les doublons seront revérifiés à l'import.");
        dire({ de: "janet", texte: bits.filter(Boolean).join(" "), ton: l.assistantIndisponible || l.tronque ? "alerte" : "ok" });
      });
      return;
    }

    const c = lireCorrection(t, n);
    if (c) {
      const fiches = appliquerCorrection(etat.fiches, c);
      if (c.op === "retirer") {
        const out = new Set(c.lignes.map((x) => x - 1));
        setAVerifier((a) => a.filter((_, i) => !out.has(i)));
      }
      dire({ de: "janet", texte: phraseCorrection(c, n, fiches.length), ton: "ok" });
      startTransition(async () => setEtat(await verifierMaListeAction(fiches)));
      return;
    }

    startTransition(async () => {
      const r = await corrigerMaListeAction({ message: t, fiches: etat.fiches });
      if (r.fiches.length !== etat.fiches.length) setAVerifier([]);
      setEtat(r);
      dire({ de: "janet", texte: r.reponse, ton: r.indisponible ? "alerte" : "ok" });
    });
  }

  function modifier(i: number, champ: keyof FicheCollee, valeur: string) {
    setEtat((e) => ({
      ...e,
      fiches: e.fiches.map((f, j) => (j === i ? { ...f, [champ]: valeur || null } : f)),
    }));
  }
  function reverifier() {
    startTransition(async () => setEtat(await verifierMaListeAction(etat.fiches)));
  }
  function retirer(i: number) {
    const fiches = etat.fiches.filter((_, j) => j !== i);
    setAVerifier((a) => a.filter((_, j) => j !== i));
    startTransition(async () => setEtat(await verifierMaListeAction(fiches)));
  }

  function importer() {
    if (aCreer.length === 0 || pending) return;
    startTransition(async () => {
      const r = await importerMaListeAction({ fiches: aCreer, ownerId: admin ? pour : null });
      if (r.error) {
        dire({ de: "janet", texte: r.error, ton: "alerte" });
        return;
      }
      setImportee({ n: r.inserted, ignorees: r.reasons });
      dire({
        de: "janet",
        texte: `C'est fait : ${r.inserted} fiche${r.inserted > 1 ? "s" : ""} créée${r.inserted > 1 ? "s" : ""}, en « À appeler »${
          r.skipped ? `, ${r.skipped} ignorée${r.skipped > 1 ? "s" : ""} à la dernière vérification` : ""
        }. Vous pouvez coller une autre liste.`,
        ton: "ok",
      });
      setEtat({ fiches: [], etats: [], recap: "", equipeIndisponible: false });
      setAVerifier([]);
    });
  }

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      {/* Les défauts du collage — choisis une fois, en tête. */}
      <div className="card flex flex-wrap items-end gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 basis-40">
          <label className="label" htmlFor="ml-secteur">
            Secteur de la liste
          </label>
          <select id="ml-secteur" value={secteur} onChange={(e) => setSecteur(e.target.value)} className="input min-h-[44px]">
            <option value="">— selon le texte —</option>
            {SECTEURS_PROPOSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1 basis-32">
          <label className="label" htmlFor="ml-ville">
            Ville
          </label>
          <input
            id="ml-ville"
            value={ville}
            onChange={(e) => setVille(e.target.value)}
            className="input min-h-[44px]"
            placeholder="selon le texte"
            autoCapitalize="words"
          />
        </div>
        {admin && (
          <div className="min-w-0 flex-1 basis-40">
            <label className="label" htmlFor="ml-pour">
              Pour
            </label>
            <select id="ml-pour" value={pour} onChange={(e) => setPour(e.target.value)} className="input min-h-[44px]">
              {membres.map(([id, nom]) => (
                <option key={id} value={id}>
                  {id === moi ? `${nom} (moi)` : nom}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Le fil. */}
      <ol className="space-y-2" aria-label="Conversation avec Janet" aria-live="polite">
        {messages.map((m, i) => (
          <li key={i} className={`flex ${m.de === "moi" ? "justify-end" : "justify-start"}`}>
            <p
              className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                m.de === "moi"
                  ? "bg-celya-blue/15 text-blue-50 ring-1 ring-celya-blue/30"
                  : m.ton === "alerte"
                    ? "bg-amber-500/[0.08] text-amber-100 ring-1 ring-amber-400/25"
                    : "bg-white/[0.04] text-slate-200 ring-1 ring-white/10"
              }`}
            >
              {m.de === "janet" && <span className="mr-1.5 text-[11px] font-semibold text-slate-400">Janet</span>}
              {m.texte}
            </p>
          </li>
        ))}
        {pending && (
          <li className="text-xs text-slate-500" role="status">
            Janet lit…
          </li>
        )}
      </ol>

      {/* Le collage, ou une correction. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          envoyer();
        }}
        className="card space-y-2 px-3 py-3"
      >
        <label className="sr-only" htmlFor="ml-texte">
          Votre liste, ou une correction
        </label>
        <ChampExtensible
          id="ml-texte"
          value={texte}
          onChange={setTexte}
          placeholder={
            etat.fiches.length
              ? "Une autre liste, ou une correction : « enlève la 3 », « le secteur c'est kiné »…"
              : "Cabinet dentaire Smile 02 640 12 34\nGarage Dupont 0470 12 34 56 — rappeler après 14h"
          }
          className="input min-h-[96px] font-mono text-xs"
          max={320}
          maxLength={PLAFOND_CARACTERES * 4}
          onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              envoyer();
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">
            {texte.length > PLAFOND_CARACTERES
              ? `Au-delà de ${PLAFOND_CARACTERES.toLocaleString("fr-BE")} caractères, la fin ne sera pas lue.`
              : `Au plus ${PLAFOND_FICHES} sociétés par collage — vous pourrez en coller d'autres ensuite.`}
          </span>
          <button type="submit" disabled={!texte.trim() || pending} className="btn-primary min-h-[44px] px-4">
            {etat.fiches.length && !estUnCollage(texte, etat.fiches.length) ? "Corriger" : "Lire ma liste"}
          </button>
        </div>
      </form>

      {/* Le récapitulatif, puis les fiches — éditables. */}
      {etat.fiches.length > 0 && (
        <section aria-labelledby="ml-recap" className="space-y-2">
          <h2 id="ml-recap" className="text-sm font-medium text-slate-200">
            {etat.recap}
          </h2>
          <ul className="space-y-2">
            {etat.fiches.map((f, i) => {
              const e = etat.etats[i];
              const notes = [...(aVerifier[i] ?? []), ...(e?.phrase ? [e.phrase] : [])];
              return (
                <li
                  key={i}
                  className={`card px-3 py-2.5 ${e && e.statut !== "a_creer" ? "opacity-70" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-2.5 w-6 shrink-0 text-right text-xs tabular-nums text-slate-500">{i + 1}</span>
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                      <input
                        aria-label={`Société, ligne ${i + 1}`}
                        value={f.company_name}
                        onChange={(ev) => modifier(i, "company_name", ev.target.value)}
                        onBlur={reverifier}
                        className="input min-h-[44px] py-1.5 font-medium"
                      />
                      <input
                        aria-label={`Téléphone, ligne ${i + 1}`}
                        type="tel"
                        value={f.phone ?? f.phone_lu ?? ""}
                        onChange={(ev) => modifier(i, "phone", ev.target.value)}
                        onBlur={reverifier}
                        placeholder="Téléphone"
                        className={`input min-h-[44px] py-1.5 ${f.phone ? "" : "ring-1 ring-amber-400/40"}`}
                      />
                      <input
                        aria-label={`Adresse, ligne ${i + 1}`}
                        value={f.address ?? ""}
                        onChange={(ev) => modifier(i, "address", ev.target.value)}
                        placeholder="Adresse"
                        className="input min-h-[44px] py-1.5 sm:col-span-2 lg:col-span-2"
                      />
                      <input
                        aria-label={`Ville, ligne ${i + 1}`}
                        value={f.city ?? ""}
                        onChange={(ev) => modifier(i, "city", ev.target.value)}
                        placeholder="Ville"
                        className="input min-h-[44px] py-1.5"
                      />
                      <select
                        aria-label={`Secteur, ligne ${i + 1}`}
                        value={f.sector ?? ""}
                        onChange={(ev) => modifier(i, "sector", ev.target.value)}
                        className="input min-h-[44px] py-1.5"
                      >
                        <option value="">Secteur —</option>
                        {SECTEURS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      {/* Un champ qui GRANDIT : la remarque se lit en entier,
                          au lieu d'être coupée au bord d'un champ d'une ligne. */}
                      <ChampExtensible
                        aria-label={`Ce qu'on sait, ligne ${i + 1}`}
                        value={f.notes ?? ""}
                        onChange={(v) => modifier(i, "notes", v)}
                        max={200}
                        placeholder="Ce qu'on sait (vos remarques)"
                        className="input min-h-[44px] py-2.5 text-xs sm:col-span-2 lg:col-span-4"
                      />
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {e && <span className={`chip ${BADGE[e.statut]}`}>{LIBELLE[e.statut]}</span>}
                      <button
                        type="button"
                        onClick={() => retirer(i)}
                        aria-label={`Retirer la ligne ${i + 1}`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white/[0.06] hover:text-rose-300"
                      >
                        <Icone nom="croix" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {notes.length > 0 && (
                    <p className="mt-1.5 pl-8 text-[11px] text-amber-200/90">{notes.join(" · ")}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {importee && (
        <p className="card flex flex-wrap items-center gap-2 px-4 py-3 text-sm text-emerald-200" role="status">
          <Icone nom="coche" className="h-4 w-4" />
          {importee.n} fiche{importee.n > 1 ? "s" : ""} créée{importee.n > 1 ? "s" : ""}.
          <Link href="/prospects?statut=a_appeler" className="btn-link ml-auto text-sm">
            Voir mes fiches « À appeler » →
          </Link>
          {importee.ignorees.length > 0 && (
            <span className="w-full text-xs text-amber-200/90">{importee.ignorees.join(" · ")}</span>
          )}
        </p>
      )}

      {/* « Importer » — un clic. Sur téléphone, au-dessus des onglets. */}
      {etat.fiches.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 px-4 lg:static lg:px-0">
          <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl bg-[#121829] px-3 py-2 shadow-2xl ring-1 ring-white/15 lg:max-w-none lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0">
            <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
              Étape « À appeler »{admin && pour !== moi ? ` · pour ${membres.find(([id]) => id === pour)?.[1] ?? "—"}` : ""}
            </span>
            <button
              type="button"
              onClick={importer}
              disabled={aCreer.length === 0 || pending}
              className="btn-primary min-h-[48px] shrink-0 px-5"
            >
              {pending ? "…" : `Importer ${aCreer.length} fiche${aCreer.length > 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
