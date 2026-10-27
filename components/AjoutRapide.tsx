"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ajoutRapideAction,
  doublonEquipeAction,
  rechercherProspectsAction,
  type ResultatRecherche,
} from "@/app/actions";
import { SECTEURS } from "@/lib/crm/secteurs";
import { lireRaccourcis } from "@/lib/crm/raccourcis";
import { lireCeQuiSestPasse, OUVRIR_AJOUT } from "@/lib/crm/ajoutRapide";
import { chiffresTelephone, doublonsProbables } from "@/lib/crm/recherche";
import { estPositionGps, lienPosition } from "@/lib/crm/maps";
import { Icone } from "@/components/ui";
import { FeuilleBas } from "@/components/FeuilleBas";
import { ChampExtensible } from "@/components/ChampExtensible";

/**
 * L'AJOUT RAPIDE — le « ＋ » de la barre du bas (19/10). Entre deux visites,
 * d'une main : trois champs (société obligatoire, contact, téléphone), la
 * position, et une ligne « Ce qui s'est passé » lue comme une note
 * (`lireCeQuiSestPasse` : « rdv mardi 11h » pose un vrai rendez-vous,
 * « rappeler jeudi » une relance). Le responsable, c'est soi ; l'étape suit
 * les faits — rien de cela n'est demandé.
 *
 * Avant de créer, la recherche ⌘K (la même, sous la RLS) regarde le nom et le
 * numéro : « Existe déjà — ouvrir la fiche ». Après, on arrive sur la fiche.
 * « Plus de champs » mène au formulaire complet, qui reste.
 *
 * UNE instance, dans le layout ; le « ＋ » et le raccourci d'application
 * (`?ajout=1`) l'ouvrent par un événement de fenêtre.
 */
export function AjoutRapide() {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [societe, setSociete] = useState("");
  const [contact, setContact] = useState("");
  const [telephone, setTelephone] = useState("");
  const [secteur, setSecteur] = useState("");
  /** « Déjà suivie dans l'équipe » (031) — la phrase, sans aucun nom pour un commercial. */
  const [equipe, setEquipe] = useState<{ phrase: string | null; peutForcer: boolean }>({
    phrase: null,
    peutForcer: false,
  });
  const [position, setPosition] = useState<string | null>(null);
  const [localise, setLocalise] = useState(false);
  const [texte, setTexte] = useState("");
  const [repere, setRepere] = useState(false);
  const [sansRdv, setSansRdv] = useState(false);
  const [trouvees, setTrouvees] = useState<ResultatRecherche[]>([]);
  const [erreur, setErreur] = useState<string>();
  const [cree, setCree] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Le « ＋ » de la barre, et le raccourci d'application (`?ajout=1`).
  useEffect(() => {
    const ouvrir = () => setOuvert(true);
    window.addEventListener(OUVRIR_AJOUT, ouvrir);
    const url = new URL(window.location.href);
    if (url.searchParams.get("ajout") === "1") {
      setOuvert(true);
      url.searchParams.delete("ajout");
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    }
    return () => window.removeEventListener(OUVRIR_AJOUT, ouvrir);
  }, []);

  // « Ce qui s'est passé » — le même parseur que la note, à la frappe.
  const lecture = useMemo(
    () =>
      lireCeQuiSestPasse(texte, texte.trim() ? lireRaccourcis(texte, new Date()) : null, {
        repere,
        sansRdv,
        contactSaisi: contact,
      }),
    [texte, repere, sansRdv, contact]
  );

  // Les doublons : la recherche ⌘K sur le nom, puis sur le numéro, 300 ms
  // après la dernière frappe. Elle passe sous la RLS : on ne voit que ses fiches.
  useEffect(() => {
    if (!ouvert) return;
    const nom = societe.trim();
    const tel = chiffresTelephone(telephone);
    if (nom.length < 3 && !tel) {
      setTrouvees([]);
      setEquipe((e) => ({ ...e, phrase: null }));
      return;
    }
    let annule = false;
    const t = setTimeout(async () => {
      // Ses fiches (RLS) ET l'équipe entière (031, des booléens seulement).
      const [parNom, parTel, dansEquipe] = await Promise.all([
        nom.length >= 3 ? rechercherProspectsAction(nom) : Promise.resolve({ resultats: [] }),
        tel ? rechercherProspectsAction(telephone) : Promise.resolve({ resultats: [] }),
        doublonEquipeAction({ telephone, societe: nom }),
      ]);
      if (!annule) {
        setTrouvees([...parTel.resultats, ...parNom.resultats]);
        setEquipe(dansEquipe);
      }
    }, 300);
    return () => {
      annule = true;
      clearTimeout(t);
    };
  }, [societe, telephone, ouvert]);

  const doublons = doublonsProbables({ nom: societe, telephone }, trouvees);
  // Une fiche visible a la priorité (on peut l'ouvrir) ; sinon l'équipe.
  const equipePhrase = doublons.length === 0 ? equipe.phrase : null;
  const memeFiche = doublons.some((d) => d.raison !== "proche") || Boolean(equipePhrase);
  /** Un commercial ne recrée jamais la fiche d'un autre ; l'admin peut forcer. */
  const bloqueEquipe = Boolean(equipePhrase) && !equipe.peutForcer;

  function fermer() {
    setOuvert(false);
  }

  function vider() {
    setSociete("");
    setContact("");
    setTelephone("");
    setSecteur("");
    setEquipe({ phrase: null, peutForcer: false });
    setPosition(null);
    setTexte("");
    setRepere(false);
    setSansRdv(false);
    setTrouvees([]);
    setErreur(undefined);
    setCree(null);
  }

  /** La position du téléphone — refusée ou indisponible : rien, sans erreur. */
  function localiser() {
    if (!("geolocation" in navigator)) return;
    setLocalise(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPosition(lienPosition(p.coords.latitude, p.coords.longitude));
        setLocalise(false);
      },
      () => setLocalise(false),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
    );
  }

  function creer() {
    if (!societe.trim() || lecture.manque || bloqueEquipe) return;
    setErreur(undefined);
    startTransition(async () => {
      const res = await ajoutRapideAction({
        champs: {
          company_name: societe,
          contact_name: contact,
          phone: telephone,
          address: position ?? "",
          sector: secteur,
        },
        echange: lecture.echange,
        forcer: Boolean(equipePhrase) && equipe.peutForcer,
      });
      if (res.doublonEquipe) {
        setEquipe((e) => ({ ...e, phrase: res.doublonEquipe ?? null }));
        return;
      }
      if (res.error || !res.id) {
        setErreur(res.error ?? "La fiche n'a pas pu être créée.");
        return;
      }
      if (res.erreurEchange) {
        // La fiche existe : on le dit, et on y mène — le geste s'y refait.
        setCree(res.id);
        setErreur(`Fiche créée, mais « ce qui s'est passé » n'a pas été enregistré : ${res.erreurEchange}`);
        return;
      }
      vider();
      setOuvert(false);
      router.push(`/prospects/${res.id}`);
    });
  }

  const libelleCreer = pending ? "Création…" : memeFiche ? "Créer quand même" : "Créer la fiche";

  return (
    <FeuilleBas
      ouvert={ouvert}
      onFermer={fermer}
      titre="Nouveau prospect"
      pied={
        <div className="flex items-center gap-2">
          <Link
            href="/prospects/nouveau"
            onClick={fermer}
            className="btn-ghost min-h-[48px] shrink-0 px-3.5 text-sm"
          >
            Plus de champs
          </Link>
          {cree ? (
            <Link
              href={`/prospects/${cree}`}
              onClick={() => {
                vider();
                fermer();
              }}
              className="btn-primary min-h-[48px] flex-1"
            >
              Ouvrir la fiche
            </Link>
          ) : (
            <button
              type="submit"
              form="ajout-rapide"
              disabled={pending || !societe.trim() || Boolean(lecture.manque) || bloqueEquipe}
              className="btn-primary min-h-[48px] flex-1"
            >
              {libelleCreer}
            </button>
          )}
        </div>
      }
    >
      <form
        id="ajout-rapide"
        onSubmit={(e) => {
          e.preventDefault();
          creer();
        }}
        className="space-y-3"
      >
        <div>
          <label className="label" htmlFor="ar-societe">
            Société
          </label>
          <input
            id="ar-societe"
            data-autofocus
            required
            value={societe}
            onChange={(e) => setSociete(e.target.value)}
            autoCapitalize="words"
            autoComplete="organization"
            enterKeyHint="next"
            className="input min-h-[48px]"
            placeholder="Garage Dupont"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="ar-contact">
              Contact
            </label>
            <input
              id="ar-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              autoCapitalize="words"
              autoComplete="name"
              enterKeyHint="next"
              className="input min-h-[48px]"
              placeholder="Prénom Nom"
            />
          </div>
          <div>
            <label className="label" htmlFor="ar-tel">
              Téléphone
            </label>
            <input
              id="ar-tel"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="next"
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              className="input min-h-[48px]"
              placeholder="0470 12 34 56"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="ar-secteur">
            Secteur <span className="normal-case tracking-normal text-slate-500">(facultatif)</span>
          </label>
          <select
            id="ar-secteur"
            value={secteur}
            onChange={(e) => setSecteur(e.target.value)}
            className="input min-h-[48px]"
          >
            <option value="">—</option>
            {SECTEURS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* La position — un point, pas une adresse : on le dit. */}
        <div className="flex flex-wrap items-center gap-2">
          {position && estPositionGps(position) ? (
            <span className="inline-flex min-h-[44px] items-center gap-1.5 text-xs text-amber-200/90">
              <Icone nom="epingle" className="h-3.5 w-3.5" />
              Position GPS — adresse à compléter
              <button
                type="button"
                onClick={() => setPosition(null)}
                aria-label="Retirer la position"
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-400"
              >
                <Icone nom="croix" className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={localiser}
              disabled={localise}
              className="btn-ghost min-h-[44px] px-3.5 text-xs"
            >
              <Icone nom="epingle" className="h-3.5 w-3.5" />
              {localise ? "Localisation…" : "Ma position"}
            </button>
          )}
        </div>

        {doublons.length > 0 && (
          <div
            role="status"
            className="space-y-1 rounded-xl bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-100 ring-1 ring-amber-400/25"
          >
            {doublons.map((d) => (
              <p key={d.fiche.id} className="flex min-h-[44px] items-center gap-2">
                <Icone nom="alerte" className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                <span className="min-w-0 flex-1">
                  {d.raison === "proche" ? "Nom voisin" : "Existe déjà"} —{" "}
                  <span className="font-medium">{d.fiche.company_name}</span>
                  {d.raison === "telephone" ? " (même numéro)" : ""}
                </span>
                <Link
                  href={`/prospects/${d.fiche.id}`}
                  onClick={() => {
                    vider();
                    fermer();
                  }}
                  className="inline-flex min-h-[44px] shrink-0 items-center font-medium text-celya-blue"
                >
                  Ouvrir la fiche
                </Link>
              </p>
            ))}
          </div>
        )}

        {equipePhrase && (
          <p
            role="status"
            className="flex min-h-[44px] items-start gap-2 rounded-xl bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-100 ring-1 ring-amber-400/25"
          >
            <Icone nom="alerte" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
            <span>
              Cette société est {equipePhrase}.{" "}
              {equipe.peutForcer
                ? "Vous pouvez la créer quand même."
                : "Elle est à qui l'a enregistrée la première — demandez à l'administrateur de vous l'attribuer."}
            </span>
          </p>
        )}

        <div>
          <label className="label" htmlFor="ar-texte">
            Ce qui s&apos;est passé <span className="normal-case tracking-normal text-slate-500">(facultatif)</span>
          </label>
          {/* Grandit avec le texte : la dictée y verse trois phrases d'un coup. */}
          <ChampExtensible
            id="ar-texte"
            value={texte}
            onChange={(v) => {
              setTexte(v);
              setSansRdv(false);
            }}
            enterKeyHint="done"
            className="input min-h-[48px]"
            placeholder="« rdv mardi 11h », « rappeler jeudi », « pdr »…"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={repere}
              onClick={() => setRepere((r) => !r)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-xs ring-1 transition ${
                repere
                  ? "bg-white/[0.08] text-slate-100 ring-white/20"
                  : "text-slate-400 ring-white/10"
              }`}
            >
              {repere && <Icone nom="coche" className="h-3.5 w-3.5" />}
              Repéré, pas encore contacté
            </button>
            {texte.trim() &&
              lecture.pastilles.map((p) => (
                <span
                  key={p}
                  className={`chip ${
                    lecture.manque
                      ? "bg-amber-500/10 text-amber-200 ring-amber-400/30"
                      : "bg-celya-blue/10 text-blue-100 ring-celya-blue/30"
                  }`}
                >
                  {p}
                </span>
              ))}
          </div>
          {/* Un rendez-vous sans jour ou sans heure n'est JAMAIS posé : on le
              dit, et on laisse compléter — ou renoncer, explicitement. */}
          {lecture.manque && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-amber-200">
              <span>
                Aucun rendez-vous ne sera posé sans{" "}
                {lecture.manque === "jour" ? "son jour" : "son heure"} — ajoutez-
                {lecture.manque === "jour" ? "le (« mardi »)" : "la (« 11h »)"}.
              </span>
              <button
                type="button"
                onClick={() => setSansRdv(true)}
                className="btn-link min-h-[44px] text-xs"
              >
                Créer sans le rendez-vous
              </button>
            </p>
          )}
        </div>

        {erreur && (
          <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-400/20">
            {erreur}
          </p>
        )}
      </form>
    </FeuilleBas>
  );
}
