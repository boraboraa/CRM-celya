"use client";

import { poserSecretAction } from "@/app/appels-ia-actions";
import { Icone } from "@/components/ui";
import { Retour } from "./commun";
import { useFormulaire } from "./formulaire";

export type SecretVue = {
  nom: "openai_api_key" | "sip_identifiant" | "sip_mot_de_passe";
  libelle: string;
  aide: string;
  /** « posé le 08 oct. 2026 », ou null : pas posé. */
  poseLe: string | null;
};

/**
 * Un secret : ÉCRITURE SEULE. Il part dans le Vault de Supabase et n'en
 * ressort jamais — ni ici, ni dans une réponse, ni dans un journal. L'écran ne
 * sait que s'il est posé, et depuis quand. Le champ se vide après l'envoi.
 */
function UnSecret({ s }: { s: SecretVue }) {
  const { etat, onSubmit, enCours, ref } = useFormulaire(poserSecretAction, { viderSiOk: true });
  const id = `secret-${s.nom}`;

  return (
    <form ref={ref} onSubmit={onSubmit} className="min-w-0 space-y-2 py-4 first:pt-0 last:pb-0">
      <input type="hidden" name="nom" value={s.nom} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-slate-100">
          {s.libelle}
        </label>
        {s.poseLe ? (
          <span className="chip bg-white/[0.05] text-slate-300 ring-white/10">
            <Icone nom="cadenas" className="h-3 w-3" />
            {s.poseLe}
          </span>
        ) : (
          <span className="chip bg-amber-500/15 text-amber-300 ring-amber-400/25">
            <Icone nom="alerte" className="h-3 w-3" />
            pas posé
          </span>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">{s.aide}</p>
      <div className="flex gap-2">
        <input
          id={id}
          name="valeur"
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore
          placeholder={s.poseLe ? "Nouvelle valeur, pour remplacer" : "Collez la valeur"}
          className="input min-w-0 font-mono text-xs"
        />
        <button type="submit" disabled={enCours} className="btn-ghost shrink-0 px-3 py-2 text-xs">
          {enCours ? "…" : s.poseLe ? "Remplacer" : "Poser"}
        </button>
      </div>
      <Retour etat={etat} />
    </form>
  );
}

export function Secrets({ secrets }: { secrets: SecretVue[] }) {
  return (
    <div className="divide-y divide-white/[0.06]">
      {secrets.map((s) => (
        <UnSecret key={s.nom} s={s} />
      ))}
    </div>
  );
}
