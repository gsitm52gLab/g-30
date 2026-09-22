-- Equivalent to SQLite0018; existing storage grants are unchanged.
CREATE FUNCTION __SCHEMA__.import_export_guard_fn() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 RAISE EXCEPTION 'Immutable export manifest' USING ERRCODE='23514';
END
$fn$;
CREATE TRIGGER import_export_no_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW WHEN (OLD.kind='importExport') EXECUTE FUNCTION __SCHEMA__.import_export_guard_fn();
CREATE TRIGGER import_export_no_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW WHEN (OLD.kind='importExport') EXECUTE FUNCTION __SCHEMA__.import_export_guard_fn();
