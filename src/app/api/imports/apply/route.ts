import { route, json, readBody } from '@/server/http/identity';
import { ImportService } from '@/server/imports/service';
export async function POST(request: Request) { return (await route(request, async (identity, token) => json(await new ImportService(identity).apply(token, await readBody(request, ['previewId', 'idempotencyKey'])), 201))); }
