/** JSON content equality ignores object key order while preserving array order and values.
 * This is for comparison only; request hashes and signed serialization keep their protocols.
 */
export function jsonContentEqual(left: unknown, right: unknown): boolean {
    const canonical = (value: unknown) => JSON.stringify(value, (_key, current: unknown) => {
        if (current === null || typeof current !== 'object' || Array.isArray(current)) return current;
        const record = current as Record<string, unknown>;
        return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
    });
    return canonical(left) === canonical(right);
}
