import { spawn } from 'node:child_process';
import path from 'node:path';
import { importLimits, type ParsedWorkbook } from '@/domain/imports/types';
import { fail } from '@/server/auth/errors';
export async function inspectWorkbook(name: string, bytes: Buffer): Promise<ParsedWorkbook> {
    if (!/\.xlsx$/i.test(name) || bytes.length > importLimits.inputBytes)
        fail('XLSX_REQUIRED', 422, '10MiB 이하의 표준 .xlsx 파일을 선택해 주세요. .xls/.xlsm/암호화 파일은 지원하지 않습니다.');
    const script = path.resolve(/* turbopackIgnore: true */ 'src/server/imports/parser-child.ts');
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--max-old-space-size=256', '--import', 'tsx', script], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, NODE_ENV: 'production' } });
        const chunks: Buffer[] = [];
        let length = 0, timeout = false, overflow = false;
        const timer = setTimeout(() => { timeout = true; child.kill('SIGKILL'); }, importLimits.timeoutMs);
        child.stdout.on('data', (chunk: Buffer) => { length += chunk.length; if (length > importLimits.totalBytes) {
            overflow = true;
            child.kill('SIGKILL');
            return;
        } chunks.push(chunk); });
        child.stderr.resume();
        child.stdin.on('error', () => undefined);
        child.on('error', () => { clearTimeout(timer); rejectError('PARSER_UNAVAILABLE'); });
        function rejectError(code: string) { try {
            fail(code, 422, code === 'PARSER_TIMEOUT' ? '파일 분석 시간이 초과되었습니다. 파일을 나누어 다시 선택해 주세요.' : '지원하지 않거나 안전하게 읽을 수 없는 Excel입니다. 원본을 확인해 주세요.');
        }
        catch (e) {
            reject(e);
        } }
        child.on('close', code => { clearTimeout(timer); if (timeout)
            return rejectError('PARSER_TIMEOUT'); if (overflow || code === null)
            return rejectError('RESOURCE_LIMIT'); try {
            const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (code !== 0 || result.ok !== true)
                return rejectError(typeof result.code === 'string' ? result.code : 'XLSX_INVALID');
            resolve(result.workbook as ParsedWorkbook);
        }
        catch {
            rejectError('XLSX_INVALID');
        } });
        child.stdin.end(bytes);
    });
}
