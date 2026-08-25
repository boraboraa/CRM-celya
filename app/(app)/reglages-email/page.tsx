import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { EmailAccountForm, SyncNowButton } from "@/components/EmailAccountForm";
import { fmtDateTime } from "@/lib/constants";


/**
 * Configuration de SA boîte Zoho — ouverte à tout membre actif depuis le
 * 25 août. Chacun connecte la sienne : c'est de là que partent ses relances,
 * et c'est là que reviennent ses réponses. Réserver ce geste à l'admin
 * l'obligeait à manipuler le mot de passe d'application d'un collègue.
 *
 * Le mot de passe d'application part directement dans Supabase Vault via
 * l'edge function — il n'est jamais stocké ni relu côté Next. La RPC
 * `mail_account_status` ne renvoie que SA boîte à un commercial, toutes à
 * l'admin, et jamais le moindre secret.
 */
export default async function EmailSettingsPage() {
  const session = await requireMember();
  const isAdmin = session.me.role === "admin";

  const supabase = await createClient();
  const { data } = await supabase.rpc("mail_account_status");
  const accounts = (data ?? []) as {
    email_address: string;
    smtp_host: string;
    imap_host: string;
    last_sync_at: string | null;
    sync_error: string | null;
    has_credentials: boolean;
    user_id: string;
    is_mine: boolean;
  }[];

  const mine = accounts.filter((a) => a.is_mine);
  const others = accounts.filter((a) => !a.is_mine);

  return (
    <>
      <PageHeader
        title="Ma boîte email"
        subtitle="Connexion SMTP + IMAP à votre boîte Zoho, avec un mot de passe d'application."
      />

      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="mb-1 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
            {mine.length > 0 ? "Remplacer ma boîte" : "Connecter ma boîte"}
          </h2>
          <div className="mb-5 space-y-2 text-xs leading-relaxed text-slate-500">
            <p>
              Il faut un{" "}
              <span className="text-slate-300">mot de passe d&apos;application</span>{" "}
              (Zoho Mail → Mon compte → Sécurité → Mots de passe
              d&apos;application, la double authentification doit être activée) —{" "}
              <span className="text-slate-300">jamais</span> votre mot de passe de
              connexion.
            </p>
            <p>
              IMAP doit être activé (Paramètres → Comptes mail → IMAP).{" "}
              <span className="text-amber-300/90">
                Sur un compte Zoho personnel gratuit, Zoho ne propose plus IMAP
                aux nouveaux inscrits : un plan payant (Mail Lite, ~1 €/mois) est
                nécessaire.
              </span>{" "}
              Le test de connexion ci-dessous vous le dira tout de suite.
            </p>
            <p>
              Le centre de données se lit dans l&apos;URL de votre boîte :
              mail.zoho.<b>eu</b> ou mail.zoho.<b>com</b> — se tromper produit des
              erreurs d&apos;authentification opaques.
            </p>
          </div>
          <EmailAccountForm />
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
            État
          </h2>

          {mine.length === 0 ? (
            <p className="card px-5 py-6 text-sm text-slate-500">
              Aucune boîte connectée. Sans boîte, vous ne pouvez pas envoyer
              d&apos;email depuis le CRM et vos réponses ne remontent pas — le
              reste du CRM fonctionne normalement.
            </p>
          ) : (
            mine.map((a) => <AccountCard key={a.email_address} account={a} canSync={isAdmin} />)
          )}

          {isAdmin && others.length > 0 && (
            <>
              <h3 className="pt-2 font-display text-xs font-semibold uppercase tracking-wider text-slate-500">
                Boîtes de l&apos;équipe
              </h3>
              {others.map((a) => (
                <AccountCard key={a.email_address} account={a} canSync={false} />
              ))}
            </>
          )}
        </section>
      </div>
    </>
  );
}

function AccountCard({
  account: a,
  canSync,
}: {
  account: {
    email_address: string;
    smtp_host: string;
    imap_host: string;
    last_sync_at: string | null;
    sync_error: string | null;
  };
  canSync: boolean;
}) {
  return (
    <div className="card space-y-2 px-5 py-4">
      <p className="text-sm font-medium text-slate-100">{a.email_address}</p>
      <p className="text-xs text-slate-500">
        SMTP {a.smtp_host} · IMAP {a.imap_host}
      </p>
      <p className="text-xs text-slate-400">
        Dernière relève :{" "}
        {a.last_sync_at
          ? fmtDateTime(a.last_sync_at)
          : "jamais (toutes les 5 min une fois connectée)"}
      </p>
      {a.sync_error ? (
        <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-400/20">
          {a.sync_error}
        </p>
      ) : (
        a.last_sync_at && <p className="text-xs text-emerald-300">Relève en ordre.</p>
      )}
      {canSync && <SyncNowButton />}
    </div>
  );
}
