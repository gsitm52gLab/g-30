import { fixtures } from "@/data/fixtures";
import type { RecordRepository } from "@/domain/records";
/** Insert missing IDs only. Never replace user edits or delete records. */
export async function seed(repository: RecordRepository) {
  return repository.transaction(store => {
    let inserted = 0; let preserved = 0;
    for (const fixture of fixtures) {
      if (store.get(fixture.kind, fixture.input.id)) { preserved++; continue; }
      store.create(fixture.kind, fixture.input); inserted++;
    }
    return { inserted, preserved };
  });
}
