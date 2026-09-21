import { fail } from '@/server/auth/errors';
export function query(request:Request,allowed:string[],required:string[]){const q=new URL(request.url).searchParams;if([...q.keys()].some(k=>!allowed.includes(k)||q.getAll(k).length!==1)||required.some(k=>!q.get(k)))fail('VALIDATION',422,'정확한 행사 조회 범위를 지정해 주세요.');return q;}
