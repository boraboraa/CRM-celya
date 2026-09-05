"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ProspectForm } from "@/components/ProspectForm";
import { createProspectAction } from "@/app/actions";
import {
  extractProspectAction,
  type ExtractedProspect,
  type DuplicateHit,
} from "@/app/ai-actions";
import { LienPourquoiIA, Icone } from "@/components/ui";
import { STATUS_LABEL, normalizeStatus } from "@/lib/constants";
import type { Profile, Prospect } from "@/lib/types";

type Members = Pick<Profile, "id" | "full_name" | "email">[];

/**
 * Coller → fiche. Bora colle ce qu'il trouve (fiche Google Maps, signature
 * d'email, ligne d'annuaire, capture d'écran) ; le modèle extrait, le code
 * valide et normalise, le formulaire arrive pré-rempli. Les champs déduits
 * sont signalés, ceux à faible confiance surlignés en orange — l'œil va
 * droit dessus. Rien ne s'enregistre sans le clic « Créer la fiche ».
 * Si l'assistant est indisponible ou répond hors format, le formulaire
 * s'ouvre vide et la saisie manuelle fonctionne comme avant.
 */
export function NewProspectAssist({
  members,
  currentUserId,
  isAdmin = false,
}: {
  members: Members;
  currentUserId?: string;
  /** Admin : « Assistant indisponible » gagne un lien « Pourquoi ? ». */
  isAdmin?: boolean;
}) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ base64: string; mime: string }>();
  const [draft, setDraft] = useState<Partial<Prospect>>();
  const [aiFields, setAiFields] = useState<string[]>([]);
  const [uncertain, setUncertain] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateHit[]>([]);
  const [notice, setNotice] = useState<string>();
  /** L'assistant n'a pas répondu : l'admin peut aller voir pourquoi. */
  const [indisponible, setIndisponible] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [pending, startTransition] = useTransition();

  function onPaste(e: React.ClipboardEvent) {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const url = String(reader.result ?? "");
          const base64 = url.split(",")[1] ?? "";
          setImage({ base64, mime: item.type });
          setNotice(undefined);
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  }

  function analyze() {
    if (!text.trim() && !image) return;
    setNotice(undefined);
    setIndisponible(false);
    startTransition(async () => {
      const res = await extractProspectAction({
        text: text || null,
        imageBase64: image?.base64 ?? null,
        imageMime: image?.mime ?? null,
      });

      if (res.error) {
        setNotice(res.error);
        return;
      }
      if (res.unavailable || !res.fields) {
        // Panne ou sortie hors format : le formulaire reste vide.
        setNotice(
          "Assistant indisponible pour le moment — remplissez la fiche à la main."
        );
        setIndisponible(true);
        return;
      }

      const f: ExtractedProspect = res.fields;
      const filled = Object.entries(f)
        .filter(([k, v]) => k !== "status" && v !== null)
        .map(([k]) => k);

      setDraft({
        company_name: f.company_name ?? undefined,
        contact_name: f.contact_name,
        phone: f.phone,
        email: f.email,
        website: f.website,
        sector: f.sector,
        address: f.address,
        city: f.city,
        source: f.source,
        status: f.status,
        notes: f.notes,
      });
      setAiFields(filled);
      setUncertain(res.uncertain ?? []);
      setDuplicates(res.duplicates ?? []);
      setFormKey((k) => k + 1); // remonte le formulaire avec les nouvelles valeurs
      setNotice(
        [
          `${filled.length} champ${filled.length > 1 ? "s" : ""} déduit${filled.length > 1 ? "s" : ""}`,
          `étape proposée : ${STATUS_LABEL[f.status]}`,
          (res.uncertain?.length ?? 0) > 0
            ? `${res.uncertain!.length} à vérifier (surligné${res.uncertain!.length > 1 ? "s" : ""} en orange)`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") + " — vérifiez avant d'enregistrer."
      );
    });
  }

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------ zone de collage */}
      <div className="card max-w-3xl p-5">
        <p className="label">Collez ce que vous avez trouvé</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          rows={4}
          className="input resize-y font-mono text-xs"
          placeholder={
            "Fiche Google Maps, signature d'email, ligne d'annuaire, extrait LinkedIn… ou collez directement une capture d'écran (Ctrl+V)."
          }
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={analyze}
            disabled={pending || (!text.trim() && !image)}
            className="btn-primary px-4 py-2 text-sm"
          >
            {pending ? (
              "Analyse en cours…"
            ) : (
              <>
                <Icone nom="etincelle" className="h-3.5 w-3.5" />
                Pré-remplir la fiche
              </>
            )}
          </button>

          {image && (
            <span className="flex items-center gap-2 text-xs text-slate-400">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:${image.mime};base64,${image.base64}`}
                alt="Capture collée"
                className="h-10 rounded-lg ring-1 ring-white/15"
              />
              Capture collée
              <button
                type="button"
                onClick={() => setImage(undefined)}
                className="inline-flex text-slate-500 hover:text-rose-400"
                title="Retirer la capture"
                aria-label="Retirer la capture"
              >
                <Icone nom="croix" className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>

        {notice && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-blue-300/90">
            {notice}
            {indisponible && <LienPourquoiIA isAdmin={isAdmin} />}
          </p>
        )}
      </div>

      {/* ------------------------------------------------ alerte doublons */}
      {duplicates.length > 0 && (
        <div className="max-w-3xl rounded-xl bg-amber-500/[0.08] p-4 ring-1 ring-amber-400/25">
          <p className="text-sm font-medium text-amber-200">
            Doublon possible — cette fiche existe peut-être déjà :
          </p>
          <ul className="mt-2 space-y-1.5">
            {duplicates.map((d) => (
              <li key={d.id} className="text-xs text-slate-300">
                <Link
                  href={`/prospects/${d.id}`}
                  prefetch={false}
                  className="font-medium text-celya-blue hover:underline"
                >
                  {d.company_name}
                </Link>{" "}
                <span className="text-slate-500">
                  ({d.reason} · {STATUS_LABEL[normalizeStatus(d.status)]})
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-500">
            Ouvrez la fiche existante, ou créez quand même si c&apos;est bien un
            autre prospect.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------ formulaire */}
      <div className="card max-w-3xl p-6">
        <ProspectForm
          key={formKey}
          prospect={draft}
          members={members}
          action={createProspectAction}
          submitLabel="Créer la fiche"
          currentUserId={currentUserId}
          aiFields={aiFields}
          uncertainFields={uncertain}
        />
      </div>
    </div>
  );
}
