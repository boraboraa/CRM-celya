import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { lirePageAppels } from "@/lib/appelsIa/lectures";
import { PageHeader, Icone } from "@/components/ui";
import { EcranAppels } from "@/components/appelsIa/ecran/Ecran";

/**
 * Appels IA — l'écran de Janet : son état, l'appel de test vers le GSM de
 * l'admin, les réglages, les secrets, les scripts, les campagnes, la file, les
 * derniers appels et la liste d'opposition.
 *
 * ADMIN SEUL : un non-admin est renvoyé vers le tableau de bord, et chaque
 * action le revérifie côté serveur (masquer un lien n'a jamais interdit
 * d'appeler une route). Tout se lit sous la session de l'admin : la RLS
 * (`is_admin()`) borne aussi.
 *
 * Une seule lecture, `lirePageAppels`. Tolérante à l'absence de la migration
 * 025 : `disponible: false`, et l'écran le dit en une phrase, sans formulaire.
 */
export default async function AppelsIaPage() {
  const session = await requireMember();
  if (session.me.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const page = await lirePageAppels(supabase);
  const reglages = page.etat.reglages;

  if (!page.disponible || !reglages) {
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

  // L'inscription automatique allumée par un AUTRE admin inscrit SES fiches :
  // l'écran le dit, avec son nom. Une lecture de plus, dans ce cas seulement.
  let allumeeParAutre: string | null = null;
  if (reglages.inscription_auto && reglages.inscription_auto_par && reglages.inscription_auto_par !== session.userId) {
    const { data } = await supabase
      .from("crm_users")
      .select("full_name, email")
      .eq("id", reglages.inscription_auto_par)
      .maybeSingle();
    const u = data as { full_name: string | null; email: string } | null;
    allumeeParAutre = u?.full_name ?? u?.email ?? "un autre administrateur";
  }

  return (
    <>
      <PageHeader
        title="Appels IA"
        subtitle="Janet appelle vos fiches « À appeler » : son état, ses réglages, sa file et ses derniers appels."
      />
      <EcranAppels page={page} reglages={reglages} allumeeParAutre={allumeeParAutre} maintenant={new Date()} />
    </>
  );
}
