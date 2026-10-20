"use client";

import { useState } from "react";
import type { AppelDetail } from "@/lib/appelsIa/lectures";
import type { Replique } from "@/lib/appelsIa/ecran";
import { Icone } from "@/components/ui";
import { ListeRepliques } from "./commun";

/**
 * La transcription d'un appel, dépliée à la demande : elle n'est lue
 * (/api/appels-ia/appel) qu'au premier dépliage — cinquante transcriptions
 * chargées d'avance alourdiraient l'onglet pour rien. Sous la session de
 * l'admin : la RLS borne.
 */
export function TranscriptionDepliable({ appelId }: { appelId: string }) {
  const [repliques, setRepliques] = useState<Replique[] | null>(null);
  const [erreur, setErreur] = useState(false);

  async function charger(ouvert: boolean) {
    if (!ouvert || repliques !== null) return;
    try {
      const r = await fetch(`/api/appels-ia/appel?id=${appelId}`, { cache: "no-store", headers: { accept: "application/json" } });
      const d = (await r.json()) as { appel: AppelDetail | null };
      setRepliques(d.appel?.transcription ?? []);
    } catch {
      setErreur(true);
    }
  }

  return (
    <details className="group/transcription mt-1.5" onToggle={(e) => void charger(e.currentTarget.open)}>
      <summary className="flex min-h-[32px] cursor-pointer list-none items-center gap-1.5 text-[11px] text-slate-400 transition hover:text-slate-200 [&::-webkit-details-marker]:hidden">
        <Icone nom="chevron" className="h-3 w-3 transition-transform group-open/transcription:rotate-180" />
        Transcription
      </summary>
      <div className="mt-1.5 rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-white/[0.06]">
        {erreur ? (
          <p className="text-[11px] text-rose-300">Transcription illisible pour l&apos;instant.</p>
        ) : repliques === null ? (
          <p className="text-[11px] text-slate-500">Chargement…</p>
        ) : repliques.length === 0 ? (
          <p className="text-[11px] text-slate-500">Aucune parole enregistrée sur cet appel.</p>
        ) : (
          <ListeRepliques repliques={repliques} />
        )}
      </div>
    </details>
  );
}
