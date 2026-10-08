/**
 * L'annexe d'appel de Janet, DE BOUT EN BOUT, contre un faux serveur Live
 * local (lib/appelsIa/faux-live/serveur.ts) :
 *
 *   node --experimental-strip-types lib/appelsIa/faux-live.test.ts
 *   (npm run test:appels-live)
 *
 * Ce qui tourne pour de vrai : le cœur de l'annexe (`menerAppel`, partagé avec
 * l'edge function Deno), `fetch` et le client `ws` avec en-têtes, de vrais
 * minuteurs (plafonds courts), les fonctions pures des outils (`lireArguments`,
 * `creneauxLibres`, `refusRdv`, `lireDeclaration`), la relecture du rapport
 * par Next (`lireRapport`, signature HMAC), et le plan de fin (`planifierFin`).
 * Ce qui est simulé : OpenAI (le faux serveur) et la base (un exécuteur
 * d'outils EN MÉMOIRE qui enregistre ce qui serait écrit — l'agenda,
 * l'opposition).
 *
 * L'horloge du cœur est FIGÉE au mercredi 7 octobre 2026, 10h (Bruxelles), et
 * avance au rythme réel : les créneaux, les essais et les relances sont donc
 * déterministes, quel que soit le jour où l'on rejoue le test.
 *
 * Aucun appel réseau sortant : tout passe par 127.0.0.1.
 */

import { randomUUID } from "node:crypto";
import { WebSocket, type RawData } from "ws";
import { menerAppel, type DependancesAnnexe, type ParametresAppel } from "../../supabase/functions/_shared/appels/annexe.ts";
import { finLisible, lireRapport, type RapportAppel } from "../../supabase/functions/_shared/appels/rapport.ts";
import { signer, verifierSignature, ENTETE_SIGNATURE, ENTETE_TS } from "../../supabase/functions/_shared/appels/signature.ts";
import { assemblerInstructions, instructionsDelegation, PREMIERE_PHRASE } from "./instructions.ts";
import { creneauxLibres, definitionsOutils, lireArguments, refusRdv, type Occupation } from "./outils.ts";
import { lireDeclaration, type Declaration } from "./resultat.ts";
import { planifierFin, type ContexteFin, type PlanFin } from "./planFin.ts";
import { prochainEssai } from "./cycle.ts";
import { FENETRE_DEFAUT, instantBruxelles, jourHeureFr } from "./calendrier.ts";
import { demarrerFauxLive, type FauxLive, type Json, type Scenario, type SessionFausse } from "./faux-live/serveur.ts";
import { verifie, vrai, bilan } from "./verifie.ts";

const DEBUT_TEST = Date.now();
const CLE = "sk-test-faux-live";
const NUMERO = "+3281223344";
const SECRET_INTERNE = "secret-interne-de-test";
/** Mercredi 7 octobre 2026, 10h00, heure de Bruxelles. */
const BASE = instantBruxelles("2026-10-07", 10 * 60).getTime();

/** Un fichier de test qui ne se termine pas est une faute : on coupe à 60 s. */
const garde = setTimeout(() => {
  console.error("  ✗ le test a dépassé 60 s");
  process.exit(1);
}, 60_000);
garde.unref();

// ---------------------------------------------------------------------------
// La session que Next prépare (même forme que preparerSession, moteur.ts)
// ---------------------------------------------------------------------------

const SESSION: Json = {
  model: "gpt-live-1",
  instructions: assemblerInstructions({
    script: null,
    brief: "Ce que fait l'entreprise : Garage à Namur (fiche, 07/10/2026)",
    variables: {
      societe: "Garage Dupont",
      secteur: "garage",
      ville: "Namur",
      contact: null,
      essai: 1,
      essaisPrecedents: [],
      dejaContacte: false,
      aujourdhui: "mercredi 7 octobre 2026",
    },
  }),
  audio: { output: { voice: "gleam" } },
  delegation: {
    type: "responses",
    responses: {
      model: "gpt-5.6-luna",
      instructions: instructionsDelegation(),
      tools: definitionsOutils(),
      tool_choice: "auto",
      parallel_tool_calls: false,
    },
  },
};

// ---------------------------------------------------------------------------
// La base, en mémoire : l'agenda du propriétaire, l'opposition
// ---------------------------------------------------------------------------

type RdvEnregistre = { debut: string; libelle: string; interlocuteur: string | null; email: string | null; notes: string | null };

type Memoire = {
  /** L'agenda du propriétaire de la fiche (rendez-vous existants + posés). */
  agenda: Occupation[];
  rdvPoses: RdvEnregistre[];
  oppositions: { numero: string; motif: string | null }[];
  declarations: Declaration[];
  finMotifs: string[];
  /** Tous les noms d'outil reçus, refusés compris. */
  recus: string[];
};

function nouvelleMemoire(): Memoire {
  return {
    // Bora a déjà un rendez-vous jeudi 8 octobre de 9h30 à 10h30.
    agenda: [{ debut: instantBruxelles("2026-10-08", 9 * 60 + 30), fin: instantBruxelles("2026-10-08", 10 * 60 + 30) }],
    rdvPoses: [],
    oppositions: [],
    declarations: [],
    finMotifs: [],
    recus: [],
  };
}

const instantLocal = (debut: string): Date => {
  const [jour, heure] = debut.split("T");
  const [h, m] = heure.split(":").map(Number);
  return instantBruxelles(jour, h * 60 + m);
};

/**
 * L'exécuteur d'outils EN MÉMOIRE — le pendant de `executerOutilServeur`
 * (lib/appelsIa/outilsServeur.ts), sur les mêmes fonctions pures, qui
 * enregistre ce qui serait écrit au lieu de l'écrire.
 */
function executeur(m: Memoire, horloge: () => Date) {
  return async (nom: string, brut: unknown): Promise<Json> => {
    m.recus.push(nom);
    const lu = lireArguments(nom, brut);
    if (!lu.ok) return { ok: false, erreur: lu.erreur };
    const maintenant = horloge();
    switch (lu.nom) {
      case "creneaux": {
        const libres = creneauxLibres(m.agenda, maintenant, { fenetre: FENETRE_DEFAUT, jourSouhaite: lu.args.jour, moment: lu.args.moment });
        if (!libres.length) return { ok: true, creneaux: [], consigne: "Aucun créneau libre : dites que le responsable rappellera." };
        return { ok: true, creneaux: libres, consigne: "Proposez deux de ces créneaux. Pour réserver, appelez rdv avec le « debut » exact." };
      }
      case "rdv": {
        const refus = refusRdv(lu.args.debut, m.agenda, maintenant, FENETRE_DEFAUT);
        if (refus) return { ok: false, erreur: refus };
        const debut = instantLocal(lu.args.debut);
        const libelle = jourHeureFr(debut);
        m.rdvPoses.push({ debut: lu.args.debut, libelle, interlocuteur: lu.args.interlocuteur, email: lu.args.email, notes: lu.args.notes });
        m.agenda.push({ debut, fin: new Date(debut.getTime() + 30 * 60_000) });
        return { ok: true, libelle, consigne: `Confirmez : démonstration de 30 minutes le ${libelle}. Puis notez le résultat, saluez, et terminez.` };
      }
      case "opposition":
        m.oppositions.push({ numero: NUMERO, motif: lu.args.motif });
        return { ok: true, consigne: "C'est noté. Excusez-vous en une phrase, saluez, puis appelez fin_appel." };
      case "noter_resultat": {
        const d = lireDeclaration(lu.args);
        if (!d) return { ok: false, erreur: "Il faut resultat (interesse, rappeler, refus ou barrage), resume et decideur." };
        m.declarations.push(d);
        return { ok: true, consigne: "Noté. Saluez la personne, puis appelez fin_appel avec le motif conversation_terminee." };
      }
      case "fin_appel":
        m.finMotifs.push(lu.args.motif);
        return { ok: true };
    }
  };
}

// ---------------------------------------------------------------------------
// Un appel : le vrai cœur de l'annexe, contre le faux serveur
// ---------------------------------------------------------------------------

type Issue = {
  rapport: RapportAppel;
  /** Le rapport tel que Next le relit (/api/appels-ia/fin). */
  relu: RapportAppel;
  session: SessionFausse | null;
  memoire: Memoire;
  statuts: string[];
  horloge: () => Date;
  /** Minuteries armées par l'annexe et encore vivantes après la fin. */
  minuteriesVivantes: () => number;
  dureeMs: number;
};

async function appeler(faux: FauxLive, scenario: Scenario, o: { cle?: string } = {}): Promise<Issue> {
  faux.prochain(scenario);
  const sessionsAvant = faux.sessions.length;
  const debutReel = Date.now();
  const horloge = () => new Date(BASE + (Date.now() - debutReel));
  const memoire = nouvelleMemoire();
  const statuts: string[] = [];
  const vivantes = new Set<ReturnType<typeof setTimeout>>();
  const outil = executeur(memoire, horloge);

  const p: ParametresAppel = {
    appelId: randomUUID(),
    apiBase: faux.apiBase,
    wsBase: faux.wsBase,
    cleApi: o.cle ?? CLE,
    session: SESSION,
    destination: NUMERO,
    trunk: { providerUrl: "sips:sip.telnyx.com:5061", identifiant: "celya-sip", motDePasse: "mot-de-passe-sip", numeroAppelant: "+32480000000" },
    plafondS: 20,
    sonnerieMaxS: 15,
    silenceMaxS: 4,
    conclureAvantS: 5,
    ageWorkerS: 3,
  };
  const d: DependancesAnnexe = {
    fetch: globalThis.fetch,
    ouvrirSocket(url, entetes, g) {
      const ws = new WebSocket(url, { headers: entetes });
      ws.on("open", () => g.ouvert());
      ws.on("message", (data: RawData) => g.message(String(data)));
      ws.on("close", (code: number, raison: Buffer) => g.ferme(code, raison.toString("utf8")));
      ws.on("error", (e: Error) => g.erreur(e));
      return {
        envoyer: (t) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(t);
        },
        fermer: () => ws.close(),
      };
    },
    maintenant: () => horloge().getTime(),
    minuterie(fn, ms) {
      const h = setTimeout(() => {
        vivantes.delete(h);
        fn();
      }, ms);
      vivantes.add(h);
      return h;
    },
    annuler(h) {
      clearTimeout(h as ReturnType<typeof setTimeout>);
      vivantes.delete(h as ReturnType<typeof setTimeout>);
    },
    journal: () => {},
    outil: (nom, args) => outil(nom, args),
    async statut(s) {
      statuts.push(s);
    },
  };

  const rapport = await menerAppel(p, d);
  const dureeMs = Date.now() - debutReel;
  const session = faux.sessions.length > sessionsAvant ? faux.sessions[faux.sessions.length - 1] : null;
  // Le serveur a fini de lire ce que l'annexe lui a envoyé.
  if (session) {
    let h: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([session.fermee, new Promise((r) => (h = setTimeout(r, 2_000)))]);
    clearTimeout(h);
  }

  // Ce que fait Next : le rapport arrive signé (HMAC), il est relu prudemment.
  const corps = JSON.stringify(rapport);
  const entetes = await signer(SECRET_INTERNE, corps);
  const signatureOk = await verifierSignature(SECRET_INTERNE, corps, entetes[ENTETE_TS], entetes[ENTETE_SIGNATURE]);
  if (!signatureOk) throw new Error("la signature du rapport ne se vérifie pas");
  const relu = lireRapport(JSON.parse(corps));
  if (!relu) throw new Error("rapport illisible par Next");

  return { rapport, relu, session, memoire, statuts, horloge, minuteriesVivantes: () => vivantes.size, dureeMs };
}

/** Le contexte de fin, comme lib/appelsIa/fin.ts le lit — ici depuis la mémoire. */
function contexte(
  i: Issue,
  o: Partial<Pick<ContexteFin, "machinesAnterieures" | "dejaHumain" | "pannesAvant" | "ligneProuveeDepuisEchec">> = {}
): ContexteFin {
  const maintenant = i.horloge();
  const rdv = i.memoire.rdvPoses[0] ?? null;
  return {
    appel: { id: i.relu.appelId, essai: 1, mode_test: false, file_id: "file-garage", prospect_id: "fiche-garage" },
    file: { id: "file-garage", campagneStatut: "active" },
    fiche: { id: "fiche-garage", company_name: "Garage Dupont" },
    rapport: i.relu,
    machinesAnterieures: o.machinesAnterieures ?? [],
    dejaHumain: o.dejaHumain ?? false,
    opposition: i.memoire.oppositions.some((x) => x.numero === NUMERO),
    rdvAVenir: i.memoire.rdvPoses.some((r) => instantLocal(r.debut).getTime() > maintenant.getTime()),
    rdvLibelle: rdv ? jourHeureFr(instantLocal(rdv.debut)) : null,
    pannesAvant: o.pannesAvant ?? 0,
    ligneProuveeDepuisEchec: o.ligneProuveeDepuisEchec ?? false,
    maintenant,
    fenetre: FENETRE_DEFAUT,
  };
}

const typesEvenements = (r: RapportAppel) => r.evenements.map((e) => e.type);
const texteDe = (r: RapportAppel, qui: "prospect" | "janet") => r.tours.filter((t) => t.qui === qui).map((t) => t.texte);
const fichePasAvant = (p: PlanFin) => (p.file && p.file.statut === "en_attente" ? p.file.pasAvant.toISOString() : null);

/** Ce qui reste commun à tout appel qui a été créé et attaché. */
function controlesCommuns(nom: string, i: Issue) {
  const s = i.session;
  vrai(`${nom} : une session créée, une attache avec « Authorization: Bearer … »`, Boolean(s) && s!.attaches.length === 1 && s!.attaches[0].autorisation === `Bearer ${CLE}`, s?.attaches);
  vrai(`${nom} : aucune anomalie dans le déroulé du faux serveur`, (s?.anomalies.length ?? 1) === 0, s?.anomalies);
  vrai(
    `${nom} : l'audio réfléchi est ignoré (aucun événement d'audio au rapport)`,
    !typesEvenements(i.rapport).some((t) => /audio/.test(t)),
    typesEvenements(i.rapport)
  );
  vrai(`${nom} : chaque raccroché porte la clé`, (s?.raccroches ?? []).every((r) => r.autorisation === `Bearer ${CLE}`), s?.raccroches);
  vrai(`${nom} : plus aucune minuterie de l'annexe ne vit après la fin`, i.minuteriesVivantes() === 0, i.minuteriesVivantes());
}

// ---------------------------------------------------------------------------
// Les scénarios
// ---------------------------------------------------------------------------

const decroche: Scenario["etapes"] = [
  { type: "evenement", ev: { type: "transport.ringing" } },
  { type: "pause", ms: 60 },
  { type: "evenement", ev: { type: "transport.answered" } },
];

const faux = await demarrerFauxLive({ cle: CLE, pasMs: 10 });
try {
  // =========================================================================
  // 1. Un appel complet : créneaux, rendez-vous, résultat, fin de conversation
  // =========================================================================
  const premierJeudi = (s: { parNom: Record<string, Json> }) => {
    const liste = ((s.parNom.creneaux?.creneaux ?? []) as { debut: string; libelle: string }[]).filter((c) => c.libelle.startsWith("jeudi"));
    return liste[0]?.debut ?? "creneau-absent";
  };
  const complet = await appeler(faux, {
    nom: "appel complet",
    secondesFacturees: 94,
    etapes: [
      ...decroche,
      { type: "audio", trames: 3 },
      { type: "audio", trames: 3, typeEnDernier: true },
      { type: "prospect", texte: "Allô ?" },
      { type: "janet", texte: `${PREMIERE_PHRASE} Est-ce que je parle au responsable du garage ?` },
      { type: "prospect", texte: "Oui, c'est Marc Dupont, le gérant. Je vous écoute." },
      { type: "janet", texte: "Quand l'atelier tourne, qui décroche le téléphone ?" },
      // Janet invente un outil : « constructor » n'en est pas un.
      { type: "outil", nom: "constructor", args: {} },
      { type: "audio", trames: 2 },
      { type: "prospect", texte: "Personne, on rate pas mal d'appels. Votre truc m'intéresse." },
      { type: "outil", nom: "creneaux", args: { moment: "indifferent" } },
      { type: "janet", texte: "Je peux vous proposer jeudi à onze heures ou jeudi à treize heures." },
      { type: "prospect", texte: "Jeudi neuf heures et demie, ce serait mieux." },
      // Un créneau qui ne vient pas de « creneaux » (Bora est déjà pris) : refusé.
      { type: "outil", nom: "rdv", args: { debut: "2026-10-08T09:30", interlocuteur: "Marc Dupont" } },
      { type: "janet", texte: "Ce créneau n'est plus libre. Onze heures vous irait ?" },
      { type: "prospect", texte: "Va pour onze heures." },
      { type: "outil", nom: "rdv", args: (s) => ({ debut: premierJeudi(s), interlocuteur: "Marc Dupont", notes: "Démo au téléphone" }) },
      {
        type: "outil",
        nom: "noter_resultat",
        args: {
          resultat: "interesse",
          resume: "Le gérant veut voir la démo jeudi",
          interlocuteur: "Marc Dupont, gérant",
          decideur: true,
          appris: "Personne ne décroche quand l'atelier tourne",
        },
      },
      { type: "janet", texte: "C'est noté : démonstration jeudi 8 octobre à 11h. Bonne journée !" },
      { type: "outil", nom: "fin_appel", args: { motif: "conversation_terminee" } },
      { type: "janet", texte: "Au revoir." },
    ],
  });
  {
    const i = complet;
    const r = i.rapport;
    const s = i.session!;
    controlesCommuns("appel complet", i);

    // La création : le corps exact attendu par GPT-Live.
    const creation = faux.creations[faux.creations.length - 1];
    const corps = creation.corps as { session?: Json; transport?: Json };
    const transport = (corps.transport ?? {}) as Json;
    const trunk = (transport.trunk ?? {}) as Json;
    vrai("création : « Authorization: Bearer … »", creation.autorisation === `Bearer ${CLE}`);
    vrai("création : PAS de « type: live » dans la session (il n'existe qu'à l'accept d'un entrant)", corps.session !== undefined && !("type" in (corps.session ?? {})), corps.session?.type);
    verifie("création : la session part telle que Next l'a préparée", corps.session, SESSION);
    verifie("création : transport SIP vers le numéro composé", [transport.type, transport.destination], ["sip", NUMERO]);
    verifie(
      "création : le trunk (URL, digest, numéro appelant)",
      trunk,
      {
        provider_url: "sips:sip.telnyx.com:5061",
        auth: { type: "digest", username: "celya-sip", password: "mot-de-passe-sip" },
        caller_number: "+32480000000",
      }
    );

    // Le déroulé.
    verifie("statuts visibles : composition, sonnerie, en ligne", i.statuts, ["composition", "sonnerie", "en_ligne"]);
    verifie("le rapport porte l'id de session du faux serveur", r.sessionId, s.id);
    vrai("sonnerie puis décroché datés", Boolean(r.sonnerieA && r.decrocheA && r.sonnerieA <= r.decrocheA));
    verifie("raccroché par l'annexe à la fin de la conversation", r.raccrochePar, "serveur_fin");
    verifie("fermeture demandée, facturation relevée", [r.raisonFermeture, r.factureS], ["close_requested", 94]);
    verifie("un seul raccroché envoyé", s.raccroches.length, 1);
    verifie(
      "les répliques du prospect, closes à chaque tour de Janet",
      texteDe(r, "prospect"),
      [
        "Allô ?",
        "Oui, c'est Marc Dupont, le gérant. Je vous écoute.",
        "Personne, on rate pas mal d'appels. Votre truc m'intéresse.",
        "Jeudi neuf heures et demie, ce serait mieux.",
        "Va pour onze heures.",
      ]
    );
    vrai("Janet s'est annoncée comme une IA dans sa première réplique", (texteDe(r, "janet")[0] ?? "").includes("intelligence artificielle"));
    // Deux phrases de Janet à moins de 900 ms l'une de l'autre (un appel
    // d'outil entre les deux) forment UNE réplique : la transcription GPT-Live
    // n'a pas de fin de tour, seul le silence ou l'autre voix en ferme une.
    vrai("la dernière phrase de Janet est bien au rapport", (texteDe(r, "janet").at(-1) ?? "").endsWith("Au revoir."), texteDe(r, "janet").at(-1));
    vrai(
      "deux phrases de Janet dans la même réplique restent séparées par une espace",
      !texteDe(r, "janet").some((t) => /[.!?…]\p{Lu}/u.test(t)),
      texteDe(r, "janet")
    );

    // Les outils : chacun a reçu sa réponse (sortie, puis response.create).
    verifie("six appels d'outil joués", s.outils.map((o) => o.nom), ["constructor", "creneaux", "rdv", "rdv", "noter_resultat", "fin_appel"]);
    vrai(
      "chaque outil a reçu sa sortie (response.item.create, function_call_output) puis response.create",
      s.outils.every((o) => o.reponseRecue && o.relanceRecue),
      s.outils.map((o) => [o.nom, o.reponseRecue, o.relanceRecue])
    );
    vrai(
      "les sorties partent par response.item.create, avec l'event_id de l'annexe",
      s.recus.filter((m) => m.type === "response.item.create").every((m) => String(m.event_id ?? "").startsWith("out_")),
      s.recus.filter((m) => m.type === "response.item.create").map((m) => m.event_id)
    );
    verifie(
      "« constructor » est refusé comme outil inconnu",
      s.outils[0].sortie,
      { ok: false, erreur: "Outil inconnu : constructor" }
    );
    verifie(
      "les créneaux respectent l'agenda (jeudi 9h30–10h30 pris, 2 h de délai, un matin et un après-midi)",
      ((s.outils[1].sortie?.creneaux ?? []) as { debut: string }[]).map((c) => c.debut),
      ["2026-10-07T13:00", "2026-10-08T11:00", "2026-10-08T13:00", "2026-10-09T09:30"]
    );
    verifie(
      "un rendez-vous sur un créneau déjà pris est refusé",
      s.outils[2].sortie,
      { ok: false, erreur: "Ce créneau vient d'être pris : redemandez les créneaux." }
    );
    verifie("le rendez-vous rendu par « creneaux » est posé", [s.outils[3].sortie?.ok, s.outils[3].sortie?.libelle], [true, "jeudi 8 octobre à 11h"]);
    verifie("« constructor » n'a rien écrit : seuls les vrais outils ont agi", [i.memoire.rdvPoses.length, i.memoire.oppositions.length, i.memoire.declarations.length, i.memoire.finMotifs], [1, 0, 1, ["conversation_terminee"]]);
    verifie(
      "l'agenda a reçu UN rendez-vous : jeudi 8 octobre à 11h, avec Marc Dupont",
      i.memoire.rdvPoses.map((x) => [x.debut, x.libelle, x.interlocuteur]),
      [["2026-10-08T11:00", "jeudi 8 octobre à 11h", "Marc Dupont"]]
    );
    verifie(
      "le rapport garde les outils dans l'ordre, arguments relus en objets",
      r.outils.map((o) => [o.nom, o.ok]),
      [["constructor", true], ["creneaux", true], ["rdv", true], ["rdv", true], ["noter_resultat", true], ["fin_appel", true]]
    );

    // Ce que Next en fait.
    vrai("fin lisible", finLisible(i.relu));
    const plan = planifierFin(contexte(i));
    verifie("classement : décroché par un humain", plan.appel.classement, "repondu_humain");
    verifie(
      "journal : intéressé, échange réel, sujet SANS préfixe « Appel IA · », contact = le décideur",
      plan.journal && [plan.journal.outcome, plan.journal.isExchange, plan.journal.sujet, plan.journal.contact, plan.journal.motifRefus],
      ["interesse", true, "Le gérant veut voir la démo jeudi", "Marc Dupont, gérant", null]
    );
    vrai("journal : le corps dit l'essai, la durée, la démo posée", Boolean(plan.journal?.corps.includes("essai 1/3") && plan.journal.corps.includes("Démonstration posée jeudi 8 octobre à 11h")), plan.journal?.corps);
    verifie("file : cycle terminé, « rendez-vous posé », essai 1 compté", plan.file && plan.file.statut !== "en_attente" ? [plan.file.statut, plan.file.motif, plan.file.essais] : plan.file, ["termine", "rendez-vous posé", 1]);
    verifie("aucune relance : le rendez-vous est la prochaine action", plan.relance, null);
    verifie("ligne apprise au brief", plan.appris?.texte, "Intéressé. Décideur : Marc Dupont, gérant. Personne ne décroche quand l'atelier tourne");
    verifie("pas de pause, l'appel suivant s'enchaîne", [plan.pause, plan.chainer], [null, true]);
    verifie("l'appel : terminé, interlocuteur et motif de Janet", [plan.appel.statut, plan.appel.interlocuteur, plan.appel.fin_motif_janet, plan.appel.erreur_cote], ["termine", "Marc Dupont, gérant", "conversation_terminee", null]);
  }

  // =========================================================================
  // 2. Un répondeur : l'annexe raccroche d'elle-même, sans un mot
  // =========================================================================
  const repondeur = await appeler(faux, {
    nom: "répondeur",
    secondesFacturees: 4,
    etapes: [
      ...decroche,
      { type: "audio", trames: 2, typeEnDernier: true },
      { type: "prospect", texte: "Bonjour, vous êtes bien sur la messagerie de Marc Dupont, je ne suis pas disponible, laissez un message après le bip." },
      // Jamais atteint : l'annexe a raccroché avant.
      { type: "pause", ms: 3_000 },
      { type: "janet", texte: "Bonjour, je suis Janet…" },
    ],
  });
  {
    const i = repondeur;
    const r = i.rapport;
    controlesCommuns("répondeur", i);
    verifie("le faux serveur a reçu le raccroché", i.session!.raccroches.length, 1);
    verifie("raccroché par l'annexe : machine reconnue en direct", [r.raccrochePar, r.machineEnDirect, r.raisonFermeture], ["serveur_machine", "repondeur", "close_requested"]);
    verifie("Janet n'a pas dit un mot", texteDe(r, "janet"), []);
    vrai("la messagerie n'a pas fini sa phrase (le scénario s'arrête au raccroché)", !texteDe(r, "prospect").join(" ").includes("bip"), texteDe(r, "prospect"));
    vrai("raccroché en moins de 3 s", i.dureeMs < 3_000, i.dureeMs);
    const plan = planifierFin(contexte(i));
    verifie("classement : répondeur", plan.appel.classement, "repondeur");
    verifie("journal : pas de réponse, SANS échange, « Répondeur »", plan.journal && [plan.journal.outcome, plan.journal.isExchange, plan.journal.sujet, plan.journal.contact], ["sans_reponse", false, "Répondeur", null]);
    const attendu = prochainEssai(2, new Date(i.relu.finA), FENETRE_DEFAUT);
    verifie("file : nouvel essai, essai 1 compté", plan.file && [plan.file.statut, plan.file.essais], ["en_attente", 1]);
    verifie("file : l'essai 2 à l'heure de la règle (prochainEssai)", fichePasAvant(plan), attendu.toISOString());
    verifie("file : essai 2 mercredi 7 octobre à 16h (créneau 16h–17h, ≥ 3 h après)", jourHeureFr(attendu), "mercredi 7 octobre à 16h");
    vrai("file : la note dit l'essai 2", Boolean(plan.file?.note.includes("essai 2 programmé")), plan.file?.note);
    verifie("aucune relance, aucune pause, rien d'appris", [plan.relance, plan.pause, plan.appris], [null, null, null]);
  }

  // =========================================================================
  // 3. Un standard automatique : raccroché, barrage SANS échange, stop
  // =========================================================================
  const standard = await appeler(faux, {
    nom: "standard",
    secondesFacturees: 5,
    etapes: [
      ...decroche,
      { type: "prospect", texte: "Bonjour et bienvenue au Garage Dupont. Pour joindre l'atelier, tapez 1. Pour la carrosserie, tapez 2." },
      { type: "pause", ms: 3_000 },
    ],
  });
  {
    const i = standard;
    const r = i.rapport;
    controlesCommuns("standard", i);
    verifie("raccroché par l'annexe : serveur vocal reconnu en direct", [r.raccrochePar, r.machineEnDirect, i.session!.raccroches.length], ["serveur_machine", "standard_ivr", 1]);
    const plan = planifierFin(contexte(i));
    verifie("classement : standard automatique", plan.appel.classement, "standard_ivr");
    verifie("journal : barrage SANS échange (la fiche ne passe pas en Contacté)", plan.journal && [plan.journal.outcome, plan.journal.isExchange, plan.journal.sujet], ["barrage", false, "Standard automatique"]);
    verifie("file : cycle terminé, « standard automatique »", plan.file && plan.file.statut !== "en_attente" ? [plan.file.statut, plan.file.motif, plan.file.essais] : plan.file, ["termine", "standard automatique", 1]);
    verifie(
      "relance le lendemain ouvré à 9h : « Janet : standard automatique, à contacter autrement »",
      plan.relance,
      { jour: "2026-10-08", minutes: 540, titre: "Janet : standard automatique, à contacter autrement" }
    );
  }

  // =========================================================================
  // 4. 403 outbound_sip_not_enabled à la création : panne de NOTRE côté
  // =========================================================================
  const upgradesAvant = faux.upgrades.length;
  const refus403 = await appeler(faux, {
    nom: "sip sortant non activé",
    creation: {
      statut: 403,
      corps: { error: { code: "outbound_sip_not_enabled", message: "Outbound SIP is not enabled for this organization.", type: "invalid_request_error" } },
    },
    etapes: [],
  });
  {
    const i = refus403;
    const r = i.rapport;
    verifie("aucune connexion annexe ouverte", [faux.upgrades.length - upgradesAvant, i.session], [0, null]);
    verifie("le rapport dit l'erreur de création", r.erreur, {
      etape: "creation",
      statut: 403,
      code: "outbound_sip_not_enabled",
      message: "Outbound SIP is not enabled for this organization.",
    });
    verifie("ni session, ni sonnerie, ni statut visible", [r.sessionId, r.sonnerieA, i.statuts], [null, null, []]);
    vrai("plus aucune minuterie de l'annexe", i.minuteriesVivantes() === 0, i.minuteriesVivantes());
    const ctx = contexte(i);
    const plan = planifierFin(ctx);
    verifie("l'appel : échec, de NOTRE côté", [plan.appel.statut, plan.appel.erreur_cote, plan.appel.erreur_code], ["echec", "nous", "outbound_sip_not_enabled"]);
    verifie("rien sur la fiche : ni journal, ni relance, ni ligne apprise", [plan.journal, plan.relance, plan.appris], [null, null, null]);
    verifie("la ligne repart en file SANS compter d'essai", plan.file && [plan.file.statut, plan.file.essais], ["en_attente", null]);
    verifie("elle repart dans 10 minutes", fichePasAvant(plan), new Date(ctx.maintenant.getTime() + 10 * 60_000).toISOString());
    verifie(
      "pause IMMÉDIATE, cause en français",
      plan.pause,
      "OpenAI refuse : l'appel SIP sortant n'est pas activé pour l'organisation (outbound_sip_not_enabled)."
    );
    verifie("pas d'enchaînement", plan.chainer, false);
  }

  // =========================================================================
  // En plus — une clé refusée (401) : pause immédiate, aucune attache
  // =========================================================================
  const upgradesAvant401 = faux.upgrades.length;
  const cleRefusee = await appeler(faux, { nom: "clé refusée", etapes: [...decroche] }, { cle: "sk-mauvaise" });
  {
    const plan = planifierFin(contexte(cleRefusee));
    verifie("clé refusée : 401 du faux serveur, aucune attache", [cleRefusee.rapport.erreur?.statut, faux.upgrades.length - upgradesAvant401], [401, 0]);
    verifie("clé refusée : pause immédiate, sans essai compté", [plan.pause, plan.file?.essais], ["OpenAI refuse la clé API (401). Reposez la clé dans l'écran Appels IA.", null]);
    verifie("clé refusée : la tentative est tracée côté serveur", faux.creations.at(-1)?.autorisation, "Bearer sk-mauvaise");
  }

  // =========================================================================
  // En plus — une connexion qui tombe, sans session.closed ni raccroché
  // =========================================================================
  const coupe = await appeler(faux, {
    nom: "connexion coupée",
    etapes: [
      ...decroche,
      { type: "prospect", texte: "Allô ?" },
      { type: "janet", texte: `${PREMIERE_PHRASE} Je cherche le responsable.` },
      { type: "prospect", texte: "Oui, c'est moi, je vous écoute." },
      { type: "couper" },
    ],
  });
  {
    const i = coupe;
    const r = i.rapport;
    controlesCommuns("connexion coupée", i);
    verifie("ni raison de fermeture, ni raccroché connu", [r.raisonFermeture, r.raccrochePar, i.session!.raccroches.length], [null, null, 0]);
    vrai("fin ILLISIBLE", !finLisible(i.relu));
    const ctx = contexte(i);
    const plan = planifierFin(ctx);
    verifie("échec NEUTRE : rien n'est deviné", [plan.appel.statut, plan.appel.erreur_cote, plan.appel.classement], ["echec", "neutre", null]);
    verifie("rien au journal, aucune relance — jamais un « pas de réponse » par défaut", [plan.journal, plan.relance], [null, null]);
    verifie("la ligne repart dans 30 min sans compter d'essai", [plan.file?.statut, plan.file?.essais, fichePasAvant(plan)], ["en_attente", null, new Date(ctx.maintenant.getTime() + 30 * 60_000).toISOString()]);
    verifie("une seule fin illisible : pas encore de pause", plan.pause, null);
    vrai("la deuxième d'affilée met en pause", Boolean(planifierFin(contexte(i, { pannesAvant: 1 })).pause?.startsWith("Deux appels d'affilée sans fin lisible")));
  }

  // =========================================================================
  // En plus — « Allô ? » puis le prospect raccroche : pas un humain
  // =========================================================================
  const raccroche = await appeler(faux, {
    nom: "raccroché du prospect",
    etapes: [
      ...decroche,
      { type: "prospect", texte: "Allô ?" },
      { type: "janet", texte: `${PREMIERE_PHRASE} Est-ce que je parle au responsable ?` },
      { type: "raccroche_prospect", secondes: 7 },
    ],
  });
  {
    const i = raccroche;
    const r = i.rapport;
    controlesCommuns("raccroché du prospect", i);
    verifie("raccroché par le prospect (remote_hangup), facturé", [r.raccrochePar, r.raisonFermeture, r.factureS, i.session!.raccroches.length], ["prospect", "remote_hangup", 7, 0]);
    const plan = planifierFin(contexte(i));
    verifie("un « Allô ? » sans échange n'est pas un humain", [plan.appel.classement, plan.journal?.outcome, plan.journal?.isExchange], ["repondeur", "sans_reponse", false]);
    verifie("nouvel essai programmé", plan.file && [plan.file.statut, plan.file.essais], ["en_attente", 1]);
  }

  // =========================================================================
  // En plus — la ligne échoue AVANT toute sonnerie : à qui la faute ?
  // =========================================================================
  const occupe = await appeler(faux, {
    nom: "occupé avant sonnerie",
    etapes: [{ type: "evenement", ev: { type: "transport.failed", error: { code: "busy", message: "486 Busy Here" } } }],
  });
  {
    const plan = planifierFin(contexte(occupe));
    verifie(
      "occupé avant sonnerie : c'est le prospect — un essai, pas une panne",
      [plan.appel.statut, plan.appel.erreur_cote, plan.appel.classement, plan.journal?.outcome, plan.pause],
      ["termine", null, "occupe_echec", "sans_reponse", null]
    );
    verifie("occupé avant sonnerie : nouvel essai, l'essai compte", plan.file && [plan.file.statut, plan.file.essais], ["en_attente", 1]);
  }

  const refusLigne = await appeler(faux, {
    nom: "ligne refusée avant sonnerie",
    etapes: [{ type: "evenement", ev: { type: "transport.failed", error: { code: "sip_auth_failed", message: "407 Proxy Authentication Required" } } }],
  });
  {
    const plan = planifierFin(contexte(refusLigne));
    verifie(
      "identifiants SIP refusés : de NOTRE côté, pause immédiate, rien sur la fiche",
      [plan.appel.erreur_cote, Boolean(plan.pause), plan.journal, plan.file?.essais],
      ["nous", true, null, null]
    );
  }

  const inconnu = await appeler(faux, {
    nom: "échec de ligne inconnu",
    etapes: [{ type: "evenement", ev: { type: "transport.failed", error: { code: "sip_error", message: "call failed" } } }],
  });
  {
    const premier = planifierFin(contexte(inconnu));
    verifie(
      "cause inconnue, première fois : de notre côté, marquée, sans pause ni essai",
      [premier.appel.erreur_cote, premier.appel.erreur_code, premier.pause, premier.file?.statut, premier.file?.essais, premier.journal],
      ["nous", "transport_inconnu", null, "en_attente", null, null]
    );
    const ligneMorte = planifierFin(contexte(inconnu, { pannesAvant: 1 }));
    vrai("cause inconnue, deuxième panne d'affilée sans preuve de la ligne : pause (c'est peut-être la nôtre)", Boolean(ligneMorte.pause));
    const numero = planifierFin(contexte(inconnu, { ligneProuveeDepuisEchec: true, pannesAvant: 1 }));
    verifie(
      "cause inconnue, la ligne a marché entre-temps : numéro injoignable — cycle arrêté, SANS pause",
      [numero.appel.erreur_cote, numero.appel.erreur_code, numero.pause, numero.file?.statut, numero.journal, numero.chainer],
      [null, "numero_injoignable", null, "arrete", null, true]
    );
    verifie(
      "numéro injoignable : une relance pour le propriétaire, le lendemain ouvré à 9h",
      numero.relance,
      { jour: "2026-10-08", minutes: 540, titre: "Janet : numéro injoignable (deux échecs de ligne), à vérifier" }
    );
  }
} finally {
  await faux.fermer();
}

const duree = Date.now() - DEBUT_TEST;
vrai(`le test tient en moins de 30 s (${(duree / 1000).toFixed(1)} s)`, duree < 30_000, duree);
clearTimeout(garde);
bilan("Faux serveur Live : l'annexe de bout en bout");
