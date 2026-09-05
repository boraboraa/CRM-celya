"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { sendProspectEmailAction } from "@/app/mail-actions";
import type { ActionState } from "@/app/actions";
import type { TimelineEntry } from "@/components/Timeline";
import { FormError } from "@/components/ui";
import { hasPlaceholder, PLACEHOLDER_ERROR } from "@/lib/crm/email";
import type { ComposerPrefill } from "@/lib/crm/composer";

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
  onOptimistic,
  prefill,
  autoFocus = false,
}: {
  prospectId: string;
  defaultTo: string;
  contactName: string | null;
  companyName: string;
  /** Inscrit le message dans la chronologie pendant que le SMTP travaille. */
  onOptimistic?: (entree: TimelineEntry) => void;
  /**
   * Texte versé au composeur à l'ouverture — un brouillon repris, une réponse
   * à écrire. Le parent remonte le composant (clé) quand il change : pas
   * d'effet de resynchronisation, donc pas de fenêtre où une frappe en cours
   * se ferait écraser.
   */
  prefill?: ComposerPrefill;
  /** Place le curseur dans le premier champ vide (ouverture explicite). */
  autoFocus?: boolean;
}) {
  const [to, setTo] = useState(prefill?.to ?? defaultTo);
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [body, setBody] = useState(prefill?.body ?? "");
  const [proposition, setProposition] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // L'envoi passe par l'edge function puis par Zoho : c'est le geste le plus
  // lent du CRM. Le message s'affiche donc tout de suite en tête du fil,
  // marqué « Enregistrement… ». S'il échoue, l'entrée provisoire disparaît
  // d'elle-même (useOptimistic) et l'erreur s'affiche sous le formulaire —
  // le texte saisi reste dans le composeur, rien n'est perdu.
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, fd) => {
      const objet = String(fd.get("subject") ?? "");
      const corps = String(fd.get("body") ?? "");
      // Le trou du gabarit ne part pas : on refuse AVANT le serveur, sans
      // inscrire quoi que ce soit dans la chronologie.
      if (hasPlaceholder(objet) || hasPlaceholder(corps)) {
        return { error: PLACEHOLDER_ERROR };
      }

      onOptimistic?.({
        key: `provisoire-mail-${Date.now()}`,
        id: "",
        source: "email",
        kind: "email_sortant",
        at: new Date().toISOString(),
        title: objet || null,
        body: corps || null,
        by: String(fd.get("to") ?? "") || null,
        pending: true,
      });
      const res = await sendProspectEmailAction(prev, fd);
      if (!res.error) {
        // Le message est parti : le composeur se vide, et seule la
        // confirmation reste à l'écran. Le laisser rempli, c'est inviter au
        // double envoi — c'était le cas jusqu'ici, le texte envoyé restait
        // affiché sous le bandeau vert.
        setSubject("");
        setBody("");
        setProposition(false);
      }
      return res;
    },
    {}
  );

  // Ouverture explicite (bouton « ✉ Email », brouillon repris) : le curseur
  // se pose dans le premier champ qui reste à remplir.
  useEffect(() => {
    if (!autoFocus) return;
    const cible = !to ? toRef : !subject ? subjectRef : bodyRef;
    cible.current?.focus();
    // Au montage seulement : le composeur est remonté à chaque ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    bodyRef.current?.focus();
  }

  /** Cmd/Ctrl + Entrée envoie — le composeur reste utilisable sans souris. */
  function raccourci(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      onKeyDown={raccourci}
      className="card space-y-3 p-5"
    >
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
          ref={toRef}
          id="to"
          name="to"
          type="email"
          required
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="input"
        />
      </div>

      <div>
        <label className="label" htmlFor="subject">
          Sujet
        </label>
        <input
          ref={subjectRef}
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
          ref={bodyRef}
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
          checked={proposition}
          onChange={(e) => setProposition(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-[#4F7BFF]"
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

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Envoi…" : "Envoyer"}
        </button>
        <span className="text-xs text-slate-500">
          Envoyé depuis votre boîte Zoho, copie dans l&apos;historique.
          <span className="ml-1 text-slate-600">(⌘/Ctrl + Entrée)</span>
        </span>
      </div>
    </form>
  );
}
