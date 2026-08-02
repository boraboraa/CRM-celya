export type UserRole = "admin" | "commercial";

export type ClientStatus =
  | "nouveau"
  | "contacte"
  | "qualifie"
  | "proposition"
  | "negociation"
  | "gagne"
  | "perdu";

export type ActivityType =
  | "appel"
  | "email"
  | "note"
  | "reunion"
  | "whatsapp"
  | "linkedin";

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

export type Client = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  sector: string | null;
  city: string | null;
  country: string | null;
  status: ClientStatus;
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
  client_id: string;
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
  client_id: string | null;
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

export type Email = {
  id: string;
  client_id: string | null;
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
};
