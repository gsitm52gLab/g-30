import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseWorkbook } from '@/server/imports/parser-core';
it('G07-V02 original valid prefixed SpreadsheetML imports exact text and decimals', async () => {
    const parsed = await parseWorkbook(readFileSync('tests/fixtures/imports-standard-prefixed.xlsx'));
    expect(parsed.sheets.map(s => s.name)).toContain('Products');
    const text = parsed.sheets.flatMap(s => s.rows.flatMap(r => r.cells.map(c => c.text)));
    expect(text).toContain('0000000000003');
    expect(text).toContain('12345678901234567890.123456');
});

import JSZip from 'jszip';
import { guardedZip } from '@/server/imports/zip';
const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
async function workbookWith(parts: Record<string, string>) {
    const zip = await JSZip.loadAsync(readFileSync('tests/fixtures/imports-standard-prefixed.xlsx'));
    for (const [name, value] of Object.entries(parts)) zip.file(name, value);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
const sheet = (body: string) => `<s:worksheet xmlns:s="${main}" xmlns:f="urn:irrelevant"><s:sheetData><s:row r="1">${body}</s:row></s:sheetData></s:worksheet>`;
it('aliases and local rebinding preserve raw decimals, inline text, XML escapes and inert extension text', async () => {
    const parsed = await parseWorkbook(await workbookWith({
        'xl/workbook.xml': `<r:workbook xmlns:r="${main}" xmlns:link="${rel}"><r:sheets><r:sheet name="Products" sheetId="1" link:id="s1"/></r:sheets></r:workbook>`,
        'xl/_rels/workbook.xml.rels': `<p:Relationships xmlns:p="${pkg}"><p:Relationship Id="s1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></p:Relationships>`,
        'xl/worksheets/sheet1.xml': sheet(`<s:c r="A1" t="inlineStr"><s:is><s:t xml:space="preserve"> 000123 &amp; &lt;literal&gt; </s:t></s:is></s:c><s:c r="B1"><s:v>9007199254740993.12345</s:v></s:c><f:c xmlns:f="${main}" r="C1"><f:v>0</f:v></f:c>`),
    }));
    expect(parsed.sheets[0].rows[0].cells.map(c => c.text)).toEqual([' 000123 & <literal> ', '9007199254740993.12345', '0']);
});
it('cached, shared and array formulas stay errors under scoped aliases', async () => {
    const parsed = await parseWorkbook(await workbookWith({ 'xl/worksheets/sheet1.xml': sheet('<s:c r="A1"><f:f xmlns:f="'+main+'" t="shared" si="0" ref="A1:B1">1+1</f:f><s:v>2</s:v></s:c><s:c r="B1"><s:f t="shared" si="0"/><s:v>2</s:v></s:c><s:c r="C1"><s:f t="array" ref="C1:D1">1+1</s:f><s:v>2</s:v></s:c><s:c r="D1"><s:v>2</s:v></s:c>') }));
    expect(parsed.sheets[0].rows[0].cells.map(c => c.error)).toEqual(Array(4).fill('FORMULA_UNSUPPORTED'));
    const original = await parseWorkbook(readFileSync('tests/fixtures/imports-formula-cached-prefixed.xlsx'));
    expect(original.sheets[0].rows.find(r => r.row === 4)?.cells.find(c => c.column === 6)?.error).toBe('FORMULA_UNSUPPORTED');
    const numeric = await parseWorkbook(readFileSync('tests/fixtures/imports-numeric-identifier-prefixed.xlsx'));
    expect(numeric.sheets[0].rows.find(r => r.row === 4)?.cells.find(c => c.column === 5)).toMatchObject({ type: 'number', text: '123' });
});
it('wrong URI, shadowed structural names and namespace undeclarations cannot bypass raw guards', async () => {
    for (const body of [
        '<s:c xmlns:s="urn:wrong" r="A1"><s:v>123</s:v></s:c>',
        '<s:c r="A1"><f:f>1+1</f:f><s:v>2</s:v></s:c>',
        '<c xmlns="" r="A1"><v>1</v></c>',
    ]) await expect(parseWorkbook(await workbookWith({ 'xl/worksheets/sheet1.xml': sheet(body) }))).rejects.toMatchObject({ code: 'OOXML_INVALID' });
    await expect(parseWorkbook(await workbookWith({ 'xl/workbook.xml': '<x:workbook xmlns:x="urn:wrong"/>' }))).rejects.toMatchObject({ code: 'OOXML_INVALID' });
    await expect(parseWorkbook(await workbookWith({ 'xl/workbook.xml': `<workbook xmlns="${main}"><sheets><sheet name="Products" sheetId="1" id="rId1"/></sheets></workbook>` }))).rejects.toMatchObject({ code: 'OOXML_INVALID' });
});
it('prefixed DTD, OLE and external relationships are rejected; hyperlink relationship remains inert', async () => {
    await expect(guardedZip(await workbookWith({ 'xl/workbook.xml': `<!DOCTYPE x:workbook SYSTEM "https://example.test/never-fetch"><x:workbook xmlns:x="${main}"/>` }))).rejects.toMatchObject({ code: 'ACTIVE_CONTENT_UNSUPPORTED' });
    await expect(guardedZip(await workbookWith({ 'xl/worksheets/sheet1.xml': sheet('<s:oleObjects/>') }))).rejects.toMatchObject({ code: 'ACTIVE_CONTENT_UNSUPPORTED' });
    for (const uri of [pkg, 'urn:spoof']) await expect(guardedZip(await workbookWith({ 'xl/_rels/workbook.xml.rels': `<p:Relationships xmlns:p="${uri}"><p:Relationship Id="bad" Type="${rel}/externalLink" TargetMode="External" Target="https://example.test/never-fetch"/></p:Relationships>` }))).rejects.toMatchObject({ code: 'ACTIVE_CONTENT_UNSUPPORTED' });
    await expect(guardedZip(await workbookWith({ 'xl/_rels/hyperlink.rels': `<p:Relationships xmlns:p="${pkg}"><p:Relationship Id="h" Type="${rel}/hyperlink" TargetMode="External" Target="https://example.test/never-fetch"/></p:Relationships>` }))).resolves.toBeDefined();
});
it('prefixed hidden/unreferenced cells and workbook sheets count toward limits before decoding', async () => {
    await expect(parseWorkbook(await workbookWith({ 'xl/worksheets/sheet1.xml': sheet('<s:c r="A1"><s:v>1</s:v></s:c>'.repeat(300001)) }))).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    await expect(parseWorkbook(await workbookWith({ 'xl/workbook.xml': `<x:workbook xmlns:x="${main}" xmlns:l="${rel}"><x:sheets>${Array.from({length:21},(_,i)=>`<x:sheet name="S${i}" sheetId="${i+1}" l:id="s${i}"/>`).join('')}</x:sheets></x:workbook>` }))).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
});
