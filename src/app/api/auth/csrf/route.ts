import { route, json, sessionCookie } from "@/server/http/identity";
export const dynamic = "force-dynamic";
export async function GET(r: Request) { return route(r, async (s, t) => { const result = await s.csrf(t); const response = json({ csrfToken: result.csrfToken }); if (result.token)
    sessionCookie(response, result.token, result.expiresAt); return response; }); }
