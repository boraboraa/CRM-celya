import { issuerFromRequest, authServerMetadata } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414). Annonce les points
 * d'entrée /authorize, /token et /register (enregistrement dynamique).
 */
export function GET(req: Request) {
  const issuer = issuerFromRequest(req);
  return Response.json(authServerMetadata(issuer), { headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
