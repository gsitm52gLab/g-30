CREATE UNIQUE INDEX IF NOT EXISTS context_product_identity ON records(context_id, json_extract(data,'$.productId')) WHERE kind='contextProduct';
CREATE UNIQUE INDEX IF NOT EXISTS context_product_code ON records(context_id, json_extract(data,'$.normalizedCode')) WHERE kind='contextProduct';
CREATE UNIQUE INDEX IF NOT EXISTS product_version_sequence ON records(json_extract(data,'$.productId'),json_extract(data,'$.sequence')) WHERE kind='productVersion';
CREATE UNIQUE INDEX IF NOT EXISTS context_product_version_sequence ON records(json_extract(data,'$.contextProductId'),json_extract(data,'$.sequence')) WHERE kind='contextProductVersion';
CREATE UNIQUE INDEX IF NOT EXISTS product_price_identity ON records(kind,json_extract(data,'$.contextProductId')) WHERE kind IN ('retailPrice','internalPrice');
CREATE UNIQUE INDEX IF NOT EXISTS product_price_version_sequence ON records(kind,json_extract(data,'$.priceId'),json_extract(data,'$.sequence')) WHERE kind IN ('retailPriceVersion','internalPriceVersion');
CREATE TRIGGER IF NOT EXISTS immutable_product_versions BEFORE UPDATE ON records
WHEN OLD.kind IN ('productVersion','contextProductVersion','retailPriceVersion','internalPriceVersion','productUseSnapshot','productMigration')
BEGIN SELECT RAISE(ABORT, 'Immutable product record'); END;
