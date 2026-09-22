import type { RecordKind, RecordInput, StoredRecord, UnitOfWork } from '@/domain/records';
import { storageDependencies, relationView, storageRelations as validate } from '@/domain/storage/constraints';
/** Await database access, then use the identical local-adapter constraints without async predicates. */
export async function storageRelations(s: UnitOfWork, kind: RecordKind, input: RecordInput<RecordKind>) {
  const refs = storageDependencies(kind, input);
  if (!refs.length) return;
  const rows: StoredRecord[] = [];
  for (const ref of refs) { const row = await s.get(ref.kind, ref.id); if (row) rows.push(row); }
  const stages = kind === 'importStage' ? await s.list('importStage') : [];
  const exports = kind === 'importExport' ? await s.list('importExport') : [];
  validate(relationView(rows, stages, exports), kind, input);
}
