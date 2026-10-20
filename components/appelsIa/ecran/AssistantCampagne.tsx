"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  fichesPourCampagneAction,
  lancerCampagneAction,
  type FicheCampagne,
  type IssueLancement,
} from "@/app/appels-ia-actions";
import {
  CONFIRMATION_REEL,
  REFUS_REEL_SANS_TEST,
  compterSelection,
  estimationJours,
  phraseEstimation,
  phraseSelection,
} from "@/lib/appelsIa/ecran";
import { SECTEURS, SECTEUR_LABEL } from "@/lib/appelsIa/secteur";
import { correspond } from "@/lib/crm/recherche";
import { STATUS_LABEL, STATUS_ORDER } from "@/lib/constants";
import { FeuilleBas } from "@/components/FeuilleBas";
import { Icone } from "@/components/ui";
import { Retour } from "./commun";

export type ReglagesAssistant = {
  fenetre: string;
  fenetre_debut: string;
  fenetre_fin: string;
  plafond_heure: number;
  plafond_jour: number;
  mode_test: boolean;
  inscription_auto: boolean;
  gsm: string | null;
};

type Etape = 1 | 2 | 3;
const TITRE: Record<Etape, string> = { 1: "Nom de la campagne", 2: "Les fiches", 3: "Récapitulatif" };

/** Sous `sm` : l'assistant passe en feuilles successives (FeuilleBas). */
function useTelephone(): boolean {
  const [t, setT] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const maj = () => setT(mq.matches);
    maj();
    mq.addEventListener("change", maj);
    return () => mq.removeEventListener("change", maj);
  }, []);
  return t;
}

/**
 * L'assistant « Nouvelle campagne » — trois écrans : le nom, les fiches, le
 * récapitulatif. Aussi « Ajouter des fiches » à une campagne existante (on
 * entre alors directement aux fiches).
 *
 * Les fiches viennent de `fichesPourCampagneAction`, chacune avec la raison
 * pour laquelle Janet ne l'appellerait pas — la règle EN BASE (migration 029 →
 * `appels_ia_refus_inscription`), jamais une copie ici. L'écran ne fait que
 * compter (`compterSelection`).
 *
 * « Lancer » demande une confirmation, et une SECONDE pour les appels réels
 * (annonce IA, liste d'opposition). Le réel n'est offert qu'après un appel de
 * test réussi — l'action serveur le revérifie.
 *
 * Un seul contenu, deux enveloppes : une carte sur ordinateur, la feuille du
 * bas sur téléphone.
 */
export function AssistantCampagne({
  ouvert,
  onFermer,
  campagne,
  membres,
  moiId,
  reglages: r,
  testReussi,
  refusLancement,
  confirmationTest,
  confirmationReel,
}: {
  ouvert: boolean;
  onFermer: () => void;
  /** « Ajouter des fiches » : la campagne visée. Null : une nouvelle campagne. */
  campagne: { id: string; nom: string } | null;
  membres: { id: string; nom: string }[];
  moiId: string;
  reglages: ReglagesAssistant;
  testReussi: boolean;
  /**
   * Pourquoi « Lancer » est bloqué — le numéro appelant, la connexion, un test
   * réussi (`refusLancement`) — ou null. On prépare la campagne quand même ;
   * seul le dernier geste attend. L'action serveur refuse avec la même phrase.
   */
  refusLancement: string | null;
  /** Les phrases de confirmation, calculées côté serveur (elles dépendent de l'heure). */
  confirmationTest: string;
  confirmationReel: string;
}) {
  const telephone = useTelephone();
  const [etape, setEtape] = useState<Etape>(campagne ? 2 : 1);
  const [nom, setNom] = useState("");
  const [filtreEtape, setFiltreEtape] = useState("a_appeler");
  const [proprietaire, setProprietaire] = useState("moi");
  const [secteur, setSecteur] = useState("");
  const [ville, setVille] = useState("");
  const [recherche, setRecherche] = useState("");
  const [fiches, setFiches] = useState<FicheCampagne[] | null>(null);
  const [tronque, setTronque] = useState(false);
  const [erreurListe, setErreurListe] = useState<string>();
  const [cochees, setCochees] = useState<Set<string>>(new Set());
  const [reel, setReel] = useState(!r.mode_test && testReussi);
  const [auto, setAuto] = useState(false);
  const [confirmer, setConfirmer] = useState<null | "lancer" | "reel">(null);
  const [issue, setIssue] = useState<IssueLancement>();
  const [chargement, startChargement] = useTransition();
  const [lancement, startLancement] = useTransition();

  // À chaque ouverture, on repart du début.
  useEffect(() => {
    if (!ouvert) return;
    setEtape(campagne ? 2 : 1);
    setNom("");
    setCochees(new Set());
    setConfirmer(null);
    setIssue(undefined);
  }, [ouvert, campagne]);

  // Les fiches : relues quand l'étape ou le propriétaire changent (filtrés en base).
  useEffect(() => {
    if (!ouvert) return;
    setErreurListe(undefined);
    startChargement(async () => {
      const res = await fichesPourCampagneAction({ etape: filtreEtape, proprietaire });
      setErreurListe(res.error);
      setFiches(res.fiches ?? []);
      setTronque(Boolean(res.tronque));
    });
  }, [ouvert, filtreEtape, proprietaire]);

  const villes = useMemo(
    () => [...new Set((fiches ?? []).map((f) => f.ville?.trim()).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, "fr")),
    [fiches]
  );
  const visibles = useMemo(
    () =>
      (fiches ?? []).filter(
        (f) =>
          (!secteur || f.secteur === secteur) &&
          (!ville || (f.ville ?? "").trim() === ville) &&
          correspond({ company_name: f.societe, contact_name: f.contact, email: f.email, city: f.ville, phone: f.telephone }, recherche)
      ),
    [fiches, secteur, ville, recherche]
  );
  const compte = useMemo(() => compterSelection(fiches ?? [], cochees), [fiches, cochees]);
  const toutesCochees = visibles.length > 0 && visibles.every((f) => cochees.has(f.id));
  const nomMembre = useMemo(() => new Map(membres.map((m) => [m.id, m.nom])), [membres]);
  const estimation = estimationJours(compte.appelables.length, r);

  function basculer(id: string) {
    setCochees((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toutBasculer() {
    setCochees((c) => {
      const n = new Set(c);
      if (toutesCochees) visibles.forEach((f) => n.delete(f.id));
      else visibles.forEach((f) => n.add(f.id));
      return n;
    });
  }

  function lancer() {
    if (confirmer === null) {
      setConfirmer("lancer");
      return;
    }
    if (confirmer === "lancer" && reel && r.mode_test) {
      setConfirmer("reel");
      return;
    }
    setIssue(undefined);
    startLancement(async () => {
      const res = await lancerCampagneAction({
        nom: campagne ? undefined : nom,
        campagneId: campagne?.id ?? null,
        ids: compte.appelables,
        reel,
        inscriptionAuto: auto,
      });
      setIssue(res);
      setConfirmer(null);
    });
  }

  const reussiLancement = Boolean(issue?.ok);

  // ---------------------------------------------------------------- les écrans
  const ecran1 = (
    <div className="space-y-3">
      <label htmlFor="campagne-nom" className="label">
        Nom de la campagne
      </label>
      <input
        id="campagne-nom"
        data-autofocus
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        maxLength={120}
        placeholder="Garages de Namur — octobre"
        className="input"
      />
      <p className="text-[11px] leading-relaxed text-slate-500">
        Pour la retrouver dans le suivi. Rien n&apos;est créé avant « Lancer la campagne ».
      </p>
    </div>
  );

  const ecran2 = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <select aria-label="Étape" value={filtreEtape} onChange={(e) => setFiltreEtape(e.target.value)} className="input">
          {STATUS_ORDER.filter((s) => s !== "gagne" && s !== "perdu").map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
          <option value="ouvertes">Toutes les étapes ouvertes</option>
        </select>
        <select aria-label="Propriétaire" value={proprietaire} onChange={(e) => setProprietaire(e.target.value)} className="input">
          <option value="moi">Mes fiches</option>
          <option value="tous">Toute l&apos;équipe</option>
          {membres
            .filter((m) => m.id !== moiId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.nom}
              </option>
            ))}
        </select>
        <select aria-label="Secteur" value={secteur} onChange={(e) => setSecteur(e.target.value)} className="input">
          <option value="">Tous les secteurs</option>
          {SECTEURS.map((s) => (
            <option key={s} value={s}>
              {SECTEUR_LABEL[s]}
            </option>
          ))}
        </select>
        <select aria-label="Ville" value={ville} onChange={(e) => setVille(e.target.value)} className="input">
          <option value="">Toutes les villes</option>
          {villes.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <input
        type="search"
        aria-label="Rechercher une fiche"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        placeholder="Rechercher : société, contact, ville, numéro"
        className="input"
      />

      {erreurListe && <Retour etat={{ error: erreurListe }} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={toutesCochees}
            onChange={toutBasculer}
            disabled={visibles.length === 0}
            className="h-4 w-4 accent-celya-blue"
          />
          Tout sélectionner ({visibles.length})
        </label>
        {chargement && <span className="text-xs text-slate-500">Vérification des fiches…</span>}
      </div>

      {tronque && (
        <p className="text-xs text-amber-300">Plus de 500 fiches : seules les 500 premières sont listées. Affinez les filtres.</p>
      )}

      <ul className="max-h-[50dvh] divide-y divide-white/[0.06] overflow-y-auto rounded-xl ring-1 ring-white/[0.06] sm:max-h-[420px]">
        {fiches !== null && visibles.length === 0 && (
          <li className="px-3 py-4 text-sm text-slate-500">Aucune fiche avec ces filtres.</li>
        )}
        {visibles.map((f) => (
          <li key={f.id}>
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3 px-3 py-2.5 transition hover:bg-white/[0.03]">
              <input
                type="checkbox"
                checked={cochees.has(f.id)}
                onChange={() => basculer(f.id)}
                className="mt-1 h-4 w-4 shrink-0 accent-celya-blue"
              />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm text-slate-100">{f.societe}</span>
                <span className="block text-[11px] text-slate-500">
                  {[f.ville, SECTEUR_LABEL[f.secteur], STATUS_LABEL[f.etape], f.telephone, proprietaire === "moi" ? null : nomMembre.get(f.proprietaireId ?? "")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {f.refus && (
                  <span className="mt-1 flex items-start gap-1 text-[11px] text-amber-300">
                    <Icone nom="alerte" className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="min-w-0">Écartée : {f.refus}</span>
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <Compte compte={compte} />
    </div>
  );

  const ecran3 = (
    <div className="space-y-4">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {!campagne && (
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-slate-500">Campagne</dt>
            <dd className="break-words text-slate-100">{nom}</dd>
          </div>
        )}
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-slate-500">Fiches</dt>
          <dd className="text-slate-100">
            {compte.appelables.length} à appeler
            {compte.ecartees.length > 0 && <span className="text-slate-400"> · {compte.ecartees.length} écartée{compte.ecartees.length > 1 ? "s" : ""}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-slate-500">Fenêtre et plafonds</dt>
          <dd className="text-slate-100">
            {r.fenetre} en semaine · {r.plafond_heure}/heure · {r.plafond_jour}/jour{" "}
            <a href="/appels-ia?onglet=campagnes#reglages-avances" className="btn-link text-xs">
              Modifier
            </a>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-slate-500">Durée estimée</dt>
          <dd className="text-slate-300">{phraseEstimation(compte.appelables.length, estimation)}</dd>
        </div>
      </dl>

      <fieldset className="space-y-2">
        <legend className="label">Mode</legend>
        <label className="flex min-h-[44px] items-start gap-2.5 rounded-xl px-3 py-2.5 ring-1 ring-white/10">
          <input type="radio" name="mode-campagne" checked={!reel} onChange={() => setReel(false)} className="mt-1 accent-celya-blue" />
          <span className="text-sm text-slate-200">
            Test — tous les appels partent vers votre GSM{r.gsm ? ` (${r.gsm})` : ""}, rien n&apos;est écrit sur les fiches.
          </span>
        </label>
        <label
          className={
            testReussi
              ? "flex min-h-[44px] items-start gap-2.5 rounded-xl px-3 py-2.5 ring-1 ring-white/10"
              : "flex min-h-[44px] items-start gap-2.5 rounded-xl px-3 py-2.5 opacity-60 ring-1 ring-white/10"
          }
        >
          <input
            type="radio"
            name="mode-campagne"
            checked={reel}
            disabled={!testReussi}
            onChange={() => setReel(true)}
            className="mt-1 accent-celya-blue"
          />
          <span className="text-sm text-slate-200">
            Réel — Janet appelle les vrais numéros et écrit chaque résultat sur la fiche.
            {!testReussi && <span className="mt-1 block text-xs text-amber-300">{REFUS_REEL_SANS_TEST}</span>}
          </span>
        </label>
      </fieldset>

      {!r.inscription_auto && (
        <label className="flex min-h-[44px] items-start gap-2.5 text-sm text-slate-300">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="mt-1 h-4 w-4 accent-celya-blue" />
          <span>
            Ajouter aussi automatiquement mes nouvelles fiches « À appeler »
            <span className="block text-[11px] text-slate-500">
              Elles entrent dans la campagne « Inscription automatique », cinq minutes après leur création.
            </span>
          </span>
        </label>
      )}

      {issue && (
        <div className="space-y-2">
          <Retour etat={issue} />
          {issue.refusees && issue.refusees.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-slate-400">
              {issue.refusees.map((x, i) => (
                <li key={i}>
                  {x.societe} — {x.raison}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------- la navigation
  const peutSuivre = etape === 1 ? nom.trim().length > 0 : etape === 2 ? compte.appelables.length > 0 : false;
  const boutons = reussiLancement ? (
    <div className="flex justify-end">
      <button type="button" onClick={onFermer} className="btn-primary">
        Fermer
      </button>
    </div>
  ) : (
    <div className="space-y-3">
      {/* La confirmation vit AU-DESSUS du bouton, dans le pied : sur téléphone,
          on ne confirme jamais une phrase qu'on n'a pas sous les yeux. Le
          refus aussi : un bouton grisé dit pourquoi, juste au-dessus de lui. */}
      {etape === 3 && refusLancement && (
        <p id="lancer-bloque" className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-300">
          <Icone nom="alerte" className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0">{refusLancement}</span>
        </p>
      )}
      {confirmer === "lancer" && (
        <p role="alert" className="rounded-xl bg-celya-blue/10 px-3.5 py-3 text-sm leading-relaxed text-blue-100 ring-1 ring-blue-400/30">
          {reel ? confirmationReel : confirmationTest}
        </p>
      )}
      {confirmer === "reel" && (
        <p role="alert" className="rounded-xl bg-amber-500/[0.08] px-3.5 py-3 text-sm leading-relaxed text-amber-200 ring-1 ring-amber-400/25">
          {CONFIRMATION_REEL}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {etape > (campagne ? 2 : 1) ? (
          <button
            type="button"
            onClick={() => {
              setConfirmer(null);
              setEtape((e) => (e - 1) as Etape);
            }}
            className="btn-ghost"
          >
            ← Retour
          </button>
        ) : (
          <button type="button" onClick={onFermer} className="btn-link text-sm">
            Annuler
          </button>
        )}
        {etape < 3 ? (
          <button type="button" disabled={!peutSuivre} onClick={() => setEtape((e) => (e + 1) as Etape)} className="btn-primary">
            Suivant →
          </button>
        ) : (
          <button type="button" disabled={lancement || compte.appelables.length === 0 || Boolean(refusLancement)} onClick={lancer} className="btn-primary">
            <Icone nom="telephone" className="h-4 w-4" />
            {lancement
              ? "Lancement…"
              : confirmer === "lancer" && reel && r.mode_test
                ? "Continuer"
                : confirmer
                  ? reel
                    ? "Oui, lancer en réel"
                    : "Oui, lancer"
                  : "Lancer la campagne"}
          </button>
        )}
      </div>
    </div>
  );

  const titre = campagne ? `Ajouter des fiches — ${campagne.nom}` : `Nouvelle campagne · ${etape}/3 — ${TITRE[etape]}`;
  const contenu = etape === 1 ? ecran1 : etape === 2 ? ecran2 : ecran3;

  if (!ouvert) return null;
  if (telephone) {
    return (
      <FeuilleBas ouvert={ouvert} onFermer={onFermer} titre={titre} pied={boutons}>
        {contenu}
      </FeuilleBas>
    );
  }
  return (
    <section className="card space-y-4 p-4 ring-1 ring-blue-400/30 sm:p-5" aria-label="Assistant de campagne">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-semibold text-slate-50">{titre}</h2>
        <button type="button" onClick={onFermer} aria-label="Fermer l'assistant" className="btn-link text-xs">
          Fermer
        </button>
      </div>
      {!campagne && (
        <ol className="flex gap-2 text-xs">
          {([1, 2, 3] as Etape[]).map((n) => (
            <li
              key={n}
              className={n === etape ? "rounded-full bg-celya-blue/15 px-2.5 py-1 text-blue-100 ring-1 ring-blue-400/40" : "rounded-full px-2.5 py-1 text-slate-500 ring-1 ring-white/10"}
            >
              {n}. {TITRE[n]}
            </li>
          ))}
        </ol>
      )}
      {contenu}
      <div className="border-t border-white/[0.06] pt-4">{boutons}</div>
    </section>
  );
}

/** Le compte de la sélection, et pourquoi les autres sont écartées. */
function Compte({ compte }: { compte: ReturnType<typeof compterSelection> }) {
  if (compte.appelables.length === 0 && compte.ecartees.length === 0) {
    return <p className="text-xs text-slate-500">Cochez les fiches à mettre dans la campagne.</p>;
  }
  return (
    <div className="rounded-xl bg-white/[0.03] px-3.5 py-3 ring-1 ring-white/[0.06]" aria-live="polite">
      <p className="text-sm font-medium text-slate-100">{phraseSelection(compte)}</p>
      {compte.parRaison.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-slate-400">
          {compte.parRaison.map((x) => (
            <li key={x.raison}>
              {x.nombre} × {x.raison}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
