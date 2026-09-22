import { route, json, readBody } from "@/server/http/identity";
export const dynamic = "force-dynamic";
export async function POST(r: Request) { return route(r, async (s, t) => json(await s.accept(t, await readBody(r, ["token", "password"])))); }
