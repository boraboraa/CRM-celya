/**
 * L'écran Appels IA, une fois les données lues — composant SERVEUR.
 *
 * TROIS ONGLETS, dans cet ordre : « Numéro & test » (le numéro appelant, le
 * GSM de test, l'appel de test — l'écran s'ouvre ici tant que le numéro
 * appelant n'est pas réglé), « Campagnes » (créer et lancer), « Suivi »
 * (l'appel en cours, la file, les derniers appels, l'opposition). Ce qui ne
 * sert pas tous les jours — la CONNEXION (posée une fois), les réglages
 * avancés, les scripts — est replié en bas de « Numéro & test » et de
 * « Campagnes » (`Replis`) ; tant que la connexion manque, une seule ligne
 * discrète y mène.
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
import {
  connexionComplete,
  etatsOnglets,
  numerosProposes,
  phraseBandeau,
  phraseConfirmationLancement,
  refusAppelTest,
  refusLancement,
  LIBELLE_ELEMENT,
  LIGNE_CONNEXION,
  SECRETS_JANET,
  type ElementMiseEnRoute,
  type Onglet,
} from "@/lib/appelsIa/ecran";
import { fmtDate } from "@/lib/constants";
import { EtatMoteur } from "./EtatMoteur";
import { AppelTest } from "./AppelTest";
import { Inscription } from "./Inscription";
import { Campagnes } from "./Campagnes";
import { FileAppels } from "./File";
import { DerniersAppels } from "./DerniersAppels";
import { Replis } from "./Replis";
import { Opposition } from "./Opposition";
import { BandeauPause } from "./BandeauPause";
import { LigneControle, type LigneControleVue } from "./LigneControle";
import { EnDirect } from "./EnDirect";
import { OngletsAppels } from "./Onglets";
import { ChoixNumero } from "./ChoixNumero";
import { TitreCarte } from "./commun";

const AIDE: Record<ElementMiseEnRoute, string> = {
  numero_appelant: "Le numéro présenté aux prospects. Sans lui, le moteur refuse de composer.",
  gsm_test: "Votre GSM : en mode test, tous les appels partent vers lui, et rien n'est écrit sur les fiches.",
  openai_api_key: "La voix et la conversation de Janet (GPT-Live). Écriture seule : elle ne s'affiche plus jamais.",
  sip_identifiant: "L'identifiant de connexion du trunk SIP Telnyx (Voice → SIP Connections → Credentials).",
  sip_mot_de_passe: "Le mot de passe du même trunk. Écriture seule.",
};

/**
 * Ce que l'écran sait de la mise en route — calculé une fois (règles :
 * lib/appelsIa/ecran/miseEnRoute.ts), lu par la page (onglet d'ouverture) et
 * ici (onglets, ligne de connexion, appel de test, Lancer).
 */
export function miseEnRoute(page: PageAppels, r: ReglagesAppels) {
  const faits = {
    numeroAppelant: r.numero_appelant,
    gsmTest: r.gsm_test,
    secretsPoses: page.secrets.map((s) => s.nom),
  };
  return {
    faits,
    connexion: connexionComplete(faits),
    bloque: refusAppelTest({ ...faits, appelEnCours: page.etat.enCours !== null }),
    refusLancement: refusLancement({ ...faits, testReussi: page.testReussi }),
  };
}

/** Les trois lignes de la connexion (secrets) : posée et quand, ou à poser — jamais la valeur. */
function lignesConnexion(page: PageAppels): LigneControleVue[] {
  const poses = new Map(page.secrets.map((s) => [s.nom, s.pose_le]));
  return SECRETS_JANET.map((e) => {
    const le = poses.get(e);
    return {
      element: e,
      genre: "secret",
      libelle: LIBELLE_ELEMENT[e],
      aide: AIDE[e],
      fait: poses.has(e) ? (le ? `posé le ${fmtDate(le)}` : "posé") : null,
    };
  });
}

export function EcranAppels({
  page,
  reglages: r,
  allumeeParAutre,
  maintenant,
  onglet,
  aSuivreDetail,
  membres,
  moiId,
  telephoneProfil,
  connexionOuverte,
}: {
  page: PageAppels;
  /** Les réglages, lus (la page ne rend l'écran que s'ils existent). */
  reglages: ReglagesAppels;
  /** Le nom de l'admin qui a allumé l'inscription automatique, si ce n'est pas l'appelant. */
  allumeeParAutre: string | null;
  maintenant: Date;
  onglet: Onglet;
  /**
   * L'appel à suivre, détaillé (transcription), ou null : sur « Numéro &
   * test », le dernier appel de test ; sur « Suivi », l'appel en cours, à
   * défaut le dernier.
   */
  aSuivreDetail: AppelDetail | null;
  /** Les membres actifs : le filtre « propriétaire » de l'assistant de campagne. */
  membres: { id: string; nom: string }[];
  moiId: string;
  /** Le téléphone du compte de l'admin (`crm_users.phone`) : un numéro appelant proposé. */
  telephoneProfil: string | null;
  /** `?connexion=1` : « Réglages avancés → Connexion » s'ouvre déplié. */
  connexionOuverte: boolean;
}) {
  const gsm = r.gsm_test ? numeroLisible(r.gsm_test) : null;
  const mer = miseEnRoute(page, r);
  const etats = etatsOnglets({
    numeroAppelant: r.numero_appelant,
    gsmTest: r.gsm_test,
    testReussi: page.testReussi,
    campagnesActives: page.campagnes.filter((c) => !c.systeme && c.statut === "active").length,
    appelEnCours: page.etat.enCours !== null,
    appelesAujourdhui: page.etat.jour.appeles,
  });
  const replis = (
    <Replis page={page} r={r} maintenant={maintenant} connexion={lignesConnexion(page)} connexionOuverte={connexionOuverte} />
  );

  return (
    <>
      <OngletsAppels actuel={onglet} etats={etats} />
      {/* UNE ligne, discrète, tant que la connexion manque ; ensuite plus rien
          n'en parle. Le panneau vit sous « Numéro & test » et « Campagnes ». */}
      {!mer.connexion && (
        <p className="-mt-3 mb-5">
          <a
            href={`/appels-ia?onglet=${onglet === "suivi" ? "campagnes" : onglet}&connexion=1#connexion`}
            className="inline-flex min-h-[44px] items-center gap-2 text-xs text-slate-400 transition hover:text-slate-100 sm:min-h-0"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            {LIGNE_CONNEXION} →
          </a>
        </p>
      )}
      {onglet === "numero-test" && (
        <div className="space-y-6">
          <OngletNumeroTest page={page} r={r} gsm={gsm} mer={mer} aSuivreDetail={aSuivreDetail} telephoneProfil={telephoneProfil} />
          {replis}
        </div>
      )}
      {onglet === "campagnes" && (
        <OngletCampagnes
          page={page}
          r={r}
          gsm={gsm}
          allumeeParAutre={allumeeParAutre}
          maintenant={maintenant}
          membres={membres}
          moiId={moiId}
          refusLancement={mer.refusLancement}
          replis={replis}
        />
      )}
      {onglet === "suivi" && <OngletSuivi page={page} r={r} maintenant={maintenant} enDirect={aSuivreDetail} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// 1. Numéro & test
// ---------------------------------------------------------------------------

function OngletNumeroTest({
  page,
  r,
  gsm,
  mer,
  aSuivreDetail,
  telephoneProfil,
}: {
  page: PageAppels;
  r: ReglagesAppels;
  gsm: string | null;
  mer: ReturnType<typeof miseEnRoute>;
  aSuivreDetail: AppelDetail | null;
  telephoneProfil: string | null;
}) {
  const ligneGsm: LigneControleVue = {
    element: "gsm_test",
    genre: "numero",
    libelle: LIBELLE_ELEMENT.gsm_test,
    aide: AIDE.gsm_test,
    fait: gsm,
  };
  return (
    <div className="space-y-6">
      <section className="card p-4 sm:p-5">
        <TitreCarte icone="telephone">Numéro appelant</TitreCarte>
        <p className="mb-3 text-xs leading-relaxed text-slate-400">{AIDE.numero_appelant}</p>
        <ChoixNumero
          proposes={numerosProposes({ actuel: r.numero_appelant, profil: telephoneProfil, gsm: r.gsm_test })}
          actuel={r.numero_appelant}
        />
        <ul className="mt-5 border-t border-white/[0.06] pt-4">
          <LigneControle l={ligneGsm} />
        </ul>
      </section>

      <section className="card p-4 sm:p-5">
        <TitreCarte icone="telephone">Appel de test</TitreCarte>
        <AppelTest gsm={gsm} bloque={mer.bloque} suivi={aSuivreDetail} reussi={page.testReussi} />
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
  maintenant,
  membres,
  moiId,
  refusLancement,
  replis,
}: {
  page: PageAppels;
  r: ReglagesAppels;
  gsm: string | null;
  allumeeParAutre: string | null;
  maintenant: Date;
  membres: { id: string; nom: string }[];
  moiId: string;
  /** Pourquoi « Lancer » est bloqué (numéro, connexion, test réussi), ou null. */
  refusLancement: string | null;
  replis: React.ReactNode;
}) {
  const debut = heureFr(enMinutes(r.fenetre_debut.slice(0, 5)));
  const fin = heureFr(enMinutes(r.fenetre_fin.slice(0, 5)));
  const bandeau = phraseBandeau({
    reglages: r,
    maintenant,
    compteur: page.etat.compteur,
    enCours: page.etat.enCours,
    fileComposable: page.fileParMode.composable,
    fileAutreMode: page.fileParMode.autreMode,
    fileEnPause: page.fileParMode.enPause,
  });
  return (
    <div className="space-y-6">
      <EtatMoteur
        bandeau={bandeau}
        pause={
          r.pause_cause
            ? { cause: r.pause_cause, depuis: r.pause_at ? jourHeureFr(new Date(r.pause_at)) : null }
            : null
        }
        testReussi={page.testReussi}
        actif={r.actif}
        modeTest={r.mode_test}
        gsm={gsm}
        plafondJour={r.plafond_jour}
        jour={page.etat.jour}
        fileTotal={page.etat.file.total}
      />

      <Campagnes
        campagnes={page.campagnes.map((c) => ({
          id: c.id,
          nom: c.nom,
          statut: c.statut,
          systeme: c.systeme,
          creeLe: fmtDate(c.created_at),
          progression: c.progression,
        }))}
        assistant={{
          refusLancement,
          membres,
          moiId,
          testReussi: page.testReussi,
          reglages: {
            fenetre: `${debut}–${fin}`,
            fenetre_debut: r.fenetre_debut,
            fenetre_fin: r.fenetre_fin,
            plafond_heure: r.plafond_heure,
            plafond_jour: r.plafond_jour,
            mode_test: r.mode_test,
            inscription_auto: r.inscription_auto,
            gsm,
          },
          confirmationTest: phraseConfirmationLancement({ ...r, mode_test: true }, maintenant),
          confirmationReel: phraseConfirmationLancement({ ...r, mode_test: false }, maintenant),
        }}
      />

      {r.inscription_auto && (
        <section className="card min-w-0 p-4 sm:p-5">
          <TitreCarte icone="taches">Inscription automatique</TitreCarte>
          <Inscription
            valeur={r.inscription_auto}
            allumeeParAutre={allumeeParAutre}
            rattrapage={page.rattrapage}
            modeTest={r.mode_test}
          />
        </section>
      )}

      {replis}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Suivi
// ---------------------------------------------------------------------------

function OngletSuivi({
  page,
  r,
  maintenant,
  enDirect,
}: {
  page: PageAppels;
  r: ReglagesAppels;
  maintenant: Date;
  enDirect: AppelDetail | null;
}) {
  return (
    <div className="space-y-6">
      <EnDirect
        appel={enDirect}
        enCours={page.etat.enCours !== null}
        sonder={r.actif && !r.pause_cause && page.etat.file.total > 0}
      />
      <FileAppels lignes={page.file} total={page.etat.file.total} maintenant={maintenant} />
      <DerniersAppels appels={page.appels} maintenant={maintenant} />
      <Opposition numeros={page.opposition} maintenant={maintenant} />
    </div>
  );
}
