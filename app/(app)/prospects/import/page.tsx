import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ImportWizard } from "@/components/ImportWizard";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = await getSession();
  if (!session?.me?.is_active) redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_users")
    .select("id, full_name, email")
    .eq("is_active", true)
    .order("full_name");

  const members = (data ?? []) as Pick<Profile, "id" | "full_name" | "email">[];

  return (
    <>
      <PageHeader
        title="Importer des prospects"
        subtitle="Chargez une liste d'entreprises depuis un fichier CSV."
        action={
          <Link href="/prospects" className="btn-ghost">
            Annuler
          </Link>
        }
      />

      <ImportWizard members={members} currentUserId={session.userId} />
    </>
  );
}
