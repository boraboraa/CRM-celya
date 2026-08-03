// Constantes de navigation partagées entre le layout serveur et le composant
// client Nav. Module volontairement sans directive "use client" : importer une
// constante depuis un module client dans un composant serveur la remplace par
// une référence client inutilisable (NAV_ITEMS is not iterable).
export type NavItem = { href: string; label: string; icon: string };

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "À faire", icon: "◉" },
  { href: "/prospects", label: "Prospects", icon: "◇" },
];

export const ADMIN_ITEM: NavItem = { href: "/equipe", label: "Équipe", icon: "◍" };
export const ACCOUNT_ITEM: NavItem = { href: "/compte", label: "Mon compte", icon: "⚙" };
