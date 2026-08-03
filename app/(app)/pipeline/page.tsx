import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { PipelineBoard, type BoardProspect } from "@/components/PipelineBoard";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("prospects")
    .select("id, company_name, contact_name, status, value_estimate, next_action_at")
    .order("updated_at", { ascending: false })
    .limit(500);

  const prospects = (data ?? []) as BoardProspect[];

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle="Vue d'ensemble par étape."
        action={
          <div className="flex gap-2">
            <Link href="/prospects/import" className="btn-ghost">
              Importer
            </Link>
            <Link href="/prospects/nouveau" className="btn-primary">
              + Nouveau prospect
            </Link>
          </div>
        }
      />

      {prospects.length === 0 ? (
        <EmptyState
          title="Le pipeline est vide"
          hint="Ajoutez vos premiers prospects, ou importez une liste depuis un fichier CSV."
          href="/prospects/nouveau"
          cta="Créer un prospect"
        />
      ) : (
        <PipelineBoard prospects={prospects} />
      )}
    </>
  );
}
