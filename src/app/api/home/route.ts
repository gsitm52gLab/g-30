import { route, json } from '@/server/http/identity';
import { HomeService, homeQuery } from '@/server/home/service';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return route(request, async (identity, token) => json(await new HomeService(identity).read(token, homeQuery(new URL(request.url).searchParams)))); }
