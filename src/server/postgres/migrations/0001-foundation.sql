CREATE TABLE __SCHEMA__.records (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  context_id TEXT,
  data JSONB NOT NULL CHECK (jsonb_typeof(data) IN ('object','array')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX records_kind_context ON __SCHEMA__.records((kind),( context_id),( id));
