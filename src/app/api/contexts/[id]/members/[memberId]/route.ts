import { route, json, readBody } from "@/server/http/identity";
export const dynamic = "force-dynamic";
export async function PATCH(r: Request, c: {
    params: Promise<{
        id: string;
        memberId: string;
    }>;
}) { return (await route(r, async (s, t) => { const p = await c.params; return json(await s.setMembership(t, p.id, p.memberId, await readBody(r, ["expectedRevision", "status", "scope", "internalPriceAccess"]))); })); }
