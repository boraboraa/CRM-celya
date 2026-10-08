/**
 * La fin d'un appel, rendue par l'annexe — signée HMAC. Next classe, écrit
 * sur la fiche, fait avancer le cycle (lib/appelsIa/fin.ts), puis lance
 * l'appel suivant à la chaîne, sans attendre la minute du tick.
 */

import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { secretInterne } from "@/lib/appelsIa/acces";
import { ecrireFin } from "@/lib/appelsIa/fin";
import { composerSuivant } from "@/lib/appelsIa/moteur";
import { lireRapport } from "../../../../supabase/functions/_shared/appels/rapport.ts";
import { ENTETE_SIGNATURE, ENTETE_TS, verifierSignature } from "../../../../supabase/functions/_shared/appels/signature.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  let rapport;
  try {
    rapport = lireRapport(JSON.parse(corps));
  } catch {
    rapport = null;
  }
  if (!rapport) return NextResponse.json({ ok: false, raison: "rapport" }, { status: 400 });
  const issue = await ecrireFin(admin, rapport);
  if (issue.chainer) {
    after(async () => {
      try {
        await composerSuivant(admin);
      } catch (e) {
        console.error("[appels-ia] chaîne", String(e));
      }
    });
  }
  return NextResponse.json({ recu: true, ecrit: issue.ok, chainer: issue.chainer, message: issue.message });
}
