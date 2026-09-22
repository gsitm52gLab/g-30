import { route, json } from '@/server/http/identity';
import { SearchService } from '@/server/search/service';
export const runtime = 'nodejs';
export async function GET(request: Request) { return route(request, async (s, t) => json(await new SearchService(s).contexts(t))); }
