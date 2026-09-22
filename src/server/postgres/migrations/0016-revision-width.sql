-- PostgreSQL-only compatibility migration; unrelated to the pending G14 SQLite 0016.
-- Preserve every existing row and the original 0001 checksum.
ALTER TABLE __SCHEMA__.records ALTER COLUMN revision TYPE BIGINT;
ALTER TABLE __SCHEMA__.records ADD CONSTRAINT records_revision_js_safe CHECK (revision <= 9007199254740991);
