import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Logo } from "@/components/Logo";


// Page affichée quand la connexion Supabase réussit mais que le compte n'a
// pas d'accès actif au CRM (fiche crm_users absente ou désactivée). Le
// message reste volontairement neutre : il ne dit pas si le compte est
// inconnu, en attente ou désactivé.
export default async function AccesRefusePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.me?.is_active) redirect("/dashboard");

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="card max-w-md p-8 text-center">
        <Logo className="mb-6 justify-center" />
        <h1 className="font-display text-lg font-semibold text-slate-50">
          Ce compte n&apos;a pas accès au CRM
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Vous êtes bien connecté en tant que{" "}
          <span className="text-slate-200">{session.email}</span>, mais aucun
          accès au CRM n&apos;est associé à ce compte. Si vous pensez qu&apos;il
          s&apos;agit d&apos;une erreur, contactez votre administrateur.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button className="btn-ghost w-full">Se déconnecter</button>
        </form>
      </div>
    </main>
  );
}
