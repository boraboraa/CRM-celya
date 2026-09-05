"use client";

import { useEffect, useOptimistic, useRef, useState } from "react";
import { Timeline, type TimelineEntry } from "@/components/Timeline";
import { DeleteEntryButton } from "@/components/DeleteEntryButton";
import { QuickNote } from "@/components/QuickNote";
import { EmailComposer } from "@/components/EmailComposer";
import { EmptyState, Icone, type IconeNom } from "@/components/ui";
import {
  COMPOSER_ANCHOR,
  COMPOSER_EVENT,
  type ComposerPrefill,
  type JournalOpen,
  type JournalTab,
} from "@/lib/crm/composer";

const ONGLETS: { value: JournalTab; label: string; icone: IconeNom }[] = [
  { value: "consigner", label: "Note", icone: "note" },
  { value: "email", label: "Email", icone: "enveloppe" },
];

/**
 * AGIR, puis la CHRONOLOGIE.
 *
 * Deux corrections d'un même défaut. D'abord, « Noter un échange » et
 * « Écrire un email » cohabitaient au même endroit, chacun avec sa case
 * « proposition » : deux formulaires pour un seul geste — décider quoi faire
 * de ce prospect. Ils n'en font plus qu'un, à deux onglets. Ensuite, le
 * composeur email vivait replié tout en bas, sous une chronologie qui pouvait
 * faire plusieurs milliers de pixels : Claude rédigeait, le texte atterrissait
 * en brouillon, et il fallait le recopier à la main. Le bloc « Agir » passe
 * donc AU-DESSUS du fil (lui-même ramené à ses dix dernières entrées).
 *
 * Ce qui se fait ICI : la note détaillée, et l'email. Le résultat d'un appel
 * ne s'y consigne plus — il vit dans la carte PROCHAINE ACTION, sous le
 * pouce, là où l'on arrive en raccrochant. Deux surfaces pour un même geste,
 * c'était une de trop.
 *
 * Le geste consigné s'inscrit en tête du fil à l'instant du clic, en retrait
 * et marqué « Enregistrement… », puis la version du serveur la remplace. En
 * cas d'échec, `useOptimistic` rend la main aux données du serveur : l'entrée
 * provisoire disparaît d'elle-même et le formulaire affiche l'erreur — le
 * texte saisi n'est pas perdu.
 */
export function ProspectJournal({
  entries,
  prospectId,
  companyName,
  contactName,
  prospectEmail,
  isAdmin,
  initialTab = "consigner",
  initialPrefill,
}: {
  entries: TimelineEntry[];
  prospectId: string;
  companyName: string;
  contactName: string | null;
  /** Adresse du prospect — sans elle, pas de composeur. */
  prospectEmail: string | null;
  isAdmin: boolean;
  /** Onglet ouvert au chargement (« Répondre » depuis une réponse reçue). */
  initialTab?: JournalTab;
  /** Texte versé au composeur au chargement (réponse à écrire). */
  initialPrefill?: ComposerPrefill;
}) {
  const [vue, ajouter] = useOptimistic(
    entries,
    (liste: TimelineEntry[], entree: TimelineEntry) => [entree, ...liste]
  );

  const [onglet, setOnglet] = useState<JournalTab>(initialTab);
  const [prefill, setPrefill] = useState<ComposerPrefill | undefined>(
    initialPrefill
  );
  /** Remonte le composeur à chaque ouverture : le pré-remplissage arrive au
   *  montage, jamais par un effet qui écraserait une frappe en cours. */
  const [cle, setCle] = useState(0);
  const [autoFocus, setAutoFocus] = useState(initialTab === "email");
  const blocRef = useRef<HTMLElement>(null);

  // Les gestes qui décident d'écrire sont ailleurs sur la page (carte
  // PROCHAINE ACTION, brouillons de la colonne latérale) et un composant
  // serveur les sépare de ce bloc : ils appellent `openComposer()`, on écoute.
  useEffect(() => {
    const defiler = () =>
      blocRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    const surOuverture = (e: Event) => {
      const detail = (e as CustomEvent<JournalOpen>).detail;
      if (!detail) return;
      setOnglet(detail.onglet);
      if (detail.onglet === "email") {
        setPrefill({ to: detail.to, subject: detail.subject, body: detail.body });
        setCle((k) => k + 1);
        setAutoFocus(true);
      }
      defiler();
    };

    // Arrivée depuis un autre écran : /prospects/<id>#ecrire-un-email.
    // Le pré-remplissage éventuel vient du serveur (?repondre=…) — on ne
    // l'écrase pas, on ne fait qu'ouvrir le bon onglet.
    const surHash = () => {
      if (window.location.hash !== `#${COMPOSER_ANCHOR}`) return;
      setOnglet("email");
      setAutoFocus(true);
      setCle((k) => k + 1);
      defiler();
    };

    window.addEventListener(COMPOSER_EVENT, surOuverture);
    window.addEventListener("hashchange", surHash);
    surHash();
    return () => {
      window.removeEventListener(COMPOSER_EVENT, surOuverture);
      window.removeEventListener("hashchange", surHash);
    };
  }, []);

  return (
    <>
      {/* ---------- AGIR : consigner un échange, ou en envoyer un ---------- */}
      <section id="noter-un-echange" ref={blocRef} className="scroll-mt-6">
        <span id={COMPOSER_ANCHOR} aria-hidden className="block scroll-mt-6" />

        <div className="mb-3 flex flex-wrap items-center gap-4">
          {ONGLETS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setOnglet(o.value)}
              aria-pressed={onglet === o.value}
              className={`inline-flex items-center gap-1.5 border-b-2 pb-1.5 text-xs font-semibold uppercase tracking-wider transition duration-200 ${
                onglet === o.value
                  ? "border-celya-blue text-slate-50"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <Icone nom={o.icone} />
              {o.label}
            </button>
          ))}
        </div>

        {onglet === "consigner" ? (
          <QuickNote
            prospectId={prospectId}
            isAdmin={isAdmin}
            onOptimistic={ajouter}
          />
        ) : prospectEmail ? (
          <EmailComposer
            key={cle}
            prospectId={prospectId}
            defaultTo={prospectEmail}
            contactName={contactName}
            companyName={companyName}
            onOptimistic={ajouter}
            prefill={prefill}
            autoFocus={autoFocus}
          />
        ) : (
          <SansAdresse companyName={companyName} />
        )}
      </section>

      {/* ---------- CHRONOLOGIE ---------- */}
      <section>
        <h2 className="mb-4 font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
          Chronologie
        </h2>
        <Timeline
          entries={vue}
          renderAction={
            isAdmin
              ? (entry) => (
                  <DeleteEntryButton
                    id={entry.id}
                    prospectId={prospectId}
                    source={entry.source}
                    isRealEmail={entry.source === "email"}
                    label="cette entrée du journal"
                  />
                )
              : undefined
          }
        />
      </section>
    </>
  );
}

/**
 * Pas d'adresse sur la fiche. Le composeur disparaissait alors sans un mot ;
 * il dit maintenant pourquoi, et propose le geste qui débloque — le
 * formulaire « Modifier la fiche » s'ouvre, curseur dans le champ Email.
 */
function SansAdresse({ companyName }: { companyName: string }) {
  function ouvrirModifierFiche() {
    const bloc = document.getElementById("modifier-la-fiche");
    if (bloc instanceof HTMLDetailsElement) {
      bloc.open = true;
      bloc.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Le champ n'existe qu'une fois le bloc déplié — et le défilement est
    // fluide : on laisse la frame passer avant de poser le curseur.
    setTimeout(() => document.getElementById("email")?.focus(), 200);
  }

  return (
    <EmptyState
      compact
      title="Pas d'adresse email sur cette fiche"
      hint={`Ajoutez l'adresse de ${companyName} pour lui écrire d'ici — et pour que ses réponses reviennent automatiquement sur la fiche.`}
      action={
        <button type="button" onClick={ouvrirModifierFiche} className="btn-primary">
          Ajouter une adresse
        </button>
      }
    />
  );
}
