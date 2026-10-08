import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { lirePageAppels } from "@/lib/appelsIa/lectures";
import { numeroLisible } from "@/lib/appelsIa/numeros";
import { jourHeureFr } from "@/lib/appelsIa/calendrier";
import { fmtDate } from "@/lib/constants";
import { PageHeader, Icone } from "@/components/ui";
import { EtatMoteur } from "@/components/appelsIa/ecran/EtatMoteur";
import { AppelTest } from "@/components/appelsIa/ecran/AppelTest";
import { Inscription } from "@/components/appelsIa/ecran/Inscription";
import { Reglages } from "@/components/appelsIa/ecran/Reglages";
import { Secrets, type SecretVue } from "@/components/appelsIa/ecran/Secrets";
import { Campagnes } from "@/components/appelsIa/ecran/Campagnes";
import { FileAppels } from "@/components/appelsIa/ecran/File";
import { DerniersAppels } from "@/components/appelsIa/ecran/DerniersAppels";
import { Scripts } from "@/components/appelsIa/ecran/Scripts";
import { Opposition } from "@/components/appelsIa/ecran/Opposition";
import { Repliable, TitreCarte } from "@/components/appelsIa/ecran/commun";
import { phraseEtat } from "@/components/appelsIa/ecran/format";

/**
 * Appels IA — l'écran de Janet. ADMIN SEUL : un non-admin est renvoyé vers le
 * tableau de bord, et chaque action le revérifie côté serveur (masquer un
 * lien n'a jamais interdit d'appeler une route). Tout se lit sous la session
 * de l'admin : la RLS (`is_admin()`) borne aussi.
 *
 * Une seule lecture, `lirePageAppels` — réglages, état du moteur, secrets
 * posés (jamais leur valeur), scripts, campagnes, file, 50 derniers appels,
 * opposition, et le nombre du rattrapage. Tolérante à l'absence de la
 * migration 025 : `disponible: false`, et l'écran le dit en une phrase.
 *
 * Les dates et « maintenant » sont calculés ICI et passés en chaînes : aucun
 * composant client ne les recalcule à l'hydratation.
 */

const SECRETS: Omit<SecretVue, "poseLe">[] = [
  {
    nom: "openai_api_key",
    libelle: "Clé OpenAI",
    aide: "La voix et la conversation de Janet (GPT-Live), et la préparation des briefs.",
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

export default async function AppelsIaPage() {
  const session = await requireMember();
  if (session.me.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const page = await lirePageAppels(supabase);

  if (!page.disponible || !page.etat.reglages) {
    return (
      <>
        <PageHeader title="Appels IA" subtitle="Janet appelle vos fiches « À appeler »." />
        <div className="card max-w-2xl p-5 sm:p-6">
          <p className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-200">
            <Icone nom="attente" className="mt-1 h-4 w-4 text-slate-400" />
            <span>
              La migration 025 n&apos;est pas encore appliquée : les appels de Janet ne sont pas
              disponibles. L&apos;écran s&apos;ouvrira de lui-même dès qu&apos;elle le sera — rien à faire
              d&apos;ici là.
            </span>
          </p>
        </div>
      </>
    );
  }

  const maintenant = new Date();
  const r = page.etat.reglages;
  const gsm = r.gsm_test ? numeroLisible(r.gsm_test) : null;

  // L'inscription automatique allumée par un AUTRE admin inscrit SES fiches :
  // l'écran le dit, avec son nom. Une lecture de plus, dans ce cas seulement.
  let allumeeParAutre: string | null = null;
  if (r.inscription_auto && r.inscription_auto_par && r.inscription_auto_par !== session.userId) {
    const { data } = await supabase
      .from("crm_users")
      .select("full_name, email")
      .eq("id", r.inscription_auto_par)
      .maybeSingle();
    const u = data as { full_name: string | null; email: string } | null;
    allumeeParAutre = u?.full_name ?? u?.email ?? "un autre administrateur";
  }

  // Les secrets : posé (et quand) ou pas — jamais la valeur, qu'on n'a pas.
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
  // moteur (lib/appelsIa/regles.ts, `test: true`), dites avant le clic.
  const testBloque = page.etat.enCours
    ? "Un appel est déjà en cours : attendez qu'il se termine."
    : !r.numero_appelant
      ? "Le numéro appelant n'est pas réglé : le moteur refuse de composer."
      : !r.gsm_test
        ? "Le GSM de test n'est pas réglé (section Réglages)."
        : null;

  const debut = r.fenetre_debut.slice(0, 5).replace(":", "h");
  const fin = r.fenetre_fin.slice(0, 5).replace(":", "h");

  return (
    <>
      <PageHeader
        title="Appels IA"
        subtitle="Janet appelle vos fiches « À appeler » : son état, ses réglages, sa file et ses derniers appels."
      />

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
              Écriture seule : la valeur part dans le coffre-fort de Supabase (Vault) et ne
              s&apos;affiche plus jamais, ici ni ailleurs. Pour en changer, posez-en une nouvelle.
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
    </>
  );
}
