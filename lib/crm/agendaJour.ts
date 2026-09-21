/**
 * La ligne « Aujourd'hui » du tableau de bord — l'agenda en clientèle.
 *
 * Module NEUTRE (ni serveur ni client) et PUR : il ne fait que dériver, d'un
 * rendez-vous et des fiches déjà chargées, ce que la ligne affiche. Le JSX se
 * contente ensuite de poser les champs.
 *
 * Pourquoi extraire ça plutôt que de le laisser en ligne dans la page : ce bloc
 * est le seul que traverse un compte AYANT des rendez-vous, et il s'est
 * longtemps nourri d'un seul rendez-vous de test — toujours rattaché à une
 * fiche, toujours avec un lieu. Le 21/09/2026 il a rencontré son premier
 * rendez-vous PERSO, sans prospect et sans lieu (« Rdv Ephec ») ; il l'a
 * d'ailleurs bien encaissé, mais personne ne pouvait le savoir avant de
 * regarder. Une branche qu'aucun test ne parcourt n'est pas une branche sûre,
 * c'est une branche dont on ignore l'état.
 *
 * Trois règles portées ici :
 *
 *   · un rendez-vous PERSO n'a pas de fiche — ni lien, ni contact, ni
 *     téléphone. `meetings_visibles` masque déjà ceux des AUTRES (« Occupé »,
 *     sans lieu ni notes) ; celui-ci est le nôtre, il s'affiche en entier, il
 *     n'a simplement rien à rattacher ;
 *   · le lieu se présente en BOUTON Maps, jamais en texte à recopier — et rien
 *     du tout quand il est absent ; `ville` ne sert qu'à désambiguïser une
 *     adresse sans code postal, jamais `country` (voir lib/crm/maps.ts) ;
 *   · l'heure est celle de BRUXELLES, la base stockant en UTC.
 */

/** Une ligne de `meetings_visibles`, réduite à ce que la zone affiche. */
export type RendezVousDuJour = {
  id: string;
  prospect_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
};

/** La fiche rattachée, telle que la requête groupée la charge. */
export type FicheDuRendezVous = {
  id: string;
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  city: string | null;
};

/** Ce que la ligne affiche — que des valeurs, aucune décision laissée au JSX. */
export type LigneAgendaJour = {
  id: string;
  titre: string;
  /** « 12:45–14:45 », heure de Bruxelles. */
  creneau: string;
  /** La fiche à ouvrir, ou null : un rendez-vous perso n'en a pas. */
  lienFiche: string | null;
  contact: string | null;
  telephone: string | null;
  /** Le `href` du lien d'appel, espaces retirés — null s'il n'y a pas de numéro. */
  telHref: string | null;
  /** L'adresse à passer à BoutonsMaps, ou null : pas de bouton sans lieu. */
  lieu: string | null;
  /** La ville de la fiche, pour compléter une adresse sans code postal. */
  ville: string | null;
};

/** Heure de Bruxelles, « 11:00 ». */
export function heureBruxelles(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-BE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

export function ligneAgendaJour(
  m: RendezVousDuJour,
  fiches: ReadonlyMap<string, FicheDuRendezVous>
): LigneAgendaJour {
  // Un `prospect_id` qui ne retrouve pas sa fiche se comporte comme un
  // rendez-vous perso : la requête groupée peut très bien n'avoir rien rendu
  // (fiche supprimée, ligne hors portée). On n'invente pas un lien mort.
  const fiche = m.prospect_id ? (fiches.get(m.prospect_id) ?? null) : null;

  return {
    id: m.id,
    titre: m.title,
    creneau: `${heureBruxelles(m.starts_at)}–${heureBruxelles(m.ends_at)}`,
    lienFiche: fiche ? `/prospects/${fiche.id}` : null,
    contact: fiche?.contact_name || null,
    telephone: fiche?.phone || null,
    telHref: fiche?.phone ? `tel:${fiche.phone.replace(/\s/g, "")}` : null,
    lieu: m.location || null,
    ville: fiche?.city || null,
  };
}
