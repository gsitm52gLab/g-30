import { route, json } from '@/server/http/identity';
import { ImportService } from '@/server/imports/service';
export async function GET(request: Request) { return (await route(request, async (identity, token) => json(await new ImportService(identity).configuration(token, new URL(request.url).searchParams.get('context') ?? '')))); }
