/** Sequential predicate preserves short-circuit behavior and avoids parallel transaction queries. */
export async function asyncSome<T>(values: readonly T[], predicate: (value: T) => Promise<boolean>): Promise<boolean> {
  for (const value of values) if (await predicate(value)) return true;
  return false;
}
