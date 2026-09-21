import { route, json, readBody } from '@/server/http/identity';
import { ImportService } from '@/server/imports/service';
export function POST(request: Request) { return route(request, async (identity, token) => json(await new ImportService(identity).apply(token, await readBody(request, ['previewId', 'idempotencyKey'])), 201)); }
