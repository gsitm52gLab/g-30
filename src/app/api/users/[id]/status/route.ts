import { route, json, readBody } from "@/server/http/identity";
export const dynamic = "force-dynamic";
export async function PATCH(r: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return route(r, async (s, t) => json(await s.setUserStatus(t, (await c.params).id, await readBody(r, ["expectedRevision", "status"])))); }
