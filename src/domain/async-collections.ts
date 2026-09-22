/** Sequential counterparts for callbacks that perform transactional asynchronous reads. */
type Callback<T, U> = (value: T, index: number, array: readonly T[]) => U | Promise<U>;
export async function asyncMap<T, U>(values: readonly T[], callback: Callback<T, U>): Promise<U[]> {
  const result = new Array<U>(values.length), length = values.length;
  for (let i = 0; i < length; i++) if (i in values) result[i] = await callback(values[i], i, values);
  return result;
}
export async function asyncFilter<T>(values: readonly T[], callback: Callback<T, boolean>): Promise<T[]> {
  const result: T[] = [], length = values.length;
  for (let i = 0; i < length; i++) if (i in values && await callback(values[i], i, values)) result.push(values[i]);
  return result;
}
export async function asyncFind<T>(values: readonly T[], callback: Callback<T, boolean>): Promise<T | undefined> {
  const length = values.length;
  for (let i = 0; i < length; i++) if (await callback(values[i], i, values)) return values[i];
  return undefined;
}
export async function asyncSome<T>(values: readonly T[], callback: Callback<T, boolean>): Promise<boolean> {
  const length = values.length;
  for (let i = 0; i < length; i++) if (i in values && await callback(values[i], i, values)) return true;
  return false;
}
export async function asyncEvery<T>(values: readonly T[], callback: Callback<T, boolean>): Promise<boolean> {
  const length = values.length;
  for (let i = 0; i < length; i++) if (i in values && !await callback(values[i], i, values)) return false;
  return true;
}
export async function asyncFlatMap<T, U>(values: readonly T[], callback: Callback<T, U | readonly U[]>): Promise<U[]> {
  const result: U[] = [], length = values.length;
  for (let i = 0; i < length; i++) if (i in values) {
    const value = await callback(values[i], i, values);
    if (Array.isArray(value)) { for (let j = 0; j < value.length; j++) if (j in value) result.push(value[j]); }
    else result.push(value as U);
  }
  return result;
}
export async function asyncForEach<T>(values: readonly T[], callback: Callback<T, void>): Promise<void> {
  const length = values.length;
  for (let i = 0; i < length; i++) if (i in values) await callback(values[i], i, values);
}
export async function asyncReduce<T, U>(values: readonly T[], callback: (accumulator: U, value: T, index: number, array: readonly T[]) => U | Promise<U>, initial: U): Promise<U> {
  let accumulator = initial; const length = values.length;
  for (let i = 0; i < length; i++) if (i in values) accumulator = await callback(accumulator, values[i], i, values);
  return accumulator;
}
