"use client";

import { enregistrerScriptAction } from "@/app/appels-ia-actions";
import { CHAMP_SCRIPT_MAX } from "@/lib/appelsIa/instructions";
import { Retour } from "./commun";
import { useFormulaire } from "./formulaire";

export type ScriptVue = {
  secteur: "garage" | "restaurant" | "cabinet" | "autre";
  libelle: string;
  accueil: string;
  presentation: string;
  objectif: string;
  questions: string;
  objections: string;
};

const CHAMPS: { cle: keyof Omit<ScriptVue, "secteur" | "libelle">; label: string; aide: string; lignes: number }[] = [
  { cle: "accueil", label: "Accueil", aide: "Qui demander, et que faire si on vous passe quelqu'un d'autre.", lignes: 2 },
  { cle: "presentation", label: "Présentation", aide: "Ce que Celya apporte à ce secteur, en deux ou trois phrases.", lignes: 3 },
  { cle: "objectif", label: "Objectif", aide: "Ce que Janet doit obtenir — en général, une démonstration de 30 minutes.", lignes: 2 },
  { cle: "questions", label: "Questions", aide: "Les questions à poser, une à la fois.", lignes: 3 },
  { cle: "objections", label: "Objections", aide: "Les objections courantes, et ce que Janet y répond.", lignes: 4 },
];

/** Le script d'un secteur : cinq champs, un enregistrement. */
export function Script({ s }: { s: ScriptVue }) {
  const { etat, onSubmit, enCours, ref } = useFormulaire(enregistrerScriptAction);
  return (
    <form ref={ref} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="secteur" value={s.secteur} />
      {CHAMPS.map((c) => {
        const id = `script-${s.secteur}-${c.cle}`;
        return (
          <div key={c.cle} className="min-w-0">
            <label htmlFor={id} className="label">
              {c.label}
            </label>
            <textarea
              id={id}
              name={c.cle}
              rows={c.lignes}
              maxLength={CHAMP_SCRIPT_MAX}
              defaultValue={s[c.cle]}
              className="input resize-y leading-relaxed"
            />
            <p className="mt-1 text-[11px] text-slate-500">{c.aide}</p>
          </div>
        );
      })}
      <Retour etat={etat} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={enCours} className="btn-ghost px-3 py-2 text-xs">
          {enCours ? "Enregistrement…" : `Enregistrer le script « ${s.libelle} »`}
        </button>
        <span className="text-[11px] text-slate-500">{CHAMP_SCRIPT_MAX} caractères au plus par champ.</span>
      </div>
    </form>
  );
}
