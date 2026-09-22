import { route, json } from '@/server/http/identity';
import { HomeService } from '@/server/home/service';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return route(request, async (identity, token) => json(await new HomeService(identity).navigation(token))); }
