import { parseWorkbook } from './parser-core';
import { importLimits } from '@/domain/imports/types';
import { WorkbookInputError } from './zip';
const chunks: Buffer[] = [];
let size = 0;
try {
    for await (const chunk of process.stdin) {
        const data = Buffer.from(chunk);
        size += data.length;
        if (size > importLimits.inputBytes)
            throw new WorkbookInputError('RESOURCE_LIMIT');
        chunks.push(data);
    }
    process.stdout.write(JSON.stringify({ ok: true, workbook: await parseWorkbook(Buffer.concat(chunks)), peakRss: process.resourceUsage().maxRSS }));
}
catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, code: error instanceof WorkbookInputError ? error.code : 'XLSX_INVALID' }));
    process.exitCode = 2;
}
