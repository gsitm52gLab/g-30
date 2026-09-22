# SQLite to PostgreSQL migration inventory

The original SQLite files/checksums are unchanged. Detailed hashes and exact index/trigger names are in `src/server/postgres/migrations/source-map.json`. G14 0016 is not part of this checkpoint.

| Version | Indexes | Triggers | Preserved area |
| --- | ---: | ---: | --- |
| 0001-foundation.sql | 1 | 0 | foundation |
| 0002-identity.sql | 6 | 2 | identity |
| 0003-tasks.sql | 3 | 1 | tasks |
| 0004-products.sql | 6 | 1 | products |
| 0005-submissions.sql | 4 | 2 | submissions |
| 0006-evidence-imports.sql | 3 | 2 | evidence-imports |
| 0007-notices.sql | 2 | 2 | notices |
| 0008-inquiries.sql | 4 | 2 | inquiries |
| 0009-corrections.sql | 4 | 4 | corrections |
| 0010-campaigns.sql | 6 | 2 | campaigns |
| 0011-completion.sql | 3 | 2 | completion |
| 0012-ai-input.sql | 3 | 2 | ai-input |
| 0013-ai-review.sql | 4 | 2 | ai-review |
| 0014-scheduling-notifications.sql | 4 | 3 | scheduling-notifications |
| 0015-ai-provider.sql | 4 | 2 | ai-provider |

All original named indexes and trigger predicates are carried into explicit schema-qualified PostgreSQL scripts. JSON fields remain typed JSONB; no product record limit was added. Domain FK-like references and exceptional legacy context changes are in async relation checkers and `updatedContext`; PostgreSQL adds the two original SQL insert reference triggers. There is intentionally no unsafe record-delete API. SQL index/trigger negatives in the real proof cover each named definition, while full product journeys remain a follow-up integration gate.
