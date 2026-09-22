export interface ProductCommon {
    name: string;
    code: string;
    temporaryCode: boolean;
    localNames: {
        language: string;
        name: string;
    }[];
    category: string;
    capacity: {
        amount: string | null;
        unit: string;
        raw: string;
    };
    variants: {
        color: string;
        scent: string;
        other: string;
    };
    description: string;
    usage: string;
    originCountry: string;
    manufacturer: string;
    manufacturingDetails: string;
    ingredients: {
        text: string;
        language: string;
        submittedAt: string | null;
        classification: string | null;
    };
    packaging: {
        container: string;
        packaging: string;
        label: string;
        box: string;
        itf: string;
    };
}
export interface ProductDate {
    value: string | null;
    precision: "date" | "datetime";
    certainty: "unknown" | "expected" | "confirmed";
    timezone: string | null;
    source: string;
    raw: string;
}
export const filePurposes = ["image", "ingredients", "packaging", "document"] as const;
export interface ProductFileBinding {
    id: string;
    fileVersionId: string;
    purpose: typeof filePurposes[number];
    title: string;
    documentType: string;
    issuer: string;
    issuedAt: string | null;
    signedAt: string | null;
    statedValidFrom: string | null;
    statedValidTo: string | null;
    validityRaw: string;
    productIds: string[];
    language: string;
    media: string;
    usePlace: string;
    source: string;
}
export interface ProductContextFields {
    localName: string;
    sku: string;
    jan: string;
    registrationStatus: "unknown" | "unregistered" | "in_progress" | "registered";
    salesStatus: "unknown" | "planned" | "selling" | "stopped";
    launchDate: ProductDate;
    projectId: string | null;
}
export interface RetailPriceFields {
    amount: string | null;
    currency: string | null;
    taxIncluded: "unknown" | "yes" | "no";
    effectiveFrom: string | null;
    effectiveTo: string | null;
    source: string;
}
export interface InternalPriceFields {
    supplyAmount: string | null;
    currency: string | null;
    supplyRate: string | null;
    rateUnit: "ratio" | "percent" | null;
    rateBasis: string;
    taxIncluded: "unknown" | "yes" | "no";
    effectiveFrom: string | null;
    effectiveTo: string | null;
    source: string;
}
export interface VersionProvenance {
    sequence: number;
    previousId: string | null;
    changedBy: string;
    changedAt: string;
    source: string;
}
export interface CommonProductExtension {
    schemaVersion?: 2;
    brandId?: string;
    currentVersionId?: string | null;
    archivedAt?: string | null;
    legacyContextId?: string | null;
}
export interface ProductVersionData extends VersionProvenance {
    productId: string;
    common: ProductCommon;
    archived: boolean;
}
export interface ContextProductData {
    productId: string;
    brandId: string;
    normalizedCode: string;
    currentVersionId: string | null;
}
export interface ContextProductVersionData extends VersionProvenance {
    contextProductId: string;
    fields: ProductContextFields;
    files: ProductFileBinding[];
}
export interface PriceData {
    contextProductId: string;
    currentVersionId: string | null;
}
export interface RetailPriceVersionData extends VersionProvenance {
    priceId: string;
    fields: RetailPriceFields;
}
export interface InternalPriceVersionData extends VersionProvenance {
    priceId: string;
    fields: InternalPriceFields;
}
export interface ProductUseSnapshotData {
    ownerType: "prior_use_fixture" | "submission" | "review" | "completion";
    ownerId: string;
    taskId: string | null;
    requestId: string | null;
    productId: string;
    contextProductId: string;
    productVersionId: string;
    contextProductVersionId: string;
    retailPriceVersionId: string | null;
    retailSelection: {
        asOfDate: string;
        rule: "explicit_version_within_stated_dates" | "explicit_none";
    };
    commonRevision: number;
    contextRevision: number;
    contentHash: string;
    fileBindingHash: string;
    common: ProductCommon;
    context: ProductContextFields;
    retailPrice: RetailPriceFields | null;
    files: {
        fileVersionId: string;
        sha256: string;
        binding: ProductFileBinding;
    }[];
    capturedBy: string;
    capturedAt: string;
}
export function blankCommon(): ProductCommon {
    return { name: "", code: "", temporaryCode: false, localNames: [], category: "", capacity: { amount: null, unit: "", raw: "" },
        variants: { color: "", scent: "", other: "" }, description: "", usage: "", originCountry: "", manufacturer: "", manufacturingDetails: "",
        ingredients: { text: "", language: "", submittedAt: null, classification: null }, packaging: { container: "", packaging: "", label: "", box: "", itf: "" } };
}
export function blankContext(): ProductContextFields {
    return { localName: "", sku: "", jan: "", registrationStatus: "unknown", salesStatus: "unknown",
        launchDate: { value: null, precision: "date", certainty: "unknown", timezone: null, source: "", raw: "" }, projectId: null };
}
export function blankRetailPrice(): RetailPriceFields { return { amount: null, currency: null, taxIncluded: "unknown", effectiveFrom: null, effectiveTo: null, source: "" }; }
export function blankInternalPrice(): InternalPriceFields { return { supplyAmount: null, currency: null, supplyRate: null, rateUnit: null, rateBasis: "", taxIncluded: "unknown", effectiveFrom: null, effectiveTo: null, source: "" }; }
export function blankFileBinding(id: string, fileVersionId: string): ProductFileBinding {
    return { id, fileVersionId, purpose: "document", title: "", documentType: "", issuer: "", issuedAt: null, signedAt: null, statedValidFrom: null, statedValidTo: null, validityRaw: "", productIds: [], language: "", media: "", usePlace: "", source: "" };
}
export const normalizeProductCode = (code: string) => code.trim().toUpperCase();
export const sharedCommonNotice = "브랜드 공통 정보는 연결된 컨텍스트에서 함께 사용됩니다. 아래에는 열람 가능한 적용 범위만 표시합니다.";
