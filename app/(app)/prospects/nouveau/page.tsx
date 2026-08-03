import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ProspectForm } from "@/components/ProspectForm";
import { createProspectAction } from "@/app/actions";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewProspectPage() {
  const supabase = await createClient();
  const session = await getSession();

  const { data } = await supabase
    .from("crm_users")
    .select("id, full_name, email")
    .eq("is_active", true)
    .order("full_name");

  const members = (data ?? []) as Pick<Profile, "id" | "full_name" | "email">[];

  return (
    <>
      <PageHeader
        title="Nouveau prospect"
        subtitle="Créez la fiche, puis notez chaque appel et planifiez le rappel."
        action={
          <Link href="/prospects" className="btn-ghost">
            Annuler
          </Link>
        }
      />

      <div className="card max-w-3xl p-6">
        <ProspectForm
          members={members}
          action={createProspectAction}
          submitLabel="Créer la fiche"
          currentUserId={session?.userId}
        />
      </div>
    </>
  );
}
