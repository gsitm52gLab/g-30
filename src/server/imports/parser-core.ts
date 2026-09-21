import ExcelJS from 'exceljs';
import path from 'node:path';
import { importLimits as limits, type ParsedWorkbook, type ParsedCell } from '@/domain/imports/types';
import { guardedZip, inputError, attribute } from './zip';
const col = (address: string) => { let n = 0; for (const c of address.match(/^[A-Z]+/)?.[0] ?? '')
    n = n * 26 + c.charCodeAt(0) - 64; return n; };
export async function parseWorkbook(bytes: Buffer): Promise<ParsedWorkbook> {
    const files = await guardedZip(bytes);
    if (!files.has('[Content_Types].xml') || !files.has('xl/workbook.xml') || !files.has('xl/_rels/workbook.xml.rels'))
        inputError('OOXML_INVALID');
    const workbookXml = files.get('xl/workbook.xml')!.toString('utf8'), rels = files.get('xl/_rels/workbook.xml.rels')!.toString('utf8');
    const sheetTags = [...workbookXml.matchAll(/<sheet\b[^>]*>/g)].map(m => m[0]);
    if (sheetTags.length > limits.sheets)
        inputError('RESOURCE_LIMIT');
    const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => [attribute(m[0], 'Id'), attribute(m[0], 'Target')]));
    let cells = 0;
    const raw = new Map<number, Map<string, {
        value: string;
        formula: boolean;
        type: string;
    }>>(), arrays = new Map<number, string[]>();
    for (const tag of sheetTags) {
        const id = Number(attribute(tag, 'sheetId')), target = targets.get(attribute(tag, 'r:id'));
        if (!target)
            inputError('OOXML_INVALID');
        const filename = target.startsWith('/') ? target.slice(1) : path.posix.normalize(`xl/${target}`);
        if (!filename.startsWith('xl/'))
            inputError('OOXML_INVALID');
        const xml = files.get(filename)?.toString('utf8');
        if (!xml)
            inputError('OOXML_INVALID');
        const values = new Map<string, {
            value: string;
            formula: boolean;
            type: string;
        }>(), ranges: string[] = [];
        for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            if (++cells > limits.cells)
                inputError('RESOURCE_LIMIT');
            const address = attribute(match[1], 'r');
            if (!address)
                inputError('OOXML_INVALID');
            const body = match[2] ?? '', formula = /<f\b/.test(body), f = /<f\b([^>]*)/.exec(body), ref = f ? attribute(f[1], 'ref') : null;
            if (ref)
                ranges.push(ref);
            values.set(address, { value: /<v>([^<]*)<\/v>/.exec(body)?.[1] ?? '', formula, type: attribute(match[1], 't') ?? 'n' });
        }
        raw.set(id, values);
        arrays.set(id, ranges);
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheets: ParsedWorkbook['sheets'] = [];
    let hidden = 0;
    for (const sheet of workbook.worksheets) {
        if (sheet.state !== 'visible') {
            hidden++;
            continue;
        }
        const rows: ParsedWorkbook['sheets'][number]['rows'] = [];
        sheet.eachRow({ includeEmpty: false }, row => {
            const rowCells: ParsedCell[] = [];
            row.eachCell({ includeEmpty: false }, cell => {
                const original = raw.get(sheet.id)?.get(cell.address), ranges = arrays.get(sheet.id) ?? [], arrayFormula = ranges.some(range => { const [a, b = a] = range.split(':'); return Number(cell.col) >= col(a) && Number(cell.col) <= col(b) && Number(cell.row) >= Number(a.replace(/[A-Z]+/, '')) && Number(cell.row) <= Number(b.replace(/[A-Z]+/, '')); });
                let type: ParsedCell['type'] = 'text', text = '', error: string | null = null;
                const value = cell.value;
                if (original?.formula || arrayFormula) {
                    type = 'error';
                    error = 'FORMULA_UNSUPPORTED';
                }
                else if (value === null || value === undefined)
                    type = 'empty';
                else if (typeof value === 'string')
                    text = value;
                else if (typeof value === 'boolean') {
                    type = 'boolean';
                    text = String(value);
                }
                else if (typeof value === 'number') {
                    type = 'number';
                    text = original?.value ?? '';
                    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(text))
                        error = 'NUMBER_INVALID';
                }
                else if (value instanceof Date) {
                    type = 'date';
                    text = Number.isFinite(value.getTime()) ? value.toISOString() : '';
                    const serial = Number(original?.value);
                    if (!text || !Number.isFinite(serial) || serial < 0 || !workbook.properties.date1904 && serial >= 60 && serial < 61)
                        error = 'DATE_INVALID';
                }
                else if ('richText' in value)
                    text = value.richText.map(v => v.text).join('');
                else if ('hyperlink' in value)
                    text = typeof value.text === 'string' ? value.text : value.hyperlink;
                else {
                    type = 'error';
                    error = 'CELL_UNSUPPORTED';
                }
                if (text.length > limits.text)
                    inputError('RESOURCE_LIMIT');
                rowCells.push({ column: Number(cell.col), type, text, error, hidden: sheet.getColumn(Number(cell.col)).hidden === true });
            });
            rows.push({ row: row.number, hidden: row.hidden === true, cells: rowCells });
        });
        sheets.push({ id: sheet.id, name: sheet.name, hidden: false, rows, mergedRanges: sheet.model.merges ?? [] });
    }
    return { sheets, omittedHiddenSheets: hidden, date1904: workbook.properties.date1904 === true };
}
