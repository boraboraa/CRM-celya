export type UserRole = "admin" | "commercial";

/** Les huit étapes d'un prospect, du panier d'entrée au client signé.
 *  « À appeler » est une colonne (la liste des entreprises à démarcher),
 *  pas une mécanique : la relance est pilotée par la date, jamais par l'étape.
 *  « À rappeler » (migration 026) : le rendez-vous a eu lieu, il faut
 *  rappeler la personne — ne pas confondre avec « À appeler ».
 *  « Essai gratuit » (migration 030) : le client essaie, gratuitement — le
 *  « win » d'un étudiant. Manuelle, et pas une fin de parcours.
 *  « Suivi par email » (migration 032) : on a eu quelqu'un qui veut l'info
 *  par mail — on y entre par le FAIT (le résultat d'appel ou le débrief).
 *  « Proposition » est RETIRÉE (29/10, décision de Bora : une étape de trop,
 *  jamais servie) ; la valeur reste dans l'enum Postgres, refusée par la
 *  contrainte de la 040, et `normalizeStatus` la lit « À rappeler ». */
export type ProspectStatus =
  | "a_appeler"
  | "contacte"
  | "rendez_vous"
  | "a_rappeler"
  | "suivi_email"
  | "essai_gratuit"
  | "gagne"
  | "perdu";

/** Trois types d'échange : ce que Bora retient d'un appel s'écrit dans une
 *  note, comme le reste. */
export type ActivityType = "note" | "email" | "rendez_vous";

export type TaskStatus = "a_faire" | "fait" | "annule";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
  phone: string | null;
  created_at: string;
};

export type Prospect = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  sector: string | null;
  /**
   * Adresse libre OU lien Google Maps collé — un seul champ (migration 018),
   * lu par lib/crm/maps.ts, qui distingue les deux.
   */
  address: string | null;
  city: string | null;
  /** La région (034) : la commune à Bruxelles, la province ailleurs — lib/crm/regions.ts. */
  region: string | null;
  /**
   * NE JAMAIS s'en servir pour localiser une fiche : la colonne porte sa
   * valeur par défaut (« Belgique ») sur des fiches lyonnaises. C'est la ville
   * qui fait foi — voir lib/crm/maps.ts.
   */
  country: string | null;
  status: ProspectStatus;
  source: string | null;
  value_estimate: number | null;
  currency: string;
  owner_id: string | null;
  tags: string[];
  /** « Ce qu'on sait » — affiché en tête de fiche dès « À appeler » (27/10). */
  notes: string | null;
  /** Étoilée par son responsable (031) : en tête de la liste et de « À faire ». */
  starred_at?: string | null;
  /** Dernière entrée en « Essai gratuit » (031) — compte les essais. */
  essai_gratuit_at?: string | null;
  /**
   * La prochaine action, c'est le prochain rendez-vous de la fiche tant qu'il
   * n'est pas débriefé ; sinon, sa relance la plus proche — sauf relance posée
   * sciemment avant le RDV (« confirmer la veille »), qui passe devant.
   * Tenue EN BASE (recalc_next_action, migration 022), jamais écrite ici.
   */
  next_action_at: string | null;
  /** Ce que désigne next_action_at. Un RDV passé non débriefé reste « rendez_vous ». */
  next_action_kind: "rendez_vous" | "relance" | null;
  last_contact_at: string | null;
  lost_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Étape fixée à la main : l'auto-classification ne la réécrit jamais. */
  status_locked: boolean;
  status_locked_at: string | null;
  /** L'événement qui a justifié le dernier avancement automatique. */
  status_auto_reason: string | null;
  status_auto_at: string | null;
  /** Signal explicite d'une proposition envoyée (jamais deviné). */
  proposal_sent_at: string | null;
  /**
   * Probabilité de conclure, en % (0–100). Colonne conservée en base mais
   * plus saisie ni affichée depuis le passage à la confiance IA (011).
   */
  probability: number | null;
  /** Colonne générée : value_estimate × probability / 100. Conservée aussi. */
  weighted_value: number | null;
  /** Confiance estimée par l'IA. null = « à évaluer » — jamais un faux niveau. */
  confidence_level: ConfidenceLevel | null;
  /** La raison courte du niveau (« réponse positive reçue »). */
  confidence_reason: string | null;
  /** Niveau corrigé à la main : l'IA ne le réécrit plus (cf. status_locked). */
  confidence_locked: boolean;
  confidence_at: string | null;
};

/** Confiance commerciale estimée par l'IA — trois niveaux, null = à évaluer. */
export type ConfidenceLevel = "chaud" | "tiede" | "froid";

/**
 * Le RÉSULTAT d'un appel — le vocabulaire tiré des notes réelles de Bora, et
 * borné en base par `activities_outcome_connu` (migration 019). Cinq valeurs,
 * pas une de plus : au-delà, personne ne choisit sur un téléphone après un
 * appel. `null` = aucune tentative d'appel consignée sur cette entrée.
 *
 * ⚠ « sans_reponse » n'est PAS un échange (la fiche reste « À appeler ») ;
 * les quatre autres le sont. La règle vit dans lib/crm/exchange.ts.
 */
export type CallOutcome =
  | "sans_reponse"
  | "barrage"
  | "rappeler"
  | "interesse"
  | "suivi_email"
  | "refus";

export type Activity = {
  id: string;
  prospect_id: string;
  author_id: string | null;
  type: ActivityType;
  subject: string | null;
  body: string | null;
  outcome: string | null;
  duration_min: number | null;
  occurred_at: string;
  created_at: string;
  /** Brouillon non envoyé : hors chronologie, et ne compte pour aucun fait. */
  is_draft: boolean;
  /** La note atteste-t-elle d'un échange réel (case « j'ai eu cet échange ») ? */
  is_exchange: boolean;
};

export type Task = {
  id: string;
  prospect_id: string | null;
  title: string;
  details: string | null;
  due_at: string;
  status: TaskStatus;
  priority: number;
  assignee_id: string | null;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
};

/** Intention détectée dans une réponse email entrante. */
export type EmailIntent =
  | "interesse"
  | "demande_info"
  | "pas_interesse"
  | "rappel_plus_tard"
  | "absence"
  | "hors_sujet";

export type EmailTriage = "a_traiter" | "accepte" | "ignore";

export type Email = {
  id: string;
  prospect_id: string | null;
  direction: "entrant" | "sortant";
  from_name: string | null;
  from_email: string;
  to_email: string | null;
  subject: string | null;
  body_text: string | null;
  message_id: string | null;
  mailbox: string | null;
  received_at: string;
  is_read: boolean;
  triage: EmailTriage;
  intent: EmailIntent | null;
  intent_confidence: number | null;
  intent_summary: string | null;
  proposed_due_at: string | null;
};
