// Constantes de navigation partagées entre le layout serveur et le composant
// client Nav. Module volontairement sans directive "use client" : importer une
// constante depuis un module client dans un composant serveur la remplace par
// une référence client inutilisable (NAV_ITEMS is not iterable).
import type { IconeNom } from "@/components/ui";

export type NavItem = { href: string; label: string; icon: IconeNom };

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "À faire", icon: "taches" },
  { href: "/agenda", label: "Agenda", icon: "agenda" },
  { href: "/prospects", label: "Prospects", icon: "dossier" },
];

export const ADMIN_ITEM: NavItem = { href: "/equipe", label: "Équipe", icon: "equipe" };
/** Les appels de Janet — admin seul, comme « Équipe » (la page le revérifie). */
export const APPELS_IA_ITEM: NavItem = { href: "/appels-ia", label: "Appels IA", icon: "telephone" };
export const ACCOUNT_ITEM: NavItem = { href: "/compte", label: "Compte", icon: "reglages" };
/** Le classement d'équipe (031) — visible par tous les comptes actifs. */
export const CLASSEMENT_ITEM: NavItem = { href: "/classement", label: "Classement", icon: "trophee" };

const parHrefDans = (liste: NavItem[], href: string): NavItem => {
  const item = liste.find((i) => i.href === href);
  if (!item) throw new Error(`Onglet inconnu : ${href}`);
  return item;
};

/**
 * La barre latérale (ordinateur). L'admin voit l'ÉQUIPE avant l'agenda (Bora,
 * 27/10) : À faire · Prospects · Classement · Équipe · Agenda · Appels IA.
 * Un commercial garde son ordre de terrain, et gagne le classement en fin.
 */
export function navOrdinateur(role: string): NavItem[] {
  if (role !== "admin") return [...NAV_ITEMS, CLASSEMENT_ITEM];
  return [
    parHrefDans(NAV_ITEMS, "/dashboard"),
    parHrefDans(NAV_ITEMS, "/prospects"),
    CLASSEMENT_ITEM,
    ADMIN_ITEM,
    parHrefDans(NAV_ITEMS, "/agenda"),
    APPELS_IA_ITEM,
  ];
}

/**
 * Un onglet de la barre du bas (téléphone) : un écran, le « ＋ » de l'ajout
 * rapide, ou « Plus » — la feuille des écrans qui ne sont pas de terrain.
 */
export type OngletMobile =
  | { type: "lien"; item: NavItem }
  | { type: "ajout" }
  | { type: "plus"; items: NavItem[] };

const parHref = (href: string): NavItem => parHrefDans(NAV_ITEMS, href);

/**
 * La barre du bas — tirée des MÊMES entrées que la barre latérale, jamais
 * d'une seconde liste. Commercial : À faire · Prospects · ＋ · Agenda (quatre,
 * pas un de plus : le pouce n'en atteint pas davantage). L'admin y gagne
 * « Plus » (Équipe, Appels IA, Compte) : ce ne sont pas des écrans de
 * terrain, ils restent à un tap sans prendre la place d'un onglet.
 *
 * Le compte d'un commercial passe par l'avatar de l'en-tête ; son classement,
 * par la carte d'objectifs de « À faire ».
 *
 * L'admin (27/10) : « Classement » prend la place d'« Agenda », qui passe
 * dans « Plus » avec Équipe, Appels IA et Compte.
 */
export function ongletsMobiles(role: string): OngletMobile[] {
  const debut: OngletMobile[] = [
    { type: "lien", item: parHref("/dashboard") },
    { type: "lien", item: parHref("/prospects") },
    { type: "ajout" },
  ];
  if (role !== "admin") return [...debut, { type: "lien", item: parHref("/agenda") }];
  const plus = navOrdinateur(role).filter((i) => !debut.some((o) => o.type === "lien" && o.item === i) && i !== CLASSEMENT_ITEM);
  return [...debut, { type: "lien", item: CLASSEMENT_ITEM }, { type: "plus", items: [...plus, ACCOUNT_ITEM] }];
}

/** L'onglet est-il celui de la page courante ? (`/prospects/123` → Prospects) */
export function ongletActif(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
