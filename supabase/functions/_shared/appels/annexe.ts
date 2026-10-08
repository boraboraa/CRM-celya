/**
 * L'annexe d'un appel sortant de Janet — le cœur, PORTABLE.
 *
 * Il tourne dans l'edge function `appels-ia-annexe` (Deno, npm:ws) et dans le
 * faux serveur Live des tests (Node, ws) : aucune API Deno ou Node ici, tout
 * arrive par `DependancesAnnexe`.
 *
 * Ce qu'il fait, et rien d'autre :
 *   1. crée l'appel chez OpenAI (`POST /v1/live/sessions`, transport SIP) —
 *      UNE fois : chaque POST compose un nouvel appel, on ne rejoue jamais ;
 *   2. s'attache AUSSITÔT à la session (`/attach`) : la doc ne garantit aucun
 *      rattrapage des événements manqués ;
 *   3. relaie chaque appel d'outil vers Next (`outil`), répond par
 *      `response.item.create` (function_call_output) puis `response.create` ;
 *   4. raccroche seul : messagerie ou serveur vocal reconnu dans l'accueil
 *      (motifs FORTS du classement partagé), sonnerie trop longue, silence
 *      après le décroché, `fin_appel` de Janet, plafond de durée ;
 *   5. rend un RAPPORT de faits. Il ne classe pas, n'écrit rien sur la fiche :
 *      c'est Next qui décide (lib/appelsIa/fin.ts), en un seul exemplaire.
 *
 * Écarts mesurés par la réceptionniste du produit (openai-live-incoming),
 * repris ici : transcriptions mot à mot sans fin de tour (900 ms de silence la
 * ferment), `session.instructions.append` comme canal pour faire conclure la
 * voix, sessions muettes facturées (d'où les gardes de sonnerie et de silence),
 * session qui ne rend pas toujours `session.closed`.
 */

import { aDesMots, machineDansAccueil } from "./classement.ts";
import type {
  ErreurAppel,
  EvenementAppel,
  OutilAppele,
  RaccrochePar,
  RapportAppel,
  ReplicaAppel,
} from "./rapport.ts";

export type SocketMinimal = {
  envoyer(texte: string): void;
  fermer(): void;
};

export type GestionnairesSocket = {
  ouvert(): void;
  message(texte: string): void;
  ferme(code: number, raison: string): void;
  erreur(e: unknown): void;
};

export type DependancesAnnexe = {
  fetch: typeof fetch;
  /** Ouvre un WebSocket CLIENT avec en-têtes (le WebSocket standard n'en prend pas). */
  ouvrirSocket(url: string, entetes: Record<string, string>, g: GestionnairesSocket): SocketMinimal;
  maintenant(): number;
  minuterie(fn: () => void, ms: number): unknown;
  annuler(h: unknown): void;
  journal(...a: unknown[]): void;
  /** Exécute un outil côté Next — la sortie part telle quelle à Janet. */
  outil(nom: string, args: unknown, callId: string): Promise<unknown>;
  /** Le statut visible de l'appel (suivi sur la fiche) — au mieux, jamais bloquant. */
  statut(s: "composition" | "sonnerie" | "en_ligne", infos: { sessionId?: string | null }): Promise<void>;
};

export type ParametresAppel = {
  appelId: string;
  /** « https://api.openai.com/v1 » — ou le faux serveur des tests. */
  apiBase: string;
  /** « wss://api.openai.com/v1 ». */
  wsBase: string;
  cleApi: string;
  /** `model`, `instructions`, `audio`, `delegation` — préparé par Next, sans secret. */
  session: Record<string, unknown>;
  destination: string;
  trunk: { providerUrl: string; identifiant: string; motDePasse: string; numeroAppelant: string };
  /** Plafond de durée, depuis la création (s). */
  plafondS: number;
  /** Sonnerie maximale (s). */
  sonnerieMaxS: number;
  /** Silence du prospect après le décroché avant de raccrocher (s). */
  silenceMaxS?: number;
  /** Combien de secondes avant le plafond Janet reçoit l'ordre de conclure. */
  conclureAvantS?: number;
  ageWorkerS: number | null;
};

const DELAI_CREATION_MS = 15_000;
const DELAI_ATTACHE_MS = 8_000;
const DELAI_RACCROCHE_MS = 5_000;
const DELAI_OUTIL_MS = 8_000;
const FIN_REPLIQUE_MS = 900;
/** Après `fin_appel` « conversation terminée » : on attend que la voix ait fini sa phrase. */
const FIN_PAROLE_MS = 1_500;
const FIN_PAROLE_MAX_MS = 6_000;
/** Après notre raccroché, combien on attend `session.closed` avant de fermer nous-mêmes. */
const ATTENTE_FERMETURE_MS = 5_000;
const EVENEMENTS_MAX = 300;

const MESSAGE_CONCLURE =
  "Il reste moins d'une minute d'appel. Conclus maintenant : si la personne est intéressée, propose un créneau ou dis que le responsable rappellera ; appelle noter_resultat, salue, puis fin_appel.";

type EtatTour = { qui: "prospect" | "janet"; texte: string; t: number; fin: number; minuterie: unknown };

export async function menerAppel(p: ParametresAppel, d: DependancesAnnexe): Promise<RapportAppel> {
  const t0 = d.maintenant();
  const iso = (ms: number) => new Date(ms).toISOString();
  const rel = () => d.maintenant() - t0;

  const evenements: EvenementAppel[] = [];
  const tours: ReplicaAppel[] = [];
  const outils: OutilAppele[] = [];
  let sessionId: string | null = null;
  let sonnerieA: number | null = null;
  let decrocheA: number | null = null;
  let raisonFermeture: string | null = null;
  let factureS: number | null = null;
  let raccrochePar: RaccrochePar | null = null;
  let machineEnDirect: "repondeur" | "standard_ivr" | null = null;
  let erreur: ErreurAppel | null = null;

  const evenement = (type: string, detail?: string) => {
    if (evenements.length < EVENEMENTS_MAX) evenements.push({ t: rel(), type, ...(detail ? { detail: detail.slice(0, 300) } : {}) });
  };

  const rapport = (): RapportAppel => ({
    appelId: p.appelId,
    sessionId,
    creeA: iso(t0),
    sonnerieA: sonnerieA !== null ? iso(sonnerieA) : null,
    decrocheA: decrocheA !== null ? iso(decrocheA) : null,
    finA: iso(d.maintenant()),
    evenements,
    tours,
    outils,
    raisonFermeture,
    factureS,
    raccrochePar,
    machineEnDirect,
    erreur,
    ageWorkerS: p.ageWorkerS,
    plafondS: p.plafondS,
  });

  // ------------------------------------------------------------- 1. Créer l'appel
  const entetes = { Authorization: `Bearer ${p.cleApi}`, "Content-Type": "application/json" };
  try {
    const res = await d.fetch(`${p.apiBase}/live/sessions`, {
      method: "POST",
      headers: entetes,
      body: JSON.stringify({
        session: p.session,
        transport: {
          type: "sip",
          destination: p.destination,
          trunk: {
            provider_url: p.trunk.providerUrl,
            auth: { type: "digest", username: p.trunk.identifiant, password: p.trunk.motDePasse },
            caller_number: p.trunk.numeroAppelant,
          },
        },
      }),
      signal: AbortSignal.timeout(DELAI_CREATION_MS),
    });
    const texte = await res.text();
    let corps: Record<string, unknown> = {};
    try {
      corps = texte ? (JSON.parse(texte) as Record<string, unknown>) : {};
    } catch {
      corps = {};
    }
    if (!res.ok) {
      const e = (corps.error ?? {}) as Record<string, unknown>;
      erreur = {
        etape: "creation",
        statut: res.status,
        code: typeof e.code === "string" ? e.code : null,
        message: typeof e.message === "string" ? e.message : texte.slice(0, 200),
      };
      evenement("creation.refusee", `${res.status} ${erreur.code ?? ""}`);
      return rapport();
    }
    const s = (corps.session ?? {}) as Record<string, unknown>;
    sessionId = typeof s.id === "string" ? s.id : null;
    if (!sessionId) {
      erreur = { etape: "creation", statut: res.status, code: null, message: "Réponse sans identifiant de session." };
      return rapport();
    }
    evenement("creation.ok", sessionId);
  } catch (e) {
    erreur = { etape: "creation", statut: null, code: null, message: String((e as Error)?.message ?? e).slice(0, 200) };
    evenement("creation.echec", erreur.message);
    return rapport();
  }
  void d.statut("composition", { sessionId }).catch(() => {});

  // ------------------------------------------------------------- 2. S'attacher, mener l'appel
  return await new Promise<RapportAppel>((resolve) => {
    let fini = false;
    let socket: SocketMinimal | null = null;
    let raccrocheEnCours = false;
    const minuteries = new Set<unknown>();
    const plus = (fn: () => void, ms: number) => {
      const h = d.minuterie(() => {
        minuteries.delete(h);
        fn();
      }, ms);
      minuteries.add(h);
      return h;
    };
    const moins = (h: unknown) => {
      if (h !== null && h !== undefined) {
        d.annuler(h);
        minuteries.delete(h);
      }
    };

    const terminer = () => {
      if (fini) return;
      fini = true;
      for (const t of [...minuteries]) moins(t);
      clore(tourProspect);
      clore(tourJanet);
      try {
        socket?.fermer();
      } catch {
        /* déjà fermée */
      }
      if (!raccrochePar) raccrochePar = raisonFermeture === "remote_hangup" ? "prospect" : raisonFermeture ? "inconnu" : null;
      resolve(rapport());
    };

    // Raccrocher : l'appel SIP par l'API, puis on attend la fermeture.
    const raccrocher = async (par: RaccrochePar) => {
      if (raccrocheEnCours || fini) return;
      raccrocheEnCours = true;
      raccrochePar = raccrochePar ?? par;
      evenement("raccroche", par);
      try {
        const r = await d.fetch(`${p.apiBase}/live/sessions/${sessionId}/hangup`, {
          method: "POST",
          headers: { Authorization: `Bearer ${p.cleApi}` },
          signal: AbortSignal.timeout(DELAI_RACCROCHE_MS),
        });
        evenement("raccroche.reponse", String(r.status));
      } catch (e) {
        evenement("raccroche.echec", String((e as Error)?.message ?? e));
      }
      plus(terminer, ATTENTE_FERMETURE_MS);
    };

    // --- Les répliques : mot à mot, closes après 900 ms sans mot, ou quand l'autre voix parle.
    let tourProspect: EtatTour | null = null;
    let tourJanet: EtatTour | null = null;
    function clore(tour: EtatTour | null) {
      if (!tour) return;
      moins(tour.minuterie);
      if (tour.texte.trim()) tours.push({ qui: tour.qui, texte: tour.texte.trim(), t: tour.t, fin: tour.fin });
      if (tour === tourProspect) tourProspect = null;
      if (tour === tourJanet) tourJanet = null;
    }
    const repliquesProspect = () => tours.filter((t) => t.qui === "prospect" && aDesMots(t.texte)).length;

    let silence: unknown = null;
    const motsDuProspect = (delta: string) => {
      if (!delta) return;
      moins(silence);
      silence = null;
      if (tourJanet) clore(tourJanet);
      if (!tourProspect) tourProspect = { qui: "prospect", texte: "", t: rel(), fin: rel(), minuterie: null };
      const tour = tourProspect;
      tour.texte += delta;
      tour.fin = rel();
      moins(tour.minuterie);
      tour.minuterie = plus(() => clore(tour), FIN_REPLIQUE_MS);
      // L'accueil (deux premières répliques) : une messagerie ou un serveur vocal
      // reconnu par un motif FORT → on raccroche tout de suite, sans un mot.
      if (!machineEnDirect && repliquesProspect() < 2) {
        const accueil = [...tours.filter((t) => t.qui === "prospect").map((t) => t.texte), tour.texte].join(" ");
        const m = machineDansAccueil(accueil);
        if (m) {
          machineEnDirect = m;
          evenement("machine.reconnue", m);
          void raccrocher("serveur_machine");
        }
      }
    };

    let finJanetH: unknown = null;
    let attenteFinParole = false;
    const motsDeJanet = (delta: string) => {
      if (!delta) return;
      if (tourProspect) clore(tourProspect);
      if (!tourJanet) tourJanet = { qui: "janet", texte: "", t: rel(), fin: rel(), minuterie: null };
      const tour = tourJanet;
      tour.texte += delta;
      tour.fin = rel();
      moins(tour.minuterie);
      tour.minuterie = plus(() => clore(tour), FIN_REPLIQUE_MS);
      if (attenteFinParole) {
        moins(finJanetH);
        finJanetH = plus(() => void raccrocher("serveur_fin"), FIN_PAROLE_MS);
      }
    };

    // --- Les outils.
    const fait = new Set<string>();
    const executerOutil = async (callId: string, nom: string, brut: unknown) => {
      if (fait.has(callId)) return;
      fait.add(callId);
      const debut = rel();
      let sortie: unknown;
      let ok = true;
      try {
        // Un délai qui ne laisse jamais de rejet orphelin (Deno arrête le
        // worker sur un rejet non traité).
        sortie = await new Promise((res, rej) => {
          const h = d.minuterie(() => rej(new Error("délai dépassé")), DELAI_OUTIL_MS);
          d.outil(nom, brut, callId).then(
            (v) => {
              d.annuler(h);
              res(v);
            },
            (e) => {
              d.annuler(h);
              rej(e);
            }
          );
        });
      } catch (e) {
        ok = false;
        sortie = {
          ok: false,
          erreur: "L'action n'a pas abouti. Dites-le simplement et proposez que le responsable rappelle.",
          detail: String((e as Error)?.message ?? e).slice(0, 120),
        };
      }
      outils.push({ t: debut, nom, arguments: lireArgs(brut), sortie, ok, ms: rel() - debut });
      if (fini || !socket) return;
      socket.envoyer(
        JSON.stringify({
          type: "response.item.create",
          event_id: `out_${callId}`.slice(0, 60),
          item: { type: "function_call_output", call_id: callId, output: JSON.stringify(sortie).slice(0, 12000) },
        })
      );
      socket.envoyer(JSON.stringify({ type: "response.create", event_id: `cont_${callId}`.slice(0, 60) }));
      if (nom === "fin_appel") {
        const motif = String((lireArgs(brut) as Record<string, unknown>)?.motif ?? "");
        if (motif === "repondeur" || motif === "standard") {
          void raccrocher("serveur_machine");
        } else {
          // Laisser la voix finir sa phrase d'au revoir, jamais plus de 6 s.
          attenteFinParole = true;
          finJanetH = plus(() => void raccrocher("serveur_fin"), FIN_PAROLE_MS);
          plus(() => void raccrocher("serveur_fin"), FIN_PAROLE_MAX_MS);
        }
      }
    };

    const appelsDeFonction = (ev: Record<string, unknown>): Record<string, unknown>[] => {
      const r: Record<string, unknown>[] = [];
      if (ev.type === "response.output_item.done") {
        const item = ev.item as Record<string, unknown> | undefined;
        if (item?.type === "function_call") r.push(item);
      } else if (ev.type === "response.completed" || ev.type === "response.done") {
        const resp = ev.response as Record<string, unknown> | undefined;
        for (const it of (resp?.output as Record<string, unknown>[] | undefined) ?? []) {
          if (it?.type === "function_call") r.push(it);
        }
      }
      return r;
    };

    // --- Les messages de la connexion annexe.
    const message = (texte: string) => {
      if (fini) return;
      // L'audio réfléchi (deux sens, ~5 trames par seconde) : compté, jamais décodé.
      const tete = texte.slice(0, 120);
      if (tete.includes('"session.input_audio.append"') || tete.includes('"session.output_audio.delta"')) return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(texte) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = String(ev.type ?? "");
      switch (type) {
        case "transport.ringing":
          if (sonnerieA === null) {
            sonnerieA = d.maintenant();
            evenement(type);
            void d.statut("sonnerie", { sessionId }).catch(() => {});
            moins(sonnerieH);
            sonnerieH = plus(() => {
              if (decrocheA === null) void raccrocher("serveur_sonnerie");
            }, p.sonnerieMaxS * 1000);
          }
          return;
        case "transport.answered":
          if (decrocheA === null) {
            decrocheA = d.maintenant();
            evenement(type);
            moins(sonnerieH);
            void d.statut("en_ligne", { sessionId }).catch(() => {});
            silence = plus(() => {
              if (repliquesProspect() === 0 && !tourProspect) void raccrocher("serveur_silence");
            }, (p.silenceMaxS ?? 10) * 1000);
          }
          return;
        case "transport.failed": {
          const e = (ev.error ?? {}) as Record<string, unknown>;
          erreur = {
            etape: "transport",
            statut: null,
            code: typeof e.code === "string" ? e.code : null,
            message: typeof e.message === "string" ? e.message : "échec du transport",
          };
          evenement(type, erreur.code ?? undefined);
          plus(terminer, ATTENTE_FERMETURE_MS);
          return;
        }
        case "session.input_transcript.delta":
          motsDuProspect(String(ev.delta ?? ""));
          return;
        case "session.output_transcript.delta":
          motsDeJanet(String(ev.delta ?? ""));
          return;
        case "session.input_transcript.done":
        case "session.input_transcript.completed":
          // Sans deltas pour cette réplique, la transcription complète en tient lieu.
          if (!tourProspect && typeof (ev.transcript ?? ev.text) === "string") motsDuProspect(String(ev.transcript ?? ev.text));
          return;
        case "session.output_transcript.done":
        case "session.output_transcript.completed":
          if (!tourJanet && typeof (ev.transcript ?? ev.text) === "string") motsDeJanet(String(ev.transcript ?? ev.text));
          return;
        case "session.closed":
        case "session.ended":
        case "session.terminated": {
          raisonFermeture = typeof ev.reason === "string" ? ev.reason : type;
          const usage = ev.usage as Record<string, unknown> | undefined;
          factureS = typeof usage?.seconds === "number" ? usage.seconds : null;
          evenement(type, raisonFermeture);
          terminer();
          return;
        }
        case "error": {
          const e = (ev.error ?? {}) as Record<string, unknown>;
          evenement("error", `${String(e.code ?? "")} ${String(e.message ?? "")}`.trim());
          return;
        }
        case "response.event": {
          const interne = ev.event as Record<string, unknown> | undefined;
          if (interne) traiterReponse(interne);
          return;
        }
        default:
          if (type.startsWith("response.")) traiterReponse(ev);
          else if (type.startsWith("session.") || type.startsWith("transport.")) evenement(type);
      }
    };

    const traiterReponse = (ev: Record<string, unknown>) => {
      for (const item of appelsDeFonction(ev)) {
        const callId = String(item.call_id ?? item.id ?? "");
        const nom = String(item.name ?? "");
        if (!callId || !nom) continue;
        evenement("outil", nom);
        void executerOutil(callId, nom, item.arguments);
      }
    };

    // --- Les gardes de temps.
    let sonnerieH: unknown = null;
    // Pas même une sonnerie : au-delà de la sonnerie maximale + 20 s, on raccroche.
    sonnerieH = plus(() => {
      if (decrocheA === null) void raccrocher("serveur_sonnerie");
    }, (p.sonnerieMaxS + 20) * 1000);
    const conclure = Math.max(0, p.plafondS - (p.conclureAvantS ?? 45));
    plus(() => {
      if (!fini && socket && decrocheA !== null) {
        socket.envoyer(
          JSON.stringify({ type: "session.instructions.append", event_id: "conclure", delegation_id: null, content: MESSAGE_CONCLURE })
        );
        evenement("conclure");
      }
    }, conclure * 1000);
    plus(() => void raccrocher("serveur_plafond"), p.plafondS * 1000);

    // --- L'attache.
    let ouvert = false;
    const attente = plus(() => {
      if (!ouvert) {
        erreur = { etape: "attache", statut: null, code: null, message: "délai d'ouverture dépassé" };
        evenement("attache.echec", "délai");
        void raccrocher("serveur_erreur");
      }
    }, DELAI_ATTACHE_MS);
    try {
      socket = d.ouvrirSocket(`${p.wsBase}/live/sessions/${sessionId}/attach`, { Authorization: `Bearer ${p.cleApi}` }, {
        ouvert() {
          ouvert = true;
          moins(attente);
          evenement("attache.ok");
        },
        message,
        ferme(code, raison) {
          evenement("attache.fermee", `${code} ${raison}`.trim());
          if (!ouvert && !erreur) {
            erreur = { etape: "attache", statut: null, code: String(code), message: raison || "connexion refusée" };
            void raccrocher("serveur_erreur");
            return;
          }
          // Une fin sans `session.closed` : on attend un peu qu'il arrive, sinon
          // on termine — le rapport dira « inconnu », et Next n'en devinera rien.
          if (!raccrocheEnCours) plus(terminer, 1_000);
        },
        erreur(e) {
          evenement("attache.erreur", String((e as Error)?.message ?? e));
        },
      });
    } catch (e) {
      erreur = { etape: "attache", statut: null, code: null, message: String((e as Error)?.message ?? e).slice(0, 200) };
      void raccrocher("serveur_erreur");
    }
  });
}

function lireArgs(brut: unknown): unknown {
  if (typeof brut !== "string") return brut ?? {};
  try {
    return JSON.parse(brut);
  } catch {
    return { brut: brut.slice(0, 500) };
  }
}
