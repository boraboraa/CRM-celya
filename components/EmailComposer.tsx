"use client";

import { useActionState, useState } from "react";
import { sendProspectEmailAction } from "@/app/mail-actions";
import type { ActionState } from "@/app/actions";
import { FormError } from "@/components/ui";

type Template = { key: string; label: string; subject: string; body: string };

const TEMPLATES: Template[] = [
  {
    key: "suite_echange",
    label: "Suite à notre échange",
    subject: "Suite à notre échange",
    body: `Bonjour {contact},

Merci pour notre échange de ce jour. Comme convenu, voici un récapitulatif de ce que Celya peut mettre en place pour {societe}.

[À compléter]

Je reste à votre disposition pour toute question.

Bien à vous,`,
  },
  {
    key: "infos",
    label: "Envoi d'informations",
    subject: "Les informations demandées",
    body: `Bonjour {contact},

Comme demandé, voici les informations concernant nos services.

[À compléter]

N'hésitez pas à revenir vers moi si un point mérite d'être précisé.

Bien à vous,`,
  },
  {
    key: "relance",
    label: "Relance",
    subject: "Petit suivi de ma proposition",
    body: `Bonjour {contact},

Je me permets de revenir vers vous au sujet de mon précédent message : avez-vous eu l'occasion d'y jeter un œil ?

Je reste disponible au moment qui vous convient le mieux.

Bien à vous,`,
  },
];

export function EmailComposer({
  prospectId,
  defaultTo,
  contactName,
  companyName,
}: {
  prospectId: string;
  defaultTo: string;
  contactName: string | null;
  companyName: string;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    sendProspectEmailAction,
    {}
  );

  function applyTemplate(key: string) {
    const t = TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    const fill = (s: string) =>
      s
        .replaceAll("{contact}", contactName?.split(" ")[0] ?? "")
        .replaceAll("{societe}", companyName)
        .replace(/^Bonjour ,/m, "Bonjour,");
    setSubject(fill(t.subject));
    setBody(fill(t.body));
  }

  return (
    <form action={formAction} className="card space-y-3 p-5">
      <input type="hidden" name="prospect_id" value={prospectId} />

      <div className="flex flex-wrap gap-1.5">
        {TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => applyTemplate(t.key)}
            className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-400 ring-1 ring-white/10 transition hover:text-slate-200"
          >
            {t.label}
          </button>
        ))}
      </div>

      <div>
        <label className="label" htmlFor="to">
          À
        </label>
        <input
          id="to"
          name="to"
          type="email"
          required
          defaultValue={defaultTo}
          className="input"
        />
      </div>

      <div>
        <label className="label" htmlFor="subject">
          Sujet
        </label>
        <input
          id="subject"
          name="subject"
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="input"
          placeholder="Suite à notre échange"
        />
      </div>

      <div>
        <label className="label" htmlFor="body">
          Message
        </label>
        <textarea
          id="body"
          name="body"
          required
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="input resize-y"
          placeholder="Le message part de votre boîte Zoho — les réponses reviennent dans votre fil et remontent ici."
        />
      </div>

      {/* Le signal explicite : « proposition » ne se devine jamais dans le
          texte du message, c'est cette case qui fait foi. */}
      <label className="flex items-start gap-2 rounded-xl bg-white/[0.02] px-3.5 py-2.5 text-xs text-slate-300 ring-1 ring-white/[0.06]">
        <input
          type="checkbox"
          name="is_proposal"
          value="1"
          className="mt-0.5 h-3.5 w-3.5 accent-cyan-400"
        />
        <span>
          Ce message est une proposition / un devis
          <span className="block text-[11px] text-slate-500">
            Fait passer la fiche en « Proposition » à l&apos;envoi.
          </span>
        </span>
      </label>

      <FormError message={state.error} />
      {state.success && (
        <p className="rounded-xl bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300 ring-1 ring-emerald-400/20">
          {state.success}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Envoi…" : "Envoyer"}
        </button>
        <span className="text-xs text-slate-500">
          Envoyé depuis votre boîte Zoho, copie dans l&apos;historique.
        </span>
      </div>
    </form>
  );
}
