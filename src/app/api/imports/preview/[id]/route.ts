import { route, json } from '@/server/http/identity';
import { ImportService } from '@/server/imports/service';
type Context = {
    params: Promise<{
        id: string;
    }>;
};
export async function GET(request: Request, context: Context) { return (await route(request, async (identity, token) => json(await new ImportService(identity).readPreview(token, (await context.params).id, Number(new URL(request.url).searchParams.get('page') ?? '1'))))); }
