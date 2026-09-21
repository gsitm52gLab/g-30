import { fail } from '@/server/auth/errors';
export const broken=():never=>fail('STORAGE_UNAVAILABLE',503,'저장된 입력 자료를 확인할 수 없습니다.');
export const storedText=(v:unknown):string=>typeof v==='string'&&v.isWellFormed()?v:broken();
export const storedId=(v:unknown):string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v)?v:broken();
export const storedHash=(v:unknown):string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:broken();
export const storedCount=(v:unknown):number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:broken();
export const storedDate=(v:unknown):string=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:broken();
