import type { RecordInput, RecordKind } from '@/domain/records';
import type { AsyncRecordRepository } from './types';
export type SeedRecord = { [K in RecordKind]: { kind: K; input: RecordInput<K> } }[RecordKind];
/** Caller supplies ordered synthetic fixtures. Existing IDs are always preserved, never upgraded implicitly. */
export async function seedPostgres(repository: AsyncRecordRepository, fixtures: readonly SeedRecord[]) {
  return repository.transaction(async store => {
    let inserted = 0, preserved = 0;
    for (const fixture of fixtures) {
      if (await store.get(fixture.kind, fixture.input.id)) { preserved++; continue; }
      await store.create(fixture.kind, fixture.input); inserted++;
    }
    return { inserted, preserved };
  });
}
