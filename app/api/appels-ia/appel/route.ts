/**
 * Un appel de Janet, avec sa transcription — sondé par l'écran Appels IA
 * pendant l'appel de test (compose → sonne → en ligne → terminé). Sous la
 * session de l'utilisateur : admin seul (RLS), un non-admin reçoit `null`.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lireAppel } from "@/lib/appelsIa/lectures";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ appel: null }, { status: 400 });
  const supabase = await createClient();
  const appel = await lireAppel(supabase, id);
  return NextResponse.json({ appel }, { headers: { "Cache-Control": "no-store" } });
}
