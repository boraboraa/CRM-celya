import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ProfileForm, PasswordForm } from "@/components/AccountForms";


export default async function AccountPage() {
  const session = await getSession();
  if (!session?.me) redirect("/login");

  const { me, email } = session;

  return (
    <>
      <PageHeader
        title="Mon compte"
        subtitle={`${email} · ${me.role === "admin" ? "Administrateur" : "Commercial"}`}
      />

      <div className="max-w-3xl space-y-6">
        <ProfileForm fullName={me.full_name ?? ""} phone={me.phone ?? ""} />
        <PasswordForm mustChange={me.must_change_password} />

        {/* Chacun connecte SA boîte : c'est de là que partent ses relances et
            que reviennent ses réponses. Réservé à l'admin, il aurait fallu
            qu'il manipule le mot de passe d'application de ses commerciaux. */}
        <section className="card p-6">
          <h2 className="mb-1 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
            Ma boîte email
          </h2>
          <p className="mb-4 text-xs leading-relaxed text-slate-500">
            Connectez votre boîte Zoho pour envoyer vos relances depuis votre
            propre adresse et voir les réponses revenir dans le CRM. Vos
            messages restent les vôtres&nbsp;: un collègue ne voit ni votre
            boîte, ni vos échanges.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/reglages-email" className="btn-ghost">
              Réglages de la boîte
            </Link>
            <Link href="/emails" className="btn-ghost">
              Emails non rattachés
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
