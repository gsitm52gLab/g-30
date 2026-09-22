import { route, json } from "@/server/http/identity";
export const dynamic = "force-dynamic";
export async function GET(r: Request) { return (await route(r, async (s, t) => json(await s.me(t)))); }
