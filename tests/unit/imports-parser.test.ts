import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { parseWorkbook } from '@/server/imports/parser-core';
import { inspectWorkbook } from '@/server/imports/parser';
import { guardedZip } from '@/server/imports/zip';
async function standard() { const b = new ExcelJS.Workbook(); b.addWorksheet('상품').addRows([['code', 'date', 'amount'], ['0001', '2026-09-21', '9007199254740993.123']]); return Buffer.from(await b.xlsx.writeBuffer()); }
async function alter(change: (zip: JSZip) => void) { const zip = await JSZip.loadAsync(await standard()); change(zip); return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }); }
describe('G07 adversarial workbook boundary', () => {
    it('rejects traversal, canonical duplicate path, excessive ZIP entries and decompressed entry size', async () => {
        await expect(guardedZip(await alter(z => { z.file('../escape.txt', 'x'); }))).rejects.toBeDefined();
        await expect(guardedZip(await alter(z => { z.file('XL/WORKBOOK.XML', 'x'); }))).rejects.toMatchObject({ code: 'ZIP_PATH_INVALID' });
        await expect(guardedZip(await alter(z => { for (let i = 0; i < 513; i++)
            z.file(`extra-${i}.txt`, 'x'); }))).rejects.toMatchObject({ code: 'ZIP_PATH_INVALID' });
        await expect(guardedZip(await alter(z => { z.file('oversize.txt', Buffer.alloc(32 * 1024 * 1024 + 1, 65)); }))).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    });
    it('rejects DTD, external workbook/OLE, macro members; ordinary hyperlinks are only inert displayed text', async () => {
        await expect(guardedZip(await alter(z => { z.file('custom.xml', '<!DOCTYPE x [<!ENTITY x "x">]><x/>'); }))).rejects.toMatchObject({ code: 'ACTIVE_CONTENT_UNSUPPORTED' });
        await expect(guardedZip(await alter(z => { z.file('xl/externalLinks/externalLink1.xml', '<x/>'); }))).rejects.toMatchObject({ code: 'ACTIVE_CONTENT_UNSUPPORTED' });
        await expect(guardedZip(await alter(z => { z.file('xl/vbaProject.bin', 'macro'); }))).rejects.toMatchObject({ code: 'ACTIVE_CONTENT_UNSUPPORTED' });
        await expect(guardedZip(await alter(z => { z.file('xl/_rels/bad.rels', '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" TargetMode="External" Target="https://example.test/private"/></Relationships>'); }))).rejects.toBeDefined();
        await expect(guardedZip(await alter(z => { z.file('[Content_Types].xml', '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>'); }))).rejects.toMatchObject({code:'ACTIVE_CONTENT_UNSUPPORTED'});
        await expect(guardedZip(await alter(z => { z.file('xl/worksheets/sheet1.xml','<worksheet><oleObjects><oleObject/></oleObjects></worksheet>'); }))).rejects.toMatchObject({code:'ACTIVE_CONTENT_UNSUPPORTED'});
        const b = new ExcelJS.Workbook(), s = b.addWorksheet('links');
        s.getCell('A1').value = { text: 'macroEnabled vbaProject oleObject 명시된 표시', hyperlink: 'https://example.test/oleObject/never-fetch' };
        const result = await parseWorkbook(Buffer.from(await b.xlsx.writeBuffer()));
        expect(result.sheets[0].rows[0].cells[0]).toMatchObject({ type: 'text', text: 'macroEnabled vbaProject oleObject 명시된 표시', error: null });
    });
    it('rejects truncated/CRC corrupted bytes and actual workbook cell limit before ExcelJS allocation', async () => {
        const bytes = await standard();
        await expect(guardedZip(bytes.subarray(0, bytes.length - 20))).rejects.toBeDefined();
        const zip = await JSZip.loadAsync(bytes), xml = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">' + '<c r="A1"><v>1</v></c>'.repeat(300001) + '</row></sheetData></worksheet>';
        zip.file('xl/worksheets/sheet1.xml', xml);
        await expect(parseWorkbook(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
        const corrupt = Buffer.from(bytes);
        const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        corrupt.writeUInt32LE((corrupt.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
        await expect(guardedZip(corrupt)).rejects.toMatchObject({ code: 'ZIP_INTEGRITY' });
    });
    it('preserves exact numeric XML and leading-zero text; rejects invalid 1900 leap date, reads 1904 date without timezone shift', async () => {
        const b = new ExcelJS.Workbook(), s = b.addWorksheet('data');
        s.addRow(['000123', 60, 1]);
        s.getCell('B1').numFmt = 'yyyy-mm-dd';
        let zip = await JSZip.loadAsync(Buffer.from(await b.xlsx.writeBuffer()));
        const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
        zip.file('xl/worksheets/sheet1.xml', xml.replace('<c r="C1"><v>1</v></c>', '<c r="C1"><v>9007199254740993.123</v></c>'));
        const parsed = await parseWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
        expect(parsed.sheets[0].rows[0].cells[0].text).toBe('000123');
        expect(parsed.sheets[0].rows[0].cells[1].error).toBe('DATE_INVALID');
        expect(parsed.sheets[0].rows[0].cells[2].text).toBe('9007199254740993.123');
        b.properties.date1904 = true;
        s.getCell('B1').value = 1;
        zip = await JSZip.loadAsync(Buffer.from(await b.xlsx.writeBuffer()));
        const valid = await parseWorkbook(await zip.generateAsync({ type: 'nodebuffer' }));
        expect(valid.sheets[0].rows[0].cells[1].text).toBe('1904-01-02T00:00:00.000Z');
    });
    it('actual child boundary rejects unsupported extensions and oversized input with controlled422', async () => {
        await expect(inspectWorkbook('legacy.xls', Buffer.from('old'))).rejects.toMatchObject({ status: 422, code: 'XLSX_REQUIRED' });
        await expect(inspectWorkbook('large.xlsx', Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toMatchObject({ status: 422, code: 'XLSX_REQUIRED' });
        await expect(inspectWorkbook('invalid.xlsx', Buffer.from('not zip'))).rejects.toMatchObject({ status: 422, code: 'XLSX_REQUIRED' });
    });
});
