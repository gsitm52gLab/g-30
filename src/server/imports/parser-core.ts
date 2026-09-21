import ExcelJS from 'exceljs';
import path from 'node:path';
import JSZip from 'jszip';
import { importLimits as limits, type ParsedWorkbook, type ParsedCell } from '@/domain/imports/types';
import { guardedZip, inputError } from './zip';
import { inspectXml, xmlAttribute as attribute, namespaces, expectedRoot, type XmlTag } from './xml';
const col = (address: string) => { let n = 0; for (const c of address.match(/^[A-Z]+/)?.[0] ?? '')
    n = n * 26 + c.charCodeAt(0) - 64; return n; };
export async function parseWorkbook(bytes: Buffer): Promise<ParsedWorkbook> {
    const files = await guardedZip(bytes);
    if (!files.has('[Content_Types].xml') || !files.has('xl/workbook.xml') || !files.has('xl/_rels/workbook.xml.rels'))
        inputError('OOXML_INVALID');
    let cells = 0, sheetCount = 0;
    const sheetRefs: { id: number; relation: string }[] = [], targets = new Map<string, string>();
    const raw = new Map<number, Map<string, { value: string; formula: boolean; type: string }>>(), arrays = new Map<number, string[]>();
    const normalized = new Map<string, Buffer>();
    for (const [name, bytes] of files) {
        if (!expectedRoot(name)) { normalized.set(name, bytes); continue; }
        normalized.set(name, inspectXml(name, bytes, { open(tag, parents) {
            if (/^xl\/worksheets\/[^/]+\.xml$/.test(name) && tag.uri === namespaces.main && tag.local === 'c' && ++cells > limits.cells) inputError('RESOURCE_LIMIT');
            if (name === 'xl/workbook.xml' && tag.uri === namespaces.main && tag.local === 'sheet') {
                if (parents.at(-1)?.local !== 'sheets' || ++sheetCount > limits.sheets) inputError(sheetCount > limits.sheets ? 'RESOURCE_LIMIT' : 'OOXML_INVALID');
                const id = Number(attribute(tag, 'sheetId')), relation = attribute(tag, 'id', namespaces.relationship);
                if (!Number.isSafeInteger(id) || id < 1 || !relation || sheetRefs.some(s => s.id === id || s.relation === relation)) inputError('OOXML_INVALID');
                sheetRefs.push({ id, relation });
            }
            if (name === 'xl/_rels/workbook.xml.rels' && tag.uri === namespaces.package && tag.local === 'Relationship') {
                const id = attribute(tag, 'Id'), target = attribute(tag, 'Target');
                if (!id || !target || targets.has(id)) inputError('OOXML_INVALID');
                if (attribute(tag, 'Type') === `${namespaces.relationship}/worksheet` && attribute(tag, 'TargetMode') !== 'External') targets.set(id, target);
            }
        } }, true));
    }
    for (const { id, relation } of sheetRefs) {
        const target = targets.get(relation);
        if (!target) inputError('OOXML_INVALID');
        const filename = target.startsWith('/') ? target.slice(1) : path.posix.normalize(`xl/${target}`);
        if (!/^xl\/worksheets\/[^/]+\.xml$/.test(filename)) inputError('OOXML_INVALID');
        const xml = files.get(filename);
        if (!xml) inputError('OOXML_INVALID');
        const values = new Map<string, { value: string; formula: boolean; type: string }>(), ranges: string[] = [];
        let current: { address: string; value: string; formula: boolean; type: string } | undefined;
        const is = (tag: XmlTag | undefined, local: string) => tag?.uri === namespaces.main && tag.local === local;
        inspectXml(filename, xml, {
            open(tag, parents) {
                if (tag.uri !== namespaces.main) return;
                if (tag.local === 'row' && !is(parents.at(-1), 'sheetData')) inputError('OOXML_INVALID');
                if (tag.local === 'c') {
                    if (current || !is(parents.at(-1), 'row') || !is(parents.at(-2), 'sheetData')) inputError('OOXML_INVALID');
                    const address = attribute(tag, 'r');
                    if (!address || !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(address) || values.has(address)) inputError('OOXML_INVALID');
                    current = { address, value: '', formula: false, type: attribute(tag, 't') ?? 'n' };
                }
                if (tag.local === 'f' || tag.local === 'v') {
                    if (!current || !is(parents.at(-1), 'c')) inputError('OOXML_INVALID');
                    if (tag.local === 'f') {
                        current.formula = true;
                        const ref = attribute(tag, 'ref');
                        if (ref) { if (!/^[A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/.test(ref)) inputError('OOXML_INVALID'); ranges.push(ref); }
                    }
                }
            },
            text(value, parents) { if (current && is(parents.at(-1), 'v')) { current.value += value; if (current.value.length > limits.text) inputError('RESOURCE_LIMIT'); } },
            close(tag) { if (is(tag, 'c') && current) { values.set(current.address, { value: current.value, formula: current.formula, type: current.type }); current = undefined; } },
        });
        raw.set(id, values); arrays.set(id, ranges);
    }
    let normalizedTotal = 0;
    const zip = new JSZip();
    for (const [name, data] of normalized) { normalizedTotal += data.length; if (normalizedTotal > limits.totalBytes) inputError('RESOURCE_LIMIT'); zip.file(name, data); }
    const decoderBytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 1 } });
    if (decoderBytes.length > limits.totalBytes) inputError('RESOURCE_LIMIT');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(decoderBytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
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
