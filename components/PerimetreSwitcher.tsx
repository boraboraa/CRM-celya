import Link from "next/link";
import type { Perimetre } from "@/lib/crm/perimetre";
import { ChoixMembrePerimetre } from "@/components/ChoixMembrePerimetre";
import { PucePerimetre } from "@/components/PucePerimetre";

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
 * `makeHref` de /prospects. Depuis le 18/10, « moi » s'écrit lui aussi dans
 * l'URL : le dernier choix est mémorisé (cookie), et l'admin arrive sur
 * « Toute l'équipe » par défaut — l'absence de paramètre ne veut plus dire
 * « moi ».
 *
 * COMPACT (18/10) : « Moi » · « Toute l'équipe » en boutons, les personnes
 * dans un menu déroulant — neuf noms en ligne débordaient de l'écran.
 *
 * TÉLÉPHONE (sous `lg`, 19/10) : replié en UNE puce (« Toute l'équipe ▾ »)
 * qui ouvre la feuille du bas — les mêmes liens, calculés une fois par
 * `optionsPerimetre`. Sur /prospects, la puce cède la place à la feuille
 * « Filtres », qui reçoit les mêmes options (`puceMobile={false}`).
 *
 * Composant serveur, sans état : le périmètre EST l'URL.
 */
type PropsPerimetre = {
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
};

/** Un choix du sélecteur : un lien déjà construit (des chaînes seulement). */
export type OptionPerimetre = {
  href: string;
  label: string;
  actif: boolean;
  /** Une personne (le menu déroulant), plutôt que « Moi » / « Toute l'équipe ». */
  personne: boolean;
};

/**
 * Les choix du sélecteur, ou null quand il ne doit RIEN montrer — calculés à
 * un seul endroit pour la version ordinateur, la puce du téléphone et la
 * feuille « Filtres » de /prospects.
 */
export function optionsPerimetre({
  role,
  viewerId,
  perimetre,
  membres,
  basePath,
  searchParams = {},
  peutElargir = false,
}: PropsPerimetre): OptionPerimetre[] | null {
  if (role !== "admin" && !peutElargir) return null;

  const href = (valeur: "moi" | "equipe" | string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (k === "perimetre" || v === undefined) continue;
      params.set(k, Array.isArray(v) ? v[0] : v);
    }
    params.set("perimetre", valeur);
    const qs = params.toString();
    return `${basePath}${qs ? `?${qs}` : ""}`;
  };

  const autres = membres.filter((m) => m.id !== viewerId);
  // Personne d'autre à proposer — un porteur seul à avoir coché la case, ou un
  // encadrant dont tous les encadrés ont été désactivés : « Moi » et « Toute
  // l'équipe » rendraient le même écran. Deux boutons pour un seul résultat,
  // c'est le sélecteur mensonger qu'on refuse à un simple commercial.
  if (role !== "admin" && autres.length === 0) return null;

  return [
    {
      href: href("moi"),
      label: "Moi",
      actif:
        perimetre.mode === "moi" ||
        (perimetre.mode === "membre" && perimetre.id === viewerId),
      personne: false,
    },
    {
      href: href("equipe"),
      label: "Toute l'équipe",
      actif: perimetre.mode === "equipe",
      personne: false,
    },
    // Le nom complet dans le menu : deux « Collins » se distinguent ; le
    // prénom seul suffisait quand ils étaient trois.
    ...autres.map((m) => ({
      href: href(m.id),
      label: m.full_name?.trim() || m.email,
      actif: perimetre.mode === "membre" && perimetre.id === m.id,
      personne: true,
    })),
  ];
}

export function PerimetreSwitcher({
  puceMobile = true,
  ...props
}: PropsPerimetre & {
  /** Téléphone : la puce repliée (false sur /prospects, où la feuille « Filtres » la porte). */
  puceMobile?: boolean;
}) {
  const options = optionsPerimetre(props);
  if (!options) return null;
  const boutons = options.filter((o) => !o.personne);
  const personnes = options.filter((o) => o.personne);

  return (
    <>
      {puceMobile && (
        <div className="lg:hidden">
          <PucePerimetre options={options} />
        </div>
      )}
      <div className="hidden flex-wrap items-center gap-0.5 rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/10 lg:flex">
        {boutons.map((o) => (
          <Link
            key={o.href}
            href={o.href}
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
        {personnes.length > 0 && <ChoixMembrePerimetre options={personnes} />}
      </div>
    </>
  );
}
