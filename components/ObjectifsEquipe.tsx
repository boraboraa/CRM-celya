"use client";

import { useState, useTransition } from "react";
import { poserObjectifsAction } from "@/app/actions";
import { OBJECTIFS_PROPOSES } from "@/lib/crm/compteurs";

type Valeurs = { appels: string; reponses: string; rdv: string; essais: string };
export type LigneObjectifs = {
  userId: string;
  nom: string;
  /** Encadré par quelqu'un — un étudiant (« appliquer à tous les étudiants »). */
  etudiant: boolean;
  /** Les objectifs déjà posés, par semaine (« YYYY-MM-DD » du lundi). */
  parSemaine: Record<string, { appels: number; reponses: number; rdv: number }>;
  /** L'objectif d'essais de la période, s'il est posé. */
  essais: number | null;
};

const vide: Valeurs = { appels: "", reponses: "", rdv: "", essais: "" };
const CHAMPS: [keyof Valeurs, string][] = [
  ["appels", "Appels"],
  ["reponses", "Réponses"],
  ["rdv", "RDV"],
  ["essais", "Essais (période)"],
];

/**
 * Les objectifs — saisis par l'ADMIN dans /equipe (27/10). Par personne : la
 * semaine (appels, réponses, RDV) et la période (essais, depuis le 2/11).
 * « Appliquer à tous les étudiants » recopie la ligne modèle sur chaque
 * commercial encadré. Une ligne laissée vide n'est pas enregistrée — et sans
 * objectif, on n'est pas au classement.
 *
 * Les valeurs proposées (60 · 15 · 3 · 2) ne sont que celles du formulaire :
 * Bora les ajuste ; la base, elle, ne connaît aucune valeur par défaut.
 */
export function ObjectifsEquipe({
  lignes,
  semaines,
}: {
  lignes: LigneObjectifs[];
  /** [lundi, libellé] — cette semaine, la suivante. */
  semaines: [string, string][];
}) {
  const [semaine, setSemaine] = useState(semaines[0][0]);
  const depuisBase = (s: string) =>
    Object.fromEntries(
      lignes.map((l) => {
        const o = l.parSemaine[s];
        return [
          l.userId,
          {
            appels: o ? String(o.appels) : "",
            reponses: o ? String(o.reponses) : "",
            rdv: o ? String(o.rdv) : "",
            essais: l.essais != null ? String(l.essais) : "",
          },
        ];
      })
    ) as Record<string, Valeurs>;
  const [valeurs, setValeurs] = useState<Record<string, Valeurs>>(() => depuisBase(semaines[0][0]));
  const [modele, setModele] = useState<Valeurs>({
    appels: String(OBJECTIFS_PROPOSES.appels),
    reponses: String(OBJECTIFS_PROPOSES.reponses),
    rdv: String(OBJECTIFS_PROPOSES.rdv),
    essais: String(OBJECTIFS_PROPOSES.essaisPeriode),
  });
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const etudiants = lignes.filter((l) => l.etudiant);

  function changerSemaine(s: string) {
    setSemaine(s);
    setValeurs(depuisBase(s));
    setMessage(null);
  }

  function enregistrer() {
    setMessage(null);
    const aEnvoyer = lignes
      .map((l) => ({ userId: l.userId, ...(valeurs[l.userId] ?? vide) }))
      .filter((v) => v.appels || v.reponses || v.rdv || v.essais);
    startTransition(async () => {
      const r = await poserObjectifsAction({
        semaine,
        lignes: aEnvoyer.map((v) => ({
          userId: v.userId,
          appels: v.appels === "" ? null : Number(v.appels),
          reponses: v.reponses === "" ? null : Number(v.reponses),
          rdv: v.rdv === "" ? null : Number(v.rdv),
          essais: v.essais === "" ? null : Number(v.essais),
        })),
      });
      setMessage(r.error ? { ok: false, texte: r.error } : { ok: true, texte: r.success ?? "Enregistré." });
    });
  }

  const champ = (v: string, onChange: (x: string) => void, label: string) => (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={10000}
      value={v}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="input min-h-[44px] w-full px-2 py-1.5 text-right tabular-nums"
    />
  );

  return (
    <section aria-labelledby="objectifs-equipe" className="card mb-6 max-w-4xl p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="objectifs-equipe" className="text-sm font-semibold text-slate-100">
          Objectifs
        </h2>
        <div className="flex rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/10" role="group" aria-label="Semaine">
          {semaines.map(([s, label]) => (
            <button
              key={s}
              type="button"
              onClick={() => changerSemaine(s)}
              aria-pressed={semaine === s}
              className={`min-h-[44px] rounded-lg px-3 text-xs transition ${
                semaine === s ? "bg-white/[0.09] text-slate-50 ring-1 ring-white/15" : "text-slate-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Appels, réponses et RDV : pour la semaine choisie. Essais : sur toute la période du Sales Trophy. Une
        ligne vide n&apos;est pas enregistrée — sans objectif, on n&apos;est pas au classement.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr>
              <th className="th">Personne</th>
              {CHAMPS.map(([k, l]) => (
                <th key={k} className="th w-24 text-right">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            <tr className="bg-white/[0.02]">
              <td className="td text-xs text-slate-400">
                Modèle
                {etudiants.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setValeurs((v) => {
                        const n = { ...v };
                        for (const e of etudiants) n[e.userId] = { ...modele };
                        return n;
                      })
                    }
                    className="btn-link ml-2 min-h-[44px] text-xs"
                  >
                    Appliquer à tous les étudiants ({etudiants.length})
                  </button>
                )}
              </td>
              {CHAMPS.map(([k, l]) => (
                <td key={k} className="td">
                  {champ(modele[k], (x) => setModele((m) => ({ ...m, [k]: x })), `Modèle — ${l}`)}
                </td>
              ))}
            </tr>
            {lignes.map((l) => (
              <tr key={l.userId}>
                <td className="td">
                  <span className="font-medium text-slate-100">{l.nom}</span>
                  {l.etudiant && <span className="ml-1.5 text-[11px] text-slate-500">étudiant</span>}
                </td>
                {CHAMPS.map(([k, lab]) => (
                  <td key={k} className="td">
                    {champ(
                      valeurs[l.userId]?.[k] ?? "",
                      (x) => setValeurs((v) => ({ ...v, [l.userId]: { ...(v[l.userId] ?? vide), [k]: x } })),
                      `${l.nom} — ${lab}`
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={enregistrer} disabled={pending} className="btn-primary min-h-[44px]">
          {pending ? "Enregistrement…" : "Enregistrer les objectifs"}
        </button>
        {message && (
          <span role="status" className={`text-xs ${message.ok ? "text-emerald-300" : "text-rose-300"}`}>
            {message.texte}
          </span>
        )}
      </div>
    </section>
  );
}
