export type UserRole = "admin" | "commercial";

/** Les six étapes d'un prospect, du panier d'entrée au client signé.
 *  « À appeler » est une colonne (la liste des entreprises à démarcher),
 *  pas une mécanique : la relance est pilotée par la date, jamais par l'étape. */
export type ProspectStatus =
  | "a_appeler"
  | "contacte"
  | "rendez_vous"
  | "proposition"
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
  notes: string | null;
  next_action_at: string | null;
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
