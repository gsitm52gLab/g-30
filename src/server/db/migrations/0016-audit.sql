-- Existing audit bytes remain intact. New and historical audit rows are append-only.
CREATE TRIGGER audit_no_update BEFORE UPDATE ON records
WHEN OLD.kind = 'audit'
BEGIN SELECT RAISE(ABORT, 'immutable audit'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON records
WHEN OLD.kind = 'audit'
BEGIN SELECT RAISE(ABORT, 'immutable audit'); END;
