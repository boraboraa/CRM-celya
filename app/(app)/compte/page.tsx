import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ProfileForm, PasswordForm } from "@/components/AccountForms";

export const dynamic = "force-dynamic";

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
      </div>
    </>
  );
}
