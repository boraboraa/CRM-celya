import { issuerFromRequest, mcpResourceUrl, SCOPE } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728). Le client MCP (Claude) la
 * lit après un 401 pour découvrir le serveur d'autorisation.
 */
export function GET(req: Request) {
  const issuer = issuerFromRequest(req);
  return Response.json(
    {
      resource: mcpResourceUrl(issuer),
      authorization_servers: [issuer],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
    },
    { headers: CORS }
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
