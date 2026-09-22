import { route, json, readBody } from "@/server/http/identity";
export const dynamic = "force-dynamic";
export async function POST(r: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return (await route(r, async (s, t) => json(await s.reissue(t, (await c.params).id, await readBody(r, ["expectedRevision"]))))); }
