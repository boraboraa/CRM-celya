import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionDe, type Role } from "./outils";

/**
 * Les fiches du banc — « ZZ Test mobile — … », numéros FICTIFS (+32 000 …),
 * RECRÉÉES à chaque lancement avec des dates relatives au jour : une relance
 * en retard, des rendez-vous passés à débriefer, un rendez-vous aujourd'hui.
 * Chaque compte crée les siennes sous SA session (la RLS s'applique, le
 * propriétaire est posé par la base). Rien d'autre n'est touché.
 */
type Fiche = {
  nom: string;
  contact: string;
  tel: string;
  ville?: string;
  adresse?: string;
  notes?: number;
  relance?: number;
  relanceTitre?: string;
  rdv?: number;
  rdvHeure?: number;
};

export const FICHES: Record<Role, Fiche[]> = {
  commercial: [
    { nom: "ZZ Test mobile — Garage Alpha", contact: "Jean Testeur", tel: "+32 000 10 00 01", ville: "Namur", adresse: "Rue de l'Essai 1, 5000 Namur", notes: 7, relance: -2, rdv: -3 },
    { nom: "ZZ Test mobile — Garage Beta", contact: "Marie Essai", tel: "+32 000 10 00 02", ville: "Liège", relance: 0 },
    { nom: "ZZ Test mobile — Carrosserie Gamma", contact: "Paul Fictif", tel: "+32 000 10 00 03", rdv: -5, rdvHeure: 14 },
    { nom: "ZZ Test mobile — Pneus Delta", contact: "Luc Banc", tel: "+32 000 10 00 04", rdv: -6, rdvHeure: 10 },
    { nom: "ZZ Test mobile — Auto Epsilon", contact: "Anne Sonde", tel: "+32 000 10 00 05", rdv: -8, rdvHeure: 15, relance: -1, relanceTitre: "Relancer Anne Sonde : devis à confirmer avant la fin du mois, sinon proposer une visite" },
    { nom: "ZZ Test mobile — Garage Zêta", contact: "Hugo Maquette", tel: "+32 000 10 00 06", rdv: 0, rdvHeure: 16, adresse: "Chaussée de Test 12, 1000 Bruxelles" },
    { nom: "ZZ Test mobile — Garage Êta", contact: "Léa Témoin", tel: "+32 000 10 00 07", relance: 3 },
  ],
  admin: [
    { nom: "ZZ Test mobile — Admin Thêta", contact: "Admin Fictif", tel: "+32 000 20 00 01", relance: -1, rdv: -2 },
    { nom: "ZZ Test mobile — Admin Iota", contact: "Autre Fictif", tel: "+32 000 20 00 02", relance: 0 },
  ],
};

/** Un instant à J+n, HH:mm à Bruxelles. */
function a(jours: number, h: number, m = 0): string {
  const jour = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(
    new Date(Date.now() + jours * 86400000)
  );
  // Le décalage de Bruxelles ce jour-là (+1 ou +2).
  const midi = new Date(`${jour}T12:00:00Z`);
  const local = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", hour: "2-digit", hourCycle: "h23" }).format(midi)
  );
  const decalage = local - 12;
  return new Date(Date.UTC(+jour.slice(0, 4), +jour.slice(5, 7) - 1, +jour.slice(8, 10), h - decalage, m)).toISOString();
}

async function verifier<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, quoi: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${quoi} : ${error.message}`);
  return data;
}

/** Retire TOUTES les fiches « ZZ Test mobile » du compte (et leurs RDV, qui ne suivent pas en cascade). */
export async function vider(c: SupabaseClient, uid: string): Promise<void> {
  const fiches = await verifier(
    c.from("prospects").select("id").ilike("company_name", "ZZ Test mobile%").eq("owner_id", uid),
    "lecture"
  );
  const ids = (fiches ?? []).map((f: { id: string }) => f.id);
  if (ids.length === 0) return;
  await verifier(c.from("meetings").delete().in("prospect_id", ids), "RDV");
  await verifier(c.from("prospects").delete().in("id", ids), "fiches");
}

export async function peupler(role: Role): Promise<void> {
  const { c, uid } = await sessionDe(role);
  await vider(c, uid);
  for (const f of FICHES[role]) {
    const p = await verifier(
      c
        .from("prospects")
        .insert({ company_name: f.nom, contact_name: f.contact, phone: f.tel, city: f.ville ?? null, address: f.adresse ?? null, status: "a_appeler" })
        .select("id")
        .single(),
      f.nom
    );
    const id = (p as { id: string }).id;
    // Les notes AVANT les rendez-vous : une note posée après le début d'un RDV
    // le clôturerait (débrief implicite, migration 027).
    for (let i = 0; i < (f.notes ?? 0); i++) {
      await verifier(
        c.from("activities").insert({
          prospect_id: id, type: "note", subject: `Note de test n° ${i + 1}`,
          body: "Échange de test (banc mobile).", is_exchange: true, author_id: uid, occurred_at: a(-20 + i, 10),
        }),
        "note"
      );
    }
    if (f.relance !== undefined) {
      await verifier(
        c.from("tasks").insert({
          prospect_id: id, title: f.relanceTitre ?? `Rappeler ${f.contact} pour faire le point sur la démo`,
          due_at: a(f.relance, 10), status: "a_faire", priority: 2, assignee_id: uid, created_by: uid,
        }),
        "relance"
      );
    }
    if (f.rdv !== undefined) {
      const h = f.rdvHeure ?? 11;
      await verifier(
        c.from("meetings").insert({
          prospect_id: id, owner_id: uid, created_by: uid, kind: "prospect",
          title: `RDV avec ${f.nom.replace("ZZ Test mobile — ", "")}`,
          starts_at: a(f.rdv, h), ends_at: a(f.rdv, h + 1), location: f.adresse ?? null, status: "prevu",
        }),
        "rdv"
      );
    }
  }
}
