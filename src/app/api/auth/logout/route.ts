import { route, json, sessionCookie } from "@/server/http/identity";
export const dynamic = "force-dynamic";
export async function POST(r: Request) { return route(r, async (s, t) => { await s.logout(t); const response = json({ loggedOut: true }); sessionCookie(response, "", new Date(0).toISOString()); return response; }); }
