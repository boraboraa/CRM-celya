/**
 * Le réveil du moteur d'appels — appelé chaque minute par pg_cron (pg_net),
 * avec le secret du Vault en en-tête. Pas de session : `service_role` (voir
 * lib/appelsIa/acces.ts). Le filet d'abord (appels bloqués), puis UNE
 * composition au plus ; les briefs se préparent après la réponse.
 */

import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretInterne } from "@/lib/appelsIa/acces";
import { composerSuivant, filet } from "@/lib/appelsIa/moteur";
import { preparerBriefs } from "@/lib/appelsIa/briefIA";
import { secretEgal } from "../../../../supabase/functions/_shared/appels/signature.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const admin = createAdminClient();
  let secret: string;
  try {
    secret = await secretInterne(admin);
  } catch {
    return NextResponse.json({ ok: false, raison: "secret" }, { status: 500 });
  }
  if (!secretEgal(secret, req.headers.get("x-appels-ia-secret"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  let liberes = 0;
  try {
    liberes = await filet(admin);
  } catch (e) {
    console.error("[appels-ia] filet", String(e));
  }
  const issue = await composerSuivant(admin);
  after(async () => {
    try {
      await preparerBriefs(admin, 2);
    } catch (e) {
      console.error("[appels-ia] briefs", String(e));
    }
  });
  return NextResponse.json({ ok: true, liberes, ...issue });
}
