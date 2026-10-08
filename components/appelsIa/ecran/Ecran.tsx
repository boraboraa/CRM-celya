/**
 * L'écran Appels IA, une fois les données lues — composant SERVEUR.
 *
 * La page (app/(app)/appels-ia/page.tsx) vérifie le rôle et lit la base ;
 * ici, on ne fait que mettre en forme. Les dates et « maintenant » sont
 * calculés ICI et passés en chaînes : aucun composant client ne les recalcule
 * à l'hydratation. Aux composants clients ne passent que des données — jamais
 * une fonction (npm run test:frontiere).
 *
 * L'ordre, de haut en bas : l'état du moteur (et ses deux interrupteurs),
 * l'appel de test et l'inscription, les réglages, les secrets et les
 * campagnes ; puis, repliables, la file, les derniers appels, les scripts et
 * la liste d'opposition.
 */

import type { PageAppels } from "@/lib/appelsIa/lectures";
import type { ReglagesAppels } from "@/lib/appelsIa/acces";
import { numeroLisible } from "@/lib/appelsIa/numeros";
import { enMinutes, heureFr, jourHeureFr } from "@/lib/appelsIa/calendrier";
import { fmtDate } from "@/lib/constants";
import { EtatMoteur } from "./EtatMoteur";
import { AppelTest } from "./AppelTest";
import { Inscription } from "./Inscription";
import { Reglages } from "./Reglages";
import { Secrets, type SecretVue } from "./Secrets";
import { Campagnes } from "./Campagnes";
import { FileAppels } from "./File";
import { DerniersAppels } from "./DerniersAppels";
import { Scripts } from "./Scripts";
import { Opposition } from "./Opposition";
import { Repliable, TitreCarte } from "./commun";
import { phraseEtat } from "./format";

const SECRETS: Omit<SecretVue, "poseLe">[] = [
  {
    nom: "openai_api_key",
    libelle: "Clé OpenAI",
    aide: "La voix et la conversation de Janet (GPT-Live) : l'annexe la lit au moment de composer.",
  },
  {
    nom: "sip_identifiant",
    libelle: "Identifiant SIP",
    aide: "L'identifiant de connexion du trunk SIP Telnyx.",
  },
  {
    nom: "sip_mot_de_passe",
    libelle: "Mot de passe SIP",
    aide: "Le mot de passe du même trunk.",
  },
];

const A_POSER: Record<SecretVue["nom"], string> = {
  openai_api_key: "Clé OpenAI à poser",
  sip_identifiant: "Identifiant SIP à poser",
  sip_mot_de_passe: "Mot de passe SIP à poser",
};

export function EcranAppels({
  page,
  reglages: r,
  allumeeParAutre,
  maintenant,
}: {
  page: PageAppels;
  /** Les réglages, lus (la page ne rend l'écran que s'ils existent). */
  reglages: ReglagesAppels;
  /** Le nom de l'admin qui a allumé l'inscription automatique, si ce n'est pas l'appelant. */
  allumeeParAutre: string | null;
  maintenant: Date;
}) {
  const gsm = r.gsm_test ? numeroLisible(r.gsm_test) : null;

  // Les secrets : posé (et quand) ou pas — jamais la valeur, que l'écran n'a pas.
  const poses = new Map(page.secrets.map((s) => [s.nom, s.pose_le]));
  const secrets: SecretVue[] = SECRETS.map((s) => {
    const le = poses.get(s.nom);
    return { ...s, poseLe: poses.has(s.nom) ? (le ? `posé le ${fmtDate(le)}` : "posé") : null };
  });

  // Ce qui manque avant le premier appel.
  const aRegler = [
    ...(r.numero_appelant ? [] : ["Numéro appelant à régler"]),
    ...(r.gsm_test ? [] : ["GSM de test à régler"]),
    ...secrets.filter((s) => !s.poseLe).map((s) => A_POSER[s.nom]),
  ];

  // Pourquoi le bouton de test ne peut pas partir — les mêmes gardes que le
  // moteur (lib/appelsIa/regles.ts, `test: true`), dites AVANT le clic.
  const testBloque = page.etat.enCours
    ? "Un appel est déjà en cours : attendez qu'il se termine."
    : !r.numero_appelant
      ? "Le numéro appelant n'est pas réglé : le moteur refuse de composer."
      : !r.gsm_test
        ? "Le GSM de test n'est pas réglé (section Réglages)."
        : null;

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
        aRegler={aRegler}
        actif={r.actif}
        modeTest={r.mode_test}
        gsm={gsm}
        plafondJour={r.plafond_jour}
        jour={page.etat.jour}
        fileTotal={page.etat.file.total}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card min-w-0 p-4 sm:p-5">
          <TitreCarte icone="telephone">Appel de test</TitreCarte>
          <AppelTest gsm={gsm} bloque={testBloque} />
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

      {/* Replié une fois réglé : le résumé suffit au quotidien. Ouvert tant
          qu'un numéro manque — c'est là que le moteur bloque. */}
      <Repliable
        titre="Réglages"
        compte={`${debut}–${fin} · ${r.plafond_heure}/h · ${r.plafond_jour}/jour`}
        icone="reglages"
        ouvert={!r.numero_appelant || !r.gsm_test}
      >
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

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card min-w-0 p-4 sm:p-5">
          <TitreCarte icone="cadenas">Secrets</TitreCarte>
          <p className="mb-4 text-xs leading-relaxed text-slate-400">
            Écriture seule : la valeur part dans le coffre-fort de Supabase (Vault) et ne s&apos;affiche
            plus jamais, ici ni ailleurs. Pour en changer, posez-en une nouvelle.
          </p>
          <Secrets secrets={secrets} />
        </section>
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
      </div>

      <FileAppels lignes={page.file} total={page.etat.file.total} maintenant={maintenant} />
      <DerniersAppels appels={page.appels} maintenant={maintenant} />
      <Scripts scripts={page.scripts} maintenant={maintenant} />
      <Opposition numeros={page.opposition} maintenant={maintenant} />
    </div>
  );
}
