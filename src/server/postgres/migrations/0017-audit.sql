-- Maps immutable G14 SQLite 0016-audit.sql; earlier PostgreSQL checksums stay unchanged.
CREATE FUNCTION __SCHEMA__.audit_immutable_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind = 'audit' THEN RAISE EXCEPTION 'Immutable audit record' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.audit_immutable_fn();
CREATE TRIGGER audit_no_delete BEFORE DELETE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.audit_immutable_fn();
