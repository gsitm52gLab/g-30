CREATE UNIQUE INDEX IF NOT EXISTS context_product_identity ON __SCHEMA__.records((context_id),( NULLIF(data #> '{productId}', 'null'::jsonb))) WHERE kind='contextProduct';
CREATE UNIQUE INDEX IF NOT EXISTS context_product_code ON __SCHEMA__.records((context_id),( NULLIF(data #> '{normalizedCode}', 'null'::jsonb))) WHERE kind='contextProduct';
CREATE UNIQUE INDEX IF NOT EXISTS product_version_sequence ON __SCHEMA__.records((NULLIF(data #> '{productId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='productVersion';
CREATE UNIQUE INDEX IF NOT EXISTS context_product_version_sequence ON __SCHEMA__.records((NULLIF(data #> '{contextProductId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind='contextProductVersion';
CREATE UNIQUE INDEX IF NOT EXISTS product_price_identity ON __SCHEMA__.records((kind),(NULLIF(data #> '{contextProductId}', 'null'::jsonb))) WHERE kind IN ('retailPrice','internalPrice');
CREATE UNIQUE INDEX IF NOT EXISTS product_price_version_sequence ON __SCHEMA__.records((kind),(NULLIF(data #> '{priceId}', 'null'::jsonb)),(NULLIF(data #> '{sequence}', 'null'::jsonb))) WHERE kind IN ('retailPriceVersion','internalPriceVersion');
CREATE FUNCTION __SCHEMA__.immutable_product_versions_fn() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $fn$
BEGIN
  IF OLD.kind IN ('productVersion','contextProductVersion','retailPriceVersion','internalPriceVersion','productUseSnapshot','productMigration') THEN RAISE EXCEPTION 'Immutable product record' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER immutable_product_versions BEFORE UPDATE ON __SCHEMA__.records FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.immutable_product_versions_fn();
