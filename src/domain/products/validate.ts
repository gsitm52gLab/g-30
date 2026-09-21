import { fail } from "@/server/auth/errors";
import { dateValue, enumValue, ids, list, object, str } from "@/domain/tasks/validate";
import { blankCommon, blankContext, blankInternalPrice, blankRetailPrice, filePurposes, type ProductCommon, type ProductContextFields, type ProductFileBinding, type RetailPriceFields, type InternalPriceFields } from "./types";
const text = (v: unknown, max = 2000) => str(v, max);
const nullable = (v: unknown, max = 2000) => v === null ? null : text(v, max);
const date = (v: unknown) => v === null ? null : dateValue(v);
export function decimal(v: unknown): string | null {
    if (v === null)
        return null;
    const value = text(v, 1000);
    if (!/^\d+(?:\.\d+)?$/.test(value))
        fail("VALIDATION", 422, "0 이상의 소수를 문자열로 입력해 주세요.");
    const [whole, fraction] = value.split(".");
    return whole.replace(/^0+(?=\d)/, "") + (fraction?.replace(/0+$/, "") ? `.${fraction.replace(/0+$/, "")}` : "");
}
const currency = (v: unknown) => { if (v === null)
    return null; const c = text(v, 3).toUpperCase(); if (!/^[A-Z]{3}$/.test(c))
    fail("VALIDATION", 422, "통화 코드를 확인해 주세요."); return c; };
function dates(a: string | null, b: string | null) { if (a && b && a > b)
    fail("VALIDATION", 422, "기간의 시작과 끝을 확인해 주세요."); }
export function commonInput(value: unknown): ProductCommon {
    const raw = object(value, Object.keys(blankCommon())), d = { ...blankCommon(), ...raw };
    const capacity = object(d.capacity, ["amount", "unit", "raw"]), variants = object(d.variants, ["color", "scent", "other"]), ingredients = object(d.ingredients, ["text", "language", "submittedAt", "classification"]), packaging = object(d.packaging, ["container", "packaging", "label", "box", "itf"]);
    if (typeof d.temporaryCode !== "boolean")
        fail("VALIDATION", 422, "임시 코드 여부를 확인해 주세요.");
    return { name: str(d.name, 200, true), code: str(d.code, 160, true), temporaryCode: d.temporaryCode,
        localNames: list(d.localNames, 40).map(v => { const n = object(v, ["language", "name"]); return { language: str(n.language, 50, true), name: str(n.name, 200, true) }; }),
        category: text(d.category, 200), capacity: { amount: decimal(capacity.amount), unit: text(capacity.unit, 100), raw: text(capacity.raw, 1000) },
        variants: { color: text(variants.color, 200), scent: text(variants.scent, 200), other: text(variants.other, 2000) },
        description: text(d.description, 20000), usage: text(d.usage, 10000), originCountry: text(d.originCountry, 200), manufacturer: text(d.manufacturer, 500), manufacturingDetails: text(d.manufacturingDetails, 5000),
        ingredients: { text: text(ingredients.text, 60000), language: text(ingredients.language, 100), submittedAt: date(ingredients.submittedAt), classification: nullable(ingredients.classification, 500) },
        packaging: { container: text(packaging.container), packaging: text(packaging.packaging), label: text(packaging.label), box: text(packaging.box), itf: text(packaging.itf, 160) } };
}
export function contextInput(value: unknown): ProductContextFields {
    const raw = object(value, Object.keys(blankContext())), d = { ...blankContext(), ...raw }, dt = object(d.launchDate, ["value", "precision", "certainty", "timezone", "source", "raw"]);
    const precision = enumValue(dt.precision, ["date", "datetime"]), timezone = nullable(dt.timezone, 100);
    let valueDate = nullable(dt.value, 60);
    if (timezone)
        try {
            new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
        }
        catch {
            fail("VALIDATION", 422, "시간대를 확인해 주세요.");
        }
    if (valueDate !== null) {
        if (precision === "date")
            valueDate = dateValue(valueDate);
        else if (!timezone || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(valueDate) || Number.isNaN(Date.parse(valueDate)))
            fail("VALIDATION", 422, "출시 일시와 시간대 오프셋을 확인해 주세요.");
        dateValue(valueDate.slice(0, 10));
    }
    return { localName: text(d.localName, 200), sku: text(d.sku, 160), jan: text(d.jan, 160), registrationStatus: enumValue(d.registrationStatus, ["unknown", "unregistered", "in_progress", "registered"]), salesStatus: enumValue(d.salesStatus, ["unknown", "planned", "selling", "stopped"]), projectId: d.projectId === null ? null : ids([d.projectId])[0], launchDate: { value: valueDate, precision, certainty: enumValue(dt.certainty, ["unknown", "expected", "confirmed"]), timezone, source: text(dt.source), raw: text(dt.raw) } };
}
export function retailInput(value: unknown): RetailPriceFields {
    const d = { ...blankRetailPrice(), ...object(value, Object.keys(blankRetailPrice())) };
    const amount = decimal(d.amount), c = currency(d.currency), from = date(d.effectiveFrom), to = date(d.effectiveTo);
    dates(from, to);
    if (amount !== null && !c)
        fail("VALIDATION", 422, "금액의 통화를 지정해 주세요.");
    return { amount, currency: c, taxIncluded: enumValue(d.taxIncluded, ["unknown", "yes", "no"]), effectiveFrom: from, effectiveTo: to, source: text(d.source) };
}
export function internalInput(value: unknown): InternalPriceFields {
    const d = { ...blankInternalPrice(), ...object(value, Object.keys(blankInternalPrice())) };
    const amount = decimal(d.supplyAmount), rate = decimal(d.supplyRate), c = currency(d.currency), unit = d.rateUnit === null ? null : enumValue(d.rateUnit, ["ratio", "percent"]), basis = text(d.rateBasis), from = date(d.effectiveFrom), to = date(d.effectiveTo);
    dates(from, to);
    if (amount !== null && !c || rate !== null && (!unit || !basis))
        fail("VALIDATION", 422, "공급 금액의 통화와 공급률의 단위·기준을 지정해 주세요.");
    return { supplyAmount: amount, currency: c, supplyRate: rate, rateUnit: unit, rateBasis: basis, taxIncluded: enumValue(d.taxIncluded, ["unknown", "yes", "no"]), effectiveFrom: from, effectiveTo: to, source: text(d.source) };
}
export function bindingsInput(value: unknown): ProductFileBinding[] {
    const rows = list(value, 100).map(v => {
        const d = object(v, ["id", "fileVersionId", "purpose", "title", "documentType", "issuer", "issuedAt", "signedAt", "statedValidFrom", "statedValidTo", "validityRaw", "productIds", "language", "media", "usePlace", "source"]), from = date(d.statedValidFrom), to = date(d.statedValidTo);
        dates(from, to);
        return { id: ids([d.id])[0], fileVersionId: ids([d.fileVersionId])[0], purpose: enumValue(d.purpose, filePurposes), title: text(d.title, 500), documentType: text(d.documentType, 200), issuer: text(d.issuer, 500), issuedAt: date(d.issuedAt), signedAt: date(d.signedAt), statedValidFrom: from, statedValidTo: to, validityRaw: text(d.validityRaw), productIds: ids(d.productIds), language: text(d.language, 100), media: text(d.media, 200), usePlace: text(d.usePlace, 1000), source: text(d.source) };
    });
    if (new Set(rows.map(r => r.id)).size !== rows.length)
        fail("VALIDATION", 422, "자료 연결 식별자가 중복됩니다.");
    return rows;
}
