"use client";

import { useActionState } from "react";
import {
  updateMyProfileAction,
  changeMyPasswordAction,
  type ActionState,
} from "@/app/actions";

const EMPTY: ActionState = {};

function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-300 ring-1 ring-rose-400/20">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300 ring-1 ring-emerald-400/20">
        {state.success}
      </p>
    );
  }
  return null;
}

export function ProfileForm({
  fullName,
  phone,
}: {
  fullName: string;
  phone: string;
}) {
  const [state, formAction, pending] = useActionState(updateMyProfileAction, EMPTY);

  return (
    <form action={formAction} className="card space-y-4 p-5">
      <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
        Mon profil
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="full_name">
            Nom complet
          </label>
          <input
            id="full_name"
            name="full_name"
            defaultValue={fullName}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Téléphone
          </label>
          <input id="phone" name="phone" defaultValue={phone} className="input" />
        </div>
      </div>

      <Feedback state={state} />

      <button disabled={pending} className="btn-ghost">
        {pending ? "Enregistrement…" : "Enregistrer"}
      </button>
    </form>
  );
}

export function PasswordForm({ mustChange }: { mustChange: boolean }) {
  const [state, formAction, pending] = useActionState(changeMyPasswordAction, EMPTY);

  return (
    <form action={formAction} className="card space-y-4 p-5">
      <div>
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
          Mot de passe
        </h2>
        {mustChange && (
          <p className="mt-2 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-300 ring-1 ring-amber-400/20">
            Votre mot de passe a été défini par un administrateur. Choisissez-en un
            nouveau maintenant.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="password">
            Nouveau mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className="input"
            placeholder="10 caractères minimum"
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm">
            Confirmer
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className="input"
          />
        </div>
      </div>

      <Feedback state={state} />

      <button disabled={pending} className="btn-primary">
        {pending ? "Modification…" : "Changer le mot de passe"}
      </button>
    </form>
  );
}
