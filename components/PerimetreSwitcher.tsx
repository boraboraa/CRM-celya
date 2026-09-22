import Link from "next/link";
import type { Perimetre } from "@/lib/crm/perimetre";

/**
 * Le sélecteur de périmètre — « Moi », les autres, « Toute l'équipe ».
 *
 * Rendu pour un ADMIN, depuis la migration 020 pour un PORTEUR de
 * l'interrupteur « travaille en équipe », et depuis la 021 pour un ENCADRANT.
 * Un commercial qui n'est rien de tout cela n'en voit toujours rien : il ne
 * voit que son portefeuille (la RLS l'y contraint de toute façon) et un
 * sélecteur qui ne change rien serait un mensonge.
 *
 * Le droit d'élargir arrive en PROP, calculé par `peutElargir` (perimetre.ts) :
 * le composant ne rejoue pas la règle. Il la rejouait avant la 021 — un
 * `role !== "admin" && !voitEquipe` recopié ici — et c'est exactement le genre
 * de copie qu'on oublie de mettre à jour quand une troisième branche arrive.
 *
 * ⚠ `membres` doit arriver DÉJÀ FILTRÉ pour un porteur : la policy
 * `crm_users_select` laisse tout membre lire TOUTE la table d'équipe, donc la
 * requête des pages remonte aussi Bora et Rémi. Les lister ici dirait à Collins
 * qui existe, et un clic lui rendrait un écran vide sans explication. C'est
 * l'appelant qui borne (voir les trois pages), et `lirePerimetre` refuse de
 * toute façon un uuid hors partage.
 *
 * Navigation par lien : `?perimetre=` est réécrit en CONSERVANT les autres
 * paramètres de la page (q, statut, tri, vue, filtre…) — même mécanique que le
 * `makeHref` de /prospects.
 *
 * Composant serveur, sans état : le périmètre EST l'URL.
 */
export function PerimetreSwitcher({
  role,
  viewerId,
  perimetre,
  membres,
  basePath,
  searchParams = {},
  peutElargir = false,
}: {
  role: string;
  viewerId: string;
  perimetre: Perimetre;
  /** Membres à proposer (soi inclus, couvert par « Moi »). Déjà borné au partage. */
  membres: { id: string; full_name: string | null; email: string }[];
  /** Chemin de la page qui porte le sélecteur (« /dashboard », « /prospects »…). */
  basePath: string;
  /** Les paramètres actuels de l'URL, conservés tels quels. */
  searchParams?: Record<string, string | string[] | undefined>;
  /**
   * A le droit de sortir de « moi » — porteur de l'interrupteur d'équipe, ou
   * encadrant. Calculé par `peutElargir` (lib/crm/perimetre.ts), jamais ici.
   */
  peutElargir?: boolean;
}) {
  if (role !== "admin" && !peutElargir) return null;

  const href = (valeur: "moi" | "equipe" | string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === "perimetre" || v === undefined) continue;
      params.set(k, Array.isArray(v) ? v[0] : v);
    }
    // « moi » est le défaut : pas de paramètre, l'URL reste propre.
    if (valeur !== "moi") params.set("perimetre", valeur);
    const qs = params.toString();
    return `${basePath}${qs ? `?${qs}` : ""}`;
  };

  const autres = membres.filter((m) => m.id !== viewerId);
  // Personne d'autre à proposer — un porteur seul à avoir coché la case, ou un
  // encadrant dont tous les encadrés ont été désactivés : « Moi » et « Toute
  // l'équipe » rendraient le même écran. Deux boutons pour un seul résultat,
  // c'est le sélecteur mensonger qu'on refuse à un simple commercial.
  if (role !== "admin" && autres.length === 0) return null;

  const options: { cle: string; label: string; actif: boolean }[] = [
    {
      cle: "moi",
      label: "Moi",
      actif:
        perimetre.mode === "moi" ||
        (perimetre.mode === "membre" && perimetre.id === viewerId),
    },
    ...autres.map((m) => ({
      cle: m.id,
      label: m.full_name?.split(" ")[0] ?? m.email,
      actif: perimetre.mode === "membre" && perimetre.id === m.id,
    })),
    { cle: "equipe", label: "Toute l'équipe", actif: perimetre.mode === "equipe" },
  ];

  return (
    <div className="flex rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/10">
      {options.map((o) => (
        <Link
          key={o.cle}
          href={href(o.cle)}
          aria-current={o.actif ? "true" : undefined}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
            o.actif
              ? "bg-white/[0.09] text-slate-100 ring-1 ring-white/15"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
