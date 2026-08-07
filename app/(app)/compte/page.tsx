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

        {me.role === "admin" && (
          <section className="card p-6">
            <h2 className="mb-1 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              Boîte email
            </h2>
            <p className="mb-4 text-xs leading-relaxed text-slate-500">
              Connexion de la boîte Zoho (envoi et relève des réponses) et
              rattachement des messages orphelins.
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
        )}
      </div>
    </>
  );
}
