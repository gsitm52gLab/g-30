import { route, json, sessionCookie, readBody } from "@/server/http/identity";
export const dynamic = "force-dynamic";
export async function POST(r: Request) { return route(r, async (s, t) => { const result = await s.login(t, await readBody(r, ["email", "password"])); const response = json({ user: result.user }); sessionCookie(response, result.token, result.expiresAt); return response; }); }
