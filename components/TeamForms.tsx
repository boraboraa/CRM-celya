"use client";

import { useActionState, useState } from "react";
import {
  adminCreateUserAction,
  adminResetPasswordAction,
  type ActionState,
} from "@/app/actions";

const EMPTY: ActionState = {};

function generatePassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

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
        <span className="mt-1 block text-xs text-emerald-400/70">
          Transmettez-le à la personne — il ne sera plus affiché ensuite.
        </span>
      </p>
    );
  }
  return null;
}

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(adminCreateUserAction, EMPTY);
  const [password, setPassword] = useState("");

  return (
    <form action={formAction} className="card space-y-4 p-5">
      <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
        Créer un accès
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="full_name">
            Nom complet
          </label>
          <input id="full_name" name="full_name" className="input" placeholder="Sarah Peeters" />
        </div>
        <div>
          <label className="label" htmlFor="email">
            Email *
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="input"
            placeholder="sarah@celya.be"
          />
        </div>
        <div>
          <label className="label" htmlFor="role">
            Rôle
          </label>
          <select id="role" name="role" defaultValue="commercial" className="input">
            <option value="commercial">Commercial — voit ses clients assignés</option>
            <option value="admin">Administrateur — voit tout</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="password">
            Mot de passe provisoire *
          </label>
          <div className="flex gap-2">
            <input
              id="password"
              name="password"
              required
              minLength={10}
              className="input font-mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="10 caractères minimum"
            />
            <button
              type="button"
              onClick={() => setPassword(generatePassword())}
              className="btn-ghost shrink-0 px-3"
              title="Générer un mot de passe"
            >
              ⟳
            </button>
          </div>
        </div>
      </div>

      <Feedback state={state} />

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Création…" : "Créer le compte"}
        </button>
        <span className="text-xs text-slate-500">
          Aucun email n&apos;est envoyé : communiquez le mot de passe vous-même.
        </span>
      </div>
    </form>
  );
}

export function ResetPasswordForm({
  userId,
  name,
}: {
  userId: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(adminResetPasswordAction, EMPTY);
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg px-2.5 py-1 text-[11px] text-slate-400 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-slate-200"
      >
        Réinitialiser le mot de passe
      </button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-2">
      <input type="hidden" name="user_id" value={userId} />
      <p className="text-[11px] text-slate-500">Nouveau mot de passe pour {name}</p>
      <div className="flex gap-2">
        <input
          name="password"
          required
          minLength={10}
          className="input font-mono text-xs"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="10 caractères minimum"
        />
        <button
          type="button"
          onClick={() => setPassword(generatePassword())}
          className="btn-ghost shrink-0 px-3 py-2 text-xs"
        >
          ⟳
        </button>
        <button type="submit" disabled={pending} className="btn-primary px-3 py-2 text-xs">
          OK
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
