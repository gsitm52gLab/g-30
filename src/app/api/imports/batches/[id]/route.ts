import { route, json } from '@/server/http/identity';
import { ImportService } from '@/server/imports/service';
type Context = {
    params: Promise<{
        id: string;
    }>;
};
export function GET(request: Request, context: Context) { return route(request, async (identity, token) => json(await new ImportService(identity).batch(token, (await context.params).id))); }
