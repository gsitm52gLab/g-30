import { fail } from "@/server/auth/errors";
import { requirementTypes, type RequestContent, type Deadline, type Requirement } from "./types";
export function object(v: unknown, keys: string[]): Record<string, unknown> {
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) fail("VALIDATION", 422, "입력 항목을 확인해 주세요.");
    return v as Record<string, unknown>;
}
export function str(v: unknown, max = 200, required = false): string {
    if (typeof v !== "string" || v.length > max || required && !v.trim()) fail("VALIDATION", 422, "필수 값 또는 입력 길이를 확인해 주세요.");
    return v.trim();
}
export function list(v: unknown, max = 80): unknown[] { if (!Array.isArray(v) || v.length > max) fail("VALIDATION", 422, "목록 형식을 확인해 주세요."); return v; }
export function ids(v: unknown, max = 80): string[] {
    const result = list(v, max).map(x => str(x, 160, true));
    if (new Set(result).size !== result.length || result.some(x => !/^[\w-]+$/.test(x))) fail("VALIDATION", 422, "식별자가 중복되거나 잘못됐습니다.");
    return result;
}
export function enumValue<T extends string>(v: unknown, values: readonly T[]): T { if (!values.includes(v as T)) fail("VALIDATION", 422, "선택값을 확인해 주세요."); return v as T; }
export function dateValue(v: unknown): string {
    const value = str(v, 10, true);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail("VALIDATION", 422, "실제 날짜를 입력해 주세요.");
    return value;
}
export function deadline(v: unknown): Deadline {
    const d = object(v, ["value", "precision", "timezone", "certainty", "source", "sourceVersion", "responsibleUserId", "raw"]);
    const precision = enumValue(d.precision, ["date", "datetime"]);
    const timezone = str(d.timezone, 100, true);
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { fail("VALIDATION", 422, "시간대를 확인해 주세요."); }
    let value: string | null = null;
    if (d.value !== null) {
        value = precision === "date" ? dateValue(d.value) : str(d.value, 60, true);
        if (precision === "datetime" && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value)))) fail("VALIDATION", 422, "일시는 시간대 오프셋을 포함해야 합니다.");
    }
    return { value, precision, timezone, certainty: enumValue(d.certainty, ["confirmed", "requested", "expected", "needs_confirmation"]), source: str(d.source, 1000), sourceVersion: str(d.sourceVersion, 200), responsibleUserId: str(d.responsibleUserId, 160, true), raw: str(d.raw, 2000) };
}
export function content(v: unknown): RequestContent {
    const d = object(v, ["title", "description", "purpose", "output", "productionResponsibility", "subtitleResponsibility", "originalResponsibility", "usePlace", "nextAction", "deadline", "milestones", "requirements", "referenceFileIds", "links", "internalOriginal", "internalMemo"]);
    const requirements = list(d.requirements).map(v => {
        const q = object(v, ["key", "label", "type", "required", "help", "unit", "options", "productIds", "condition", "specifications"]);
        const key = ids([q.key])[0];
        if (typeof q.required !== "boolean") fail("VALIDATION", 422, "필수 여부를 확인해 주세요.");
        const options = list(q.options, 50).map(x => str(x, 200, true));
        if (new Set(options).size !== options.length) fail("VALIDATION", 422, "선택지가 중복됩니다.");
        let condition: Requirement["condition"] = null;
        if (q.condition !== null) { const c = object(q.condition, ["key", "equals"]); condition = { key: ids([c.key])[0], equals: str(c.equals, 200, true) }; }
        const type = enumValue(q.type, requirementTypes);
        if (type === "choice" && !options.length) fail("VALIDATION", 422, "선택 항목에는 선택지가 필요합니다.");
        return { key, label: str(q.label, 200, true), type, required: q.required, help: str(q.help, 2000), unit: str(q.unit, 100), options, productIds: ids(q.productIds), condition,
            specifications: list(q.specifications, 20).map(v => { const s = object(v, ["text", "source", "version", "severity", "check"]); return { text: str(s.text, 2000, true), source: str(s.source, 1000, true), version: str(s.version, 200, true), severity: enumValue(s.severity, ["required", "recommended"]), check: enumValue(s.check, ["auto", "human"]) }; }) };
    });
    if (new Set(requirements.map(q => q.key)).size !== requirements.length) fail("VALIDATION", 422, "요청 항목 키가 중복됩니다.");
    for (const q of requirements) {
        const seen = new Set([q.key]); let cursor = q;
        while (cursor.condition) {
            const next = requirements.find(r => r.key === cursor.condition!.key);
            if (!next || next.type !== "choice" || !next.options.includes(cursor.condition.equals) || seen.has(next.key)) fail("VALIDATION", 422, "조건의 선택 항목·값 또는 순환 관계를 확인해 주세요.");
            seen.add(next.key); cursor = next;
        }
    }
    const milestones = list(d.milestones, 40).map(v => { const m = object(v, ["id", "kind", "deadline", "counterpart", "visibility"]); return { id: ids([m.id])[0], kind: enumValue(m.kind, ["application", "review", "printing_delivery", "publication_use"]), deadline: deadline(m.deadline), counterpart: str(m.counterpart, 500, true), visibility: enumValue(m.visibility, ["public", "internal"]) }; });
    if (new Set(milestones.map(m => m.id)).size !== milestones.length) fail("VALIDATION", 422, "일정 식별자가 중복됩니다.");
    const links = list(d.links, 20).map(v => { const l = object(v, ["url", "description", "contentFixed"]); const url = str(l.url, 2048, true); try { if (!["https:", "http:"].includes(new URL(url).protocol)) throw 0; } catch { fail("VALIDATION", 422, "http 또는 https 링크를 입력해 주세요."); } if (l.contentFixed !== false) fail("VALIDATION", 422, "외부 링크의 내용은 고정되지 않습니다."); return { url, description: str(l.description, 1000, true), contentFixed: false as const }; });
    return { title: str(d.title, 200, true), description: str(d.description, 20000), purpose: str(d.purpose, 2000), output: str(d.output, 2000), productionResponsibility: str(d.productionResponsibility, 1000), subtitleResponsibility: str(d.subtitleResponsibility, 1000), originalResponsibility: str(d.originalResponsibility, 1000), usePlace: str(d.usePlace, 1000), nextAction: str(d.nextAction, 1000, true), deadline: deadline(d.deadline), milestones, requirements, referenceFileIds: ids(d.referenceFileIds, 10), links, internalOriginal: str(d.internalOriginal, 20000), internalMemo: str(d.internalMemo, 10000) };
}
