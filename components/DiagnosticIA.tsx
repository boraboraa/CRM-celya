"use client";

import { useState, useTransition } from "react";
import { diagnosticIA, type DiagnosticIA as Diagnostic } from "@/app/ai-actions";

/**
 * « Pourquoi l'IA ne marche pas ? » — l'écran qui répond.
 *
 * Quatre pannes très différentes (variable absente sur l'hébergeur, clé
 * refusée, solde épuisé, URL fausse) se ressemblaient toutes : « Assistant
 * indisponible ». Ce bouton fait un appel RÉEL minimal et affiche la cause
 * exacte, traduite en français, avec la variable à corriger.
 *
 * Admin seulement — et vérifié côté serveur dans `diagnosticIA`, pas
 * seulement ici : masquer un bouton n'interdit pas d'appeler la route.
 */
export function DiagnosticIA() {
  const [res, setRes] = useState<Diagnostic>();
  const [pending, startTransition] = useTransition();

  function tester() {
    setRes(undefined);
    startTransition(async () => setRes(await diagnosticIA()));
  }

  const ok = res?.test === "ok";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={tester}
          disabled={pending}
          className="btn-primary px-4 py-2 text-sm"
        >
          {pending ? "Test en cours…" : "Tester l'assistant"}
        </button>
        {res?.ms !== undefined && (
          <span className="text-xs text-slate-500">
            Réponse en {res.ms} ms
          </span>
        )}
      </div>

      {res?.error && (
        <p className="rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-300 ring-1 ring-rose-400/20">
          {res.error}
        </p>
      )}

      {res && !res.error && (
        <div className="space-y-3">
          <p
            className={`rounded-xl px-3.5 py-2.5 text-sm ring-1 ${
              ok
                ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
                : "bg-rose-500/10 text-rose-200 ring-rose-400/20"
            }`}
          >
            <span aria-hidden>{ok ? "✓ " : "✕ "}</span>
            {res.message}
          </p>

          <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
            <Ligne label="Fournisseur" valeur={res.fournisseur} />
            <Ligne label="Modèle" valeur={res.modele ?? "—"} />
            <Ligne label="URL de base" valeur={res.baseUrl ?? "(défaut du SDK)"} />
            <Ligne
              label="Clé d'API"
              valeur={
                res.cleePresente
                  ? `présente (${res.cleeLongueur} caractères)`
                  : "absente"
              }
            />
            <Ligne
              label="Variables manquantes"
              valeur={
                res.variablesManquantes?.length
                  ? res.variablesManquantes.join(", ")
                  : "aucune"
              }
              alerte={Boolean(res.variablesManquantes?.length)}
            />
            {/* La cause brute : c'est elle qu'on retrouve dans les logs
                Vercel, à l'identique — `[IA] base_resp_1008 — …`. */}
            <Ligne label="Cause" valeur={res.test} />
          </dl>

          <p className="text-[11px] leading-relaxed text-slate-500">
            Une variable ajoutée sur Vercel n&apos;agit qu&apos;après un
            redéploiement.
          </p>
        </div>
      )}
    </div>
  );
}

function Ligne({
  label,
  valeur,
  alerte = false,
}: {
  label: string;
  valeur?: string | null;
  alerte?: boolean;
}) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-slate-500">{label} :</dt>
      <dd
        className={`min-w-0 break-words font-mono ${
          alerte ? "text-amber-300" : "text-slate-300"
        }`}
      >
        {valeur ?? "—"}
      </dd>
    </div>
  );
}
