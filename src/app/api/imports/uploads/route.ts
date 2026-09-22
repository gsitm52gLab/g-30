import { route, json, readBody } from '@/server/http/identity';
import { ImportStorage } from '@/server/imports/storage';
import { storageAction } from '@/server/imports/storage-http';
import { fail } from '@/server/auth/errors';
export const runtime = 'nodejs';
export async function POST(request: Request) { return route(request, (i,t) => storageAction(async () => {
 if (i.repo.mode !== 'supabase') fail('VALIDATION',422,'현재 저장 방식의 업로드 경로를 사용해 주세요.');
 const v = await readBody(request,['contextId','clientItemId','originalName','declaredMime','expectedBytes','expectedSha256']);
 return json(await new ImportStorage(i).issue(t, { contextId: v.contextId as string, clientItemId: v.clientItemId as string, originalName: v.originalName as string, declaredMime: v.declaredMime as string, expectedBytes: v.expectedBytes as number, expectedSha256: v.expectedSha256 as string, owner: { purpose: 'import_source' }, visibility: 'internal' }));
 })); }
