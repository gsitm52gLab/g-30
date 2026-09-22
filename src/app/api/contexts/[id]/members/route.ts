import { route, json } from "@/server/http/identity";
export const dynamic = "force-dynamic";
export async function GET(r: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return route(r, async (s, t) => json(await s.members(t, (await c.params).id))); }
