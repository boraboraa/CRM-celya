"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  triageAnalyzeAction,
  triageAcceptAction,
  triageIgnoreAction,
} from "@/app/mail-actions";
import { INTENT_LABEL, fmtDate, relative } from "@/lib/constants";
import { composerHref } from "@/lib/crm/composer";
import type { EmailIntent } from "@/lib/types";

export type ReplyCardEmail = {
  id: string;
  from_email: string;
  subject: string | null;
  body_text: string | null;
  received_at: string;
  intent: EmailIntent | null;
  intent_confidence: number | null;
  intent_summary: string | null;
  proposed_due_at: string | null;
  prospects: { id: string; company_name: string } | null;
};

/** Carte « Réponses reçues » : l'IA propose, Bora décide. */
export function ReplyCard({ email }: { email: ReplyCardEmail }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(undefined);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
    });
  };

  const company = email.prospects?.company_name ?? email.from_email;

  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {email.prospects ? (
          <Link
            href={`/prospects/${email.prospects.id}`}
              prefetch={false}
            className="font-medium text-slate-100 hover:text-celya-cyan"
          >
            {company}
          </Link>
        ) : (
          <span className="font-medium text-slate-100">{company}</span>
        )}
        <span className="text-xs text-slate-500">
          a répondu {relative(email.received_at)}
        </span>
        {email.intent && (
          <span className="chip bg-celya-blue/15 text-blue-300 ring-blue-400/25">
            {INTENT_LABEL[email.intent]}
            {email.intent_confidence !== null &&
              ` · ${Math.round(Number(email.intent_confidence) * 100)} %`}
          </span>
        )}
      </div>

      {email.subject && (
        <p className="mt-1 text-sm text-slate-300">{email.subject}</p>
      )}

      {email.intent ? (
        <p className="mt-1.5 text-xs text-slate-400">
          {email.intent_summary ?? INTENT_LABEL[email.intent]}
          {email.proposed_due_at && (
            <span className="text-cyan-300">
              {" "}
              → proposition : le {fmtDate(email.proposed_due_at)}
            </span>
          )}
        </p>
      ) : (
        email.body_text && (
          <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">
            {email.body_text.slice(0, 300)}
          </p>
        )
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {email.intent ? (
          <>
            <button
              onClick={() => run(() => triageAcceptAction(email.id))}
              disabled={pending}
              className="btn-primary px-3.5 py-1.5 text-xs"
            >
              {pending ? "…" : "Accepter"}
            </button>
            {email.prospects && (
              <Link
                href={`/prospects/${email.prospects.id}`}
              prefetch={false}
                className="btn-ghost px-3.5 py-1.5 text-xs"
              >
                Modifier sur la fiche
              </Link>
            )}
          </>
        ) : (
          <button
            onClick={() => run(() => triageAnalyzeAction(email.id))}
            disabled={pending}
            className="btn-primary px-3.5 py-1.5 text-xs"
          >
            {pending ? "Analyse…" : "✨ Analyser"}
          </button>
        )}
        {/* Lire et classer une réponse, oui — mais il fallait aussi pouvoir y
            RÉPONDRE. Le composeur s'ouvre sur la fiche, destinataire et objet
            « Re: … » déjà remplis. */}
        {email.prospects && (
          <Link
            href={composerHref(email.prospects.id, email.id)}
            prefetch={false}
            className="btn-ghost px-3.5 py-1.5 text-xs"
          >
            ✉ Répondre
          </Link>
        )}
        <button
          onClick={() => run(() => triageIgnoreAction(email.id))}
          disabled={pending}
          className="btn-ghost px-3.5 py-1.5 text-xs"
        >
          Ignorer
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </li>
  );
}
