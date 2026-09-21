import type { ProductCommon, ProductContextFields, ProductFileBinding, RetailPriceFields, InternalPriceFields, VersionProvenance } from "@/domain/products/types";
const t = (v: unknown) => typeof v === "string" ? v : "";
const n = (v: unknown) => typeof v === "string" ? v : null;
const objects = <T>(v: readonly T[] | undefined): T[] => Array.isArray(v) ? v.filter(x => !!x && typeof x === "object" && !Array.isArray(x)) : [];
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const choice = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => values.includes(v as T) ? v as T : fallback;
export function commonDTO(c: ProductCommon): ProductCommon {
    return { name: t(c.name), code: t(c.code), temporaryCode: c.temporaryCode === true, localNames: objects(c.localNames).map(x => ({ language: t(x.language), name: t(x.name) })), category: t(c.category),
        capacity: { amount: n(c.capacity?.amount), unit: t(c.capacity?.unit), raw: t(c.capacity?.raw) }, variants: { color: t(c.variants?.color), scent: t(c.variants?.scent), other: t(c.variants?.other) },
        description: t(c.description), usage: t(c.usage), originCountry: t(c.originCountry), manufacturer: t(c.manufacturer), manufacturingDetails: t(c.manufacturingDetails),
        ingredients: { text: t(c.ingredients?.text), language: t(c.ingredients?.language), submittedAt: n(c.ingredients?.submittedAt), classification: n(c.ingredients?.classification) },
        packaging: { container: t(c.packaging?.container), packaging: t(c.packaging?.packaging), label: t(c.packaging?.label), box: t(c.packaging?.box), itf: t(c.packaging?.itf) } };
}
export function contextDTO(c: ProductContextFields): ProductContextFields {
    return { localName: t(c.localName), sku: t(c.sku), jan: t(c.jan), registrationStatus: choice(c.registrationStatus, ["unknown", "unregistered", "in_progress", "registered"], "unknown"), salesStatus: choice(c.salesStatus, ["unknown", "planned", "selling", "stopped"], "unknown"), projectId: n(c.projectId),
        launchDate: { value: n(c.launchDate?.value), precision: choice(c.launchDate?.precision, ["date", "datetime"], "date"), certainty: choice(c.launchDate?.certainty, ["unknown", "expected", "confirmed"], "unknown"), timezone: n(c.launchDate?.timezone), source: t(c.launchDate?.source), raw: t(c.launchDate?.raw) } };
}
export function bindingDTO(f: ProductFileBinding): ProductFileBinding {
    return { id: t(f.id), fileVersionId: t(f.fileVersionId), purpose: choice(f.purpose, ["image", "ingredients", "packaging", "document"], "document"), title: t(f.title), documentType: t(f.documentType), issuer: t(f.issuer), issuedAt: n(f.issuedAt), signedAt: n(f.signedAt), statedValidFrom: n(f.statedValidFrom), statedValidTo: n(f.statedValidTo), validityRaw: t(f.validityRaw), productIds: strings(f.productIds), language: t(f.language), media: t(f.media), usePlace: t(f.usePlace), source: t(f.source) };
}
export function retailDTO(f: RetailPriceFields): RetailPriceFields { return { amount: n(f.amount), currency: n(f.currency), taxIncluded: choice(f.taxIncluded, ["unknown", "yes", "no"], "unknown"), effectiveFrom: n(f.effectiveFrom), effectiveTo: n(f.effectiveTo), source: t(f.source) }; }
export function internalDTO(f: InternalPriceFields): InternalPriceFields { return { supplyAmount: n(f.supplyAmount), currency: n(f.currency), supplyRate: n(f.supplyRate), rateUnit: f.rateUnit === "ratio" || f.rateUnit === "percent" ? f.rateUnit : null, rateBasis: t(f.rateBasis), taxIncluded: choice(f.taxIncluded, ["unknown", "yes", "no"], "unknown"), effectiveFrom: n(f.effectiveFrom), effectiveTo: n(f.effectiveTo), source: t(f.source) }; }
export function provenanceDTO(d: VersionProvenance, authorLabel: string) { return { sequence: typeof d.sequence === "number" ? d.sequence : 0, previousId: n(d.previousId), changedAt: t(d.changedAt), changedByLabel: t(authorLabel), source: t(d.source) }; }
export function commonDiff(before: ProductCommon, after: ProductCommon) {
    const a = commonDTO(before), b = commonDTO(after);
    return (Object.keys(a) as (keyof ProductCommon)[]).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(field => ({ field, before: a[field], after: b[field] }));
}
