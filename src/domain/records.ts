/** G00 demo records. Later modules add validated domain services and constraints. */
export interface ContextData { country: string; retailer: string; brand: string }
export interface UserData { name: string; email: string; role: "gsg" | "brand" }
export interface TaskData {
  title: string; category: "onboarding" | "spot"; assigneeId: string; ownerId: string;
  description: string; status: "requested" | "in_progress" | "partial" | "completed";
  deadline: string | null; nextAction: string; productIds: string[]; notes: string[];
}
export interface ProductData { name: string; code: string; brand: string; size: string; category: string; status: "draft" | "active" | "archived"; missingMaterials: number }
export interface RecordDataMap { context: ContextData; user: UserData; task: TaskData; product: ProductData; checkpoint: { value: string } }
export type RecordKind = keyof RecordDataMap;
export interface StoredRecord<K extends RecordKind = RecordKind> {
  kind: K; id: string; contextId: string | null; data: RecordDataMap[K];
  revision: number; createdAt: string; updatedAt: string;
}
export type RecordInput<K extends RecordKind> = Pick<StoredRecord<K>, "id" | "contextId" | "data">;
export type Clock = () => string;
export type IdFactory = () => string;
export const systemClock: Clock = () => new Date().toISOString();

export class StoreError extends Error {
  constructor(public readonly code: "CONFLICT" | "NOT_FOUND" | "STORAGE_UNAVAILABLE" | "INVALID_RECORD" | "ASYNC_TRANSACTION") {
    super(code); this.name = "StoreError";
  }
}

/** Transaction callbacks are synchronous; perform network/crypto work before entering. */
export interface UnitOfWork {
  get<K extends RecordKind>(kind: K, id: string): StoredRecord<K> | null;
  list<K extends RecordKind>(kind: K, contextId?: string): StoredRecord<K>[];
  create<K extends RecordKind>(kind: K, input: RecordInput<K>): StoredRecord<K>;
  update<K extends RecordKind>(kind: K, id: string, expectedRevision: number, data: RecordDataMap[K]): StoredRecord<K>;
}
export interface RecordRepository {
  readonly mode: "mock" | "sqlite";
  get<K extends RecordKind>(kind: K, id: string): Promise<StoredRecord<K> | null>;
  list<K extends RecordKind>(kind: K, contextId?: string): Promise<StoredRecord<K>[]>;
  transaction<T>(operation: (store: UnitOfWork) => T): Promise<T>;
  close(): void;
}
export function jsonCopy<T>(value: T): T {
  try { return JSON.parse(JSON.stringify(value)) as T; }
  catch { throw new StoreError("INVALID_RECORD"); }
}
export function checkInput<K extends RecordKind>(input: RecordInput<K>): void {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(input.id) || (input.contextId !== null && !/^[a-zA-Z0-9_-]{1,160}$/.test(input.contextId)) || !input.data || typeof input.data !== "object") throw new StoreError("INVALID_RECORD");
}
export function assertSynchronous<T>(result: T): T {
  if (result && typeof (result as { then?: unknown }).then === "function") {
    // Consume a rejected async callback to avoid an unhandled rejection; rollback is immediate.
    void Promise.resolve(result).catch(() => undefined);
    throw new StoreError("ASYNC_TRANSACTION");
  }
  return result;
}
