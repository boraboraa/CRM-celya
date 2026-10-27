import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { MaListe } from "@/components/MaListe";

// Les server actions de la page héritent de cette limite : un collage lu par
// le modèle part en trois morceaux EN PARALLÈLE (lib/crm/maListeIA.ts), chacun
// borné à 30 s par le fournisseur. Une minute suffit, et tient dans tous les
// plans Vercel.
export const maxDuration = 60;

/**
 * « Ma liste » (27/10) — coller sa liste avant d'appeler, et Janet fait les
 * fiches. Ouvert à tout membre actif : chacun importe pour lui ; l'admin
 * choisit pour qui.
 */
export default async function MaListePage() {
  const session = await getSession();
  if (!session?.me?.is_active) redirect("/dashboard");
  const admin = session.me.role === "admin";

  let membres: [string, string][] = [];
  if (admin) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("crm_users")
      .select("id, full_name, email")
      .eq("is_active", true)
      .order("full_name");
    membres = ((data ?? []) as { id: string; full_name: string | null; email: string }[]).map((m) => [
      m.id,
      m.full_name ?? m.email,
    ]);
  }

  return (
    <>
      <PageHeader
        title="Ma liste"
        subtitle="Collez votre liste avant d'appeler — Janet fait les fiches, vous relisez, un clic pour importer."
        compactMobile
        action={
          <Link href="/prospects/import" className="btn-ghost">
            Importer un CSV
          </Link>
        }
      />
      <MaListe admin={admin} moi={session.userId} membres={membres} />
    </>
  );
}
