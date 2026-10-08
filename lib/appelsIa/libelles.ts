/**
 * Les libellés des appels de Janet — module NEUTRE (ni serveur ni client), pur.
 */

export const OUTCOME_LABEL_APPEL: Record<"sans_reponse" | "barrage" | "rappeler" | "interesse" | "refus", string> = {
  sans_reponse: "Pas de réponse",
  barrage: "Barrage",
  rappeler: "À rappeler",
  interesse: "Intéressé",
  refus: "Pas intéressé",
};

export const CLASSEMENT_LABEL: Record<string, string> = {
  repondu_humain: "Décroché",
  repondeur: "Répondeur",
  standard_ivr: "Standard automatique",
  sans_reponse: "Pas décroché",
  occupe_echec: "Occupé",
};

export const STATUT_APPEL_LABEL: Record<string, string> = {
  reserve: "Préparation",
  composition: "Composition",
  sonnerie: "Ça sonne",
  en_ligne: "En ligne",
  termine: "Terminé",
  echec: "Échec",
};

export const STATUT_FILE_LABEL: Record<string, string> = {
  en_attente: "En attente",
  en_cours: "En cours",
  termine: "Terminé",
  arrete: "Arrêté",
};

export const ORIGINE_LABEL: Record<string, string> = {
  auto: "inscription automatique",
  rattrapage: "rattrapage",
  manuel: "à la main",
  mcp: "Claude",
  fiche: "depuis la fiche",
};

/** La couleur du point d'un appel dans le fil (classes Tailwind ENTIÈRES — règle JIT). */
export const POINT_APPEL: Record<string, string> = {
  interesse: "bg-emerald-400",
  rappeler: "bg-cyan-400",
  barrage: "bg-amber-400",
  refus: "bg-rose-400",
  sans_reponse: "bg-slate-500",
  echec: "bg-slate-700 ring-1 ring-amber-400/60",
  en_cours: "bg-celya-blue animate-pulse",
};
