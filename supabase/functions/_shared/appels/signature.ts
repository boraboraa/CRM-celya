/**
 * La signature HMAC entre l'annexe (edge function) et Next, dans les deux
 * sens. Un seul exemplaire, en WebCrypto : disponible sous Deno comme sous
 * Node 22, sans import.
 *
 *   x-appels-ia-ts        : l'instant de l'envoi, en millisecondes ;
 *   x-appels-ia-signature : hex(HMAC-SHA256(secret, `${ts}.${corps}`)).
 *
 * Une signature de plus de 5 minutes est refusée (pas de rejeu). Le secret
 * vit dans le Vault (`appels_ia_secret_interne`), lu par le service_role.
 */

export const ENTETE_TS = "x-appels-ia-ts";
export const ENTETE_SIGNATURE = "x-appels-ia-signature";
export const TOLERANCE_MS = 5 * 60_000;

const encodeur = new TextEncoder();

async function cle(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", encodeur.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signer(secret: string, corps: string, ts: number = Date.now()): Promise<Record<string, string>> {
  const sig = await crypto.subtle.sign("HMAC", await cle(secret), encodeur.encode(`${ts}.${corps}`));
  return { [ENTETE_TS]: String(ts), [ENTETE_SIGNATURE]: hex(sig) };
}

/** Comparaison en temps constant. */
function egal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function verifierSignature(
  secret: string,
  corps: string,
  ts: string | null,
  signature: string | null,
  maintenant: number = Date.now()
): Promise<boolean> {
  if (!secret || !ts || !signature || !/^\d{10,16}$/.test(ts) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(maintenant - Number(ts)) > TOLERANCE_MS) return false;
  const attendue = hex(await crypto.subtle.sign("HMAC", await cle(secret), encodeur.encode(`${ts}.${corps}`)));
  return egal(attendue, signature);
}

/** Le secret brut, comparé en temps constant (le tick de pg_cron, qui ne signe pas). */
export function secretEgal(attendu: string, recu: string | null): boolean {
  return Boolean(attendu) && Boolean(recu) && egal(attendu, recu ?? "");
}
