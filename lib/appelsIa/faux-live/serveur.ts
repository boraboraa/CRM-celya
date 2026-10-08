/**
 * Le FAUX serveur Live — imite l'API OpenAI GPT-Live telle que la doc et la
 * réceptionniste du produit (openai-live-incoming) la décrivent, en LOCAL
 * (node:http + ws, port libre), pour faire tourner le VRAI cœur de l'annexe
 * (`supabase/functions/_shared/appels/annexe.ts`) sans un seul appel sortant.
 *
 *   POST /v1/live/sessions                    → 201 { session: { id }, transport: { type: "sip" } }
 *                                               (ou l'erreur que le scénario demande)
 *   WS   /v1/live/sessions/{id}/attach        → joue le scénario d'événements
 *   POST /v1/live/sessions/{id}/hangup        → 200, puis `session.closed`
 *                                               (`reason: "close_requested"`, `usage.seconds`)
 *
 * Chaque requête doit porter `Authorization: Bearer <clé>` : sans elle, 401
 * (création, raccroché) ou poignée de main WebSocket refusée (attache).
 *
 * Le scénario est une suite d'ÉTAPES jouées dans l'ordre, dès l'attache :
 * événements de transport, mots du prospect et de Janet (deltas mot à mot, la
 * transcription GPT-Live n'a pas de fin de tour), audio réfléchi (que l'annexe
 * doit ignorer), appels d'outil — pour lesquels le serveur ATTEND la réponse de
 * l'annexe (`response.item.create` avec `function_call_output`, puis
 * `response.create`) avant de continuer —, raccroché du prospect, coupure sèche.
 * Dès que l'annexe raccroche, le scénario s'arrête : une messagerie ne finit
 * pas sa phrase devant un raccroché.
 *
 * Module de TEST : jamais importé par l'application.
 */

import http from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";

export type Json = Record<string, unknown>;

/** Les sorties d'outil déjà reçues dans la session, par nom (la dernière) et par call_id. */
export type SortiesOutils = { parNom: Record<string, Json>; parAppel: Record<string, Json> };

export type Etape =
  | { type: "evenement"; ev: Json }
  | { type: "pause"; ms: number }
  /** Les mots du prospect : `session.input_transcript.delta`, un mot à la fois. */
  | { type: "prospect"; texte: string }
  /** Les mots de Janet : `session.output_transcript.delta`. */
  | { type: "janet"; texte: string }
  /** De l'audio réfléchi, dans les deux sens. `typeEnDernier` : la clé `type` après l'audio. */
  | { type: "audio"; trames: number; typeEnDernier?: boolean }
  /** Un appel d'outil, enveloppé comme GPT-Live le fait ; on attend la réponse de l'annexe. */
  | { type: "outil"; nom: string; args: Json | ((s: SortiesOutils) => Json); callId?: string }
  /** Le prospect raccroche : `session.closed`, `reason: "remote_hangup"`. */
  | { type: "raccroche_prospect"; secondes?: number }
  /** La connexion tombe, sans `session.closed` ni raccroché. */
  | { type: "couper" };

export type Scenario = {
  nom: string;
  /** Une création refusée : statut HTTP et corps JSON. Absent : 201. */
  creation?: { statut: number; corps: Json };
  etapes: Etape[];
  /** `usage.seconds` du `session.closed`. */
  secondesFacturees?: number;
};

export type OutilJoue = {
  callId: string;
  nom: string;
  /** La sortie renvoyée par l'annexe (le `output` relu en JSON). */
  sortie: Json | null;
  /** `response.item.create` (function_call_output) reçu pour ce call_id. */
  reponseRecue: boolean;
  /** `response.create` reçu APRÈS la sortie. */
  relanceRecue: boolean;
};

export type SessionFausse = {
  id: string;
  scenario: Scenario;
  attaches: { autorisation: string | null }[];
  /** Tout ce que l'annexe a envoyé sur la WebSocket, dans l'ordre. */
  recus: Json[];
  outils: OutilJoue[];
  raccroches: { autorisation: string | null }[];
  /** Comment la session s'est fermée côté serveur. */
  fermeture: "close_requested" | "remote_hangup" | "coupee" | null;
  /** Ce qui n'allait pas dans le déroulé (sortie d'outil jamais reçue…). */
  anomalies: string[];
  /** Résolue quand la WebSocket est fermée. */
  fermee: Promise<void>;
};

export type CreationRecue = {
  autorisation: string | null;
  corps: unknown;
  statut: number;
  sessionId: string | null;
};

export type FauxLive = {
  apiBase: string;
  wsBase: string;
  /** Le scénario de la PROCHAINE création. */
  prochain(s: Scenario): void;
  creations: CreationRecue[];
  sessions: SessionFausse[];
  /** Toutes les poignées de main WebSocket tentées, acceptées ou non. */
  upgrades: { chemin: string; autorisation: string | null; acceptee: boolean }[];
  fermer(): Promise<void>;
};

/** Une trame d'audio factice (g711 en base64), de la taille d'une vraie trame de 20 ms. */
const AUDIO = Buffer.alloc(160, 0x7f).toString("base64").repeat(2);

export async function demarrerFauxLive(o: { cle: string; pasMs?: number }): Promise<FauxLive> {
  const pas = o.pasMs ?? 12;
  const attendu = `Bearer ${o.cle}`;
  const file: Scenario[] = [];
  const creations: CreationRecue[] = [];
  const sessions: SessionFausse[] = [];
  const upgrades: FauxLive["upgrades"] = [];
  type SessionInterne = SessionFausse & { ws: WebSocket | null; attente: (() => void)[]; signalerFermee: () => void };
  const parId = new Map<string, SessionInterne>();

  const repondre = (res: http.ServerResponse, statut: number, corps: Json) => {
    res.writeHead(statut, { "Content-Type": "application/json" });
    res.end(JSON.stringify(corps));
  };

  const fermerSession = (s: SessionInterne, raison: "close_requested" | "remote_hangup") => {
    if (s.fermeture || !s.ws || s.ws.readyState !== WebSocket.OPEN) return;
    s.fermeture = raison;
    s.ws.send(JSON.stringify({ type: "session.closed", reason: raison, usage: { seconds: s.scenario.secondesFacturees ?? 0 } }));
    s.ws.close(1000, raison);
  };

  const serveur = http.createServer((req, res) => {
    const morceaux: Buffer[] = [];
    req.on("data", (m: Buffer) => morceaux.push(m));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://local");
      const autorisation = req.headers.authorization ?? null;
      const brut = Buffer.concat(morceaux).toString("utf8");

      // ---------------------------------------------------- création de l'appel
      if (req.method === "POST" && url.pathname === "/v1/live/sessions") {
        let corps: unknown = null;
        try {
          corps = brut ? JSON.parse(brut) : null;
        } catch {
          corps = brut;
        }
        // Le scénario est consommé par la tentative, même refusée.
        const scenario = file.shift();
        if (autorisation !== attendu) {
          creations.push({ autorisation, corps, statut: 401, sessionId: null });
          return repondre(res, 401, { error: { code: "invalid_api_key", message: "Incorrect API key provided.", type: "invalid_request_error" } });
        }
        if (!scenario) {
          creations.push({ autorisation, corps, statut: 500, sessionId: null });
          return repondre(res, 500, { error: { code: "scenario_absent", message: "Le faux serveur n'a pas de scénario." } });
        }
        if (scenario.creation) {
          creations.push({ autorisation, corps, statut: scenario.creation.statut, sessionId: null });
          return repondre(res, scenario.creation.statut, scenario.creation.corps);
        }
        const id = `sess_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
        let signalerFermee = () => {};
        const fermee = new Promise<void>((r) => (signalerFermee = r));
        const s: SessionInterne = {
          id,
          scenario,
          attaches: [],
          recus: [],
          outils: [],
          raccroches: [],
          fermeture: null,
          anomalies: [],
          fermee,
          ws: null,
          attente: [],
          signalerFermee,
        };
        parId.set(id, s);
        sessions.push(s);
        creations.push({ autorisation, corps, statut: 201, sessionId: id });
        return repondre(res, 201, { session: { id, object: "live.session" }, transport: { type: "sip" } });
      }

      // ---------------------------------------------------- raccroché demandé
      const r = /^\/v1\/live\/sessions\/([^/]+)\/hangup$/.exec(url.pathname);
      if (req.method === "POST" && r) {
        const s = parId.get(r[1]);
        if (!s) return repondre(res, 404, { error: { code: "session_not_found", message: "Unknown session." } });
        s.raccroches.push({ autorisation });
        if (autorisation !== attendu) return repondre(res, 401, { error: { code: "invalid_api_key", message: "Incorrect API key provided." } });
        repondre(res, 200, { ok: true });
        // Comme le vrai : la réponse HTTP d'abord, la fermeture de session ensuite.
        setTimeout(() => fermerSession(s, "close_requested"), 30);
        return;
      }

      repondre(res, 404, { error: { code: "not_found", message: `${req.method} ${url.pathname}` } });
    });
  });

  const wss = new WebSocketServer({ noServer: true });

  serveur.on("upgrade", (req: http.IncomingMessage, socket: Duplex, tete: Buffer) => {
    const url = new URL(req.url ?? "/", "http://local");
    const autorisation = req.headers.authorization ?? null;
    const m = /^\/v1\/live\/sessions\/([^/]+)\/attach$/.exec(url.pathname);
    const s = m ? parId.get(m[1]) : undefined;
    const refuser = (ligne: string) => {
      upgrades.push({ chemin: url.pathname, autorisation, acceptee: false });
      socket.write(`HTTP/1.1 ${ligne}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!s) return refuser("404 Not Found");
    if (autorisation !== attendu) return refuser("401 Unauthorized");
    upgrades.push({ chemin: url.pathname, autorisation, acceptee: true });
    wss.handleUpgrade(req, socket, tete, (ws) => {
      s.attaches.push({ autorisation });
      s.ws = ws;
      ws.on("message", (data: RawData) => {
        let m: Json;
        try {
          m = JSON.parse(String(data)) as Json;
        } catch {
          s.anomalies.push("message non JSON reçu de l'annexe");
          return;
        }
        s.recus.push(m);
        for (const f of s.attente.splice(0)) f();
      });
      ws.on("close", () => {
        for (const f of s.attente.splice(0)) f();
        s.signalerFermee();
      });
      void jouer(s, ws).catch((e) => s.anomalies.push(`scénario interrompu : ${String((e as Error)?.message ?? e)}`));
    });
  });

  /** Attend un message de l'annexe (à partir de l'index `depuis`) — ou null au délai. */
  const attendreMessage = async (
    s: SessionInterne,
    pred: (m: Json) => boolean,
    depuis: number,
    delaiMs: number
  ): Promise<number | null> => {
    const fin = Date.now() + delaiMs;
    for (;;) {
      for (let i = depuis; i < s.recus.length; i++) if (pred(s.recus[i])) return i;
      if (Date.now() >= fin || !s.ws || s.ws.readyState !== WebSocket.OPEN) return null;
      await new Promise<void>((r) => {
        const h = setTimeout(r, Math.max(1, fin - Date.now()));
        s.attente.push(() => {
          clearTimeout(h);
          r();
        });
      });
    }
  };

  async function jouer(s: SessionInterne, ws: WebSocket) {
    const actif = () => !s.fermeture && s.raccroches.length === 0 && ws.readyState === WebSocket.OPEN;
    const envoyer = (ev: Json) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ev));
    };
    // Une pause s'interrompt avec la session : rien ne reste armé après la fin.
    const dormir = (ms: number) =>
      new Promise<void>((r) => {
        const h = setTimeout(r, ms);
        void s.fermee.then(() => {
          clearTimeout(h);
          r();
        });
      });
    const sorties: SortiesOutils = { parNom: {}, parAppel: {} };
    let n = 0;
    for (const e of s.scenario.etapes) {
      if (!actif()) return;
      switch (e.type) {
        case "evenement":
          envoyer(e.ev);
          break;
        case "pause":
          await dormir(e.ms);
          break;
        case "prospect":
        case "janet": {
          const type = e.type === "prospect" ? "session.input_transcript.delta" : "session.output_transcript.delta";
          for (const mot of e.texte.match(/\S+\s*/g) ?? []) {
            if (!actif()) return;
            envoyer({ type, delta: mot });
            await dormir(pas);
          }
          break;
        }
        case "audio":
          for (let i = 0; i < e.trames; i++) {
            // Les deux sens : l'écho de la ligne et la voix de Janet.
            const entree = e.typeEnDernier
              ? `{"audio":"${AUDIO}","event_id":"in_${i}","type":"session.input_audio.append"}`
              : JSON.stringify({ type: "session.input_audio.append", event_id: `in_${i}`, audio: AUDIO });
            const sortie = e.typeEnDernier
              ? `{"delta":"${AUDIO}","response_id":"resp_audio","type":"session.output_audio.delta"}`
              : JSON.stringify({ type: "session.output_audio.delta", response_id: "resp_audio", delta: AUDIO });
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(entree);
              ws.send(sortie);
            }
            await dormir(2);
          }
          break;
        case "outil": {
          const callId = e.callId ?? `call_${++n}_${e.nom}`.slice(0, 40);
          const args = typeof e.args === "function" ? e.args(sorties) : e.args;
          const depuis = s.recus.length;
          envoyer({
            type: "response.event",
            event: {
              type: "response.output_item.done",
              response_id: `resp_${n}`,
              output_index: 0,
              item: { id: `item_${n}`, type: "function_call", status: "completed", call_id: callId, name: e.nom, arguments: JSON.stringify(args) },
            },
          });
          const joue: OutilJoue = { callId, nom: e.nom, sortie: null, reponseRecue: false, relanceRecue: false };
          s.outils.push(joue);
          const iSortie = await attendreMessage(
            s,
            (m) => m.type === "response.item.create" && (m.item as Json | undefined)?.call_id === callId,
            depuis,
            5_000
          );
          if (iSortie === null) {
            s.anomalies.push(`outil ${e.nom} (${callId}) : aucune sortie reçue`);
            return;
          }
          const item = s.recus[iSortie].item as Json;
          joue.reponseRecue = item.type === "function_call_output";
          try {
            joue.sortie = JSON.parse(String(item.output)) as Json;
          } catch {
            s.anomalies.push(`outil ${e.nom} : sortie non JSON`);
          }
          const iRelance = await attendreMessage(s, (m) => m.type === "response.create", iSortie + 1, 5_000);
          joue.relanceRecue = iRelance !== null;
          if (iRelance === null) s.anomalies.push(`outil ${e.nom} : aucun response.create après la sortie`);
          if (joue.sortie) {
            sorties.parNom[e.nom] = joue.sortie;
            sorties.parAppel[callId] = joue.sortie;
          }
          break;
        }
        case "raccroche_prospect":
          s.scenario.secondesFacturees = e.secondes ?? s.scenario.secondesFacturees;
          fermerSession(s, "remote_hangup");
          return;
        case "couper":
          s.fermeture = "coupee";
          ws.terminate();
          return;
      }
    }
  }

  await new Promise<void>((r) => serveur.listen(0, "127.0.0.1", () => r()));
  const adresse = serveur.address();
  const port = typeof adresse === "object" && adresse ? adresse.port : 0;

  return {
    apiBase: `http://127.0.0.1:${port}/v1`,
    wsBase: `ws://127.0.0.1:${port}/v1`,
    prochain: (s) => file.push(s),
    creations,
    sessions,
    upgrades,
    async fermer() {
      for (const s of parId.values()) s.ws?.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
      serveur.closeAllConnections();
      await new Promise<void>((r) => serveur.close(() => r()));
    },
  };
}
