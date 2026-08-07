"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  importProspectsAction,
  type ImportRow,
  type ImportResult,
} from "@/app/actions";
import {
  parseCsv,
  guessMapping,
  IMPORT_FIELDS,
  type ImportFieldKey,
} from "@/lib/csv";
import type { Profile } from "@/lib/types";

type Members = Pick<Profile, "id" | "full_name" | "email">[];

export function ImportWizard({
  members,
  currentUserId,
}: {
  members: Members;
  currentUserId: string;
}) {
  const [fileName, setFileName] = useState<string>();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, ImportFieldKey | "">>({});
  const [owner, setOwner] = useState(currentUserId);
  const [result, setResult] = useState<ImportResult>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(undefined);
    setResult(undefined);

    try {
      const text = await file.text();
      const table = parseCsv(text);

      if (table.headers.length === 0 || table.rows.length === 0) {
        setError("Le fichier semble vide ou illisible.");
        return;
      }

      setFileName(file.name);
      setHeaders(table.headers);
      setRows(table.rows);
      setMapping(guessMapping(table.headers));
    } catch {
      setError("Impossible de lire ce fichier. Exportez-le au format CSV.");
    }
  }

  const mapped = Object.values(mapping).filter(Boolean) as ImportFieldKey[];
  const hasCompany = mapped.includes("company_name");

  function buildRows(): ImportRow[] {
    return rows.map((cells) => {
      const row: ImportRow = {};
      Object.entries(mapping).forEach(([indexStr, field]) => {
        if (!field) return;
        const value = cells[Number(indexStr)];
        if (value !== undefined) row[field] = value;
      });
      return row;
    });
  }

  function submit() {
    setError(undefined);
    startTransition(async () => {
      const res = await importProspectsAction(buildRows(), owner);
      setResult(res);
    });
  }

  // ---------------------------------------------------------------- résultat
  if (result && !result.error) {
    return (
      <div className="card max-w-2xl p-6">
        <h2 className="font-display text-lg font-semibold text-slate-50">
          Import terminé
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          <span className="text-emerald-300">{result.inserted}</span> fiche
          {result.inserted > 1 ? "s" : ""} créée{result.inserted > 1 ? "s" : ""}
          {result.skipped > 0 && (
            <>
              {" · "}
              <span className="text-amber-300">{result.skipped}</span> ignorée
              {result.skipped > 1 ? "s" : ""}
            </>
          )}
        </p>

        {result.reasons.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
              Voir pourquoi certaines lignes ont été ignorées
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-slate-400">
              {result.reasons.map((r, i) => (
                <li key={i}>• {r}</li>
              ))}
            </ul>
          </details>
        )}

        <div className="mt-6 flex gap-2">
          <Link href="/prospects" className="btn-primary">
            Voir les prospects
          </Link>
          <button
            onClick={() => {
              setResult(undefined);
              setHeaders([]);
              setRows([]);
              setFileName(undefined);
            }}
            className="btn-ghost"
          >
            Importer un autre fichier
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------ 1. fichier */}
      <div className="card max-w-3xl p-6">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
          1 · Choisir le fichier
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Un fichier <span className="text-slate-200">.csv</span> avec une ligne
          d&apos;en-tête. Depuis Excel : Fichier → Enregistrer sous → CSV. Le
          séparateur (virgule ou point-virgule) est détecté automatiquement.
        </p>

        <label className="mt-4 flex cursor-pointer items-center gap-3">
          <span className="btn-ghost">Parcourir…</span>
          <span className="text-sm text-slate-400">
            {fileName ?? "Aucun fichier sélectionné"}
          </span>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={onFile}
            className="hidden"
          />
        </label>

        {error && (
          <p className="mt-4 rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-300 ring-1 ring-rose-400/20">
            {error}
          </p>
        )}
        {result?.error && (
          <p className="mt-4 rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-300 ring-1 ring-rose-400/20">
            {result.error}
          </p>
        )}
      </div>

      {/* ---------------------------------------------- 2. correspondances */}
      {headers.length > 0 && (
        <>
          <div className="card max-w-3xl p-6">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              2 · Vérifier les colonnes
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              {rows.length} ligne{rows.length > 1 ? "s" : ""} détectée
              {rows.length > 1 ? "s" : ""}. J&apos;ai deviné les correspondances —
              corrigez si besoin, ou laissez « Ignorer ».
            </p>

            <div className="mt-5 space-y-2.5">
              {headers.map((header, index) => (
                <div key={index} className="flex flex-wrap items-center gap-3">
                  <span className="min-w-[160px] truncate text-sm text-slate-300">
                    {header || <em className="text-slate-600">colonne {index + 1}</em>}
                  </span>
                  <span className="text-slate-600">→</span>
                  <select
                    value={mapping[index] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => ({
                        ...m,
                        [index]: e.target.value as ImportFieldKey | "",
                      }))
                    }
                    className="input max-w-[240px] py-1.5 text-xs"
                  >
                    <option value="">Ignorer cette colonne</option>
                    {IMPORT_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                        {f.required ? " *" : ""}
                      </option>
                    ))}
                  </select>
                  <span className="truncate text-xs text-slate-600">
                    ex. {rows[0]?.[index]?.slice(0, 30) || "—"}
                  </span>
                </div>
              ))}
            </div>

            {!hasCompany && (
              <p className="mt-5 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-300 ring-1 ring-amber-400/20">
                Indiquez quelle colonne contient le nom de la société — c&apos;est le
                seul champ obligatoire.
              </p>
            )}

            <div className="mt-6">
              <label className="label" htmlFor="owner">
                Assigner ces fiches à
              </label>
              <select
                id="owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="input max-w-sm"
              >
                <option value="none">Personne (vivier partagé)</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name ?? m.email}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ------------------------------------------------- 3. aperçu */}
          <div className="card p-6">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-slate-400">
              3 · Aperçu
            </h2>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="border-b border-white/[0.06]">
                  <tr>
                    {mapped.map((field) => (
                      <th key={field} className="th">
                        {IMPORT_FIELDS.find((f) => f.key === field)?.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {buildRows()
                    .slice(0, 5)
                    .map((row, i) => (
                      <tr key={i}>
                        {mapped.map((field) => (
                          <td key={field} className="td max-w-[220px] truncate">
                            {row[field] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {rows.length > 5 && (
              <p className="mt-3 text-xs text-slate-500">
                … et {rows.length - 5} autre{rows.length - 5 > 1 ? "s" : ""} ligne
                {rows.length - 5 > 1 ? "s" : ""}.
              </p>
            )}

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={submit}
                disabled={!hasCompany || pending}
                className="btn-primary"
              >
                {pending ? "Import en cours…" : `Importer ${rows.length} fiche${rows.length > 1 ? "s" : ""}`}
              </button>
              <span className="text-xs text-slate-500">
                Les lignes dont l&apos;email existe déjà sont ignorées.
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
