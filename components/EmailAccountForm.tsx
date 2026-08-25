"use client";

import { useActionState, useTransition, useState } from "react";
import { saveEmailAccountAction, syncNowAction } from "@/app/mail-actions";
import type { ActionState } from "@/app/actions";
import { FormError } from "@/components/ui";

export function EmailAccountForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    saveEmailAccountAction,
    {}
  );

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="label" htmlFor="email_address">
          Adresse de la boîte
        </label>
        <input
          id="email_address"
          name="email_address"
          type="email"
          required
          className="input"
          placeholder="bora@celya.be"
        />
      </div>

      <div>
        <label className="label" htmlFor="app_password">
          Mot de passe d&apos;application
        </label>
        <input
          id="app_password"
          name="app_password"
          type="password"
          required
          autoComplete="off"
          className="input"
          placeholder="••••••••••••"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Stocké chiffré dans Supabase Vault — jamais dans le code ni le navigateur.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="datacenter">
          Centre de données Zoho
        </label>
        <select id="datacenter" name="datacenter" required defaultValue="" className="input">
          <option value="" disabled>
            À vérifier dans l&apos;URL de votre boîte…
          </option>
          <option value="eu">Europe — mail.zoho.eu</option>
          <option value="com">International — mail.zoho.com</option>
        </select>
      </div>

      {/* Zoho a deux jeux de serveurs, et se tromper donne une erreur
          d'authentification indiscernable d'un mauvais mot de passe. Le
          domaine de l'adresse suffit à trancher dans l'immense majorité des
          cas — mais pas tous, d'où le forçage manuel. */}
      <div>
        <label className="label" htmlFor="hosts">
          Type de compte
        </label>
        <select id="hosts" name="hosts" defaultValue="auto" className="input">
          <option value="auto">Détection automatique (recommandé)</option>
          <option value="pro">
            Adresse sur mon domaine (@celya.be) — imappro / smtppro
          </option>
          <option value="perso">
            Compte Zoho personnel (@zohomail.eu) — imap / smtp
          </option>
        </select>
        <p className="mt-1 text-[11px] text-slate-500">
          Déduit du domaine de l&apos;adresse. Ne le forcez que si la détection
          se trompe.
        </p>
      </div>

      <FormError message={state.error} />
      {state.success && (
        <p className="rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300 ring-1 ring-emerald-400/20">
          {state.success}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Test de connexion…" : "Connecter et tester"}
      </button>
    </form>
  );
}

export function SyncNowButton() {
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <button
        onClick={() => {
          setMessage(undefined);
          startTransition(async () => {
            const res = await syncNowAction();
            setMessage(res.error ?? res.success);
          });
        }}
        disabled={pending}
        className="btn-ghost px-3 py-1.5 text-xs"
      >
        {pending ? "Relève en cours…" : "Relever maintenant"}
      </button>
      {message && <p className="mt-1.5 text-xs text-slate-400">{message}</p>}
    </div>
  );
}
