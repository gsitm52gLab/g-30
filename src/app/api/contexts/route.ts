import { route, json, readBody } from "@/server/http/identity";
export const dynamic = "force-dynamic";
export async function GET(r: Request) { return route(r, async (s, t) => json(await s.me(t))); }
export async function POST(r: Request) { return route(r, async (s, t) => json(await s.createContext(t, await readBody(r, ["type", "countryId", "retailerId", "brandId", "eventName"])), 201)); }
