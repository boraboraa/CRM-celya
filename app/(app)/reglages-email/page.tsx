import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { EmailAccountForm, SyncNowButton } from "@/components/EmailAccountForm";
import { fmtDateTime } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Configuration de la boîte Zoho (admin). Le mot de passe d'application part
 *  directement dans Supabase Vault via l'edge function — il n'est jamais
 *  stocké ni relu côté Next. */
export default async function EmailSettingsPage() {
  const session = await requireMember();
  if (session.me.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();
  const { data } = await supabase.rpc("mail_account_status");
  const accounts = (data ?? []) as {
    email_address: string;
    smtp_host: string;
    imap_host: string;
    last_sync_at: string | null;
    sync_error: string | null;
    has_credentials: boolean;
  }[];

  return (
    <>
      <PageHeader
        title="Boîte email"
        subtitle="Connexion SMTP + IMAP à votre boîte Zoho, avec un mot de passe d'application."
      />

      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="mb-1 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
            {accounts.length > 0 ? "Remplacer le compte" : "Connecter la boîte"}
          </h2>
          <p className="mb-5 text-xs leading-relaxed text-slate-500">
            Créez un <span className="text-slate-300">mot de passe d&apos;application</span> dans
            Zoho Mail (Mon compte → Sécurité → Mots de passe d&apos;application) et
            activez IMAP (Paramètres → Comptes mail → IMAP). Le centre de données
            se lit dans l&apos;URL de votre boîte : mail.zoho.<b>eu</b> ou
            mail.zoho.<b>com</b> — se tromper produit des erreurs
            d&apos;authentification opaques.
          </p>
          <EmailAccountForm />
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
            État
          </h2>

          {accounts.length === 0 ? (
            <p className="card px-5 py-6 text-sm text-slate-500">
              Aucune boîte connectée. Sans boîte, l&apos;envoi d&apos;emails et la
              remontée des réponses sont désactivés — le reste du CRM fonctionne
              normalement.
            </p>
          ) : (
            accounts.map((a) => (
              <div key={a.email_address} className="card space-y-2 px-5 py-4">
                <p className="text-sm font-medium text-slate-100">{a.email_address}</p>
                <p className="text-xs text-slate-500">
                  SMTP {a.smtp_host} · IMAP {a.imap_host}
                </p>
                <p className="text-xs text-slate-400">
                  Dernière relève :{" "}
                  {a.last_sync_at ? fmtDateTime(a.last_sync_at) : "jamais (toutes les 5 min une fois connectée)"}
                </p>
                {a.sync_error ? (
                  <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-400/20">
                    {a.sync_error}
                  </p>
                ) : (
                  a.last_sync_at && (
                    <p className="text-xs text-emerald-300">Relève en ordre.</p>
                  )
                )}
                <SyncNowButton />
              </div>
            ))
          )}
        </section>
      </div>
    </>
  );
}
