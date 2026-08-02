"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";
import { FormError } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("suivant") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(undefined);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "Email ou mot de passe incorrect."
          : error.message
      );
      setLoading(false);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card w-full max-w-sm p-7">
      <Logo className="mb-6" />
      <h1 className="font-display text-xl font-semibold text-slate-50">Connexion</h1>
      <p className="mb-6 mt-1 text-sm text-slate-400">
        Accédez à votre suivi clients et vos relances.
      </p>

      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="input"
            placeholder="vous@celya.be"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Mot de passe
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            className="input"
            placeholder="••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <FormError message={error} />

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Connexion…" : "Se connecter"}
        </button>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-slate-500">
        Mot de passe oublié ? Demandez à un administrateur de le réinitialiser
        depuis l&apos;onglet Équipe.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <Suspense fallback={<div className="card h-96 w-full max-w-sm animate-pulse" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
