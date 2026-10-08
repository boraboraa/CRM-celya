/**
 * Un outil de Janet pendant l'appel, relayé par l'annexe — signé HMAC.
 * L'outil agit sur la fiche de l'appel désigné par l'annexe, jamais sur un id
 * venu du modèle (lib/appelsIa/outilsServeur.ts).
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretInterne } from "@/lib/appelsIa/acces";
import { executerOutilServeur } from "@/lib/appelsIa/outilsServeur";
import { ENTETE_SIGNATURE, ENTETE_TS, verifierSignature } from "../../../../supabase/functions/_shared/appels/signature.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const corps = await req.text();
  const admin = createAdminClient();
  let secret: string;
  try {
    secret = await secretInterne(admin);
  } catch {
    return NextResponse.json({ ok: false, raison: "secret" }, { status: 500 });
  }
  if (!(await verifierSignature(secret, corps, req.headers.get(ENTETE_TS), req.headers.get(ENTETE_SIGNATURE)))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  let appelId = "";
  let nom = "";
  let args: unknown = null;
  try {
    const j = JSON.parse(corps) as { appel_id?: unknown; nom?: unknown; arguments?: unknown };
    appelId = String(j.appel_id ?? "");
    nom = String(j.nom ?? "");
    args = j.arguments ?? null;
  } catch {
    return NextResponse.json({ ok: false, raison: "corps" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/.test(appelId)) return NextResponse.json({ ok: false, raison: "appel_id" }, { status: 400 });
  try {
    const sortie = await executerOutilServeur(admin, appelId, nom, args);
    return NextResponse.json({ sortie });
  } catch (e) {
    console.error("[appels-ia] outil", nom, String(e));
    return NextResponse.json({
      sortie: { ok: false, erreur: "L'action n'a pas abouti. Dites-le simplement et proposez que le responsable rappelle." },
    });
  }
}
