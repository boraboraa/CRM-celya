/**
 * Lecture de CSV côté navigateur.
 * Gère les guillemets, les retours à la ligne dans les cellules, le BOM Excel,
 * et détecte automatiquement le séparateur (Excel FR/BE exporte en « ; »).
 */

export type CsvTable = { headers: string[]; rows: string[][] };

export function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const candidates = [";", ",", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    // On compte hors guillemets pour ne pas se faire piéger par « Dupont, Marie »
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

export function parseCsv(input: string, delimiter?: string): CsvTable {
  const text = input.replace(/^﻿/, "");
  const d = delimiter ?? detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === d) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const cleaned = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (cleaned.length === 0) return { headers: [], rows: [] };

  const headers = cleaned[0].map((h) => h.trim());
  return { headers, rows: cleaned.slice(1) };
}

/** Champs du CRM qu'une colonne du fichier peut alimenter. */
export const IMPORT_FIELDS = [
  { key: "company_name", label: "Société", required: true },
  { key: "contact_name", label: "Personne de contact", required: false },
  { key: "email", label: "Email", required: false },
  { key: "phone", label: "Téléphone", required: false },
  { key: "website", label: "Site web", required: false },
  { key: "sector", label: "Secteur", required: false },
  { key: "city", label: "Ville", required: false },
  { key: "status", label: "Statut", required: false },
  { key: "source", label: "Source", required: false },
  { key: "value_estimate", label: "Valeur estimée", required: false },
  { key: "notes", label: "Notes", required: false },
] as const;

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

/** Synonymes FR/EN/NL rencontrés dans les exports habituels. */
const ALIASES: Record<ImportFieldKey, string[]> = {
  company_name: [
    "societe", "société", "company", "companyname", "entreprise", "raisonsociale",
    "nom", "name", "organisation", "organization", "bedrijf", "client",
  ],
  contact_name: [
    "contact", "contactname", "personnedecontact", "interlocuteur", "prenomnom",
    "nomcontact", "fullname", "responsable",
  ],
  email: ["email", "mail", "courriel", "adresseemail", "emailaddress", "e-mail"],
  phone: ["telephone", "téléphone", "tel", "phone", "gsm", "mobile", "phonenumber", "numero"],
  website: ["site", "siteweb", "website", "url", "web", "domaine"],
  sector: ["secteur", "sector", "industrie", "industry", "activite", "activité", "branche"],
  city: ["ville", "city", "localite", "localité", "commune", "stad"],
  status: ["statut", "status", "etape", "étape", "stage", "phase"],
  source: ["source", "origine", "provenance", "canal"],
  value_estimate: [
    "valeur", "value", "montant", "amount", "budget", "ca", "chiffreaffaires", "prix",
  ],
  notes: ["notes", "note", "commentaire", "commentaires", "remarque", "remarques", "description"],
};

const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

/** Devine la correspondance colonne du fichier → champ du CRM. */
export function guessMapping(headers: string[]): Record<number, ImportFieldKey | ""> {
  const mapping: Record<number, ImportFieldKey | ""> = {};
  const taken = new Set<ImportFieldKey>();

  headers.forEach((header, index) => {
    const h = normalise(header);
    mapping[index] = "";
    if (!h) return;

    for (const [field, aliases] of Object.entries(ALIASES) as [
      ImportFieldKey,
      string[],
    ][]) {
      if (taken.has(field)) continue;
      if (aliases.some((a) => h === normalise(a))) {
        mapping[index] = field;
        taken.add(field);
        return;
      }
    }

    // Deuxième passe, plus permissive : correspondance partielle.
    for (const [field, aliases] of Object.entries(ALIASES) as [
      ImportFieldKey,
      string[],
    ][]) {
      if (taken.has(field)) continue;
      if (aliases.some((a) => h.includes(normalise(a)))) {
        mapping[index] = field;
        taken.add(field);
        return;
      }
    }
  });

  return mapping;
}
