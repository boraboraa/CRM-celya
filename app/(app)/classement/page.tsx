import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { EmptyState, PageHeader } from "@/components/ui";
import { lireClassement, periodesClassement } from "@/lib/crm/lectureObjectifs";
import { DEBUT_SALES_TROPHY } from "@/lib/crm/compteurs";
import { TableauClassement } from "@/components/TableauClassement";


const fmtJour = (ymd: string) => {
  const [a, m, j] = ymd.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j)).toLocaleDateString("fr-BE", { day: "numeric", month: "long", timeZone: "UTC" });
};

/**
 * Le CLASSEMENT de l'équipe (27/10) — visible par TOUS les comptes actifs, en
 * CHIFFRES seulement : par personne, appels · réponses · intéressés · RDV ·
 * essais · numéros ajoutés, sur « cette semaine » et « depuis le 2 novembre ».
 * Aucune fiche, aucun nom de prospect : la cloison entre étudiants tient —
 * la base ne rend que des compteurs (`classement_equipe`, 031).
 *
 * Y figurent les commerciaux actifs qui ont un objectif posé (décision de
 * Bora) ; ni l'admin, ni un compte inactif. Ordre : essais, RDV, réponses,
 * appels — le « win » d'abord.
 */
export default async function ClassementPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const session = await getSession();
  if (!session?.me?.is_active) redirect("/acces-refuse");
  const { periode } = await searchParams;
  const choix = periode === "trophy" ? "trophy" : "semaine";
  const bornes = periodesClassement();
  const supabase = await createClient();
  const { disponible, lignes } = await lireClassement(supabase, bornes[choix].debut, bornes[choix].fin);

  const onglets = [
    ["semaine", "Cette semaine"],
    ["trophy", `Depuis le ${fmtJour(DEBUT_SALES_TROPHY)}`],
  ] as const;

  return (
    <>
      <PageHeader
        title="Classement"
        subtitle={
          choix === "semaine"
            ? `Semaine du ${fmtJour(bornes.semaine.debut)} — des chiffres, jamais une fiche.`
            : "Depuis le début du Sales Trophy — des chiffres, jamais une fiche."
        }
        compactMobile
      />

      <nav aria-label="Période" className="mb-4 flex rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/10 sm:inline-flex">
        {onglets.map(([v, label]) => (
          <Link
            key={v}
            href={v === "semaine" ? "/classement" : "/classement?periode=trophy"}
            aria-current={choix === v ? "page" : undefined}
            className={`flex min-h-[44px] flex-1 items-center justify-center rounded-lg px-4 text-sm transition ${
              choix === v ? "bg-white/[0.09] text-slate-50 ring-1 ring-white/15" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {!disponible ? (
        <EmptyState
          title="Le classement n'est pas encore en place"
          hint="Il demande la migration 031, pas encore appliquée."
        />
      ) : lignes.length === 0 ? (
        <EmptyState
          title="Personne au classement pour l'instant"
          hint="Y figurent les commerciaux qui ont un objectif — l'administrateur les pose depuis « Équipe »."
        />
      ) : (
        <TableauClassement lignes={lignes} moiId={session.userId} />
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Appels : chaque résultat d&apos;appel noté (un débrief de rendez-vous n&apos;en est pas un). Réponses :
        « à rappeler », « intéressé » ou « pas intéressé » — on a eu le décideur ; un barrage reste un appel.
        Essais : fiches passées en « Essai gratuit ».
      </p>
    </>
  );
}
