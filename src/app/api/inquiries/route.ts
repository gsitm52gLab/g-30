import { route, json, readBody } from '@/server/http/identity';
import { InquiryService } from '@/server/inquiries/service';
import { inquiryLimits } from '@/domain/inquiries/validate';
export const runtime = 'nodejs';
export async function GET(request: Request) { return route(request, async (s, t) => json(await new InquiryService(s).list(t, new URL(request.url).searchParams))); }
export async function POST(request: Request) { return route(request, async (s, t) => json(await new InquiryService(s).createDraft(t, await readBody(request, ['contextId', 'taskId', 'idempotencyKey'], inquiryLimits.requestBytes)), 201)); }
