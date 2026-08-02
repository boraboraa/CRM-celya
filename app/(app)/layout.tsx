import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { Avatar } from "@/components/ui";
import { NavLinks } from "@/components/Nav";
import { NAV_ITEMS, ADMIN_ITEM, ACCOUNT_ITEM } from "@/lib/nav";

function SignOutButton({ full = false }: { full?: boolean }) {
  return (
    <form action="/auth/signout" method="post" className={full ? "w-full" : ""}>
      <button className={`btn-ghost ${full ? "w-full" : "px-3 py-2 text-xs"}`}>
        Se déconnecter
      </button>
    </form>
  );
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { me, email } = session;

  if (!me || !me.is_active) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="card max-w-md p-8 text-center">
          <Logo className="mb-6 justify-center" />
          <h1 className="font-display text-lg font-semibold text-slate-50">
            Compte en attente d&apos;activation
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Votre compte <span className="text-slate-200">{email}</span> a bien été
            créé, mais un administrateur doit encore l&apos;activer avant que vous
            puissiez accéder aux données.
          </p>
          <div className="mt-6">
            <SignOutButton full />
          </div>
        </div>
      </main>
    );
  }

  const items = me.role === "admin" ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — desktop */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/[0.06] bg-space-800/40 px-4 py-6 lg:flex">
        <Link href="/dashboard" className="mb-8 px-2">
          <Logo />
        </Link>

        <NavLinks items={items} />

        <div className="mt-auto space-y-3 pt-6">
          <Link
            href="/compte"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/[0.05]"
          >
            <Avatar name={me.full_name ?? email} size="md" />
            <span className="min-w-0">
              <span className="block truncate text-sm text-slate-200">
                {me.full_name ?? email}
              </span>
              <span className="block text-[11px] text-slate-500">
                {me.role === "admin" ? "Administrateur" : "Commercial"}
              </span>
            </span>
          </Link>
          <SignOutButton full />
        </div>
      </aside>

      {/* Contenu */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barre mobile */}
        <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-space/85 px-4 py-3 backdrop-blur lg:hidden">
          <div className="mb-3 flex items-center justify-between">
            <Link href="/dashboard">
              <Logo />
            </Link>
            <SignOutButton />
          </div>
          <NavLinks items={[...items, ACCOUNT_ITEM]} orientation="horizontal" />
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
