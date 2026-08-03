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
  city: string | null;
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
};

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
