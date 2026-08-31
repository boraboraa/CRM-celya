/**
 * Table de cas du parseur de raccourcis — exécutable sans framework :
 *
 *   node --experimental-strip-types lib/crm/raccourcis.test.ts
 *
 * (script npm : `npm run test:raccourcis`). Les entrées marquées « réelle »
 * viennent de notes réellement dictées — dont celle qui a perdu le rendez-vous
 * du 31/08. Le parseur est PUR : l'instant courant est passé en paramètre,
 * chaque cas fixe le sien.
 */

import { lireRaccourcis, type Raccourci } from "./raccourcis.ts";

type Attendu = Partial<Omit<Raccourci, "segments">>;

type Cas = {
  note: string;
  /** « YYYY-MM-DDTHH:mm » local — l'instant du test. */
  maintenant: string;
  attendu: Attendu;
  /** Champs qui doivent être ABSENTS. */
  absents?: ("rdv" | "relance" | "sansReponse" | "propositionEnvoyee" | "contact" | "suggestionPerdu")[];
};

// Le 2026-08-01 est un samedi ; le 2026-08-04 un mardi ; le 2026-08-31 un lundi.
const CAS: Cas[] = [
  // --- réelle : la note qui a perdu le RDV du 31/08. L'heure est lue, le
  // lieu est lu, et le JOUR MANQUE — jamais complété en silence.
  {
    note: "rdv 11H eghéeze chaussée de namur 393",
    maintenant: "2026-08-31T08:00",
    attendu: {
      rdv: { debut: "11:00", lieu: "eghéeze chaussée de namur 393", manque: "jour" },
    },
    absents: ["relance", "sansReponse"],
  },
  // --- réelle : jour explicite + heure. Le 20 août 2026 est un jeudi.
  {
    note: "RDV jeudi 20 août 14h",
    maintenant: "2026-08-01T08:00",
    attendu: { rdv: { debut: "2026-08-20T14:00" } },
  },
  // --- réelle : une relance a un jour, jamais d'heure (09:00 par défaut).
  {
    note: "à rappeler lundi",
    maintenant: "2026-08-04T08:00",
    attendu: { relance: { date: "2026-08-10" } },
    absents: ["rdv"],
  },
  // --- réelle : demain + heure + durée.
  {
    note: "rdv demain 9h30 1h",
    maintenant: "2026-08-31T08:00",
    attendu: { rdv: { debut: "2026-09-01T09:30", fin: "2026-09-01T10:30" } },
  },
  // --- réelle : date numérique + durée 1h30.
  {
    note: "rdv 3/9 14h30 1h30",
    maintenant: "2026-08-31T08:00",
    attendu: { rdv: { debut: "2026-09-03T14:30", fin: "2026-09-03T16:00" } },
  },
  // --- réelle : « pdr » = appelé, pas de réponse. « rappellera » n'est PAS
  // un déclencheur de relance (il faudrait « rappeler » entier).
  {
    note: "appelé pdr, la gérante rappellera",
    maintenant: "2026-08-31T08:00",
    attendu: { sansReponse: true },
    absents: ["rdv", "relance"],
  },
  // --- plage horaire : « 11h-12h ».
  {
    note: "rdv mardi 11h-12h",
    maintenant: "2026-08-31T08:00",
    attendu: { rdv: { debut: "2026-09-01T11:00", fin: "2026-09-01T12:00" } },
  },
  // --- un jour SANS heure : un rendez-vous a toujours une heure.
  {
    note: "rdv jeudi",
    maintenant: "2026-08-31T08:00",
    attendu: { rdv: { debut: "2026-09-03", manque: "heure" } },
  },
  // --- l'heure en lettres (dictée vocale) + « midi ».
  {
    note: "rdv demain onze heures trente",
    maintenant: "2026-08-31T08:00",
    attendu: { rdv: { debut: "2026-09-01T11:30" } },
  },
  {
    note: "rdv vendredi midi chez Marchal",
    maintenant: "2026-08-31T08:00",
    attendu: { rdv: { debut: "2026-09-04T12:00", lieu: "chez Marchal" } },
  },
  // --- proposition envoyée, contact, perte (suggestion SEULE).
  {
    note: "devis envoyé au gérant",
    maintenant: "2026-08-31T08:00",
    attendu: { propositionEnvoyee: true },
  },
  {
    note: "le gérant c'est Marc",
    maintenant: "2026-08-31T08:00",
    attendu: { contact: "Marc" },
  },
  {
    note: "pas intéressé, bosse déjà avec un concurrent",
    maintenant: "2026-08-31T08:00",
    attendu: { suggestionPerdu: { motif: "pas intéressé" } },
    absents: ["rdv", "relance", "contact"],
  },
  // --- « 3/8 » sans année et déjà passé → l'occurrence suivante (2027).
  {
    note: "rdv 3/8 10h",
    maintenant: "2026-08-31T08:00",
    attendu: { rdv: { debut: "2027-08-03T10:00" } },
  },
  // --- année explicite : le passé est permis, on ne roule pas.
  {
    note: "rappeler le 3/8/2026",
    maintenant: "2026-08-31T08:00",
    attendu: { relance: { date: "2026-08-03" } },
  },
  // --- « 1er septembre » + minuscule « 14h00 ».
  {
    note: "rdv 1er septembre 14h00 à la brasserie",
    maintenant: "2026-08-31T08:00",
    attendu: { rdv: { debut: "2026-09-01T14:00", lieu: "la brasserie" } },
  },
  // --- texte libre sans raccourci : rien ne sort.
  {
    note: "belle vitrine, à revoir un de ces jours",
    maintenant: "2026-08-31T08:00",
    attendu: {},
    absents: ["rdv", "relance", "sansReponse", "propositionEnvoyee", "suggestionPerdu"],
  },
  // --- le déclencheur seul : on demande le jour, on ne devine rien.
  {
    note: "rdv à caler",
    maintenant: "2026-08-31T08:00",
    attendu: { rdv: { debut: "", manque: "jour" } },
  },
];

// ---------------------------------------------------------------------------

let echecs = 0;

function verifie(nom: string, obtenu: unknown, attendu: unknown) {
  const o = JSON.stringify(obtenu);
  const a = JSON.stringify(attendu);
  if (o !== a) {
    echecs++;
    console.error(`  ✗ ${nom}\n      attendu ${a}\n      obtenu  ${o}`);
  }
}

for (const cas of CAS) {
  const maintenant = new Date(cas.maintenant);
  const r = lireRaccourcis(cas.note, maintenant);
  const avant = echecs;

  for (const [cle, attendu] of Object.entries(cas.attendu)) {
    if (cle === "rdv") {
      const rdv = r.rdv as Record<string, unknown> | undefined;
      const att = attendu as Record<string, unknown>;
      verifie("rdv présent", Boolean(rdv), true);
      if (rdv) {
        verifie("rdv.debut", rdv.debut, att.debut);
        if ("fin" in att) verifie("rdv.fin", rdv.fin, att.fin);
        if ("lieu" in att) verifie("rdv.lieu", rdv.lieu, att.lieu);
        verifie("rdv.manque", rdv.manque, att.manque);
      }
    } else if (cle === "suggestionPerdu") {
      verifie("suggestionPerdu présent", Boolean(r.suggestionPerdu), true);
      const motifAttendu = (attendu as { motif?: string }).motif;
      if (motifAttendu && r.suggestionPerdu?.motif) {
        verifie(
          "motif contient le déclencheur",
          r.suggestionPerdu.motif.includes(motifAttendu),
          true
        );
      }
    } else {
      verifie(cle, (r as unknown as Record<string, unknown>)[cle], attendu);
    }
  }
  for (const absent of cas.absents ?? []) {
    verifie(
      `${absent} absent`,
      (r as unknown as Record<string, unknown>)[absent] === undefined,
      true
    );
  }

  // Les segments pointent le texte D'ORIGINE : chaque plage doit être valide.
  for (const s of r.segments) {
    verifie(
      `segment ${s.role} borné`,
      s.debut >= 0 && s.fin > s.debut && s.fin <= cas.note.length,
      true
    );
  }

  console.log(`${echecs === avant ? "✓" : "✗"} « ${cas.note} »`);
}

if (echecs > 0) {
  console.error(`\n${echecs} vérification(s) en échec.`);
  process.exit(1);
}
console.log(`\nTous les cas passent (${CAS.length}).`);
