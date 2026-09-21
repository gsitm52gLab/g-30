CREATE TABLE records (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  context_id TEXT,
  data TEXT NOT NULL CHECK (json_valid(data)),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX records_kind_context ON records(kind, context_id, id);
