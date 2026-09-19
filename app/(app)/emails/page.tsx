import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/auth";
import { PageHeader, EmptyState } from "@/components/ui";
import { attachEmailAction } from "@/app/mail-actions";
import { fmtDateTime } from "@/lib/constants";


/**
 * Messages entrants sans correspondance : plutôt que de deviner (et polluer
 * silencieusement l'historique), on les associe ici en un clic.
 *
 * Qui les voit : l'admin, et depuis la migration 015 le PROPRIÉTAIRE DE LA
 * BOÎTE dans laquelle ils sont arrivés (`owns_mailbox`). Le commentaire
 * d'origine disait « l'admin seulement » — c'était vrai avant 015, plus après.
 * Aujourd'hui une seule boîte est configurée, donc en pratique l'écran ne sert
 * qu'à Bora ; il servira à chaque commercial dès qu'il connectera la sienne.
 *
 * La liste des fiches proposées est BORNÉE AU PROPRIÉTAIRE : rattacher un
 * message est une écriture sur la fiche (il entre dans son journal et dans sa
 * chronologie), et `emails_update` la refuse hors de son portefeuille depuis la
 * migration 020. Même raison qu'à `/agenda` : une liste qui alimente une
 * écriture ne peut pas se contenter de ce que la RLS laisse LIRE.
 */
export default async function UnmatchedEmailsPage() {
  const session = await requireMember();
  const estAdmin = session.me.role === "admin";
  const supabase = await createClient();

  const [emailsRes, prospectsRes] = await Promise.all([
    supabase
      .from("emails")
      .select("id, from_name, from_email, subject, body_text, received_at")
      .eq("direction", "entrant")
      .is("prospect_id", null)
      .order("received_at", { ascending: false })
      .limit(100),
    (estAdmin
      ? supabase.from("prospects").select("id, company_name")
      : supabase
          .from("prospects")
          .select("id, company_name")
          .eq("owner_id", session.userId)
    )
      .order("company_name")
      .limit(1000),
  ]);

  const emails = emailsRes.data ?? [];
  const prospects = prospectsRes.data ?? [];

  return (
    <>
      <PageHeader
        title="Emails non rattachés"
        subtitle="Messages reçus sans correspondance automatique — associez-les à la bonne fiche."
      />

      {emails.length === 0 ? (
        <EmptyState
          title="Aucun message en attente"
          hint="Quand un email entrant ne correspond à aucun prospect (adresse, fil de réponse ou domaine), il atterrit ici au lieu d'être rattaché au hasard."
        />
      ) : (
        <ul className="card divide-y divide-white/[0.05]">
          {emails.map((e) => (
            <li key={e.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-100">
                  {e.from_name ?? e.from_email}
                </span>
                <span className="text-xs text-slate-500">{e.from_email}</span>
                <span className="ml-auto text-xs text-slate-500">
                  {fmtDateTime(e.received_at)}
                </span>
              </div>
              {e.subject && <p className="mt-1 text-sm text-slate-300">{e.subject}</p>}
              {e.body_text && (
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                  {e.body_text.slice(0, 300)}
                </p>
              )}

              <form
                action={attachEmailAction}
                className="mt-3 flex flex-wrap items-center gap-2"
              >
                <input type="hidden" name="email_id" value={e.id} />
                <select name="prospect_id" defaultValue="none" className="input max-w-xs py-1.5 text-xs">
                  <option value="none">Choisir le prospect…</option>
                  {prospects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.company_name}
                    </option>
                  ))}
                </select>
                <button className="btn-ghost px-3 py-1.5 text-xs">Associer</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
