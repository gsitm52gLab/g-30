-- Generated workbook manifests are immutable private records.
CREATE TRIGGER import_export_no_update BEFORE UPDATE ON records WHEN OLD.kind='importExport'
BEGIN SELECT RAISE(ABORT,'Immutable export manifest'); END;
CREATE TRIGGER import_export_no_delete BEFORE DELETE ON records WHEN OLD.kind='importExport'
BEGIN SELECT RAISE(ABORT,'Immutable export manifest'); END;
