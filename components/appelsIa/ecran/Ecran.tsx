/**
 * L'écran Appels IA, une fois les données lues — composant SERVEUR.
 *
 * TROIS ONGLETS, dans cet ordre : « Mise en route » (tant qu'elle n'est pas
 * complète, l'écran s'ouvre ici), « Campagnes » (créer et lancer), « Suivi »
 * (l'appel en cours, la file, les derniers appels, l'opposition).
 *
 * La page (app/(app)/appels-ia/page.tsx) vérifie le rôle et lit la base ;
 * ici, on ne fait que mettre en forme. Les dates et « maintenant » sont
 * calculés ICI et passés en chaînes : aucun composant client ne les recalcule
 * à l'hydratation. Aux composants clients ne passent que des données — jamais
 * une fonction (npm run test:frontiere).
 */

import type { AppelDetail, PageAppels } from "@/lib/appelsIa/lectures";
import type { ReglagesAppels } from "@/lib/appelsIa/acces";
import { numeroLisible } from "@/lib/appelsIa/numeros";
import { enMinutes, heureFr, jourHeureFr } from "@/lib/appelsIa/calendrier";
import { elementsManquants, refusAppelTest, LIBELLE_ELEMENT, type ElementMiseEnRoute } from "@/lib/appelsIa/ecran";
import { fmtDate } from "@/lib/constants";
import { EtatMoteur } from "./EtatMoteur";
import { AppelTest } from "./AppelTest";
import { Inscription } from "./Inscription";
import { Reglages } from "./Reglages";
import { Campagnes } from "./Campagnes";
import { FileAppels } from "./File";
import { DerniersAppels } from "./DerniersAppels";
import { Scripts } from "./Scripts";
import { Opposition } from "./Opposition";
import { BandeauPause } from "./BandeauPause";
import { LigneControle, type LigneControleVue } from "./LigneControle";
import { OngletsAppels, type EtatOnglet, type Onglet } from "./Onglets";
import { Repliable, TitreCarte } from "./commun";
import { phraseEtat } from "./format";

const AIDE: Record<ElementMiseEnRoute, string> = {
  numero_appelant: "Le numéro présenté aux prospects (le 0480). Sans lui, le moteur refuse de composer.",
  gsm_test: "Votre GSM : en mode test, tous les appels partent vers lui, et rien n'est écrit sur les fiches.",
  openai_api_key: "La voix et la conversation de Janet (GPT-Live). Écriture seule : elle ne s'affiche plus jamais.",
  sip_identifiant: "L'identifiant de connexion du trunk SIP Telnyx (Voice → SIP Connections → Credentials).",
  sip_mot_de_passe: "Le mot de passe du même trunk. Écriture seule.",
};

/** Ce que l'écran sait de la mise en route — calculé une fois, lu par la page (onglet par défaut) et ici. */
export function miseEnRoute(page: PageAppels, r: ReglagesAppels) {
  const faits = {
    numeroAppelant: r.numero_appelant,
    gsmTest: r.gsm_test,
    secretsPoses: page.secrets.map((s) => s.nom),
  };
  const manquants = elementsManquants(faits);
  return {
    faits,
    manquants,
    complete: manquants.length === 0 && page.testReussi,
    bloque: refusAppelTest({ ...faits, appelEnCours: page.etat.enCours !== null }),
  };
}

export function EcranAppels({
  page,
  reglages: r,
  allumeeParAutre,
  maintenant,
  onglet,
  suiviTest,
}: {
  page: PageAppels;
  /** Les réglages, lus (la page ne rend l'écran que s'ils existent). */
  reglages: ReglagesAppels;
  /** Le nom de l'admin qui a allumé l'inscription automatique, si ce n'est pas l'appelant. */
  allumeeParAutre: string | null;
  maintenant: Date;
  onglet: Onglet;
  /** Le dernier appel de test, détaillé (transcription), ou null. */
  suiviTest: AppelDetail | null;
}) {
  const gsm = r.gsm_test ? numeroLisible(r.gsm_test) : null;
  const mer = miseEnRoute(page, r);

  const campagnesActives = page.campagnes.filter((c) => !c.systeme && c.statut === "active").length;
  const etats: Record<Onglet, EtatOnglet> = {
    "mise-en-route": mer.complete
      ? { ton: "fait", texte: "fait" }
      : { ton: "a_faire", texte: mer.manquants.length ? `${mer.manquants.length} à régler` : "test à faire" },
    campagnes:
      campagnesActives > 0
        ? { ton: "info", texte: `${campagnesActives} active${campagnesActives > 1 ? "s" : ""}` }
        : { ton: "a_faire", texte: "à faire" },
    suivi: page.etat.enCours
      ? { ton: "info", texte: "en direct" }
      : { ton: "info", texte: `${page.etat.jour.appeles} aujourd'hui` },
  };

  return (
    <>
      <OngletsAppels actuel={onglet} etats={etats} />
      {onglet === "mise-en-route" && <OngletMiseEnRoute page={page} r={r} gsm={gsm} mer={mer} suiviTest={suiviTest} />}
      {onglet === "campagnes" && (
        <OngletCampagnes page={page} r={r} gsm={gsm} allumeeParAutre={allumeeParAutre} />
      )}
      {onglet === "suivi" && <OngletSuivi page={page} maintenant={maintenant} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// 1. Mise en route
// ---------------------------------------------------------------------------

function OngletMiseEnRoute({
  page,
  r,
  gsm,
  mer,
  suiviTest,
}: {
  page: PageAppels;
  r: ReglagesAppels;
  gsm: string | null;
  mer: ReturnType<typeof miseEnRoute>;
  suiviTest: AppelDetail | null;
}) {
  const poses = new Map(page.secrets.map((s) => [s.nom, s.pose_le]));
  const lignes: LigneControleVue[] = (["numero_appelant", "gsm_test", "openai_api_key", "sip_identifiant", "sip_mot_de_passe"] as const).map(
    (e) => {
      if (e === "numero_appelant" || e === "gsm_test") {
        const v = r[e];
        return { element: e, genre: "numero", libelle: LIBELLE_ELEMENT[e], aide: AIDE[e], fait: v ? numeroLisible(v) : null };
      }
      const le = poses.get(e);
      return {
        element: e,
        genre: "secret",
        libelle: LIBELLE_ELEMENT[e],
        aide: AIDE[e],
        fait: poses.has(e) ? (le ? `posé le ${fmtDate(le)}` : "posé") : null,
      };
    }
  );
  const faits = lignes.filter((l) => l.fait).length;

  return (
    <div className="space-y-6">
      <section className="card p-4 sm:p-5">
        <TitreCarte
          icone="reglages"
          aside={
            <span className={faits === lignes.length ? "text-xs text-emerald-300" : "text-xs text-amber-300"}>
              {faits} / {lignes.length}
            </span>
          }
        >
          Avant le premier appel
        </TitreCarte>
        <p className="mb-4 text-xs leading-relaxed text-slate-400">
          De haut en bas. Chaque ligne se coche dès qu&apos;elle est enregistrée ; les secrets partent dans le
          coffre-fort de Supabase (Vault) et ne s&apos;affichent plus jamais, ici ni ailleurs.
        </p>
        <ul className="divide-y divide-white/[0.06]">
          {lignes.map((l) => (
            <LigneControle key={l.element} l={l} />
          ))}
        </ul>
      </section>

      <section className="card p-4 sm:p-5">
        <TitreCarte icone="telephone">Appel de test</TitreCarte>
        <AppelTest gsm={gsm} bloque={mer.bloque} suivi={suiviTest} reussi={page.testReussi} />
        {r.pause_cause && (
          <BandeauPause cause={r.pause_cause} depuis={r.pause_at ? jourHeureFr(new Date(r.pause_at)) : null} />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Campagnes
// ---------------------------------------------------------------------------

function OngletCampagnes({
  page,
  r,
  gsm,
  allumeeParAutre,
}: {
  page: PageAppels;
  r: ReglagesAppels;
  gsm: string | null;
  allumeeParAutre: string | null;
}) {
  const debut = heureFr(enMinutes(r.fenetre_debut.slice(0, 5)));
  const fin = heureFr(enMinutes(r.fenetre_fin.slice(0, 5)));
  return (
    <div className="space-y-6">
      <EtatMoteur
        phrase={phraseEtat({
          reglages: r,
          refus: page.etat.refus,
          enCours: page.etat.enCours,
          fileTotal: page.etat.file.total,
        })}
        pause={
          r.pause_cause
            ? { cause: r.pause_cause, depuis: r.pause_at ? jourHeureFr(new Date(r.pause_at)) : null }
            : null
        }
        aRegler={[]}
        actif={r.actif}
        modeTest={r.mode_test}
        gsm={gsm}
        plafondJour={r.plafond_jour}
        jour={page.etat.jour}
        fileTotal={page.etat.file.total}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card min-w-0 p-4 sm:p-5">
          <TitreCarte icone="dossier">Campagnes</TitreCarte>
          <Campagnes
            campagnes={page.campagnes.map((c) => ({
              id: c.id,
              nom: c.nom,
              statut: c.statut,
              systeme: c.systeme,
              enAttente: c.enAttente,
              termine: c.termine,
              creeLe: fmtDate(c.created_at),
            }))}
          />
        </section>
        <section className="card min-w-0 p-4 sm:p-5">
          <TitreCarte icone="taches">Inscription dans la file</TitreCarte>
          <Inscription
            valeur={r.inscription_auto}
            allumeeParAutre={allumeeParAutre}
            rattrapage={page.rattrapage}
            modeTest={r.mode_test}
          />
        </section>
      </div>

      <Repliable titre="Réglages avancés" compte={`${debut}–${fin} · ${r.plafond_heure}/h · ${r.plafond_jour}/jour`} icone="reglages">
        <Reglages
          r={{
            fenetre_debut: r.fenetre_debut,
            fenetre_fin: r.fenetre_fin,
            plafond_heure: r.plafond_heure,
            plafond_jour: r.plafond_jour,
            limite_compte_heure: r.limite_compte_heure,
            limite_compte_jour: r.limite_compte_jour,
            duree_max_s: r.duree_max_s,
            sonnerie_max_s: r.sonnerie_max_s,
            numero_appelant: r.numero_appelant,
            gsm_test: r.gsm_test,
            trunk_url: r.trunk_url,
            voix: r.voix,
            modele: r.modele,
            modele_delegation: r.modele_delegation,
            mode_test: r.mode_test,
          }}
        />
      </Repliable>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Suivi
// ---------------------------------------------------------------------------

function OngletSuivi({ page, maintenant }: { page: PageAppels; maintenant: Date }) {
  return (
    <div className="space-y-6">
      <FileAppels lignes={page.file} total={page.etat.file.total} maintenant={maintenant} />
      <DerniersAppels appels={page.appels} maintenant={maintenant} />
      <Scripts scripts={page.scripts} maintenant={maintenant} />
      <Opposition numeros={page.opposition} maintenant={maintenant} />
    </div>
  );
}
