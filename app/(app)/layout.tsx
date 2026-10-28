import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { Avatar, Icone } from "@/components/ui";
import { NavLinks } from "@/components/Nav";
import { BarreOnglets } from "@/components/BarreOnglets";
import { AjoutRapide } from "@/components/AjoutRapide";
import { BoutonRecherche, RechercheGlobale } from "@/components/RechercheGlobale";
import { MA_LISTE_ITEM, navOrdinateur, ongletsMobiles } from "@/lib/nav";
import { Suspense } from "react";
import { MemoirePerimetre } from "@/components/MemoirePerimetre";

function SignOutButton() {
  return (
    <form action="/auth/signout" method="post" className="w-full">
      <button className="btn-ghost w-full">Se déconnecter</button>
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

  if (!me || !me.is_active) redirect("/acces-refuse");

  const items = navOrdinateur(me.role);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — desktop */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/[0.06] bg-space-800/40 px-4 py-6 lg:flex">
        <Link href="/dashboard" className="mb-6 px-2">
          <Logo />
        </Link>

        {/* Ouvrir une fiche de n'importe où : ⌘K, « / », ou ce bouton. */}
        <div className="mb-6">
          <BoutonRecherche />
        </div>

        <NavLinks items={items} />

        {/* Un raccourci, pas un écran : on colle sa liste avant d'appeler. */}
        <Link
          href={MA_LISTE_ITEM.href}
          className="mt-3 flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-xs text-slate-400 ring-1 ring-white/[0.08] transition hover:bg-white/[0.05] hover:text-slate-100"
        >
          <Icone nom={MA_LISTE_ITEM.icon} className="h-3.5 w-3.5" />
          {MA_LISTE_ITEM.label}
        </Link>

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
          <SignOutButton />
        </div>
      </aside>

      {/* Contenu */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* En-tête mobile — compact (19/10) : le logo, la loupe et l'avatar
            qui mène au compte. La navigation est descendue sous le pouce
            (BarreOnglets) ; « Se déconnecter » ne prend plus la meilleure
            place de l'écran, il vit dans « Compte » (et « Plus » pour l'admin). */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-white/[0.06] bg-space/85 px-4 py-1.5 backdrop-blur lg:hidden">
          <Link href="/dashboard" className="py-1.5">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <BoutonRecherche compact />
            <Link
              href="/compte"
              aria-label="Mon compte"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl transition hover:bg-white/[0.06]"
            >
              <Avatar name={me.full_name ?? email} />
            </Link>
          </div>
        </header>

        {/* Sous `lg`, la marge du bas laisse la place à la barre d'onglets. */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:px-8 lg:py-9">
          {children}
        </main>
        <BarreOnglets onglets={ongletsMobiles(me.role)} />
        {/* L'ajout rapide, UNE fois : le « ＋ » et le raccourci d'application l'ouvrent. */}
        <AjoutRapide />
        {/* Le dernier périmètre choisi, mémorisé dans le navigateur (27/10). */}
        <Suspense fallback={null}>
          <MemoirePerimetre />
        </Suspense>
        {/* La fenêtre de recherche, UNE fois : les deux boutons l'ouvrent. */}
        <RechercheGlobale />
      </div>
    </div>
  );
}
