import { route, json, readBody } from '@/server/http/identity';
import { ImportService } from '@/server/imports/service';
import { previewInput } from '@/domain/imports/validate';
export async function POST(request: Request) { return (await route(request, async (identity, token) => json(await new ImportService(identity).preview(token, previewInput(await readBody(request, ['sourceId', 'sheetId', 'headerRow', 'mapping', 'choices'], 2 * 1024 * 1024))), 201))); }
