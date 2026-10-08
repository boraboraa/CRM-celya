// appels-ia-annexe — l'annexe des appels sortants de Janet (CRM Celya).
// ---------------------------------------------------------------------------
// Réveillée par Next (POST signé HMAC, `appel_id`), elle crée l'appel chez
// OpenAI (GPT-Live, transport SIP Telnyx), tient la connexion annexe pendant
// l'appel, relaie les outils vers Next et rend le rapport à Next en fin
// d'appel. Toute la logique (cœur de l'annexe, classement) vit dans
// `../_shared/appels/`, en TypeScript portable, testée sous node par le faux
// serveur Live (lib/appelsIa/faux-live.test.ts) : ce fichier n'est qu'une
// enveloppe Deno (Deno.serve, npm:ws, EdgeRuntime.waitUntil, base, Vault).
//
// POURQUOI UNE EDGE FUNCTION : l'appel dure plusieurs minutes et la connexion
// annexe doit rester ouverte tout du long. L'organisation Supabase « celya »
// est en plan Pro : le worker vit 400 s (150 s en gratuit). D'où le plafond de
// 330 s par appel, comme la réceptionniste du produit (openai-live-incoming).
//
// LA LIMITE PORTE SUR LE WORKER, PAS SUR L'APPEL (doc Supabase) : un worker
// réutilisé pour l'appel suivant n'a plus que ce qui lui reste. L'annexe note
// la naissance de son worker, plafonne l'appel à ce qui reste, et refuse
// (503, « worker_vieux ») s'il reste moins de 4 minutes : Next repousse alors
// l'appel, sans compter d'essai ni de panne.
//
// Déployée avec `verify_jwt: false` : l'authentification est la signature HMAC
// (secret `appels_ia_secret_interne` du Vault). Secrets lus par le service_role
// (`appels_ia_secret`) : clé OpenAI, identifiant et mot de passe SIP. Aucun
// secret dans ce fichier ni dans les variables d'environnement.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import WebSocket from "npm:ws@8.18.0";
import { menerAppel, type SocketMinimal } from "../_shared/appels/annexe.ts";
import { rapportSansAppel, type RapportAppel } from "../_shared/appels/rapport.ts";
import { ENTETE_SIGNATURE, ENTETE_TS, signer, verifierSignature } from "../_shared/appels/signature.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const NAISSANCE = Date.now();
/** La limite murale du worker (plan Pro). En plan gratuit : 150. */
const MUR_S = Number(Deno.env.get("APPELS_IA_MUR_S") ?? "400");
/** La marge gardée pour rendre le rapport et écrire la fin. */
const MARGE_S = 45;
/** En dessous, on ne compose pas : on demande à Next de repousser. */
const BUDGET_MIN_S = 240;
const API = "https://api.openai.com/v1";
const WS = "wss://api.openai.com/v1";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const log = (...a: unknown[]) => console.log("[appels-ia-annexe]", ...a);
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

async function secret(nom: string): Promise<string> {
  const { data, error } = await supabase.rpc("appels_ia_secret", { p_nom: nom });
  if (error) throw new Error(`lecture du secret ${nom} : ${error.message}`);
  return typeof data === "string" ? data : "";
}

type Reglages = {
  trunk_url: string;
  numero_appelant: string | null;
  url_app: string;
  sonnerie_max_s: number;
  duree_max_s: number;
};

async function reglages(): Promise<Reglages> {
  const { data, error } = await supabase
    .from("appels_ia_reglages")
    .select("trunk_url, numero_appelant, url_app, sonnerie_max_s, duree_max_s")
    .eq("id", 1)
    .single();
  if (error || !data) throw new Error(`lecture des réglages : ${error?.message ?? "absents"}`);
  return data as Reglages;
}

async function posterSigne(url: string, corps: string, interne: string, delaiMs: number): Promise<Response> {
  return await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await signer(interne, corps)) },
    body: corps,
    signal: AbortSignal.timeout(delaiMs),
  });
}

/**
 * Rend le rapport à Next — deux essais, puis, à défaut, la trace minimale en
 * base. Ne lève JAMAIS : une promesse rejetée dans `waitUntil` tue le worker, et
 * avec lui toute trace de l'appel. Un second essai après un délai dépassé est
 * sans risque : Next prend un jeton de fin avant d'écrire (une seule écriture).
 */
async function rendre(rapport: RapportAppel, interne: string, urlApp: string) {
  const corps = JSON.stringify(rapport);
  if (interne && urlApp) {
    for (let i = 0; i < 2; i++) {
      try {
        const r = await posterSigne(`${urlApp}/api/appels-ia/fin`, corps, interne, 25_000);
        if (r.ok) return;
        log("fin refusée par Next", r.status, (await r.text().catch(() => "")).slice(0, 200));
        // 4xx : Next a lu et refusé (signature, rapport illisible) — inutile d'insister.
        if (r.status >= 400 && r.status < 500) break;
      } catch (e) {
        log("fin : Next injoignable", String(e));
      }
      if (i === 0) await new Promise((res) => setTimeout(res, 3_000));
    }
  } else {
    log("fin : secret interne ou URL de l'app inconnus, trace minimale en base");
  }
  // Next n'a pas pu écrire la fin : on libère la ligne, en échec NEUTRE — rien
  // n'est deviné, la ligne de file repartira (tick de Next, filet).
  try {
    const { error } = await supabase
      .from("appels_ia")
      .update({
        statut: "echec",
        erreur_cote: "neutre",
        erreur_code: "fin_injoignable",
        erreur_message: "Next n'a pas pu écrire la fin de l'appel.",
        session_id: rapport.sessionId,
        transcription: rapport.tours,
        evenements: rapport.evenements,
        outils: rapport.outils,
        fin_at: rapport.finA,
      })
      .eq("id", rapport.appelId)
      .in("statut", ["reserve", "composition", "sonnerie", "en_ligne"]);
    if (error) log("trace minimale refusée", error.message);
  } catch (e) {
    // Dernier filet : le tick de Next (appel actif depuis plus de 15 min → neutre).
    log("trace minimale impossible", String(e));
  }
}

async function mener(appel: { id: string; numero_compose: string; session_prete: Record<string, unknown> | null }, plafondMurS: number, ageS: number) {
  let interne = "";
  let urlApp = "";
  let rapport: RapportAppel;
  try {
    const [r, cle, ident, mdp, sec] = await Promise.all([
      reglages(),
      secret("openai_api_key"),
      secret("sip_identifiant"),
      secret("sip_mot_de_passe"),
      secret("secret_interne"),
    ]);
    interne = sec;
    urlApp = r.url_app;
    const manquants = [!cle && "clé OpenAI", !ident && "identifiant SIP", !mdp && "mot de passe SIP"].filter(Boolean);
    if (manquants.length) {
      rapport = rapportSansAppel(appel.id, "preparation", `Secret manquant : ${manquants.join(", ")}.`);
    } else if (!r.numero_appelant) {
      rapport = rapportSansAppel(appel.id, "preparation", "Le numéro appelant n'est pas réglé.");
    } else if (!appel.session_prete) {
      rapport = rapportSansAppel(appel.id, "preparation", "La session n'a pas été préparée.");
    } else {
      rapport = await menerAppel(
        {
          appelId: appel.id,
          apiBase: API,
          wsBase: WS,
          cleApi: cle,
          session: appel.session_prete,
          destination: appel.numero_compose,
          trunk: { providerUrl: r.trunk_url, identifiant: ident, motDePasse: mdp, numeroAppelant: r.numero_appelant },
          plafondS: Math.min(r.duree_max_s, plafondMurS),
          sonnerieMaxS: r.sonnerie_max_s,
          ageWorkerS: Math.round(ageS),
        },
        {
          fetch,
          ouvrirSocket(url, entetes, g): SocketMinimal {
            const ws = new WebSocket(url, { headers: entetes });
            ws.on("open", () => g.ouvert());
            ws.on("message", (data: unknown) => g.message(String(data)));
            ws.on("close", (code: number, raison: unknown) => g.ferme(code, String(raison ?? "")));
            ws.on("error", (e: unknown) => g.erreur(e));
            return {
              envoyer: (t) => {
                if (ws.readyState === WebSocket.OPEN) ws.send(t);
              },
              fermer: () => ws.close(),
            };
          },
          maintenant: () => Date.now(),
          minuterie: (fn, ms) => setTimeout(fn, ms),
          annuler: (h) => clearTimeout(h as number),
          journal: log,
          async outil(nom, args, callId) {
            const corps = JSON.stringify({ appel_id: appel.id, nom, arguments: args, call_id: callId });
            const res = await posterSigne(`${urlApp}/api/appels-ia/outils`, corps, interne, 7_500);
            const j = (await res.json().catch(() => null)) as { sortie?: unknown } | null;
            if (!res.ok || !j) throw new Error(`outil ${nom} : HTTP ${res.status}`);
            return j.sortie;
          },
          async statut(s, infos) {
            const patch: Record<string, unknown> = { statut: s };
            if (infos.sessionId) patch.session_id = infos.sessionId;
            if (s === "en_ligne") patch.decroche_at = new Date().toISOString();
            await supabase
              .from("appels_ia")
              .update(patch)
              .eq("id", appel.id)
              .in("statut", ["reserve", "composition", "sonnerie", "en_ligne"]);
          },
        }
      );
    }
  } catch (e) {
    rapport = rapportSansAppel(appel.id, "annexe", String((e as Error)?.message ?? e).slice(0, 200));
  }
  try {
    log("fin", appel.id, rapport.raisonFermeture ?? rapport.erreur?.message ?? "", `${rapport.tours.length} répliques`);
    if (!interne || !urlApp) {
      try {
        interne = interne || (await secret("secret_interne"));
        urlApp = urlApp || (await reglages()).url_app;
      } catch (e) {
        log("impossible de relire secret / réglages pour rendre la fin", String(e));
      }
    }
    await rendre(rapport, interne, urlApp);
  } catch (e) {
    log("rendre a levé", String(e));
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const corps = await req.text();
  let interne: string;
  try {
    interne = await secret("secret_interne");
  } catch (e) {
    log("secret interne illisible", String(e));
    return json({ ok: false, raison: "secret_illisible" }, 500);
  }
  if (!(await verifierSignature(interne, corps, req.headers.get(ENTETE_TS), req.headers.get(ENTETE_SIGNATURE)))) {
    return json({ ok: false, raison: "signature" }, 401);
  }
  let appelId = "";
  try {
    appelId = String((JSON.parse(corps) as { appel_id?: unknown }).appel_id ?? "");
  } catch {
    return json({ ok: false, raison: "corps" }, 400);
  }
  if (!/^[0-9a-f-]{36}$/.test(appelId)) return json({ ok: false, raison: "appel_id" }, 400);

  const ageS = (Date.now() - NAISSANCE) / 1000;
  const resteS = Math.floor(MUR_S - ageS - MARGE_S);
  if (resteS < BUDGET_MIN_S) {
    return json({ ok: false, raison: "worker_vieux", reessayer_dans_s: Math.ceil(MUR_S - ageS) + 5 }, 503);
  }

  // La prise : seule une ligne « réservée » devient « composition ». Un second
  // réveil pour le même appel ne compose pas deux fois.
  const { data: appel, error } = await supabase
    .from("appels_ia")
    .update({ statut: "composition" })
    .eq("id", appelId)
    .eq("statut", "reserve")
    .select("id, numero_compose, session_prete")
    .maybeSingle();
  if (error) return json({ ok: false, raison: "base", detail: error.message }, 500);
  if (!appel) return json({ ok: false, raison: "deja_pris" }, 409);

  EdgeRuntime.waitUntil(mener(appel as { id: string; numero_compose: string; session_prete: Record<string, unknown> | null }, resteS, ageS));
  return json({ ok: true, plafond_s: resteS }, 202);
});
