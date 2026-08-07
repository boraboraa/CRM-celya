import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { NewProspectAssist } from "@/components/NewProspectAssist";
import type { Profile } from "@/lib/types";


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
        subtitle="Collez ce que vous avez trouvé — la fiche se pré-remplit, vous validez."
        action={
          <Link href="/prospects" className="btn-ghost">
            Annuler
          </Link>
        }
      />

      <NewProspectAssist members={members} currentUserId={session?.userId} />
    </>
  );
}
