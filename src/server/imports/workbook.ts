import ExcelJS from 'exceljs';
import { importFields, type ImportField } from '@/domain/imports/fields';
import { IMPORT_SCHEMA } from '@/domain/imports/types';
import type { ProductCommon, ProductContextFields, RetailPriceFields, InternalPriceFields } from '@/domain/products/types';
export function productValues(contextId: string, brandId: string, common: ProductCommon, local: ProductContextFields, retail: RetailPriceFields | null, internal: InternalPriceFields | null): Record<string, string | boolean | null> {
    const source = { common, local, retail, internal } as unknown as Record<string, unknown>, out: Record<string, string | boolean | null> = { contextKey: contextId, brandId };
    for (const field of importFields) {
        if (field.key in out)
            continue;
        let value: unknown = source;
        for (const part of field.key.split('.'))
            value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : null;
        out[field.key] = typeof value === 'string' || typeof value === 'boolean' ? value : null;
    }
    out['common.localNameLanguage'] = common.localNames[0]?.language ?? '';
    out['common.localName'] = common.localNames[0]?.name ?? '';
    return out;
}
/** Build from explicit projected data only; uploaded sheets/properties/names are never copied. */
export async function workbookBytes(fields: readonly ImportField[], rows: Record<string, string | boolean | null>[], title = '상품') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GS HALE';
    workbook.title = IMPORT_SCHEMA;
    const sheet = workbook.addWorksheet(title);
    sheet.addRow(fields.map(f => f.key));
    for (const values of rows)
        sheet.addRow(fields.map(f => values[f.key] === null ? '' : String(values[f.key] ?? '')));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns.forEach(c => { c.width = 24; c.numFmt = '@'; });
    const help = workbook.addWorksheet('입력 안내');
    help.addRow(['스키마', IMPORT_SCHEMA]);
    help.addRow(['규칙', '컨텍스트 키는 선택한 컨텍스트 ID입니다. 식별자는 텍스트, 날짜는 ISO, 빈 셀은 업데이트 시 유지됩니다. 수식은 지원하지 않습니다.']);
    help.addRow(['공통 현지표기', '언어와 이름을 함께 입력하면 그 언어의 표기만 추가/수정합니다. 다른 언어는 보존됩니다.']);
    for (const f of fields)
        help.addRow([f.key, f.label, f.type, f.options?.join(' | ') ?? '']);
    return Buffer.from(await workbook.xlsx.writeBuffer());
}
